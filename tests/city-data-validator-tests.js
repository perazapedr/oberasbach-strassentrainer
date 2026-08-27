"use strict";

const assert = require("node:assert/strict");
const {
  SUPPORTED_POI_CATEGORIES,
  STREET_MERGE_DISTANCE_METERS,
  POI_POSSIBLE_DUPLICATE_DISTANCE_METERS,
  CURATED_POSITION_DIFFERENCE_METERS,
  validateCityData,
  compareWithCuratedData
} = require("../city-data-validator.js");

const tests = [];
let nextWayId = 100;
let nextPoiId = 1000;

function test(name, run) {
  tests.push({ name, run });
}

function city(overrides = {}) {
  return {
    id: "osm-relation-1",
    name: "Teststadt",
    displayName: "Teststadt",
    osmType: "relation",
    osmId: 1,
    bounds: { south: 49, west: 9.99, north: 49.03, east: 10.03 },
    center: { lat: 49.01, lon: 10.01 },
    streetCount: 1,
    poiCount: 1,
    source: "openstreetmap",
    dataVersion: 1,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
    ...overrides
  };
}

function boundary(overrides = {}) {
  return {
    type: "Polygon",
    coordinates: [[
      [10, 49], [10.02, 49], [10.02, 49.02], [10, 49.02], [10, 49]
    ]],
    ...overrides
  };
}

function street(id = "street-1", name = "Hauptstraße", coordinates, overrides = {}) {
  const osmWayId = nextWayId++;
  return {
    id,
    cityId: "osm-relation-1",
    name,
    aliases: [],
    geometry: {
      type: "MultiLineString",
      coordinates: coordinates || [[[10.005, 49.005], [10.01, 49.01]]]
    },
    osmWayIds: [osmWayId],
    ...overrides
  };
}

function poi(id = "poi-1", name = "Grundschule Teststadt", position, overrides = {}) {
  const osmId = nextPoiId++;
  return {
    id,
    cityId: "osm-relation-1",
    name,
    category: "school",
    aliases: [],
    position: position || { lat: 49.01, lon: 10.01 },
    geometry: null,
    osmType: "node",
    osmId,
    tags: { amenity: "school" },
    ...overrides
  };
}

function polygon(minLon = 10.006, minLat = 49.006, size = 0.002) {
  return {
    type: "Polygon",
    coordinates: [[
      [minLon, minLat], [minLon + size, minLat], [minLon + size, minLat + size],
      [minLon, minLat + size], [minLon, minLat]
    ]]
  };
}

function packageFixture(overrides = {}) {
  return {
    city: city(),
    boundary: boundary(),
    streets: [street()],
    pois: [poi()],
    ...overrides
  };
}

function allCodes(result) {
  return [
    ...result.validation.municipality.errors,
    ...result.validation.municipality.warnings,
    ...result.validation.streets.errors,
    ...result.validation.streets.warnings,
    ...result.validation.pois.errors,
    ...result.validation.pois.warnings
  ].map(entry => entry.code);
}

test("Browser-Global und öffentliche API sind verfügbar", () => {
  assert.ok(globalThis.StrassentrainerCityDataValidator);
  assert.equal(typeof globalThis.StrassentrainerCityDataValidator.validateCityData, "function");
  assert.equal(typeof globalThis.StrassentrainerCityDataValidator.compareWithCuratedData, "function");
});

test("zentrale Kategorien und Schwellenwerte sind dokumentiert exportiert", () => {
  assert.deepEqual(SUPPORTED_POI_CATEGORIES, ["fire_station", "school", "kindergarten", "supermarket"]);
  assert.equal(STREET_MERGE_DISTANCE_METERS, 8);
  assert.equal(POI_POSSIBLE_DUPLICATE_DISTANCE_METERS, 50);
  assert.equal(CURATED_POSITION_DIFFERENCE_METERS, 50);
});

test("vollständig gültiges Stadtpaket bleibt gültig", () => {
  const result = validateCityData(packageFixture());
  assert.equal(result.valid, true);
  assert.equal(result.validation.summary.errorCount, 0);
  assert.equal(result.streets.length, 1);
  assert.equal(result.pois.length, 1);
});

test("Validierung mutiert das Eingangspaket nicht", () => {
  const input = packageFixture();
  const before = structuredClone(input);
  validateCityData(input);
  assert.deepEqual(input, before);
});

test("identischer Input erzeugt deterministische Ausgabe", () => {
  const input = packageFixture();
  assert.deepEqual(validateCityData(input), validateCityData(input));
});

test("fehlendes city-Objekt macht das Paket kontrolliert ungültig", () => {
  const result = validateCityData(packageFixture({ city: null }));
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_MISSING"));
});

test("fehlende Stadt-ID ist fatal", () => {
  const result = validateCityData(packageFixture({ city: city({ id: "" }) }));
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_ID_MISSING"));
});

test("fehlende Boundary ist fatal und Bounds dienen nicht als Ersatz", () => {
  const result = validateCityData(packageFixture({ boundary: undefined }));
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_BOUNDARY_MISSING"));
});

test("ungültige Boundary wird kontrolliert gemeldet", () => {
  const result = validateCityData(packageFixture({ boundary: { type: "Polygon", coordinates: [] } }));
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_BOUNDARY_INVALID"));
});

test("gültiges MultiPolygon wird als administrative Grenze akzeptiert", () => {
  const secondPolygon = [[[10.03, 49.03], [10.04, 49.03], [10.04, 49.04], [10.03, 49.04], [10.03, 49.03]]];
  const multi = { type: "MultiPolygon", coordinates: [boundary().coordinates, secondPolygon] };
  assert.equal(validateCityData(packageFixture({ boundary: multi })).valid, true);
});

test("ungültige Bounds sind ein fundamentaler Stadtfehler", () => {
  const result = validateCityData(packageFixture({ city: city({ bounds: { south: 50, west: 10, north: 49, east: 11 } }) }));
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_BOUNDS_INVALID"));
});

test("ungültiger Center ist ein fundamentaler Stadtfehler", () => {
  const result = validateCityData(packageFixture({ city: city({ center: { lat: 200, lon: 10 } }) }));
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_CENTER_INVALID"));
});

test("Center außerhalb der Boundary ist eine Warnung", () => {
  const result = validateCityData(packageFixture({ city: city({ center: { lat: 49.025, lon: 10.025 } }) }));
  assert.equal(result.valid, true);
  assert.ok(allCodes(result).includes("CITY_CENTER_OUTSIDE_BOUNDARY"));
});

test("Straße vollständig innerhalb bleibt erhalten", () => {
  const result = validateCityData(packageFixture({ streets: [street()] }));
  assert.equal(result.streets.length, 1);
  assert.equal(result.validation.streets.invalidRemoved, 0);
});

test("Straße innerhalb der Bounds, aber außerhalb der echten Boundary wird entfernt", () => {
  const outside = street("outside", "Außenstraße", [[[10.025, 49.005], [10.026, 49.006]]]);
  const result = validateCityData(packageFixture({ streets: [street(), outside] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_OUTSIDE_BOUNDARY"));
});

test("Straße mit nur kreuzendem Segment bleibt mit Teilwarnung erhalten", () => {
  const crossing = street("crossing", "Querstraße", [[[9.999, 49.01], [10.021, 49.01]]]);
  const result = validateCityData(packageFixture({ streets: [crossing] }));
  assert.equal(result.valid, true);
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_PARTLY_OUTSIDE_BOUNDARY"));
});

test("leere Street-Geometrie wird entfernt", () => {
  const broken = street("empty", "Leerstraße", [], { geometry: { type: "MultiLineString", coordinates: [] } });
  const result = validateCityData(packageFixture({ streets: [street(), broken] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_GEOMETRY_INVALID"));
});

test("NaN in Street-Koordinate wird entfernt", () => {
  const broken = street("nan", "NaN-Straße", [[[NaN, 49.01], [10.01, 49.01]]]);
  const result = validateCityData(packageFixture({ streets: [street(), broken] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_GEOMETRY_INVALID"));
});

test("LineString-Komponente mit nur einem Punkt ist unbrauchbar", () => {
  const broken = street("point", "Punktstraße", [[[10.01, 49.01]]]);
  const result = validateCityData(packageFixture({ streets: [street(), broken] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_GEOMETRY_INVALID"));
});

test("fehlender Straßenname führt zur Entfernung", () => {
  const result = validateCityData(packageFixture({ streets: [street(), street("nameless", "   ")] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_NAME_MISSING"));
});

test("fehlende Straßen-ID führt zur Entfernung", () => {
  const result = validateCityData(packageFixture({ streets: [street(), street("", "Ohne ID")] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_ID_MISSING"));
});

test("falsche cityId einer Straße führt zur Entfernung", () => {
  const wrong = street("wrong-city", "Falsche Straße", undefined, { cityId: "andere-stadt" });
  const result = validateCityData(packageFixture({ streets: [street(), wrong] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_CITY_ID_INVALID"));
});

test("fehlende OSM-Way-IDs führen zur Entfernung", () => {
  const broken = street("no-way", "Waylose Straße", undefined, { osmWayIds: [] });
  const result = validateCityData(packageFixture({ streets: [street(), broken] }));
  assert.equal(result.streets.length, 1);
  assert.ok(allCodes(result).includes("STREET_OSM_WAY_IDS_INVALID"));
});

test("Unicode- und Großschreibungsvarianten werden nur bei räumlicher Evidenz gemerged", () => {
  const first = street("unicode-a", "Fürther Straße", [[[10.004, 49.005], [10.008, 49.008]]], { osmWayIds: [1] });
  const second = street("unicode-b", "FÜRTHER STRASSE", [[[10.008, 49.008], [10.012, 49.011]]], { osmWayIds: [2] });
  const result = validateCityData(packageFixture({ streets: [first, second] }));
  assert.equal(result.streets.length, 1);
  assert.deepEqual(result.streets[0].osmWayIds, [1, 2]);
  assert.ok([result.streets[0].name, ...result.streets[0].aliases].includes("Fürther Straße"));
  assert.ok([result.streets[0].name, ...result.streets[0].aliases].includes("FÜRTHER STRASSE"));
});

test("mehrfaches Whitespace wird für sicheren Vergleich normalisiert", () => {
  const first = street("space-a", "Fürther  Straße", [[[10.004, 49.005], [10.008, 49.008]]], { osmWayIds: [3] });
  const second = street("space-b", "Fürther Straße", [[[10.008, 49.008], [10.012, 49.011]]], { osmWayIds: [4] });
  const result = validateCityData(packageFixture({ streets: [first, second] }));
  assert.equal(result.validation.streets.duplicatesMerged, 1);
});

test("Straße-/Str.-Varianten werden als Kandidaten erkannt, aber räumlich getrennt nicht gemerged", () => {
  const first = street("abbr-a", "Hauptstraße", [[[10.002, 49.002], [10.004, 49.004]]]);
  const second = street("abbr-b", "Hauptstr.", [[[10.015, 49.015], [10.017, 49.017]]]);
  const result = validateCityData(packageFixture({ streets: [first, second] }));
  assert.equal(result.streets.length, 2);
  assert.equal(result.validation.streets.duplicatesMerged, 0);
  assert.ok(allCodes(result).includes("STREET_POSSIBLE_DUPLICATE"));
});

test("räumlich getrennte identische Straßennamen werden nicht aggressiv gemerged", () => {
  const first = street("same-a", "Ringstraße", [[[10.002, 49.002], [10.004, 49.004]]]);
  const second = street("same-b", "Ringstraße", [[[10.015, 49.015], [10.017, 49.017]]]);
  const result = validateCityData(packageFixture({ streets: [first, second] }));
  assert.equal(result.streets.length, 2);
  assert.ok(allCodes(result).includes("STREET_POSSIBLE_DUPLICATE"));
});

test("sicherer Street-Merge vereinigt Namen, Aliase, Geometrien und Way-IDs", () => {
  const first = street("merge-a", "Hauptstraße", [[[10.002, 49.002], [10.008, 49.008]]], {
    aliases: ["Alte Hauptstraße"], osmWayIds: [11]
  });
  const second = street("merge-b", "Hauptstr.", [[[10.008, 49.008], [10.014, 49.014]]], {
    aliases: ["Haupt-Str."], osmWayIds: [12]
  });
  const result = validateCityData(packageFixture({ streets: [first, second] }));
  assert.equal(result.streets.length, 1);
  assert.equal(result.streets[0].name, "Hauptstraße");
  assert.deepEqual(result.streets[0].osmWayIds, [11, 12]);
  assert.equal(result.streets[0].geometry.coordinates.length, 2);
  assert.ok(result.streets[0].aliases.includes("Hauptstr."));
  assert.ok(result.streets[0].aliases.includes("Alte Hauptstraße"));
  assert.ok(allCodes(result).includes("STREET_DUPLICATE_MERGED"));
});

test("gültiger POI-Node innerhalb bleibt erhalten", () => {
  const result = validateCityData(packageFixture({ pois: [poi()] }));
  assert.equal(result.pois.length, 1);
  assert.equal(result.validation.pois.invalidRemoved, 0);
});

test("POI außerhalb der echten Gemeindegrenze wird entfernt", () => {
  const outside = poi("outside-poi", "Außenschule", { lat: 49.025, lon: 10.025 });
  const result = validateCityData(packageFixture({ pois: [poi(), outside] }));
  assert.equal(result.pois.length, 1);
  assert.ok(allCodes(result).includes("POI_OUTSIDE_BOUNDARY"));
});

test("POI ohne brauchbare Position oder Geometrie wird entfernt", () => {
  const broken = poi("bad-position", "Positionslose Schule", { lat: NaN, lon: 10 }, { geometry: null });
  const result = validateCityData(packageFixture({ pois: [poi(), broken] }));
  assert.equal(result.pois.length, 1);
  assert.ok(allCodes(result).includes("POI_POSITION_INVALID"));
});

test("Position wird lokal aus einer validen Polygongeometrie abgeleitet", () => {
  const areaPoi = poi("derived", "Flächenschule", { lat: NaN, lon: NaN }, {
    geometry: polygon(), osmType: "way"
  });
  const result = validateCityData(packageFixture({ pois: [areaPoi] }));
  assert.equal(result.valid, true);
  assert.equal(result.pois.length, 1);
  assert.ok(Number.isFinite(result.pois[0].position.lat));
  assert.ok(allCodes(result).includes("POI_POSITION_DERIVED_FROM_GEOMETRY"));
});

test("gültiges POI-Polygon innerhalb bleibt erhalten", () => {
  const areaPoi = poi("area", "Flächenschule", { lat: 49.007, lon: 10.007 }, {
    geometry: polygon(), osmType: "way"
  });
  const result = validateCityData(packageFixture({ pois: [areaPoi] }));
  assert.equal(result.pois[0].geometry.type, "Polygon");
});

test("POI mit geometry null und gültiger Position bleibt erlaubt", () => {
  const result = validateCityData(packageFixture({ pois: [poi("node", "Nodeschule", undefined, { geometry: null })] }));
  assert.equal(result.pois.length, 1);
  assert.equal(result.pois[0].geometry, null);
});

test("ungültige POI-Geometrie wird bei gültiger Position verworfen und gemeldet", () => {
  const invalidGeometry = { type: "Polygon", coordinates: [[[10.005, 49.005], [10.006, 49.005], [10.006, 49.006]]] };
  const result = validateCityData(packageFixture({ pois: [poi("invalid-area", "Schule", undefined, { geometry: invalidGeometry })] }));
  assert.equal(result.pois.length, 1);
  assert.equal(result.pois[0].geometry, null);
  assert.ok(allCodes(result).includes("POI_GEOMETRY_INVALID"));
});

test("teilweise außerhalb liegende POI-Fläche bleibt mit Warnung nutzbar", () => {
  const areaPoi = poi("partial-area", "Grenzschule", { lat: 49.01, lon: 10.019 }, {
    geometry: polygon(10.019, 49.009, 0.003), osmType: "way"
  });
  const result = validateCityData(packageFixture({ pois: [areaPoi] }));
  assert.equal(result.pois.length, 1);
  assert.ok(allCodes(result).includes("POI_PARTLY_OUTSIDE_BOUNDARY"));
});

test("sicherer Node-/Way-Duplikatfall wird automatisch gemerged", () => {
  const node = poi("school-node", "Grundschule Teststadt", { lat: 49.007, lon: 10.007 }, {
    osmType: "node", osmId: 201
  });
  const way = poi("school-way", "Grundschule Teststadt", { lat: 49.007, lon: 10.007 }, {
    osmType: "way", osmId: 202, geometry: polygon()
  });
  const result = validateCityData(packageFixture({ pois: [node, way] }));
  assert.equal(result.pois.length, 1);
  assert.equal(result.pois[0].id, "school-way");
  assert.equal(result.validation.pois.duplicatesMerged, 1);
  assert.ok(allCodes(result).includes("POI_DUPLICATE_MERGED"));
});

test("POI-Merge bewahrt beide OSM-Ursprünge", () => {
  const node = poi("source-node", "Quellschule", { lat: 49.007, lon: 10.007 }, { osmType: "node", osmId: 301 });
  const way = poi("source-way", "Quellschule", { lat: 49.007, lon: 10.007 }, { osmType: "way", osmId: 302, geometry: polygon() });
  const [merged] = validateCityData(packageFixture({ pois: [node, way] })).pois;
  assert.deepEqual(merged.sourceOsmObjects, [
    { osmType: "node", osmId: 301 },
    { osmType: "way", osmId: 302 }
  ]);
});

test("gleich benannte POIs an deutlich verschiedenen Standorten bleiben getrennt", () => {
  const first = poi("market-a", "ALDI Süd", { lat: 49.002, lon: 10.002 }, { category: "supermarket", tags: { shop: "supermarket" } });
  const second = poi("market-b", "ALDI Süd", { lat: 49.018, lon: 10.018 }, { category: "supermarket", tags: { shop: "supermarket" } });
  const result = validateCityData(packageFixture({ pois: [first, second] }));
  assert.equal(result.pois.length, 2);
  assert.ok(!allCodes(result).includes("POI_POSSIBLE_DUPLICATE"));
});

test("unsicheres nahes POI-Duplikat bleibt getrennt und wird gewarnt", () => {
  const first = poi("near-a", "Kita Sonnenschein", { lat: 49.01, lon: 10.01 }, { category: "kindergarten" });
  const second = poi("near-b", "Kita Sonnenschein", { lat: 49.0101, lon: 10.0101 }, { category: "kindergarten" });
  const result = validateCityData(packageFixture({ pois: [first, second] }));
  assert.equal(result.pois.length, 2);
  assert.ok(allCodes(result).includes("POI_POSSIBLE_DUPLICATE"));
});

test("unbekannte POI-Kategorie wird nicht umetikettiert", () => {
  const unknown = poi("unknown", "Krankenhaus", undefined, { category: "hospital" });
  const result = validateCityData(packageFixture({ pois: [poi(), unknown] }));
  assert.equal(result.pois.length, 1);
  assert.ok(allCodes(result).includes("POI_CATEGORY_INVALID"));
});

test("fehlender POI-Name führt zur Entfernung", () => {
  const result = validateCityData(packageFixture({ pois: [poi(), poi("nameless-poi", " ")] }));
  assert.equal(result.pois.length, 1);
  assert.ok(allCodes(result).includes("POI_NAME_MISSING"));
});

test("Stadt bleibt bei einzelnen fehlerhaften Objekten gültig", () => {
  const result = validateCityData(packageFixture({
    streets: [street("good"), street("bad", "", [])],
    pois: [poi(), poi("bad-poi", "Bad", { lat: 500, lon: 10 })]
  }));
  assert.equal(result.valid, true);
  assert.equal(result.streets.length, 1);
  assert.equal(result.pois.length, 1);
});

test("nach Validierung null spielbare Straßen macht die Stadt ungültig", () => {
  const result = validateCityData(packageFixture({ streets: [street("bad", "", [])] }));
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_NO_PLAYABLE_STREETS"));
});

test("null POIs sind bei vorhandener Straße zulässig", () => {
  const result = validateCityData(packageFixture({ pois: [] }));
  assert.equal(result.valid, true);
  assert.equal(result.pois.length, 0);
  assert.equal(result.city.poiCount, 0);
});

test("Input-, Invalid-, Merge- und Output-Counts sind mathematisch konsistent", () => {
  const first = street("count-a", "Zählstraße", [[[10.004, 49.004], [10.008, 49.008]]], { osmWayIds: [401] });
  const second = street("count-b", "Zählstr.", [[[10.008, 49.008], [10.012, 49.012]]], { osmWayIds: [402] });
  const invalid = street("count-invalid", "", []);
  const result = validateCityData(packageFixture({ streets: [first, second, invalid] }));
  const counts = result.validation.streets;
  assert.equal(counts.totalInput - counts.invalidRemoved - counts.duplicatesMerged, counts.totalOutput);
  assert.equal(counts.totalOutput, result.streets.length);
});

test("konfigurierbarer Street-Merge-Abstand kann automatischen Merge deaktivieren", () => {
  const first = street("threshold-a", "Nahstraße", [[[10.004, 49.004], [10.008, 49.008]]]);
  const second = street("threshold-b", "Nahstraße", [[[10.00801, 49.008], [10.012, 49.012]]]);
  const result = validateCityData(packageFixture({ streets: [first, second] }), { streetMergeDistanceMeters: 0 });
  assert.equal(result.streets.length, 2);
});

test("Straßenabgleich erkennt exakten Match sowie Einträge nur auf einer Seite", () => {
  const osm = {
    city: city(),
    streets: [street("osm-main", "Hauptstraße"), street("osm-only", "OSM-Straße")],
    pois: []
  };
  const curated = {
    streets: [
      { id: "cur-main", name: "Hauptstraße", aliases: [] },
      { id: "cur-only", name: "Kuratiertstraße", aliases: [] }
    ],
    pois: []
  };
  const result = compareWithCuratedData(osm, curated);
  assert.equal(result.streets.matched.length, 1);
  assert.equal(result.streets.onlyInOsm.length, 1);
  assert.equal(result.streets.onlyInCurated.length, 1);
});

test("Straßenabgleich meldet sichere Namensvariante neutral", () => {
  const result = compareWithCuratedData(
    { city: city(), streets: [street("osm", "Fürther Straße")], pois: [] },
    { streets: [{ id: "cur", name: "FÜRTHER STRASSE", aliases: [] }], pois: [] }
  );
  assert.equal(result.streets.matched.length, 1);
  assert.equal(result.streets.nameDifferences.length, 1);
  assert.equal(result.streets.nameDifferences[0].type, "name-variant");
});

test("mehrdeutiger Straßenmatch wird nicht als sichere Übereinstimmung gezählt", () => {
  const result = compareWithCuratedData(
    { city: city(), streets: [street("osm-a", "Ringstraße"), street("osm-b", "Ringstraße")], pois: [] },
    { streets: [{ id: "cur", name: "Ringstraße", aliases: [] }], pois: [] }
  );
  assert.equal(result.streets.matched.length, 0);
  assert.equal(result.streets.ambiguous.length, 1);
});

test("explizite kuratierte OSM-Way-ID hat beim Straßenmatch Vorrang", () => {
  const osmA = street("osm-a", "Neuer Name", undefined, { osmWayIds: [700] });
  const osmB = street("osm-b", "Alter Name", undefined, { osmWayIds: [701] });
  const result = compareWithCuratedData(
    { city: city(), streets: [osmA, osmB], pois: [] },
    { streets: [{ id: "cur", name: "Alter Name", osmWayId: 700 }], pois: [] }
  );
  assert.equal(result.streets.matched[0].osm.id, "osm-a");
  assert.equal(result.streets.matched[0].matchReason, "osm-reference");
});

test("ausdrücklich ausgeschlossener Highway-Typ wird nicht vorschnell als fehlend gemeldet", () => {
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [] },
    { streets: [{ id: "foot", name: "Fußweg", highway: "footway" }], pois: [] }
  );
  assert.equal(result.streets.onlyInCurated.length, 0);
  assert.equal(result.streets.notCompared.length, 1);
});

test("POI-Abgleich erkennt exakten Match", () => {
  const osmPoi = poi("osm-school", "Grundschule Teststadt", { lat: 49.01, lon: 10.01 });
  const curatedPoi = {
    id: "cur-school", displayName: "Grundschule Teststadt", category: "school",
    latitude: 49.01, longitude: 10.01, address: null, aliases: []
  };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.matched.length, 1);
  assert.equal(result.pois.onlyInOsm.length, 0);
  assert.equal(result.pois.onlyInCurated.length, 0);
});

test("POI-Abgleich meldet Einträge nur in OSM und nur kuratiert", () => {
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [poi("osm-only", "OSM-Schule", { lat: 49.002, lon: 10.002 })] },
    { streets: [], pois: [{ id: "cur-only", displayName: "Kuratiertschule", category: "school", latitude: 49.018, longitude: 10.018 }] }
  );
  assert.equal(result.pois.onlyInOsm.length, 1);
  assert.equal(result.pois.onlyInCurated.length, 1);
});

test("childcare wird fair auf die OSM-Kategorie kindergarten abgebildet", () => {
  const osmPoi = poi("osm-kita", "Kita Regenbogen", undefined, { category: "kindergarten" });
  const curatedPoi = { id: "cur-kita", displayName: "Kita Regenbogen", category: "childcare", latitude: 49.01, longitude: 10.01 };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.matched.length, 1);
  assert.equal(result.pois.categoryDifferences.length, 0);
});

test("kuratierte Feuerwehr-Unterkategorie wird auf fire_station abgebildet", () => {
  const osmPoi = poi("osm-fire", "Freiwillige Feuerwehr Teststadt", undefined, {
    category: "fire_station",
    tags: { amenity: "fire_station" }
  });
  const curatedPoi = {
    id: "cur-fire",
    displayName: "Freiwillige Feuerwehr Teststadt",
    category: "other-relevant",
    subcategory: "Feuerwehrgerätehaus",
    latitude: 49.01,
    longitude: 10.01
  };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.matched.length, 1);
  assert.equal(result.pois.notCompared.length, 0);
  assert.deepEqual(result.pois.categories.compared, ["other-relevant / Feuerwehrgerätehaus"]);
});

test("POI-Namensabweichung wird bei sicherem Positionsmatch gemeldet", () => {
  const osmPoi = poi("osm-name", "Grundschule Neu", { lat: 49.01, lon: 10.01 });
  const curatedPoi = { id: "cur-name", displayName: "Grundschule Alt", category: "school", latitude: 49.01, longitude: 10.01 };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.matched.length, 1);
  assert.equal(result.pois.nameDifferences.length, 1);
});

test("POI-Adressabweichung wird neutral gemeldet", () => {
  const osmPoi = poi("osm-address", "Grundschule Test", undefined, {
    tags: { amenity: "school", "addr:street": "Schulstraße", "addr:housenumber": "2", "addr:postcode": "90522", "addr:city": "Teststadt" }
  });
  const curatedPoi = {
    id: "cur-address", displayName: "Grundschule Test", category: "school", latitude: 49.01, longitude: 10.01,
    address: "Schulstraße 4, 90522 Teststadt"
  };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.addressDifferences.length, 1);
});

test("auffällige POI-Positionsabweichung enthält Distanz und Schwellenwert", () => {
  const osmPoi = poi("osm-position", "Positionsschule", { lat: 49.01, lon: 10.01 });
  const curatedPoi = {
    id: "cur-position", displayName: "Positionsschule", category: "school",
    latitude: 49.011, longitude: 10.01
  };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.positionDifferences.length, 1);
  assert.ok(result.pois.positionDifferences[0].distanceMeters > 100);
  assert.equal(result.pois.positionDifferences[0].thresholdMeters, 50);
});

test("Positionsabweichungs-Schwellenwert bleibt konfigurierbar", () => {
  const osmPoi = poi("osm-position", "Positionsschule", { lat: 49.01, lon: 10.01 });
  const curatedPoi = { id: "cur-position", displayName: "Positionsschule", category: "school", latitude: 49.011, longitude: 10.01 };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] },
    { positionDifferenceThresholdMeters: 200 }
  );
  assert.equal(result.pois.positionDifferences.length, 0);
});

test("POI-Kategorieabweichung wird ohne Gewinnerwertung gemeldet", () => {
  const osmPoi = poi("osm-category", "Bildungszentrum", undefined, { category: "kindergarten" });
  const curatedPoi = { id: "cur-category", displayName: "Bildungszentrum", category: "school", latitude: 49.01, longitude: 10.01 };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmPoi] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.matched.length, 1);
  assert.equal(result.pois.categoryDifferences.length, 1);
  assert.equal(result.pois.categoryDifferences[0].osmCategory, "kindergarten");
  assert.equal(result.pois.categoryDifferences[0].curatedCategory, "school");
});

test("mehrdeutiger POI-Match wird nicht sicher zugeordnet", () => {
  const osmA = poi("osm-a", "Gleiche Schule", { lat: 49.01, lon: 10.01 });
  const osmB = poi("osm-b", "Gleiche Schule", { lat: 49.01, lon: 10.01 });
  const curatedPoi = { id: "cur", displayName: "Gleiche Schule", category: "school", latitude: 49.01, longitude: 10.01 };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [osmA, osmB] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.matched.length, 0);
  assert.equal(result.pois.ambiguous.length, 1);
});

test("nicht unterstützte kuratierte POI-Kategorie wird als notCompared geführt", () => {
  const curatedPoi = { id: "hospital", displayName: "Klinik", category: "hospital", latitude: 49.01, longitude: 10.01 };
  const result = compareWithCuratedData(
    { city: city(), streets: [], pois: [] },
    { streets: [], pois: [curatedPoi] }
  );
  assert.equal(result.pois.onlyInCurated.length, 0);
  assert.equal(result.pois.notCompared.length, 1);
  assert.equal(result.pois.notCompared[0].reason, "unsupportedCategory");
});

test("kuratierter Abgleich mutiert keine Eingabedaten", () => {
  const osm = { city: city(), streets: [street()], pois: [poi()] };
  const curated = {
    streets: [{ id: "cur-street", name: "Hauptstraße", aliases: [] }],
    pois: [{ id: "cur-poi", displayName: "Grundschule Teststadt", category: "school", latitude: 49.01, longitude: 10.01 }]
  };
  const osmBefore = structuredClone(osm);
  const curatedBefore = structuredClone(curated);
  compareWithCuratedData(osm, curated);
  assert.deepEqual(osm, osmBefore);
  assert.deepEqual(curated, curatedBefore);
});

test("Abgleichs-Summary entspricht den Detailarrays", () => {
  const result = compareWithCuratedData(
    { city: city(), streets: [street("osm", "OSM")], pois: [] },
    { streets: [{ id: "cur", name: "Kuratiert" }], pois: [{ id: "unsupported", displayName: "Klinik", category: "hospital" }] }
  );
  assert.equal(result.summary.streets.onlyInOsm, result.streets.onlyInOsm.length);
  assert.equal(result.summary.streets.onlyInCurated, result.streets.onlyInCurated.length);
  assert.equal(result.summary.pois.notCompared, result.pois.notCompared.length);
});

(async () => {
  let passed = 0;
  for (const currentTest of tests) {
    try {
      await currentTest.run();
      passed += 1;
    } catch (error) {
      console.error(`FAIL: ${currentTest.name}`);
      throw error;
    }
  }
  console.log(`City-Data-Validator-Tests erfolgreich: ${passed}/${tests.length}`);
  console.log("- Stadtmetadaten, echte Polygon-/MultiPolygon-Grenzen und kein Bounds-Fallback");
  console.log("- Street-Pflichtfelder, Geometrien, räumliche Zugehörigkeit und konservative Merges");
  console.log("- POI-Positionen, Flächen, Kategorien, Node-/Polygon-Merges und Provenienz");
  console.log("- deterministische Reports, konsistente Counts und unveränderte Eingaben");
  console.log("- neutraler kuratierter Straßen-/POI-Abgleich einschließlich nicht vergleichbarer Kategorien");
})().catch(error => {
  console.error("Testfehler in city-data-validator-tests:", error);
  process.exitCode = 1;
});
