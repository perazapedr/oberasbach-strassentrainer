"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const areas = require("../custom-training-area.js");

const DATASET_ID = "synthetic-district";
const DISTRICT = { type: "Polygon", coordinates: [[
  [7, 50], [8, 50], [8, 51], [7, 51], [7, 50]
]] };

function polygon(west = 7.1, south = 50.1, east = 7.4, north = 50.4) {
  return { type: "Polygon", coordinates: [[
    [west, south], [east, south], [east, north], [west, north], [west, south]
  ]] };
}

function importArea(geometry = polygon(), overrides = {}) {
  return areas.importResponseArea({
    type: "Feature",
    properties: { name: "SYNTHETIC Response Area", datasetId: DATASET_ID, ...overrides },
    geometry
  }, {
    datasetId: DATASET_ID,
    cityBoundary: DISTRICT,
    existingAreas: []
  });
}

test("17.2 response model remains one TrainingArea contract with dataset context", () => {
  const area = areas.createArea({
    cityId: DATASET_ID,
    name: "SYNTHETIC local response",
    kind: "response_area",
    points: polygon().coordinates[0],
    cityBoundary: DISTRICT,
    parentId: "municipality-a",
    uuidFactory: () => "stable-response"
  });
  assert.equal(area.id, "user-area-stable-response");
  assert.equal(area.cityId, DATASET_ID);
  assert.equal(area.datasetId, DATASET_ID);
  assert.equal(area.kind, "response_area");
  assert.equal(area.areaType, "fire_response");
  assert.equal(area.parentId, "municipality-a");
  assert.equal(area.source, "user");
  assert.equal(area.local, true);
  assert.equal(area.curated, false);
});

test("17.2 curated response area is modelled but not user-owned", () => {
  const area = areas.createArea({
    id: "curated-response-synthetic-1",
    cityId: DATASET_ID,
    name: "SYNTHETIC curated response",
    kind: "response_area",
    geometry: polygon(),
    cityBoundary: DISTRICT,
    source: "curated",
    provenance: { source: "curation", label: "SYNTHETIC TEST DATA" }
  });
  assert.equal(areas.isCuratedArea(area), true);
  assert.equal(areas.isUserArea(area), false);
  assert.equal(area.local, false);
  assert.equal(area.curated, true);
});

test("17.2 Polygon import is stable and tagged as imported local response", () => {
  const first = importArea();
  const second = importArea();
  assert.equal(first.id, second.id);
  assert.equal(first.kind, "response_area");
  assert.deepEqual(first.provenance, { source: "import", label: "GeoJSON import" });
});

test("17.2 MultiPolygon import uses the identical canonical geometry path", () => {
  const geometry = { type: "MultiPolygon", coordinates: [
    polygon(7.1, 50.1, 7.2, 50.2).coordinates,
    polygon(7.6, 50.6, 7.7, 50.7).coordinates
  ] };
  const area = importArea(geometry);
  assert.equal(area.boundary.type, "MultiPolygon");
  assert.equal(areas.isContainedInCity(area.boundary, DISTRICT), true);
});

test("17.2 import is atomic and rejects multi-feature, cross-dataset and unsupported geometry", () => {
  assert.throws(() => areas.importResponseArea({ type: "FeatureCollection", features: [] }, {
    datasetId: DATASET_ID, cityBoundary: DISTRICT
  }), { code: "AREA_IMPORT_NOT_ATOMIC" });
  assert.throws(() => importArea(polygon(), { datasetId: "other-dataset" }), { code: "AREA_DATASET_MISMATCH" });
  assert.throws(() => importArea({ type: "Point", coordinates: [7.2, 50.2] }), { code: "GEOMETRY_TYPE_INVALID" });
  assert.throws(() => importArea({ type: "LineString", coordinates: [[7.2, 50.2], [7.3, 50.3]] }), { code: "GEOMETRY_TYPE_INVALID" });
});

test("17.2 containment accepts district-internal cross-municipality geometry", () => {
  const crossMunicipality = polygon(7.35, 50.2, 7.65, 50.8);
  const area = importArea(crossMunicipality);
  assert.equal(area.invalid, false);
  assert.equal(areas.classifyAreaContainment(area.boundary, DISTRICT).status, "inside");
});

test("17.2 containment distinguishes partial and fully outside", () => {
  assert.equal(areas.classifyAreaContainment(polygon(7.8, 50.2, 8.2, 50.4), DISTRICT).status, "partial");
  assert.equal(areas.classifyAreaContainment(polygon(8.2, 50.2, 8.4, 50.4), DISTRICT).status, "outside");
  assert.throws(() => importArea(polygon(7.8, 50.2, 8.2, 50.4)), error => (
    error.code === "AREA_OUTSIDE_CITY" && error.containmentStatus === "partial"
  ));
});

test("17.2 response membership computes street and POI targets without entity copies", () => {
  const area = importArea();
  const street = { id: "street-inside", geometry: { type: "MultiLineString", coordinates: [[[7.2, 50.2], [7.3, 50.3]]] } };
  const poi = { id: "poi-inside", position: { lon: 7.2, lat: 50.2 } };
  const membership = areas.computeMembership(DATASET_ID, area, [street], [poi], { force: true });
  assert.equal(membership.streetTargets[0], street);
  assert.equal(membership.poiTargets[0], poi);
  assert.equal(Object.hasOwn(area, "streetIds"), false);
  assert.equal(Object.hasOwn(area, "poiIds"), false);
});

test("17.3 normalization closes rings and removes direct numeric zero segments", () => {
  const normalized = areas.canonicalizeAreaGeometry({ type: "Polygon", coordinates: [[
    [7.1, 50.1], [7.1, 50.1], [7.4, 50.1], [7.4, 50.4], [7.1, 50.4]
  ]] });
  assert.equal(normalized.coordinates[0].length, 5);
  assert.deepEqual(normalized.coordinates[0][0], normalized.coordinates[0].at(-1));
});

test("17.3 normalization rejects empty, NaN, Infinity and self intersection", () => {
  assert.throws(() => areas.canonicalizeAreaGeometry({ type: "Polygon", coordinates: [] }), { code: "POLYGON_EMPTY" });
  assert.throws(() => areas.normalizePolygon([[7, 50], [NaN, 50.2], [7.2, 50.2]]), { code: "POLYGON_COORDINATE_INVALID" });
  assert.throws(() => areas.normalizePolygon([[7, 50], [Infinity, 50.2], [7.2, 50.2]]), { code: "POLYGON_COORDINATE_INVALID" });
  assert.throws(() => areas.normalizePolygon([[7.1, 50.1], [7.4, 50.4], [7.1, 50.4], [7.4, 50.1]]), { code: "POLYGON_SELF_INTERSECTION" });
});

test("17.3 boundary touch is explicitly accepted while positive outside area is rejected", () => {
  const touch = polygon(7, 50.2, 7.4, 50.4);
  const result = areas.classifyAreaContainment(touch, DISTRICT);
  assert.equal(result.accepted, true);
  assert.equal(result.status, "boundary_touch");
  assert.equal(areas.classifyAreaContainment(polygon(6.999, 50.2, 7.4, 50.4), DISTRICT).accepted, false);
});

test("17.3 Leaflet and import converge on canonical longitude/latitude GeoJSON", () => {
  const clicks = [
    { lat: 50.1, lng: 7.1 }, { lat: 50.1, lng: 7.4 },
    { lat: 50.4, lng: 7.4 }, { lat: 50.4, lng: 7.1 }
  ].map(areas.leafletLatLngToGeoJsonCoordinate);
  const editorGeometry = areas.normalizePolygon(clicks);
  const importedGeometry = areas.canonicalizeAreaGeometry(polygon());
  assert.deepEqual(editorGeometry, importedGeometry);
  assert.deepEqual(editorGeometry.coordinates[0][0], [7.1, 50.1]);
});

