"use strict";

const assert = require("node:assert/strict");
const validatorApi = require("../city-data-validator.js");
const osmApi = require("../osm-service.js");

const tests = [];
const CITY_ID = "osm-relation-7001";

function test(name, run) {
  tests.push({ name, run });
}

function circularBoundary(pointCount = 400) {
  const ring = [];
  for (let index = 0; index < pointCount; index += 1) {
    const angle = index / pointCount * Math.PI * 2;
    ring.push([10.5 + Math.cos(angle) * 0.45, 49.5 + Math.sin(angle) * 0.45]);
  }
  ring.push([...ring[0]]);
  return { type: "Polygon", coordinates: [ring] };
}

function street(index) {
  return {
    id: `${CITY_ID}:street-${index}`,
    cityId: CITY_ID,
    name: `Teststraße ${index}`,
    aliases: [],
    geometry: {
      type: "MultiLineString",
      coordinates: [[[10.3, 49.3 + index * 0.01], [10.4, 49.31 + index * 0.01]]]
    },
    osmWayIds: [index + 1]
  };
}

function poi(index, overrides = {}) {
  return {
    id: `${CITY_ID}:poi:node-${index}`,
    cityId: CITY_ID,
    name: `POI ${index}`,
    category: "school",
    aliases: [],
    position: { lat: 49.5 + index * 0.00001, lon: 10.5 },
    geometry: null,
    osmType: "node",
    osmId: 10000 + index,
    tags: {},
    ...overrides
  };
}

function cityPackage(pois, boundary = circularBoundary()) {
  const streets = Array.from({ length: 5 }, (_, index) => street(index));
  return {
    city: {
      id: CITY_ID,
      name: "Performancestadt",
      osmType: "relation",
      osmId: 7001,
      bounds: { south: 49, west: 10, north: 50, east: 11 },
      center: { lat: 49.5, lon: 10.5 },
      streetCount: streets.length,
      poiCount: pois.length
    },
    streets,
    pois,
    boundary
  };
}

test("Boundary-Index prüft nur relevante Ringkanten und erhält das Validatorergebnis", () => {
  const diagnostics = {};
  const input = cityPackage([]);
  const result = validatorApi.validateCityData(input, { sourceMode: "download", diagnostics });
  assert.equal(result.valid, true);
  assert.equal(result.streets.length, 5);
  const naivePointEdgePairs = diagnostics.counts.streetBoundaryPointsTested * 400;
  assert.ok(diagnostics.counts.boundaryEdgesTested < naivePointEdgePairs / 4);
  assert.ok(diagnostics.timingsMs.streetBoundaryMs >= 0);
  assert.ok(diagnostics.timingsMs.validatorTotalMs >= 0);
});

test("Boundary-Index erhält die Semantik auf dem Rand eines Polygonlochs", () => {
  const boundary = {
    type: "Polygon",
    coordinates: [
      [[10, 49], [11, 49], [11, 50], [10, 50], [10, 49]],
      [[10.4, 49.4], [10.6, 49.4], [10.6, 49.6], [10.4, 49.6], [10.4, 49.4]]
    ]
  };
  const input = cityPackage([], boundary);
  input.streets.forEach((item, index) => {
    item.geometry.coordinates = index === 0
      ? [[[10.4, 49.45], [10.4, 49.55]]]
      : [[[10.2, 49.2 + index * 0.01], [10.3, 49.21 + index * 0.01]]];
  });
  const result = validatorApi.validateCityData(input, { sourceMode: "download", diagnostics: {} });
  assert.equal(result.valid, true);
  assert.equal(result.streets.length, 5);
  assert.equal(result.validation.streets.errors.some(error => error.code === "STREET_OUTSIDE_BOUNDARY"), false);
});

test("POI-Namensindex vermeidet den quadratischen Vollpaarraum", () => {
  const pois = Array.from({ length: 120 }, (_, index) => poi(index));
  const diagnostics = {};
  const result = validatorApi.validateCityData(cityPackage(pois), {
    sourceMode: "download",
    diagnostics
  });
  assert.equal(result.valid, true);
  assert.equal(result.pois.length, 120);
  assert.equal(diagnostics.counts.poiNormalFormsPrepared, 120);
  assert.equal(diagnostics.counts.poiIndexedCandidatePairs || 0, 0);
  assert.equal(diagnostics.counts.poiPossibleCandidatePairsTested || 0, 0);
});

test("gleiche Namen und Aliase bleiben vollständige POI-Kandidaten", () => {
  const pois = [
    poi(1, { name: "Gemeinschaftsschule", position: { lat: 49.5, lon: 10.5 } }),
    poi(2, { name: "Gemeinschaftsschule", position: { lat: 49.5001, lon: 10.5 } }),
    poi(3, { name: "Schulzentrum", aliases: ["Gemeinschaftsschule"], position: { lat: 49.8, lon: 10.8 } }),
    poi(4, { name: "Andere Schule", position: { lat: 49.5001, lon: 10.5 } })
  ];
  const diagnostics = {};
  const result = validatorApi.validateCityData(cityPackage(pois), {
    sourceMode: "download",
    diagnostics
  });
  const duplicateWarnings = result.validation.pois.warnings
    .filter(warning => warning.code === "POI_POSSIBLE_DUPLICATE");
  assert.equal(duplicateWarnings.length, 1);
  assert.deepEqual(duplicateWarnings[0].details.candidateIds, [pois[0].id, pois[1].id]);
  assert.ok(diagnostics.counts.poiPossibleCandidatePairsTested >= 3);
  assert.ok(diagnostics.counts.poiPossibleCandidatePairsTested < 6);
});

test("OSM-Verarbeitung meldet getrennte CPU-Phasen ohne Ergebnisänderung", async () => {
  const relationId = 7001;
  const boundary = {
    type: "relation",
    id: relationId,
    members: [{
      type: "way",
      role: "outer",
      geometry: [
        { lat: 49, lon: 10 }, { lat: 49, lon: 11 }, { lat: 50, lon: 11 },
        { lat: 50, lon: 10 }, { lat: 49, lon: 10 }
      ]
    }]
  };
  const way = {
    type: "way",
    id: 1,
    tags: { highway: "residential", name: "Messstraße" },
    geometry: [{ lat: 49.4, lon: 10.4 }, { lat: 49.6, lon: 10.6 }]
  };
  const school = {
    type: "node",
    id: 2,
    lat: 49.5,
    lon: 10.5,
    tags: { amenity: "school", name: "Messschule" }
  };
  const service = osmApi.createOsmService({
    requestIntervalMs: 0,
    downloadPlanFactory: municipality => osmApi.createDownloadPlan(municipality, {
      areaThresholdSquareKilometers: 20000,
      maxSpanKilometers: 200
    }),
    fetch: async (url, options) => {
      const query = new URLSearchParams(options.body).get("data") || "";
      return {
        ok: true,
        status: 200,
        async json() { return { elements: query.includes("map_to_area") ? [way, way, school] : [boundary] }; }
      };
    }
  });
  const diagnostics = {};
  const result = await service.fetchCityData({
    name: "Performancestadt",
    osmType: "relation",
    osmId: relationId,
    placeType: "administrative",
    bounds: { south: 49, west: 10, north: 50, east: 11 },
    center: { lat: 49.5, lon: 10.5 }
  }, { diagnostics });

  assert.equal(result.streets.length, 1);
  assert.equal(result.pois.length, 1);
  assert.equal(result.downloadDiagnostics.rawObjectsBeforeDeduplication, 3);
  assert.equal(result.downloadDiagnostics.rawObjectsAfterDeduplication, 2);
  for (const phase of [
    "boundaryProcessingMs", "chunkRawCollectionMs", "osmDedupeMs", "streetExtractionMs",
    "streetGroupingMs", "streetGeometryMs", "poiExtractionMs", "poiNormalizationMs"
  ]) assert.ok(diagnostics.timingsMs[phase] >= 0, `fehlende Diagnosephase ${phase}`);
  assert.equal(diagnostics.counts.osmObjectsDeduplicated, 1);
});

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }
  console.log(`\n${passed}/${tests.length} Performance-Architekturtests bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
