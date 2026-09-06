"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../tools/dataset-builder/lib/core.js");
const osmService = require("../osm-service.js");
const turf = require("../vendor/turf/turf.min.js");

// Erzeuge eine quadratische Referenz-Gemeinde (Siegen-Mock: admin_level 8)
// Koordinaten: lon 8.0 bis 8.1, lat 50.8 bis 50.9 (ca. 7x11 km)
const MOCK_MUNICIPALITY_BOUNDARY = {
  type: "Polygon",
  coordinates: [[
    [8.00, 50.80],
    [8.10, 50.80],
    [8.10, 50.90],
    [8.00, 50.90],
    [8.00, 50.80]
  ]]
};

const MOCK_MUNICIPALITY = {
  osmId: 163256,
  name: "Siegen",
  adminLevel: 8
};

const BOUNDARY_FEATURE = turf.feature(MOCK_MUNICIPALITY_BOUNDARY);

test("A. Child Area vollständig innen -> ACCEPT (ACCEPTED_CHILD_ADMIN_AREA)", () => {
  const childCandidate = {
    identity: { type: "relation", id: 3294251 },
    name: "Eisern",
    tags: {
      name: "Eisern",
      boundary: "administrative",
      admin_level: "10"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [8.02, 50.82],
        [8.05, 50.82],
        [8.05, 50.85],
        [8.02, 50.85],
        [8.02, 50.82]
      ]]
    }
  };

  const result = core.classifyAreaCandidate(childCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, true);
  assert.equal(result.report.decision, "accepted");
  assert.equal(result.report.reason, "ACCEPTED_CHILD_ADMIN_AREA");
  assert.equal(result.report.contained, true);
  assert.equal(result.report.ratioInside, 1.0);
  assert.equal(result.report.centerInside, true);
  assert.equal(result.report.hierarchyMatch, true);
});

test("B. Nachbarkommune mit gleichem admin_level (8) und gemeinsamer Grenze -> REJECT (REJECTED_SAME_ADMIN_LEVEL)", () => {
  // Kreuztal liegt nördlich angrenzend, teilt die Grenzlinie lat 50.90
  const neighborCandidate = {
    identity: { type: "relation", id: 163254 },
    name: "Kreuztal",
    tags: {
      name: "Kreuztal",
      boundary: "administrative",
      admin_level: "8"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [8.00, 50.90],
        [8.10, 50.90],
        [8.10, 51.00],
        [8.00, 51.00],
        [8.00, 50.90]
      ]]
    }
  };

  const result = core.classifyAreaCandidate(neighborCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, false);
  assert.equal(result.report.decision, "rejected");
  assert.equal(result.report.reason, "REJECTED_SAME_ADMIN_LEVEL");
  assert.equal(result.report.contained, false);
});

test("C. Area vollständig außerhalb -> REJECT (REJECTED_OUTSIDE)", () => {
  // Buschhütten liegt vollständig im Norden außerhalb von Siegen
  const outsideCandidate = {
    identity: { type: "relation", id: 5486489 },
    name: "Buschhütten",
    tags: {
      name: "Buschhütten",
      boundary: "administrative",
      admin_level: "10"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [8.02, 50.92],
        [8.06, 50.92],
        [8.06, 50.96],
        [8.02, 50.96],
        [8.02, 50.92]
      ]]
    }
  };

  const result = core.classifyAreaCandidate(outsideCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, false);
  assert.equal(result.report.decision, "rejected");
  assert.equal(result.report.reason, "REJECTED_OUTSIDE");
  assert.equal(result.report.contained, false);
  assert.equal(result.report.ratioInside, 0);
  assert.equal(result.report.centerInside, false);
});

test("D. Area teilweise überschneidend (< 85% inside) -> REJECT (REJECTED_PARTIAL_OVERLAP)", () => {
  // Gebiet liegt zur Hälfte innerhalb und zur Hälfte außerhalb (50% Überdeckung)
  const overlappingCandidate = {
    identity: { type: "relation", id: 999901 },
    name: "Halb-Draußen",
    tags: {
      name: "Halb-Draußen",
      boundary: "administrative",
      admin_level: "10"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [8.05, 50.85],
        [8.15, 50.85],
        [8.15, 50.95],
        [8.05, 50.95],
        [8.05, 50.85]
      ]]
    }
  };

  const result = core.classifyAreaCandidate(overlappingCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, false);
  assert.equal(result.report.decision, "rejected");
  assert.equal(result.report.reason, "REJECTED_PARTIAL_OVERLAP");
  assert.equal(result.report.contained, false);
  assert.ok(result.report.ratioInside < 0.85 && result.report.ratioInside > 0);
});

test("E. Area vollständig innen aber ungeeigneter Typ -> REJECT (REJECTED_UNSUPPORTED_TYPE)", () => {
  // Naturpark oder Wahlkreis ohne administrative Gemeindegliederung
  const wrongTypeCandidate = {
    identity: { type: "relation", id: 999902 },
    name: "Landschaftsschutzgebiet",
    tags: {
      name: "Landschaftsschutzgebiet",
      boundary: "protected_area"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [8.02, 50.82],
        [8.05, 50.82],
        [8.05, 50.85],
        [8.02, 50.85],
        [8.02, 50.82]
      ]]
    }
  };

  const result = core.classifyAreaCandidate(wrongTypeCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, false);
  assert.equal(result.report.decision, "rejected");
  assert.equal(result.report.reason, "REJECTED_UNSUPPORTED_TYPE");
});

test("F. Gültige place=suburb Area innen -> ACCEPT (ACCEPTED_CONTAINED_PLACE)", () => {
  const suburbCandidate = {
    identity: { type: "relation", id: 999903 },
    name: "Sonnensiedlung",
    tags: {
      name: "Sonnensiedlung",
      place: "suburb"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [8.02, 50.82],
        [8.05, 50.82],
        [8.05, 50.85],
        [8.02, 50.85],
        [8.02, 50.82]
      ]]
    }
  };

  const result = core.classifyAreaCandidate(suburbCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, true);
  assert.equal(result.report.decision, "accepted");
  assert.equal(result.report.reason, "ACCEPTED_CONTAINED_PLACE");
  assert.equal(result.report.category, "place");
  assert.equal(result.report.contained, true);
});

test("G. MultiPolygon Child Area vollständig innen -> korrekt verarbeitet", () => {
  const multiPolyCandidate = {
    identity: { type: "relation", id: 999904 },
    name: "Insel-Stadtteil",
    tags: {
      name: "Insel-Stadtteil",
      boundary: "administrative",
      admin_level: "10"
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [[
          [8.01, 50.81],
          [8.03, 50.81],
          [8.03, 50.83],
          [8.01, 50.83],
          [8.01, 50.81]
        ]],
        [[
          [8.06, 50.86],
          [8.08, 50.86],
          [8.08, 50.88],
          [8.06, 50.88],
          [8.06, 50.86]
        ]]
      ]
    }
  };

  const result = core.classifyAreaCandidate(multiPolyCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, true);
  assert.equal(result.report.decision, "accepted");
  assert.equal(result.report.reason, "ACCEPTED_CHILD_ADMIN_AREA");
  assert.equal(result.report.contained, true);
  assert.equal(result.geometry.type, "MultiPolygon");
});

test("H. Gemeinsame Boundary numerisch stabil -> Nachbar berührt Grenze und wird sicher abgelehnt", () => {
  // Nachbar berührt die Grenze exakt auf lon 8.10 und ragt winzig hinein (Floating Point Drift < 0.05%)
  const touchingCandidate = {
    identity: { type: "relation", id: 999905 },
    name: "Grenzberührend",
    tags: {
      name: "Grenzberührend",
      boundary: "administrative",
      admin_level: "10"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [8.09999, 50.82],
        [8.15000, 50.82],
        [8.15000, 50.85],
        [8.09999, 50.85],
        [8.09999, 50.82]
      ]]
    }
  };

  const result = core.classifyAreaCandidate(touchingCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, false);
  assert.equal(result.report.decision, "rejected");
  assert.ok(["REJECTED_TOUCHING_BOUNDARY", "REJECTED_PARTIAL_OVERLAP"].includes(result.report.reason));
  assert.equal(result.report.contained, false);
});

test("I. Target Municipality selbst wird nicht als Sub-Area übernommen", () => {
  const selfCandidate = {
    identity: { type: "relation", id: 163256 },
    name: "Siegen",
    tags: {
      name: "Siegen",
      boundary: "administrative",
      admin_level: "8"
    },
    geometry: MOCK_MUNICIPALITY_BOUNDARY
  };

  const result = core.classifyAreaCandidate(selfCandidate, MOCK_MUNICIPALITY, BOUNDARY_FEATURE);
  assert.equal(result.accepted, false);
  assert.equal(result.report.decision, "rejected");
  assert.equal(result.report.reason, "REJECTED_TARGET_MUNICIPALITY");
});

test("J. osmService.discoverTrainingAreas weist externe Nachbarn via boundary & adminLevel ab", () => {
  const elements = [
    // Internes Kind (admin_level 10)
    {
      type: "relation",
      id: 3294251,
      tags: { name: "Eisern", boundary: "administrative", admin_level: "10" },
      members: [{
        type: "way", role: "outer",
        geometry: [[8.02, 50.82], [8.05, 50.82], [8.05, 50.85], [8.02, 50.85], [8.02, 50.82]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    },
    // Weiteres internes Kind (admin_level 10)
    {
      type: "relation",
      id: 3294266,
      tags: { name: "Weidenau", boundary: "administrative", admin_level: "10" },
      members: [{
        type: "way", role: "outer",
        geometry: [[8.05, 50.85], [8.08, 50.85], [8.08, 50.88], [8.05, 50.88], [8.05, 50.85]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    },
    // Externe Nachbarkommune Kreuztal (admin_level 8)
    {
      type: "relation",
      id: 163254,
      tags: { name: "Kreuztal", boundary: "administrative", admin_level: "8" },
      members: [{
        type: "way", role: "outer",
        geometry: [[8.00, 50.90], [8.10, 50.90], [8.10, 51.00], [8.00, 51.00], [8.00, 50.90]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    },
    // Externer Nachbar-Ortsteil Buschhütten (admin_level 10)
    {
      type: "relation",
      id: 5486489,
      tags: { name: "Buschhütten", boundary: "administrative", admin_level: "10" },
      members: [{
        type: "way", role: "outer",
        geometry: [[8.02, 50.92], [8.06, 50.92], [8.06, 50.96], [8.02, 50.96], [8.02, 50.92]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    }
  ];

  const discovered = osmService.discoverTrainingAreas(
    elements,
    MOCK_MUNICIPALITY,
    MOCK_MUNICIPALITY_BOUNDARY
  );

  assert.equal(discovered.length, 2);
  assert.ok(discovered.some(a => a.name === "Eisern"));
  assert.ok(discovered.some(a => a.name === "Weidenau"));
  assert.ok(!discovered.some(a => a.name === "Kreuztal"), "Kreuztal must be rejected");
  assert.ok(!discovered.some(a => a.name === "Buschhütten"), "Buschhütten must be rejected");
});

