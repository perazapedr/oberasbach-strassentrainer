"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createStaticDatasetProvider } = require("../dataset-provider.js");
const validator = require("../city-data-validator.js");
const { createCityStorage } = require("../city-storage.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const poiCategories = require("../poi-categories.js");
const gameEngineApi = require("../game-engine.js");
const turf = require("../vendor/turf/turf.min.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_PATH = path.join(ROOT, "data/cities/de-nw-olpe.json");

(async () => {
  const packageData = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
  const packageValidation = validator.validateCityPackage(packageData);
  assert.equal(packageValidation.valid, true);
  assert.equal(validator.verifyPackageHash(packageData).valid, true);

  let overpassCalls = 0;
  let nominatimCalls = 0;
  let otherGeoApiCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input && input.url ? input.url : input);
    if (url.includes("overpass") || url.includes("/api/interpreter")) overpassCalls += 1;
    else if (url.includes("nominatim")) nominatimCalls += 1;
    else otherGeoApiCalls += 1;
    throw new Error(`Unexpected network access during static Olpe gameplay: ${url}`);
  };

  try {
    const provider = createStaticDatasetProvider([{
      metadata: {
        id: packageData.city.id,
        name: packageData.city.name,
        displayName: packageData.city.displayName,
        state: packageData.city.state,
        country: packageData.city.country,
        datasetKind: "municipality"
      },
      dataset: packageData
    }], { providerId: "phase-15.2-pbf" });
    assert.equal(provider.requiresNetwork("download"), false);
    const [metadata] = await provider.searchDatasets("Olpe");
    const downloaded = await provider.downloadDataset(metadata.id);
    const validated = validator.validateCityData(downloaded.dataset, { sourceMode: "download" });
    assert.equal(validated.valid, true);
    assert.equal(validated.streets.length, 461);
    assert.equal(validated.pois.length, 114);
    assert.equal(validated.areas.length, 2);

    const storage = createCityStorage({
      dbName: "phase-15-2-olpe-real-pbf", indexedDB: new MockIndexedDB(), IDBKeyRange: MockIDBKeyRange,
      localStorage: createMemoryStorage(), activeCityStorageKey: "phase-15-2-olpe-active"
    });
    const city = { ...validated.city, boundary: validated.boundary };
    await storage.saveCity(city, validated.streets, validated.pois, validated.areas);
    await storage.setActiveCityId(city.id);
    const active = await storage.getActiveCityData();
    assert.equal(active.city.id, "osm-relation-163179");
    assert.equal(active.city.name, "Olpe");

    const streetTargets = targetApi.prepareStreetTargets(active.streets, geometryApi);
    const poiTargets = targetApi.preparePoiTargets(active.pois, poiCategories.getAll());
    assert.equal(streetTargets.length, 461);
    assert.equal(poiTargets.length, 114);
    assert.ok(streetTargets.every(target => targetApi.isValidTargetGeometry(target, geometryApi)));
    assert.ok(poiTargets.every(target => targetApi.isValidTargetGeometry(target, geometryApi)));

    const target = streetTargets[0];
    const clicked = target.geometry.sections[0][0];
    const evaluation = targetApi.evaluateTargetDistance(target, clicked, turf, geometryApi);
    assert.ok(evaluation && Number.isFinite(evaluation.distanceMeters));
    const engine = gameEngineApi.createGameEngine({ now: (() => { let now = 1_000; return () => (now += 100); })() });
    engine.startGame({ mode: "free", contentSelection: "streets" });
    engine.startRound();
    engine.activateRound({ ...target, name: target.displayName });
    engine.submitGuess({ lat: clicked[1], lng: clicked[0] });
    const result = engine.resolveRound(evaluation);
    assert.equal(result.targetId, target.id);
    assert.ok(Number.isFinite(result.points));
    assert.ok(Number.isFinite(result.distanceMeters));

    assert.equal(overpassCalls, 0);
    assert.equal(nominatimCalls, 0);
    assert.equal(otherGeoApiCalls, 0);
    assert.ok(!fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("dataset-builder"));
    assert.ok(!fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes(".osm.pbf"));

    console.log("✓ Reales Olpe-PBF-Package -> StaticDatasetProvider -> Validator -> IndexedDB -> CityContext");
    console.log("✓ Street-/POI-Targets und freie Spielrunde einschließlich Geometrieauswertung");
    console.log(`✓ Overpass: ${overpassCalls}, Nominatim: ${nominatimCalls}, sonstige Geodaten-APIs: ${otherGeoApiCalls}, PBF im Spielpfad: 0`);
    console.log("\n1/1 Olpe-PBF-Integrationstests bestanden.");
  } finally {
    globalThis.fetch = originalFetch;
  }
})().catch(error => {
  console.error("✗ Olpe-PBF-Integrationstest fehlgeschlagen");
  console.error(error);
  process.exitCode = 1;
});
