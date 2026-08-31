"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const validatorApi = require("../city-data-validator.js");
const packageApi = require("../city-package.js");

const tests = [];
function test(name, run) { tests.push({ name, run }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function city(overrides = {}) {
  return {
    id: "osm-relation-1",
    name: "Bad Homburg vor der Höhe",
    displayName: "Bad Homburg vor der Höhe",
    district: "Hochtaunuskreis",
    state: "Hessen",
    country: "Deutschland",
    osmType: "relation",
    osmId: 1,
    bounds: { south: 50.2, west: 8.5, north: 50.3, east: 8.7 },
    center: { lat: 50.25, lon: 8.6 },
    streetCount: 2,
    poiCount: 2,
    source: "curated+openstreetmap",
    dataVersion: 7,
    ...overrides
  };
}

function street(id = "street-1", overrides = {}) {
  return {
    id,
    cityId: "osm-relation-1",
    name: id === "street-1" ? "Hauptstraße" : "Nebenstraße",
    aliases: [id === "street-1" ? "Hauptstr." : "Nebenstr."],
    geometry: {
      type: "MultiLineString",
      coordinates: [[[8.55, 50.22], [8.56, 50.23]], [[8.56, 50.23], [8.57, 50.24]]]
    },
    osmWayIds: [id === "street-1" ? 11 : 12],
    tags: { highway: "residential" },
    ...overrides
  };
}

function poi(id = "poi-1", overrides = {}) {
  return {
    id,
    cityId: "osm-relation-1",
    name: id === "poi-1" ? "Rathaus" : "Kulturzentrum",
    displayName: id === "poi-1" ? "Rathaus" : "Kulturzentrum",
    category: id === "poi-1" ? "public-facility" : "curated-special-category",
    categoryLabel: id === "poi-1" ? "Öffentliche Einrichtung" : "Kuratierte Sonderkategorie",
    position: { lat: 50.24, lon: 8.58 },
    geometry: null,
    source: "Kuratiert",
    ...overrides
  };
}

function cityPackage(overrides = {}) {
  return {
    schemaVersion: 1,
    exportedAt: "2026-08-28T12:34:56.000Z",
    city: city(),
    streets: [street(), street("street-2")],
    pois: [poi(), poi("poi-2")],
    ...overrides
  };
}

function allCodes(result) {
  return ["municipality", "streets", "pois"].flatMap(section => [
    ...(result.validation[section].errors || []),
    ...(result.validation[section].warnings || [])
  ]).map(entry => entry.code);
}

function memoryStorage(initialPackage, statistics = {}) {
  let stored = initialPackage ? clone(initialPackage) : null;
  const calls = { getCity: 0, getCityStreets: 0, getCityPois: 0, saveCity: 0 };
  return {
    statistics,
    calls,
    async getCity(cityId) {
      calls.getCity += 1;
      return stored?.city.id === cityId ? clone(stored.city) : null;
    },
    async getCityStreets(cityId) {
      calls.getCityStreets += 1;
      return stored?.city.id === cityId ? clone(stored.streets) : [];
    },
    async getCityPois(cityId) {
      calls.getCityPois += 1;
      return stored?.city.id === cityId ? clone(stored.pois) : [];
    },
    async saveCity(cityData, streets, pois) {
      calls.saveCity += 1;
      stored = clone({ city: cityData, streets, pois });
    },
    snapshot() { return clone(stored); }
  };
}

test("öffentliche Phase-9-API und zentrale Größenbegrenzung sind verfügbar", () => {
  assert.equal(packageApi.SCHEMA_VERSION, 1);
  assert.equal(packageApi.MAX_IMPORT_FILE_SIZE_BYTES, 25 * 1024 * 1024);
  assert.equal(typeof packageApi.exportCityPackage, "function");
  assert.equal(typeof packageApi.readCityPackageFile, "function");
  assert.equal(typeof validatorApi.validateCityPackage, "function");
});

test("Dateinamen verwenden einen sicheren deterministischen deutschen Slug", () => {
  assert.equal(packageApi.cityPackageFilename(city()),
    "bad-homburg-vor-der-hoehe-strassentrainer-v1.json");
  assert.equal(packageApi.cityPackageFilename({ name: "  München / Süd  " }),
    "muenchen-sued-strassentrainer-v1.json");
});

test("Export liest City, Straßen und POIs exakt einmal über die Storage-API", async () => {
  const storage = memoryStorage(cityPackage());
  const exported = await packageApi.exportCityPackage("osm-relation-1", {
    storage,
    exportedAt: "2026-08-28T13:00:00.000Z"
  });
  assert.deepEqual(storage.calls, { getCity: 1, getCityStreets: 1, getCityPois: 1, saveCity: 0 });
  assert.equal(exported.filename, "bad-homburg-vor-der-hoehe-strassentrainer-v1.json");
});

test("Exportformat enthält ausschließlich Version, Zeitpunkt und Stadtmodell", async () => {
  const storage = memoryStorage(cityPackage(), { games: 99 });
  const { packageData, json } = await packageApi.exportCityPackage("osm-relation-1", { storage });
  assert.deepEqual(Object.keys(packageData), ["schemaVersion", "exportedAt", "city", "streets", "pois"]);
  assert.equal(packageData.schemaVersion, 1);
  assert.equal("statistics" in packageData, false);
  assert.equal(json.endsWith("\n"), true);
  assert.deepEqual(storage.statistics, { games: 99 });
});

test("Export erhält IDs, Aliases, Tags, Geometrien, Kategorien und Quellenmetadaten", async () => {
  const source = cityPackage();
  const storage = memoryStorage(source);
  const { packageData } = await packageApi.exportCityPackage(source.city.id, { storage });
  assert.deepEqual(packageData.city, source.city);
  assert.deepEqual(packageData.streets, source.streets);
  assert.deepEqual(packageData.pois, source.pois);
});

test("Export mutiert weder Quellpaket noch Storage", async () => {
  const source = cityPackage();
  const before = clone(source);
  const storage = memoryStorage(source);
  await packageApi.exportCityPackage(source.city.id, { storage });
  assert.deepEqual(source, before);
  assert.deepEqual(storage.snapshot(), before);
  assert.equal(storage.calls.saveCity, 0);
});

test("fehlende Stadt blockiert den Export kontrolliert", async () => {
  const storage = memoryStorage(null);
  await assert.rejects(packageApi.exportCityPackage("osm-relation-404", { storage }), error => (
    error.code === "CITY_NOT_FOUND" && /nicht gefunden/.test(error.message)
  ));
});

test("intern inkonsistente cityId blockiert den Export", async () => {
  const broken = cityPackage();
  broken.streets[0].cityId = "osm-relation-2";
  await assert.rejects(packageApi.exportCityPackage(broken.city.id, { storage: memoryStorage(broken) }), error => (
    error.code === "EXPORT_DATA_INVALID"
  ));
});

test("gültiger Import bleibt semantisch unverändert", () => {
  const input = cityPackage();
  const before = clone(input);
  const result = packageApi.parseCityPackageText(JSON.stringify(input));
  assert.equal(result.valid, true);
  assert.deepEqual(result.city, input.city);
  assert.deepEqual(result.streets, input.streets);
  assert.deepEqual(result.pois, input.pois);
  assert.deepEqual(input, before);
});

test("fehlender Exportzeitpunkt ist tolerant nur eine Warnung", () => {
  const input = cityPackage();
  delete input.exportedAt;
  const result = validatorApi.validateCityPackage(input);
  assert.equal(result.valid, true);
  assert.ok(allCodes(result).includes("CITY_PACKAGE_EXPORTED_AT_MISSING"));
});

test("kuratierte POI-Kategorien bleiben uneingeschränkt importierbar", () => {
  const result = validatorApi.validateCityPackage(cityPackage());
  assert.equal(result.valid, true);
  assert.equal(result.pois[1].category, "curated-special-category");
});

const invalidCases = [
  ["leeres Objekt", () => ({}), "CITY_PACKAGE_SCHEMA_UNSUPPORTED"],
  ["falsche Schema-Version", () => cityPackage({ schemaVersion: 0 }), "CITY_PACKAGE_SCHEMA_UNSUPPORTED"],
  ["neuere Schema-Version", () => cityPackage({ schemaVersion: 2 }), "CITY_PACKAGE_SCHEMA_NEWER"],
  ["fehlende City", () => cityPackage({ city: undefined }), "CITY_MISSING"],
  ["fehlende city.id", () => cityPackage({ city: city({ id: "" }) }), "CITY_ID_MISSING"],
  ["fehlender city.name", () => cityPackage({ city: city({ name: "" }) }), "CITY_NAME_MISSING"],
  ["fehlende Straßen", () => cityPackage({ streets: undefined }), "CITY_STREETS_INVALID"],
  ["leere Straßen", () => cityPackage({ city: city({ streetCount: 0 }), streets: [] }), "CITY_NO_PLAYABLE_STREETS"],
  ["fehlende POIs", () => cityPackage({ pois: undefined }), "CITY_POIS_INVALID"],
  ["ungültige Bounds", () => cityPackage({ city: city({ bounds: { south: 51, west: 8, north: 50, east: 9 } }) }), "CITY_BOUNDS_INVALID"],
  ["gleiche Bounds-Kanten", () => cityPackage({ city: city({ bounds: { south: 50, west: 8, north: 50, east: 9 } }) }), "CITY_BOUNDS_INVALID"],
  ["doppelte Straßen-ID", () => cityPackage({ streets: [street(), street()] }), "STREET_ID_DUPLICATE"],
  ["doppelte POI-ID", () => cityPackage({ pois: [poi(), poi()] }), "POI_ID_DUPLICATE"],
  ["Straßen-/POI-ID-Kollision", () => cityPackage({ pois: [poi("street-1"), poi("poi-2")] }), "CITY_ENTITY_ID_DUPLICATE"],
  ["falsche Straßen-cityId", () => cityPackage({ streets: [street("street-1", { cityId: "falsch" }), street("street-2")] }), "STREET_CITY_ID_INVALID"],
  ["falsche POI-cityId", () => cityPackage({ pois: [poi("poi-1", { cityId: "falsch" }), poi("poi-2")] }), "POI_CITY_ID_INVALID"],
  ["ungültige Straßenkoordinate", () => cityPackage({ streets: [street("street-1", { geometry: { type: "MultiLineString", coordinates: [[[200, 50], [8.6, 50.2]]] } }), street("street-2")] }), "STREET_GEOMETRY_INVALID"],
  ["ungültiger Straßengeometrietyp", () => cityPackage({ streets: [street("street-1", { geometry: { type: "LineString", coordinates: [[8.5, 50.2], [8.6, 50.3]] } }), street("street-2")] }), "STREET_GEOMETRY_INVALID"],
  ["ungültige POI-Position", () => cityPackage({ pois: [poi("poi-1", { position: { lat: 91, lon: 8.6 } }), poi("poi-2")] }), "POI_POSITION_INVALID"],
  ["ungültiges POI-Legacy-Koordinatenfeld", () => cityPackage({ pois: [poi("poi-1", { latitude: "ungültig" }), poi("poi-2")] }), "POI_POSITION_INVALID"],
  ["ungültige POI-Geometrie", () => cityPackage({ pois: [poi("poi-1", { geometry: { type: "Polygon", coordinates: [] } }), poi("poi-2")] }), "POI_GEOMETRY_INVALID"]
];

invalidCases.forEach(([name, makeInput, expectedCode]) => {
  test(`${name} wird ohne Mutation blockiert`, () => {
    const input = makeInput();
    const before = structuredClone(input);
    const result = validatorApi.validateCityPackage(input);
    assert.equal(result.valid, false);
    assert.ok(allCodes(result).includes(expectedCode), `${expectedCode} fehlt in ${allCodes(result).join(", ")}`);
    assert.deepEqual(input, before);
  });
});

test("nicht parsebares JSON liefert eine benutzerfreundliche Fehlermeldung", () => {
  assert.throws(() => packageApi.parseCityPackageText("{kaputt"), error => (
    error.code === "INVALID_JSON" && error.message === "Die Datei ist keine gültige JSON-Datei."
  ));
});

test("Dateigrößenlimit wird vor dem Lesen der Datei durchgesetzt", async () => {
  let readCalls = 0;
  const file = {
    name: "gross.json",
    type: "application/json",
    size: packageApi.MAX_IMPORT_FILE_SIZE_BYTES + 1,
    async text() { readCalls += 1; return "{}"; }
  };
  await assert.rejects(packageApi.readCityPackageFile(file), error => error.code === "FILE_TOO_LARGE");
  assert.equal(readCalls, 0);
});

test("nicht als JSON erkennbare Datei wird kontrolliert abgelehnt", async () => {
  const file = { name: "stadt.txt", type: "text/plain", size: 2, async text() { return "{}"; } };
  await assert.rejects(packageApi.readCityPackageFile(file), error => error.code === "FILE_TYPE_INVALID");
});

test("rekursiver __proto__-Payload wird blockiert und verschmutzt kein Prototype", () => {
  const malicious = JSON.stringify(cityPackage()).replace(
    '"tags":{"highway":"residential"}',
    '"tags":{"__proto__":{"polluted":true},"highway":"residential"}'
  );
  const result = packageApi.parseCityPackageText(malicious);
  assert.equal(result.valid, false);
  assert.ok(allCodes(result).includes("CITY_PACKAGE_DANGEROUS_KEY"));
  assert.equal(({}).polluted, undefined);
});

test("constructor und prototype werden auch tief verschachtelt blockiert", () => {
  for (const key of ["constructor", "prototype"]) {
    const input = cityPackage();
    input.pois[0].tags = JSON.parse(`{"safe":{"${key}":{"polluted":true}}}`);
    const result = validatorApi.validateCityPackage(input);
    assert.equal(result.valid, false);
    assert.ok(allCodes(result).includes("CITY_PACKAGE_DANGEROUS_KEY"));
  }
  assert.equal(({}).polluted, undefined);
});

test("Import schreibt erst nach expliziter Bestätigung", async () => {
  const result = packageApi.parseCityPackageText(JSON.stringify(cityPackage()));
  const storage = memoryStorage(null);
  assert.equal(storage.calls.saveCity, 0);
  await storage.saveCity(result.city, result.streets, result.pois);
  assert.equal(storage.calls.saveCity, 1);
});

test("Export-Import-Roundtrip ist für City, Straßen und POIs deep-identisch", async () => {
  const source = cityPackage();
  const firstStorage = memoryStorage(source);
  const exported = await packageApi.exportCityPackage(source.city.id, { firstStorage, storage: firstStorage });
  const imported = packageApi.parseCityPackageText(exported.json);
  const emptyStorage = memoryStorage(null);
  await emptyStorage.saveCity(imported.city, imported.streets, imported.pois);
  const roundtrip = emptyStorage.snapshot();
  assert.deepEqual(roundtrip.city, source.city);
  assert.deepEqual(roundtrip.streets, source.streets);
  assert.deepEqual(roundtrip.pois, source.pois);
});

test("Roundtrip verändert Statistik weder der importierten noch anderer Städte", async () => {
  const statistics = { "osm-relation-1": { games: 5 }, "osm-relation-2": { games: 9 } };
  const storage = memoryStorage(cityPackage(), statistics);
  const exported = await packageApi.exportCityPackage("osm-relation-1", { storage });
  const imported = packageApi.parseCityPackageText(exported.json);
  await storage.saveCity(imported.city, imported.streets, imported.pois);
  assert.deepEqual(storage.statistics, statistics);
  assert.equal("statistics" in imported, false);
});

test("Oberasbach-Paket besteht den vollständigen semantischen Roundtrip", async () => {
  const packagePath = path.join(__dirname, "..", "data", "cities", "oberasbach.json");
  const source = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const storage = memoryStorage(source);
  const exported = await packageApi.exportCityPackage(source.city.id, {
    storage,
    exportedAt: "2026-08-28T14:00:00.000Z"
  });
  const imported = packageApi.parseCityPackageText(exported.json);
  assert.equal(imported.valid, true);
  assert.equal(imported.streets.length, 271);
  assert.equal(imported.pois.length, 60);
  assert.equal(imported.streets.filter(entry => entry.geometry?.type === "MultiLineString").length, 271);
  assert.deepEqual(imported.city, source.city);
  assert.deepEqual(imported.streets, source.streets);
  assert.deepEqual(imported.pois, source.pois);
  assert.deepEqual(
    [...new Set(imported.pois.map(entry => entry.category))].sort(),
    [...new Set(source.pois.map(entry => entry.category))].sort()
  );
});

test("Export, Import, Vorschau-Daten und Speicherung benötigen kein Netzwerk", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("Netzwerk verboten"); };
  try {
    const source = cityPackage();
    const storage = memoryStorage(source);
    const exported = await packageApi.exportCityPackage(source.city.id, { storage });
    const imported = packageApi.parseCityPackageText(exported.json);
    await storage.saveCity(imported.city, imported.streets, imported.pois);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
  console.log(`\nCity-Package-Tests: ${passed}/${tests.length} bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
