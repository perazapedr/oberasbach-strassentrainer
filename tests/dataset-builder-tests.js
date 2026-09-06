"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const core = require("../tools/dataset-builder/lib/core.js");
const { createStaticDatasetProvider } = require("../dataset-provider.js");
const validator = require("../city-data-validator.js");
const { createCityStorage } = require("../city-storage.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const poiCategories = require("../poi-categories.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_XML = path.join(ROOT, "tools/dataset-builder/test/fixtures/mini-olpe.osm");
const FIXTURE_PBF = path.join(ROOT, "tools/dataset-builder/test/fixtures/mini-olpe.osm.pbf");
const tests = [];
function test(name, run) { tests.push({ name, run }); }

function osmiumAvailable() {
  return spawnSync("osmium", ["--version"], { encoding: "utf8" }).status === 0;
}

function assertFixturePbf() {
  if (!osmiumAvailable()) throw new Error("osmium-tool is required for the PBF integration test.");
  if (!fs.existsSync(FIXTURE_XML) || !fs.existsSync(FIXTURE_PBF)) throw new Error("OSM/PBF fixtures are missing.");
  const result = spawnSync("osmium", ["fileinfo", FIXTURE_PBF], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Fixture PBF is unreadable.");
}

function fixtureFeature(type, id, tags, geometry) {
  return { type: "Feature", properties: { ...tags, "@type": type, "@id": id }, geometry };
}

const boundary = {
  type: "Polygon",
  coordinates: [[[7, 51], [7.04, 51], [7.04, 51.04], [7, 51.04], [7, 51]]]
};

test("Boundary Selection akzeptiert nur die eindeutige administrative Gemeinde", () => {
  const candidates = [
    { id: 7, tags: { boundary: "administrative", admin_level: "6", name: "Olpe" } },
    { id: 8, tags: { boundary: "administrative", admin_level: "8", name: "Olpe", "de:amtlicher_gemeindeschluessel": "05966024" } },
    { id: 9, tags: { boundary: "postal_code", admin_level: "8", name: "Olpe" } }
  ];
  assert.equal(core.selectMunicipalityRelation(candidates, " olpe ").id, 8);
  assert.throws(() => core.selectMunicipalityRelation(candidates, "Olpe", 7), /No admin_level=8/);
  assert.throws(() => core.selectMunicipalityRelation([], "Olpe"), /No admin_level=8/);
});

test("OPL-Tags einschließlich Gemeindeschlüssel werden verlustfrei gelesen", () => {
  const [relation] = core.parseBoundaryRelationOpl(
    "r62591 v1 dV c1 t2026-09-01T00:00:00Z i1 u Ttype=boundary,boundary=administrative,admin_level=8,name=Olpe,de:amtlicher_gemeindeschluessel=05966024\n"
  );
  assert.equal(relation.id, 62591);
  assert.equal(relation.tags.name, "Olpe");
  assert.equal(relation.tags["de:amtlicher_gemeindeschluessel"], "05966024");
});

test("LineStrings werden an der echten Polygon-Grenze geclippt", () => {
  const result = core.clipLineStringToBoundary([[6.99, 51.02], [7.02, 51.02], [7.05, 51.02]], boundary);
  assert.ok(result.length >= 1);
  const flat = result.flat();
  assert.ok(flat.every(([lon]) => lon >= 7 - 1e-9 && lon <= 7.04 + 1e-9));
  assert.deepEqual(core.clipLineStringToBoundary([[7.01, 51.01]], boundary), []);
});

test("Polygon und MultiPolygon bleiben im aktuellen GeoJSON-Modell gültig", () => {
  assert.deepEqual(core.normalizeAreaGeometry(boundary), boundary);
  const multi = { type: "MultiPolygon", coordinates: [boundary.coordinates] };
  assert.deepEqual(core.normalizeAreaGeometry(multi), multi);
  assert.equal(core.normalizeAreaGeometry({ type: "Polygon", coordinates: [] }), null);
});

test("Administrative Way-Flächen behalten ihre OSM-Way-Identität", () => {
  const element = core.areaFeatureToOsmElement({
    identity: { type: "way", id: 42 },
    tags: { boundary: "administrative", admin_level: "10", name: "Ortsteil" },
    geometry: { type: "MultiPolygon", coordinates: [boundary.coordinates] }
  });
  assert.equal(element.type, "way");
  assert.equal(element.id, 42);
  assert.equal(element.geometry.length, boundary.coordinates[0].length);
});

test("Straßenfilter, Way-Merge, Aliases und IDs sind deterministisch", () => {
  const features = [
    fixtureFeature("way", 2, { highway: "residential", name: "Hauptstraße", short_name: "Hauptstr." }, { type: "LineString", coordinates: [[7.02, 51.01], [7.03, 51.01]] }),
    fixtureFeature("way", 1, { highway: "residential", name: "Hauptstraße", alt_name: "Alte Hauptstraße" }, { type: "LineString", coordinates: [[7.01, 51.01], [7.02, 51.01]] }),
    fixtureFeature("way", 3, { highway: "service", name: "Serviceweg" }, { type: "LineString", coordinates: [[7.01, 51.02], [7.02, 51.02]] }),
    fixtureFeature("way", 4, { highway: "primary" }, { type: "LineString", coordinates: [[7.01, 51.03], [7.02, 51.03]] })
  ];
  const collected = core.collectRelevantFeatures(features, boundary, {});
  const streets = core.buildStreets(collected.streetWays, "osm-relation-8");
  assert.equal(streets.length, 1);
  assert.deepEqual(streets[0].osmWayIds, [1, 2]);
  assert.deepEqual(streets[0].aliases, ["Alte Hauptstraße", "Hauptstr."]);
  assert.equal(streets[0].geometry.coordinates.length, 2);
  assert.deepEqual(streets, core.buildStreets(collected.streetWays, "osm-relation-8"));
});

test("POI-Registry klassifiziert Node, Way und Relation", () => {
  const features = [
    fixtureFeature("node", 1, { amenity: "fire_station", name: "Feuerwehr" }, { type: "Point", coordinates: [7.01, 51.01] }),
    fixtureFeature("way", 2, { amenity: "school", name: "Schule" }, boundary),
    fixtureFeature("relation", 3, { type: "multipolygon", tourism: "hotel", name: "Hotel" }, { type: "MultiPolygon", coordinates: [boundary.coordinates] })
  ];
  const diagnostics = {};
  const collected = core.collectRelevantFeatures(features, boundary, diagnostics);
  const pois = core.buildPois(collected.poiObjects, "osm-relation-8", diagnostics);
  assert.deepEqual(pois.map(poi => poi.category).sort(), ["fire_station", "hotel", "school"]);
  assert.deepEqual(pois.map(poi => poi.osmType).sort(), ["node", "relation", "way"]);
  assert.equal(pois.find(poi => poi.osmType === "node").geometry, null);
  assert.equal(pois.find(poi => poi.osmType === "relation").geometry.type, "MultiPolygon");
});

test("Gleicher fachlicher Input erzeugt denselben contentHash", () => {
  const city = { id: "osm-relation-8", name: "Test", displayName: "Test", osmType: "relation", osmId: 8,
    bounds: { south: 51, west: 7, north: 51.04, east: 7.04 }, center: { lat: 51.02, lon: 7.02 } };
  const one = { package: { id: "x", type: "osm", version: "0.1.0" }, city,
    streets: [{ id: "s", cityId: city.id, name: "A", aliases: ["B", "A"], osmWayIds: [2, 1], geometry: { type: "MultiLineString", coordinates: [[[7, 51], [7.01, 51.01]]] } }],
    pois: [], areas: [] };
  const two = JSON.parse(JSON.stringify(one));
  two.streets[0].aliases.reverse();
  two.streets[0].osmWayIds.reverse();
  assert.equal(validator.computePackageHash(one), validator.computePackageHash(two));
});

test("Fixture-PBF durchläuft Builder, Package-Validator, Provider, IndexedDB und Targets offline", async () => {
  assertFixturePbf();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dataset-builder-test-"));
  const output = path.join(temp, "testolpe.json");
  const reportPath = path.join(temp, "report.json");
  try {
    const command = spawnSync(process.execPath, [
      path.join(ROOT, "tools/dataset-builder/index.js"),
      "--pbf", FIXTURE_PBF, "--municipality", "Testolpe", "--relation-id", "100",
      "--output", output, "--report", reportPath
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    const packageData = JSON.parse(fs.readFileSync(output, "utf8"));
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.status, "PASS");
    assert.equal(packageData.city.id, "osm-relation-100");
    assert.equal(packageData.boundary.type, "Polygon");
    assert.ok(packageData.streets.length >= 5);
    assert.ok(packageData.pois.some(poi => poi.osmType === "node"));
    assert.ok(packageData.pois.some(poi => poi.osmType === "relation"));
    assert.equal(validator.validateCityPackage(packageData).valid, true);
    assert.equal(validator.verifyPackageHash(packageData).valid, true);

    let networkCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
    try {
      const provider = createStaticDatasetProvider([{
        metadata: { id: packageData.city.id, name: packageData.city.name, state: packageData.city.state },
        dataset: packageData
      }]);
      const downloaded = await provider.downloadDataset(packageData.city.id);
      const validated = validator.validateCityData(downloaded.dataset, { sourceMode: "download" });
      assert.equal(validated.valid, true);
      const storage = createCityStorage({
        dbName: "phase-15-2-builder-integration", indexedDB: new MockIndexedDB(), IDBKeyRange: MockIDBKeyRange,
        localStorage: createMemoryStorage(), activeCityStorageKey: "phase-15-2-active"
      });
      const city = { ...validated.city, boundary: validated.boundary };
      await storage.saveCity(city, validated.streets, validated.pois, validated.areas);
      await storage.setActiveCityId(city.id);
      const active = await storage.getActiveCityData();
      const streetTargets = targetApi.prepareStreetTargets(active.streets, geometryApi);
      const poiTargets = targetApi.preparePoiTargets(active.pois, poiCategories.getAll());
      assert.equal(active.city.id, "osm-relation-100");
      assert.ok(streetTargets.length >= 5);
      assert.ok(streetTargets.every(target => target.geometry));
      assert.ok(poiTargets.length >= 2);
      assert.equal(networkCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

(async () => {
  let passed = 0;
  for (const entry of tests) {
    try {
      await entry.run();
      passed += 1;
      console.log(`✓ ${entry.name}`);
    } catch (error) {
      console.error(`✗ ${entry.name}`);
      console.error(error);
    }
  }
  console.log(`\n${passed}/${tests.length} Dataset-Builder-Tests bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
