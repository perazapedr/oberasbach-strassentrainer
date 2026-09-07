"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  loadRegions,
  loadManifest,
  filterTargets,
  RegionConfigError,
  ManifestError
} = require("../tools/dataset-pipeline/lib/manifest.js");
const { evaluateCandidatePackage } = require("../tools/dataset-pipeline/lib/qa.js");
const { createCatalogDatasetProvider } = require("../dataset-provider.js");
const validator = require("../city-data-validator.js");
const { createCityStorage } = require("../city-storage.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const gameEngineApi = require("../game-engine.js");
const turf = require("../vendor/turf/turf.min.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const REGIONS_PATH = path.join(ROOT, "tools/dataset-pipeline/regions.json");
const MANIFEST_NW_PATH = path.join(ROOT, "tools/dataset-pipeline/manifests/de-nw.json");
const MANIFEST_BY_PATH = path.join(ROOT, "tools/dataset-pipeline/manifests/de-by.json");
const CATALOG_SCHEMA_PATH = path.join(ROOT, "schemas/strassentrainer-catalog.schema.json");
const ZIRNDORF_FIXTURE_PATH = path.join(ROOT, "tests/fixtures/de-by-zirndorf.json");
const CANDIDATE_CATALOG_PATH = path.join(ROOT, "tests/fixtures/multi-region-candidate-catalog.json");

function createTempDir(prefix = "phase16-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function allIssues(result, kind = "errors") {
  return ["package", "municipality", "streets", "pois", "areas"]
    .flatMap(section => Array.isArray(result?.validation?.[section]?.[kind])
      ? result.validation[section][kind]
      : []);
}

// ------------------------------------------------------------
// 1. REGION CONFIGURATION TESTS (loadRegions)
// ------------------------------------------------------------

test("1.1 loadRegions lädt die offizielle regions.json mit de-nw und de-by", () => {
  const config = loadRegions(REGIONS_PATH);
  assert.equal(config.schemaVersion, 1);
  assert.ok(typeof config.regions === "object");
  assert.ok(config.regions["de-nw"]);
  assert.ok(config.regions["de-by"]);

  const nw = config.regions["de-nw"];
  assert.equal(nw.regionId, "de-nw");
  assert.equal(nw.state, "Nordrhein-Westfalen");
  assert.equal(nw.country, "Deutschland");
  assert.equal(nw.stateCode, "NW");

  const by = config.regions["de-by"];
  assert.equal(by.regionId, "de-by");
  assert.equal(by.state, "Bayern");
  assert.equal(by.country, "Deutschland");
  assert.equal(by.stateCode, "BY");
});

test("1.2 loadRegions weist fehlende Pflichtfelder (state, country) sauber ab", () => {
  const tempDir = createTempDir();
  try {
    const badFile = path.join(tempDir, "bad-regions.json");
    fs.writeFileSync(badFile, JSON.stringify({
      schemaVersion: 1,
      regions: {
        "de-nw": { regionId: "de-nw", stateCode: "NW" } // state and country missing
      }
    }));
    assert.throws(
      () => loadRegions(badFile),
      err => err instanceof RegionConfigError && err.code === "REGION_MISSING_COUNTRY"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("1.3 loadRegions weist ungültigen stateCode ab", () => {
  const tempDir = createTempDir();
  try {
    const badFile = path.join(tempDir, "bad-code.json");
    fs.writeFileSync(badFile, JSON.stringify({
      schemaVersion: 1,
      regions: {
        "de-xx": { regionId: "de-xx", state: "Testland", country: "Deutschland", stateCode: "invalid-code-123" }
      }
    }));
    assert.throws(
      () => loadRegions(badFile),
      err => err instanceof RegionConfigError && err.code === "REGION_INVALID_STATE_CODE"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("1.4 loadRegions weist Key-Mismatch ab", () => {
  const tempDir = createTempDir();
  try {
    const dupFile = path.join(tempDir, "mismatch.json");
    fs.writeFileSync(dupFile, JSON.stringify({
      schemaVersion: 1,
      regions: {
        "de-by": { regionId: "de-nw", state: "Bayern", country: "Deutschland", stateCode: "BY" }
      }
    }));
    assert.throws(
      () => loadRegions(dupFile),
      err => err instanceof RegionConfigError && err.code === "REGION_KEY_MISMATCH"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("1.5 loadRegions weist ungültiges Schema Version ab", () => {
  const tempDir = createTempDir();
  try {
    const badFile = path.join(tempDir, "bad-schema.json");
    fs.writeFileSync(badFile, JSON.stringify({
      schemaVersion: 99,
      regions: {}
    }));
    assert.throws(
      () => loadRegions(badFile),
      err => err instanceof RegionConfigError && err.code === "REGIONS_UNSUPPORTED_SCHEMA"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------
// 2. MANIFEST GENERALIZATION & REGION MAPPING TESTS
// ------------------------------------------------------------

test("2.1 de-nw und de-by Manifeste sind wohlgeformt und mit regions.json verknüpft", () => {
  const regionsConfig = loadRegions(REGIONS_PATH);

  const manifestNW = loadManifest(MANIFEST_NW_PATH, regionsConfig);
  assert.equal(manifestNW.regionId, "de-nw");
  assert.ok(regionsConfig.regions[manifestNW.regionId]);
  assert.equal(manifestNW.datasets.length, 5);
  assert.ok(manifestNW.datasets.some(dataset =>
    dataset.datasetId === "de-nw-kreis-olpe" && dataset.targetType === "district"
  ));

  const manifestBY = loadManifest(MANIFEST_BY_PATH, regionsConfig);
  assert.equal(manifestBY.regionId, "de-by");
  assert.ok(regionsConfig.regions[manifestBY.regionId]);
  assert.equal(manifestBY.datasets.length, 1);
  assert.equal(manifestBY.datasets[0].datasetId, "de-by-zirndorf");
});

test("2.2 Oberasbach ist in keinem regionalen PBF-Manifest als Build-Target erlaubt", () => {
  const tempDir = createTempDir();
  try {
    const badByManifest = path.join(tempDir, "by-oberasbach.json");
    fs.writeFileSync(badByManifest, JSON.stringify({
      schemaVersion: 1,
      regionId: "de-by",
      datasets: [
        { datasetId: "de-by-oberasbach", name: "Oberasbach", relationId: 1016396, adminLevel: 8 }
      ]
    }));
    assert.throws(
      () => loadManifest(badByManifest),
      err => err.code === "OBERASBACH_PROTECTED"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("2.3 Region-Mismatch: Manifest weist unbekannte regionId ab wenn Regionen übergeben werden", () => {
  const regionsConfig = loadRegions(REGIONS_PATH);
  const tempDir = createTempDir();
  try {
    const badManifest = path.join(tempDir, "unknown-region.json");
    fs.writeFileSync(badManifest, JSON.stringify({
      schemaVersion: 1,
      regionId: "de-sn", // Sachsen ist noch nicht in regions.json
      datasets: [
        { datasetId: "de-sn-dresden", name: "Dresden", relationId: 191645, adminLevel: 6 }
      ]
    }));
    assert.throws(
      () => loadManifest(badManifest, regionsConfig),
      err => err.code === "UNKNOWN_REGION"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------
// 3. METADATA ISOLATION & ZIRNDORF DATASET QUALITY
// ------------------------------------------------------------

test("3.1 Zirndorf Dataset-Fixture besitzt vollständige Bayern-Metadaten ohne NRW-Defaults", () => {
  assert.ok(fs.existsSync(ZIRNDORF_FIXTURE_PATH), "Zirndorf Fixture muss existieren");
  const pkg = JSON.parse(fs.readFileSync(ZIRNDORF_FIXTURE_PATH, "utf8"));

  // Metadaten-Prüfung
  assert.equal(pkg.package.id, "de-by-zirndorf");
  assert.equal(pkg.city.state, "Bayern");
  assert.equal(pkg.city.country, "Deutschland");
  assert.notEqual(pkg.city.state, "Nordrhein-Westfalen");
  assert.equal(pkg.city.osmId, 3351257);
  assert.equal(pkg.city.adminLevel, 8);
  assert.equal(pkg.package.type, "osm");
  assert.equal(pkg.package.version, "2026.09.05");

  // Metriken
  assert.equal(pkg.city.streetCount, 345);
  assert.equal(pkg.city.poiCount, 124);
  assert.equal(pkg.city.areaCount, 0);
  assert.equal(pkg.streets.length, 345);
  assert.equal(pkg.pois.length, 124);
  assert.equal(pkg.areas.length, 0);

  // ContentHash Integrität
  assert.equal(pkg.package.contentHash, "sha256:766615fdfddcbea7250d218f3b9f79c5f18e8e3b72fdcf99f7218e4867340f49");
});

test("3.2 Zirndorf erfüllt den vollständigen Schema 1 Package Contract", () => {
  const pkg = JSON.parse(fs.readFileSync(ZIRNDORF_FIXTURE_PATH, "utf8"));
  const validation = validator.validateCityPackage(pkg);
  assert.equal(validation.valid, true);
  assert.deepEqual(allIssues(validation, "errors"), []);

  const hashCheck = validator.verifyPackageHash(pkg);
  assert.equal(hashCheck.valid, true);
  assert.equal(hashCheck.expectedHash, pkg.package.contentHash);
});

test("3.3 Zirndorf Geometrien und Bounding Box liegen plausibel im Großraum Nürnberg/Fürth (Bayern)", () => {
  const pkg = JSON.parse(fs.readFileSync(ZIRNDORF_FIXTURE_PATH, "utf8"));
  const bounds = pkg.city.bounds;

  // Zirndorf liegt ca. bei 49.44° N, 10.95° E
  assert.ok(bounds.west > 10.85 && bounds.west < 10.99, "Min Lon plausibel");
  assert.ok(bounds.south > 49.39 && bounds.south < 49.47, "Min Lat plausibel");
  assert.ok(bounds.east > 10.86 && bounds.east < 11.00, "Max Lon plausibel");
  assert.ok(bounds.north > 49.40 && bounds.north < 49.48, "Max Lat plausibel");

  // Alle Straßen haben gültige Geometrien
  for (const street of pkg.streets) {
    assert.ok(typeof street.name === "string" && street.name.length > 0);
    assert.ok(street.geometry && Array.isArray(street.geometry.coordinates) && street.geometry.coordinates.length > 0);
  }
});

// ------------------------------------------------------------
// 4. MULTI-REGION CANDIDATE CATALOG TESTS
// ------------------------------------------------------------

test("4.1 Kandidaten-Katalog validiert gegen JSON Schema und enthält beide Bundesländer", () => {
  assert.ok(fs.existsSync(CANDIDATE_CATALOG_PATH), "Kandidatenkatalog muss existieren");
  const catalog = JSON.parse(fs.readFileSync(CANDIDATE_CATALOG_PATH, "utf8"));

  assert.equal(catalog.schemaVersion, 1);
  assert.ok(typeof catalog.generatedAt === "string");
  assert.equal(catalog.datasets.length, 6);

  const byDatasets = catalog.datasets.filter(d => d.state === "Bayern");
  const nwDatasets = catalog.datasets.filter(d => d.state === "Nordrhein-Westfalen");

  assert.equal(byDatasets.length, 2, "Bayern muss 2 Datensätze haben (Oberasbach + Zirndorf)");
  assert.equal(nwDatasets.length, 4, "NRW muss 4 Datensätze haben (Köln, Olpe, Siegen, Wenden)");
});

test("4.2 Oberasbach Golden Dataset bleibt unberührt im Multi-Region-Katalog", () => {
  const catalog = JSON.parse(fs.readFileSync(CANDIDATE_CATALOG_PATH, "utf8"));
  const oberasbach = catalog.datasets.find(d => d.id === "de-oberasbach-fire-training");

  assert.ok(oberasbach, "Oberasbach muss im Katalog sein");
  assert.equal(oberasbach.name, "Oberasbach");
  assert.equal(oberasbach.state, "Bayern");
  assert.equal(oberasbach.country, "Deutschland");
  assert.equal(oberasbach.packageType, "curated");
  assert.equal(oberasbach.version, "1.0.0");
  assert.equal(oberasbach.streetCount, 271);
  assert.equal(oberasbach.poiCount, 60);
  assert.equal(oberasbach.areaCount, 0);
  assert.equal(oberasbach.contentHash, "sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95");
  assert.equal(oberasbach.downloadPath, "cities/oberasbach.json");
});

test("4.3 Zirndorf Candidate ist im Multi-Region-Katalog voll integriert", () => {
  const catalog = JSON.parse(fs.readFileSync(CANDIDATE_CATALOG_PATH, "utf8"));
  const zirndorf = catalog.datasets.find(d => d.id === "de-by-zirndorf");

  assert.ok(zirndorf, "Zirndorf muss im Katalog sein");
  assert.equal(zirndorf.name, "Zirndorf");
  assert.equal(zirndorf.state, "Bayern");
  assert.equal(zirndorf.country, "Deutschland");
  assert.equal(zirndorf.packageType, "osm");
  assert.equal(zirndorf.version, "2026.09.05");
  assert.equal(zirndorf.streetCount, 345);
  assert.equal(zirndorf.poiCount, 124);
  assert.equal(zirndorf.areaCount, 0);
  assert.equal(zirndorf.contentHash, "sha256:766615fdfddcbea7250d218f3b9f79c5f18e8e3b72fdcf99f7218e4867340f49");
  assert.equal(zirndorf.downloadPath, "cities/de-by-zirndorf.json");
});

test("4.4 Alle Datensätze im Multi-Region-Katalog haben sichere relative downloadPaths", () => {
  const catalog = JSON.parse(fs.readFileSync(CANDIDATE_CATALOG_PATH, "utf8"));
  for (const ds of catalog.datasets) {
    assert.ok(
      /^cities\/[a-z0-9-]+\.json$/.test(ds.downloadPath),
      `Pfad muss sicher und relativ sein: ${ds.downloadPath}`
    );
    assert.ok(!ds.downloadPath.includes(".."), "Kein Pfad-Traversal");
    assert.ok(!ds.downloadPath.startsWith("/"), "Kein absoluter Pfad");
  }
});

// ------------------------------------------------------------
// 5. CATALOG PROVIDER MULTI-REGION SEARCH TESTS
// ------------------------------------------------------------

test("5.1 CatalogDatasetProvider sucht über beide Bundesländer ohne Netzwerkaufrufe", async () => {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    networkCalls++;
    throw new Error(`Unerwarteter Netzwerkaufruf: ${input}`);
  };

  try {
    const provider = createCatalogDatasetProvider(CANDIDATE_CATALOG_PATH);

    // Suche nach Bayern
    const byResults = await provider.searchDatasets("Bayern");
    assert.equal(byResults.length, 2);
    assert.ok(byResults.some(r => r.id === "de-oberasbach-fire-training"));
    assert.ok(byResults.some(r => r.id === "de-by-zirndorf"));

    // Suche nach Nordrhein-Westfalen
    const nwResults = await provider.searchDatasets("Nordrhein-Westfalen");
    assert.equal(nwResults.length, 4);
    assert.ok(nwResults.some(r => r.id === "de-nw-koeln"));
    assert.ok(nwResults.some(r => r.id === "de-nw-olpe"));
    assert.ok(nwResults.some(r => r.id === "de-nw-siegen"));
    assert.ok(nwResults.some(r => r.id === "de-nw-wenden"));

    // Suche nach Stadtname Zirndorf
    const zirndorfResults = await provider.searchDatasets("Zirndorf");
    assert.equal(zirndorfResults.length, 1);
    assert.equal(zirndorfResults[0].id, "de-by-zirndorf");
    assert.equal(zirndorfResults[0].state, "Bayern");

    // Case-insensitiv
    const zirndorfLower = await provider.searchDatasets("zirndorf");
    assert.equal(zirndorfLower.length, 1);
    assert.equal(zirndorfLower[0].id, "de-by-zirndorf");

    // Metadaten abfragen
    const metaZirndorf = await provider.getDatasetMetadata("de-by-zirndorf");
    assert.equal(metaZirndorf.name, "Zirndorf");
    assert.equal(metaZirndorf.streetCount, 345);

    // Keine Netzwerkaufrufe getätigt
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ------------------------------------------------------------
// 6. STORAGE & GAMEPLAY INTEGRATION WITH ZIRNDORF
// ------------------------------------------------------------

test("6.1 Zirndorf lässt sich vollständig in CityStorage speichern und laden", async () => {
  const memoryStorage = createMemoryStorage();
  const storage = createCityStorage({
    dbName: "phase-16-zirndorf-storage",
    indexedDB: new MockIndexedDB(),
    IDBKeyRange: MockIDBKeyRange,
    localStorage: memoryStorage,
    activeCityStorageKey: "phase-16-zirndorf-active"
  });
  const pkg = JSON.parse(fs.readFileSync(ZIRNDORF_FIXTURE_PATH, "utf8"));
  const validated = validator.validateCityPackage(pkg);
  const city = { ...validated.city, boundary: validated.boundary };

  await storage.saveCity(city, validated.streets, validated.pois, validated.areas);
  await storage.setActiveCityId(city.id);

  const active = await storage.getActiveCityData();
  assert.ok(active);
  assert.equal(active.city.name, "Zirndorf");
  assert.equal(active.streets.length, 345);
  assert.equal(active.pois.length, 124);
  assert.equal(active.areas.length, 0);
});

test("6.2 Zirndorf erzeugt valide Rundenziele und funktioniert im Game-Engine Free-Mode", async () => {
  const pkg = JSON.parse(fs.readFileSync(ZIRNDORF_FIXTURE_PATH, "utf8"));
  const validated = validator.validateCityPackage(pkg);
  
  // 1. Target generation
  const streetTargets = targetApi.prepareStreetTargets(validated.streets, geometryApi);
  assert.equal(streetTargets.length, 345);
  assert.ok(streetTargets.every(t => targetApi.isValidTargetGeometry(t, geometryApi)));

  // 2. Click evaluation
  const target = streetTargets[0];
  const clicked = target.geometry.sections[0][0];
  const evaluation = targetApi.evaluateTargetDistance(target, clicked, turf, geometryApi);
  assert.ok(evaluation && Number.isFinite(evaluation.distanceMeters));
  assert.equal(evaluation.distanceMeters, 0);

  // 3. Engine initialisieren und freie Runde simulieren
  let now = 1000;
  const engine = gameEngineApi.createGameEngine({ now: () => (now += 100) });
  engine.startGame({ mode: "free", contentSelection: "streets" });
  engine.startRound();
  engine.activateRound({ ...target, name: target.displayName });
  engine.submitGuess({ lat: clicked[1], lng: clicked[0] });
  const roundResult = engine.resolveRound(evaluation);

  assert.equal(roundResult.targetId, target.id);
  assert.ok(Number.isFinite(roundResult.points));
  assert.ok(Number.isFinite(roundResult.distanceMeters));
  assert.equal(roundResult.distanceMeters, 0);
});
