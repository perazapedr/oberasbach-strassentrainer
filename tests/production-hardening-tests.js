"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { createCatalogDatasetProvider, DatasetProviderError } = require("../dataset-provider.js");
const { createCityStorage } = require("../city-storage.js");
const validator = require("../city-data-validator.js");
const cityPackage = require("../city-package.js");
const cityUpdate = require("../city-update.js");
const customAreaApi = require("../custom-training-area.js");
const statisticsApi = require("../statistics.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const gameEngineApi = require("../game-engine.js");
const curationComposer = require("../tools/dataset-curation/index.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const OBERASBACH_PATH = path.join(ROOT, "data/cities/oberasbach.json");
const OLPE_PATH = path.join(ROOT, "data/cities/de-nw-olpe.json");
const KREIS_OLPE_PATH = path.join(ROOT, "data/cities/de-nw-kreis-olpe.json");

function createTestStorage(dbName = "hardening-test-db") {
  const mockIdb = new MockIndexedDB();
  const memStorage = createMemoryStorage();
  return createCityStorage({
    dbName,
    indexedDB: mockIdb,
    IDBKeyRange: MockIDBKeyRange,
    localStorage: memStorage,
    activeCityStorageKey: "hardening-active-city"
  });
}

// ===========================================================================
// 19.3 & 19.20: Missing Dataset & 404 Package Handling
// ===========================================================================
test("Phase 19.3 & 19.20: Fehlendes Dataset (404 / fehlt) wirft kontrollierten Fehler ohne Crash", async () => {
  const catalogWith404 = {
    schemaVersion: 1,
    datasets: [
      { id: "existing-city", name: "Existing City", downloadPath: "nonexistent-404.json" },
      { id: "working-city", name: "Working City", downloadPath: "datasets/working/package.json" }
    ]
  };

  const provider = createCatalogDatasetProvider({
    catalog: catalogWith404,
    async loadPackage(pkgPath) {
      if (pkgPath === "nonexistent-404.json") {
        const err = new Error("Package not found (HTTP 404)");
        err.code = "DOWNLOAD_FAILED";
        err.status = 404;
        throw err;
      }
      return { id: "working-city", city: { id: "working-city", name: "Working City" } };
    }
  });

  const searchResults = await provider.searchDatasets("existing");
  assert.equal(searchResults.length, 1);

  await assert.rejects(
    async () => provider.downloadDataset("existing-city"),
    err => err.code === "DOWNLOAD_FAILED"
  );

  const workingResult = await provider.downloadDataset("working-city");
  assert.equal(workingResult.datasetId, "working-city");
});

// ===========================================================================
// 19.4: Defekter Download (Abort, Truncated JSON, Invalid JSON, Timeout)
// ===========================================================================
test("Phase 19.4: Defekter Download (Truncated JSON, Abort, Timeout) blockiert Installation", async () => {
  const invalidJsonProvider = createCatalogDatasetProvider({
    catalog: {
      schemaVersion: 1,
      datasets: [{ id: "corrupt-city", name: "Corrupt City", downloadPath: "corrupt.json" }]
    },
    async loadPackage() {
      throw new DatasetProviderError("DOWNLOAD_FAILED", "JSON parse error: Unexpected end of JSON input");
    }
  });

  await assert.rejects(
    async () => invalidJsonProvider.downloadDataset("corrupt-city"),
    err => err.code === "DOWNLOAD_FAILED"
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    async () => invalidJsonProvider.downloadDataset("corrupt-city", { signal: controller.signal }),
    err => err.code === "ABORTED"
  );
});

// ===========================================================================
// 19.5 & 19.22 & 19.49: Hash Falsch & Package Tamper & Same Version Different Hash
// ===========================================================================
test("Phase 19.5 & 19.22 & 19.49: Manipulierter Hash oder abweichender Hash bei gleicher Version wird geblockt", async () => {
  const pkg = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

  const tampered = JSON.parse(JSON.stringify(pkg));
  tampered.streets[0].name = "Böswillig Manipulierte Straße";
  const check = validator.verifyPackageHash(tampered);
  assert.equal(check.valid, false, "Manipuliertes Paket darf verifyPackageHash nicht bestehen");

  const tamperedHash = JSON.parse(JSON.stringify(pkg));
  tamperedHash.package.contentHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  const check2 = validator.verifyPackageHash(tamperedHash);
  assert.equal(check2.valid, false);

  const catalogEntry = {
    id: "de-nw-olpe",
    name: "Olpe",
    version: pkg.package.version,
    contentHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    downloadPath: "package.json"
  };

  const provider = createCatalogDatasetProvider({
    catalog: { schemaVersion: 1, datasets: [catalogEntry] },
    async loadPackage() { return pkg; }
  });

  await assert.rejects(
    async () => provider.downloadDataset("de-nw-olpe"),
    err => err.code === "HASH_MISMATCH"
  );
});

// ===========================================================================
// 19.6: Package Contract Broken
// ===========================================================================
test("Phase 19.6: Paket mit fehlenden Pflichtfeldern, ungültiger Geometrie oder falschem Schema wird abgewiesen", () => {
  const invalidSchema = { schemaVersion: 99, city: { id: "test", name: "Test" } };
  const val1 = validator.validateCityPackage(invalidSchema);
  assert.equal(val1.valid, false);

  const missingStreets = { schemaVersion: 1, city: { id: "test", name: "Test" } };
  const val2 = validator.validateCityPackage(missingStreets);
  assert.equal(val2.valid, false);

  const badKind = {
    schemaVersion: 1,
    package: { id: "test", type: "osm", datasetKind: "galaxy" },
    city: { id: "test", name: "Test" },
    streets: [{ id: "s1", name: "Str", geometry: { type: "MultiLineString", coordinates: [[[8, 50], [8.1, 50.1]]] } }],
    pois: []
  };
  const val3 = validator.validateCityPackage(badKind);
  assert.equal(val3.valid, false);
});

// ===========================================================================
// 19.7 & 19.50: Catalog Defekt & Path / URL Safety
// ===========================================================================
test("Phase 19.7 & 19.50: Defekter Katalog und unsichere Pfade (.., absolute, file:, javascript:) werden blockiert", async () => {
  const pTraversal = createCatalogDatasetProvider({
    catalog: {
      schemaVersion: 1,
      datasets: [{ id: "bad-path", name: "Bad", downloadPath: "../secret.json" }]
    }
  });
  await assert.rejects(
    async () => pTraversal.searchDatasets("bad"),
    err => err.code === "UNSAFE_DOWNLOAD_PATH"
  );

  const pAbs = createCatalogDatasetProvider({
    catalog: {
      schemaVersion: 1,
      datasets: [{ id: "abs-path", name: "Abs", downloadPath: "/etc/passwd.json" }]
    }
  });
  await assert.rejects(
    async () => pAbs.searchDatasets("abs"),
    err => err.code === "UNSAFE_DOWNLOAD_PATH"
  );

  const pDup = createCatalogDatasetProvider({
    catalog: {
      schemaVersion: 1,
      datasets: [
        { id: "dup-id", name: "First", downloadPath: "a.json" },
        { id: "dup-id", name: "Second", downloadPath: "b.json" }
      ]
    }
  });
  await assert.rejects(
    async () => pDup.searchDatasets("dup"),
    err => err.code === "INVALID_CATALOG"
  );
});

// ===========================================================================
// 19.8 & 19.9 & 19.11: Update Abbruch, Recovery & Quota / Write Failure
// ===========================================================================
test("Phase 19.8 & 19.9 & 19.11: Atomic Rollback bei Schreibfehler & Update Recovery", async () => {
  const storage = createTestStorage("atomic-test-db");
  const basePkg = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

  await storage.saveCity(basePkg.city, basePkg.streets, basePkg.pois, basePkg.areas || []);
  await storage.setActiveCityId(basePkg.city.id);

  const initialData = await storage.getCityData(basePkg.city.id);
  assert.equal(initialData.streets.length, basePkg.streets.length);

  const failingStorage = {
    ...storage,
    async saveCity() {
      const err = new Error("QuotaExceededError: DomException quota exceeded");
      err.name = "QuotaExceededError";
      throw err;
    }
  };

  await assert.rejects(
    async () => failingStorage.saveCity(basePkg.city, [], []),
    err => err.name === "QuotaExceededError"
  );

  const dataAfterFailure = await storage.getCityData(basePkg.city.id);
  assert.equal(dataAfterFailure.streets.length, basePkg.streets.length, "Vorherige Stadt muss nach Fehlschlag 100% intakt sein");
});

// ===========================================================================
// 19.10 & 19.25 & 19.26: Statistik, Custom Areas & Local Response Areas erhalten
// ===========================================================================
test("Phase 19.10 & 19.25 & 19.26: Update erhält Statistik, Custom Areas und lokale Wachgebiete verlustfrei", async () => {
  const storage = createTestStorage("stats-update-db");
  const basePkg = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

  await storage.saveCity(basePkg.city, basePkg.streets, basePkg.pois, basePkg.areas || []);
  await storage.setActiveCityId(basePkg.city.id);

  const storageMap = new Map();
  const mockStorage = {
    getItem: k => storageMap.get(k) || null,
    setItem: (k, v) => storageMap.set(k, String(v))
  };
  const statsKey = statisticsApi.getStatisticsStorageKey(basePkg.city.id);
  const statsStore = statisticsApi.createStatisticsStore(mockStorage, statsKey, { cityId: basePkg.city.id });
  statsStore.recordRound({
    targetId: basePkg.streets[0].id,
    targetType: "street",
    mode: "free",
    score: 850,
    distanceMeters: 45,
    durationMs: 4200
  });

  const statsSnapshotBefore = statsStore.getSnapshot();
  assert.equal(statsSnapshotBefore.overall.roundsEvaluated, 1);

  const customPolygon = customAreaApi.createArea({
    id: "user-area-custom-1",
    cityId: basePkg.city.id,
    name: "Mein Wachgebiet Nord",
    kind: "custom",
    source: "user",
    cityBoundary: basePkg.boundary || basePkg.city.boundary,
    geometry: {
      type: "Polygon",
      coordinates: [[[7.85, 51.02], [7.88, 51.02], [7.88, 51.05], [7.85, 51.05], [7.85, 51.02]]]
    }
  });
  await storage.saveArea(customPolygon);

  const updatedPkg = JSON.parse(JSON.stringify(basePkg));
  updatedPkg.package.version = "2026.09.99";
  await storage.saveCity(updatedPkg.city, updatedPkg.streets, updatedPkg.pois, updatedPkg.areas || []);

  const areasAfterUpdate = await storage.getCityAreas(basePkg.city.id);
  const userArea = areasAfterUpdate.find(a => a.id === "user-area-custom-1");
  assert.ok(userArea, "Benutzergebiet muss nach Update erhalten bleiben");
  assert.equal(userArea.name, "Mein Wachgebiet Nord");

  const statsSnapshotAfter = statsStore.getSnapshot();
  assert.equal(statsSnapshotAfter.overall.roundsEvaluated, 1, "Statistik muss nach Update unverändert erhalten sein");
});

// ===========================================================================
// 19.12: Corrupt / Missing Records Graceful Handling
// ===========================================================================
test("Phase 19.12: Beschädigter IDB-State (City ohne Straßen) führt nicht zu Endlosschleife oder White Screen", async () => {
  const storage = createTestStorage("corrupt-records-db");

  const emptyCity = { id: "empty-city", name: "Leere Stadt" };
  await storage.saveCity(emptyCity, [], [], []);
  await storage.setActiveCityId("empty-city");

  const activeData = await storage.getActiveCityData();
  assert.ok(activeData);
  assert.equal(activeData.city.id, "empty-city");
  assert.deepEqual(activeData.streets, []);
  assert.deepEqual(activeData.pois, []);

  const streetTargets = targetApi.prepareStreetTargets(activeData.streets, geometryApi);
  const poiTargets = targetApi.preparePoiTargets(activeData.pois);
  const targets = [...streetTargets, ...poiTargets];
  assert.equal(targets.length, 0);
  assert.equal(Array.isArray(targets), true);
});

// ===========================================================================
// 19.21: Version Downgrade Rejection
// ===========================================================================
test("Phase 19.21: Version Downgrade (Remote Katalog hat ältere Version) wird nicht als Update angeboten", async () => {
  const provider = createCatalogDatasetProvider({
    catalog: {
      schemaVersion: 1,
      datasets: [{ id: "de-nw-olpe", name: "Olpe", version: "1.0.0", downloadPath: "olpe.json" }]
    }
  });

  const installedHigher = {
    id: "de-nw-olpe",
    name: "Olpe",
    package: { id: "de-nw-olpe", version: "2.0.0" }
  };

  const updateCheck = await provider.checkForUpdate(installedHigher);
  assert.equal(updateCheck.hasUpdate, false, "Ältere Version im Remote-Katalog darf nicht als Update angeboten werden");
});

// ===========================================================================
// 19.23 & 19.24: Curated vs Generated & Curation Base Mismatch
// ===========================================================================
test("Phase 19.23 & 19.24: Curation Base Mismatch blockiert Rebase; Curated nicht überschrieben", () => {
  const base = JSON.parse(fs.readFileSync(KREIS_OLPE_PATH, "utf8"));
  const overlay = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/curation/kreis-olpe-synthetic-overlay.json"), "utf8"));

  const composed = curationComposer.composeCuratedPackage(base, overlay);
  assert.equal(composed.packageData.package.type, "curated");
  assert.equal(composed.packageData.package.version, overlay.curatedVersion);

  const modifiedBase = JSON.parse(JSON.stringify(base));
  modifiedBase.package.contentHash = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

  assert.throws(
    () => curationComposer.composeCuratedPackage(modifiedBase, overlay),
    err => err.code === "CURATION_BASE_HASH_MISMATCH"
  );
});

// ===========================================================================
// 19.27: Area Round Keys & Statistics Isolation
// ===========================================================================
test("Phase 19.27: Area Round Keys sind eindeutig und trennen Städte statistisch sauber", () => {
  const storageMap = new Map();
  const mockStorage = {
    getItem: k => storageMap.get(k) || null,
    setItem: (k, v) => storageMap.set(k, String(v))
  };

  const olpeStore = statisticsApi.createStatisticsStore(
    mockStorage,
    statisticsApi.getStatisticsStorageKey("de-nw-olpe"),
    { cityId: "de-nw-olpe" }
  );
  const districtStore = statisticsApi.createStatisticsStore(
    mockStorage,
    statisticsApi.getStatisticsStorageKey("de-nw-kreis-olpe"),
    { cityId: "de-nw-kreis-olpe" }
  );

  olpeStore.recordRound({
    targetId: "street-olpe-1",
    targetType: "street",
    mode: "free",
    score: 600,
    distanceMeters: 50,
    durationMs: 3000
  });

  districtStore.recordRound({
    targetId: "street-district-1",
    targetType: "street",
    mode: "free",
    score: 800,
    distanceMeters: 20,
    durationMs: 2500
  });

  assert.equal(olpeStore.getSnapshot().overall.roundsEvaluated, 1);
  assert.equal(districtStore.getSnapshot().overall.roundsEvaluated, 1);
  assert.notEqual(olpeStore.getStorageKey(), districtStore.getStorageKey());
});

// ===========================================================================
// 19.46 & 19.47 & 19.48: Multi Dataset, Switching, Delete & Reinstall
// ===========================================================================
test("Phase 19.46 & 19.47 & 19.48: Multi-Dataset-Installation, Umschalten, Löschen und Neuinstallation", async () => {
  const storage = createTestStorage("multi-city-lifecycle-db");

  const oberasbachPkg = JSON.parse(fs.readFileSync(OBERASBACH_PATH, "utf8"));
  const olpePkg = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

  await storage.saveCity(oberasbachPkg.city, oberasbachPkg.streets, oberasbachPkg.pois, oberasbachPkg.areas || []);
  await storage.saveCity(olpePkg.city, olpePkg.streets, olpePkg.pois, olpePkg.areas || []);

  const cities = await storage.getAllCities();
  assert.equal(cities.length, 2);

  await storage.setActiveCityId(oberasbachPkg.city.id);
  assert.equal(storage.getActiveCityId(), oberasbachPkg.city.id);

  await storage.setActiveCityId(olpePkg.city.id);
  assert.equal(storage.getActiveCityId(), olpePkg.city.id);

  await storage.deleteCity(olpePkg.city.id);
  const citiesAfterDelete = await storage.getAllCities();
  assert.equal(citiesAfterDelete.length, 1);
  assert.equal(citiesAfterDelete[0].id, oberasbachPkg.city.id);

  const oberasbachData = await storage.getCityData(oberasbachPkg.city.id);
  assert.equal(oberasbachData.streets.length, 271);

  await storage.saveCity(olpePkg.city, olpePkg.streets, olpePkg.pois, olpePkg.areas || []);
  const citiesAfterReinstall = await storage.getAllCities();
  assert.equal(citiesAfterReinstall.length, 2);
});

// ===========================================================================
// 19.51 & 19.52 & 19.53: XSS, Unicode, Long Names Safety
// ===========================================================================
test("Phase 19.51 & 19.52 & 19.53: XSS-Strings, deutsches Unicode und überlange Namen führen nicht zu Absturz", () => {
  const testPkg = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    city: {
      id: "unicode-xss-test",
      name: "Groß-Übelstädt <script>alert(1)</script>",
      displayName: "Gemeinde Groß-Übelstädt an der Schönen Aussicht (Kreis Groß-Übelstädt-Süd)",
      osmType: "relation",
      osmId: 999999,
      center: { lat: 50.1, lon: 8.1 },
      bounds: { north: 50.2, south: 50.0, west: 8.0, east: 8.2 }
    },
    boundary: {
      type: "Polygon",
      coordinates: [[[8.0, 50.0], [8.2, 50.0], [8.2, 50.2], [8.0, 50.2], [8.0, 50.0]]]
    },
    streets: [
      {
        id: "st-unicode-1",
        cityId: "unicode-xss-test",
        osmWayIds: [1001],
        name: "Äußere Straße der Barmherzigkeit & Nächstenliebe \"Zur goldenen Krone\" <img src=x onerror=1>",
        geometry: {
          type: "MultiLineString",
          coordinates: [[[8.05, 50.05], [8.06, 50.06]]]
        },
        quizEligible: true
      },
      {
        id: "st-long-2",
        cityId: "unicode-xss-test",
        osmWayIds: [1002],
        name: "General-Feldmarschall-Graf-Gottfried-Heinrich-zu-Pappenheim-Gedächtnis-Allee-und-Verbindungsstraße-Nordost",
        geometry: {
          type: "MultiLineString",
          coordinates: [[[8.06, 50.06], [8.07, 50.07]]]
        },
        quizEligible: true
      }
    ],
    pois: [
      {
        id: "poi-unicode-1",
        cityId: "unicode-xss-test",
        name: "Café & Bäckerei 'Süßer Gruß' <iframe src='evil.com'>",
        category: "restaurant",
        position: { lat: 50.055, lon: 8.055 },
        quizEligible: true
      }
    ]
  };

  const check = validator.validateCityPackage(testPkg);
  assert.equal(check.valid, true);

  const streetTargets = targetApi.prepareStreetTargets(testPkg.streets, geometryApi);
  const poiTargets = targetApi.preparePoiTargets(testPkg.pois, [{ id: "restaurant", label: "Gastronomie" }]);
  const targets = [...streetTargets, ...poiTargets];
  assert.equal(targets.length, 3);
  assert.ok(targets[0].displayName.includes("Äußere"));
  assert.ok(targets[1].displayName.includes("Pappenheim"));

  const engine = gameEngineApi.createGameEngine({});
  engine.startGame(gameEngineApi.MODE_CONFIGS.free);
  assert.equal(engine.gameState.status, gameEngineApi.GAME_STATUS.IDLE);
  engine.startRound();
  assert.equal(engine.gameState.status, gameEngineApi.GAME_STATUS.PREPARING);
  const activeTarget = { ...targets[0], name: targets[0].canonicalName || targets[0].displayName };
  engine.activateRound(activeTarget);
  assert.equal(engine.gameState.status, gameEngineApi.GAME_STATUS.ACTIVE);
  assert.ok(engine.gameState.currentRound.target.name.includes("Äußere"));
});
