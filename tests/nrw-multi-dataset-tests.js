"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCatalogDatasetProvider } = require("../dataset-provider.js");
const validator = require("../city-data-validator.js");
const { createCityStorage } = require("../city-storage.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const poiCategories = require("../poi-categories.js");
const gameEngineApi = require("../game-engine.js");
const statisticsApi = require("../statistics.js");
const turf = require("../vendor/turf/turf.min.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "data/catalog.json");

const EXPECTED_CITIES = [
  {
    name: "Oberasbach",
    datasetId: "de-oberasbach-fire-training",
    cityId: "osm-relation-1016396",
    packageType: "curated",
    datasetKind: "municipality",
    state: "Bayern",
    streets: 271,
    pois: 60,
    areas: 0,
    contentHash: "sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95"
  },
  {
    name: "Köln",
    datasetId: "de-nw-koeln",
    cityId: "osm-relation-62578",
    packageType: "osm",
    datasetKind: "municipality",
    state: "Nordrhein-Westfalen",
    streets: 4628,
    pois: 4453,
    areas: 101,
    contentHash: "sha256:82533736b96d1734aca82aa3f3829552c80dfad923348a4cc1f73a4068b047b2"
  },
  {
    name: "Olpe",
    datasetId: "de-nw-olpe",
    cityId: "osm-relation-163179",
    packageType: "osm",
    datasetKind: "municipality",
    state: "Nordrhein-Westfalen",
    streets: 461,
    pois: 114,
    areas: 2,
    contentHash: "sha256:6c89d676e575f2d69301715c3be5e8e66b5a798afc21b73495671fa33d996269"
  },
  {
    name: "Siegen",
    datasetId: "de-nw-siegen",
    cityId: "osm-relation-163256",
    packageType: "osm",
    datasetKind: "municipality",
    state: "Nordrhein-Westfalen",
    streets: 1176,
    pois: 426,
    areas: 23,
    contentHash: "sha256:f3d357f23ca65ea9d6fbb14dbd254d4e8955cb3ccaa3359786757fa87f4e95bb"
  },
  {
    name: "Wenden",
    datasetId: "de-nw-wenden",
    cityId: "osm-relation-160880",
    packageType: "osm",
    datasetKind: "municipality",
    state: "Nordrhein-Westfalen",
    streets: 460,
    pois: 37,
    areas: 3,
    contentHash: "sha256:a5e0edb8deb7e3cee8e7e0b0864e7e533c44ed76b5a1dc319526ff66149be6f4"
  }
];

function allIssues(result, kind = "errors") {
  return ["package", "municipality", "streets", "pois", "areas"]
    .flatMap(section => Array.isArray(result?.validation?.[section]?.[kind])
      ? result.validation[section][kind]
      : []);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("Katalog enthält die 5 Municipality-Referenzstädte mit eindeutigen IDs und Hashes", () => {
  const rawCatalog = fs.readFileSync(CATALOG_PATH, "utf8");
  const catalog = JSON.parse(rawCatalog);
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.datasets.length >= EXPECTED_CITIES.length);

  const seenDatasetIds = new Set();
  const seenCityIds = new Set();

  for (const expected of EXPECTED_CITIES) {
    const entry = catalog.datasets.find(d => d.id === expected.datasetId);
    assert.ok(entry, `Stadt ${expected.name} (${expected.datasetId}) muss im Katalog vorhanden sein`);
    assert.equal(entry.name, expected.name);
    assert.equal(entry.cityId, expected.cityId);
    assert.equal(entry.packageType, expected.packageType);
    assert.equal(entry.datasetKind, expected.datasetKind);
    assert.equal(entry.state, expected.state);
    assert.equal(entry.streetCount, expected.streets);
    assert.equal(entry.poiCount, expected.pois);
    assert.equal(entry.areaCount, expected.areas);
    assert.equal(entry.contentHash, expected.contentHash);
    assert.ok(entry.fileSize > 0);
    assert.ok(entry.downloadPath.endsWith(".json"));

    assert.ok(!seenDatasetIds.has(entry.id), `Dataset-ID ${entry.id} darf nicht doppelt vorkommen`);
    seenDatasetIds.add(entry.id);
    assert.ok(!seenCityIds.has(entry.cityId), `City-ID ${entry.cityId} darf nicht doppelt vorkommen`);
    seenCityIds.add(entry.cityId);
  }
});

test("Alle 5 Paketdateien sind Schema-1-konform, fehlerfrei und hash-valid", () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  for (const entry of catalog.datasets) {
    const pkgPath = path.join(path.dirname(CATALOG_PATH), entry.downloadPath);
    assert.ok(fs.existsSync(pkgPath), `Paketdatei muss existieren: ${pkgPath}`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    const val = validator.validateCityPackage(pkg);
    assert.equal(val.valid, true, `Paket ${entry.id} muss valide sein`);
    const errors = allIssues(val, "errors");
    assert.deepEqual(errors, [], `Paket ${entry.id} darf keine Validierungsfehler haben`);

    const hashCheck = validator.verifyPackageHash(pkg);
    assert.equal(hashCheck.valid, true, `contentHash für ${entry.id} muss übereinstimmen`);
    assert.equal(entry.contentHash, pkg.package.contentHash);
    assert.equal(entry.streetCount, pkg.streets.length);
    assert.equal(entry.poiCount, pkg.pois.length);
    assert.equal(entry.areaCount, Array.isArray(pkg.areas) ? pkg.areas.length : 0);
  }
});

test("CatalogDatasetProvider: Suche und Download aller 5 Städte ohne externe Netzwerkanfragen", async () => {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    networkCalls++;
    throw new Error(`Unerlaubter externer Netzwerkaufruf: ${url}`);
  };

  try {
    const provider = createCatalogDatasetProvider(CATALOG_PATH);
    for (const expected of EXPECTED_CITIES) {
      const candidates = await provider.searchDatasets(expected.name);
      assert.ok(candidates.length >= 1, `Suche nach "${expected.name}" muss Treffer liefern`);
      const match = candidates.find(c => c.id === expected.datasetId);
      assert.ok(match, `Kandidat mit ID "${expected.datasetId}" muss vorhanden sein`);
      assert.equal(match.name, expected.name);

      const downloadResult = await provider.downloadDataset(expected.datasetId);
      assert.equal(downloadResult.datasetId, expected.datasetId);
      assert.ok(downloadResult.dataset);
      assert.equal(downloadResult.metadata.contentHash, expected.contentHash);
    }
    assert.equal(networkCalls, 0, "Keine externen API-Aufrufe während Provider-Suche und Download");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CityStorage & IndexedDB: Speicherung, Laden und Targets für Wenden, Siegen, Köln", async () => {
  const provider = createCatalogDatasetProvider(CATALOG_PATH);
  const targetCities = EXPECTED_CITIES.filter(c => ["Wenden", "Siegen", "Köln"].includes(c.name));

  for (const expected of targetCities) {
    const download = await provider.downloadDataset(expected.datasetId);
    const validated = validator.validateCityPackage(download.dataset);
    assert.equal(validated.valid, true);

    const storage = createCityStorage({
      dbName: `phase-15-7-storage-${expected.datasetId}`,
      indexedDB: new MockIndexedDB(),
      IDBKeyRange: MockIDBKeyRange,
      localStorage: createMemoryStorage(),
      activeCityStorageKey: `phase-15-7-active-${expected.datasetId}`
    });

    const city = { ...validated.city, boundary: validated.boundary };
    await storage.saveCity(city, validated.streets, validated.pois, validated.areas);
    await storage.setActiveCityId(city.id);

    const active = await storage.getActiveCityData();
    assert.equal(active.city.id, expected.cityId);
    assert.equal(active.city.name, expected.name);
    assert.equal(active.streets.length, expected.streets);
    assert.equal(active.pois.length, expected.pois);
    assert.equal(active.areas.length, expected.areas);

    const streetTargets = targetApi.prepareStreetTargets(active.streets, geometryApi);
    const poiTargets = targetApi.preparePoiTargets(active.pois, poiCategories.getAll());

    assert.equal(streetTargets.length, expected.streets);
    assert.equal(poiTargets.length, expected.pois);
    assert.ok(streetTargets.every(t => targetApi.isValidTargetGeometry(t, geometryApi)));
    assert.ok(poiTargets.every(t => targetApi.isValidTargetGeometry(t, geometryApi)));
  }
});

test("Gameplay-Simulation: Freie Spielrunde in Wenden, Siegen und Köln ohne Netzwerk", async () => {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    networkCalls++;
    throw new Error(`Netzwerk während Gameplay verboten: ${url}`);
  };

  try {
    const provider = createCatalogDatasetProvider(CATALOG_PATH);
    const targetCities = EXPECTED_CITIES.filter(c => ["Wenden", "Siegen", "Köln"].includes(c.name));

    for (const expected of targetCities) {
      const download = await provider.downloadDataset(expected.datasetId);
      const validated = validator.validateCityPackage(download.dataset);

      const storage = createCityStorage({
        dbName: `phase-15-7-gameplay-${expected.datasetId}`,
        indexedDB: new MockIndexedDB(),
        IDBKeyRange: MockIDBKeyRange,
        localStorage: createMemoryStorage(),
        activeCityStorageKey: `phase-15-7-gameplay-active-${expected.datasetId}`
      });

      const city = { ...validated.city, boundary: validated.boundary };
      await storage.saveCity(city, validated.streets, validated.pois, validated.areas);
      await storage.setActiveCityId(city.id);

      const active = await storage.getActiveCityData();
      const streetTargets = targetApi.prepareStreetTargets(active.streets, geometryApi);
      assert.ok(streetTargets.length > 0);

      const target = streetTargets[0];
      const clicked = target.geometry.sections[0][0];
      const evaluation = targetApi.evaluateTargetDistance(target, clicked, turf, geometryApi);
      assert.ok(evaluation && Number.isFinite(evaluation.distanceMeters));

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
    }
    assert.equal(networkCalls, 0, "Keine Netzwerkaufrufe während des Gameplays");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Multi-City Switching & Statistiktrennung über alle 5 Städte", async () => {
  const provider = createCatalogDatasetProvider(CATALOG_PATH);
  const storage = createCityStorage({
    dbName: "phase-15-7-multicity-switch",
    indexedDB: new MockIndexedDB(),
    IDBKeyRange: MockIDBKeyRange,
    localStorage: createMemoryStorage(),
    activeCityStorageKey: "phase-15-7-multicity-active"
  });

  // Alle 5 Städte in dieselbe IndexedDB installieren
  for (const expected of EXPECTED_CITIES) {
    const download = await provider.downloadDataset(expected.datasetId);
    const validated = validator.validateCityPackage(download.dataset);
    const city = { ...validated.city, boundary: validated.boundary };
    await storage.saveCity(city, validated.streets, validated.pois, validated.areas);
  }

  // Zyklischer Wechsel: Oberasbach -> Olpe -> Wenden -> Siegen -> Köln -> Oberasbach
  const cycle = ["Oberasbach", "Olpe", "Wenden", "Siegen", "Köln", "Oberasbach"];
  for (const cityName of cycle) {
    const expected = EXPECTED_CITIES.find(c => c.name === cityName);
    await storage.setActiveCityId(expected.cityId);
    const active = await storage.getActiveCityData();

    assert.equal(active.city.id, expected.cityId);
    assert.equal(active.city.name, expected.name);
    assert.equal(active.streets.length, expected.streets);
    assert.equal(active.pois.length, expected.pois);
    assert.equal(active.areas.length, expected.areas);

    const streetTargets = targetApi.prepareStreetTargets(active.streets, geometryApi);
    assert.equal(streetTargets.length, expected.streets);
  }

  // Statistiktrennung prüfen: Je eine Runde für Wenden, Siegen, Köln speichern
  const mockLocalStorage = createMemoryStorage();
  const targetSub = EXPECTED_CITIES.filter(c => ["Wenden", "Siegen", "Köln"].includes(c.name));

  for (let i = 0; i < targetSub.length; i++) {
    const city = targetSub[i];
    const store = statisticsApi.createStatisticsStore(mockLocalStorage, city.cityId);

    store.recordGameStarted("free", { gameId: `game-${city.cityId}` });
    store.recordRound({
      mode: "free",
      targetId: `${city.cityId}:street-${i}`,
      targetName: `Teststraße ${city.name}`,
      targetType: "street",
      distanceMeters: 25 * (i + 1),
      points: 100 - (10 * i),
      durationSeconds: 5 + i
    }, { roundId: `round-${city.cityId}` });
  }

  // Überprüfen, dass jede Stadt isolierte Statistik hat
  for (let i = 0; i < targetSub.length; i++) {
    const city = targetSub[i];
    const store = statisticsApi.createStatisticsStore(mockLocalStorage, city.cityId);
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.overall.roundsEvaluated, 1, `Stadt ${city.name} muss genau 1 Runde haben`);
    assert.equal(store.getView().statistics.averagePoints, 100 - (10 * i));
  }
});

test("Phase 15.7a: Administrative Area Containment & Hierarchy Regression Checks", () => {
  const siegenPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-siegen.json"), "utf8"));
  const koelnPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-koeln.json"), "utf8"));
  const olpePkg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-olpe.json"), "utf8"));
  const wendenPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-wenden.json"), "utf8"));

  // Siegen: Exakt 23 valide Ortsteile, keine Nachbarkommunen oder externe Stadtteile
  assert.equal(siegenPkg.areas.length, 23, "Siegen muss genau 23 Ortsteile haben");
  const siegenAreaNames = siegenPkg.areas.map(a => a.name);
  const forbiddenSiegenNeighbors = [
    "Kreuztal",
    "Freudenberg",
    "Wilnsdorf",
    "Netphen",
    "Buschhütten",
    "Dreis-Tiefenbach"
  ];
  for (const neighbor of forbiddenSiegenNeighbors) {
    assert.ok(
      !siegenAreaNames.includes(neighbor),
      `Siegen darf den externen Nachbarn / Stadtteil "${neighbor}" keinesfalls enthalten!`
    );
  }

  // Köln: Exakt 101 valide Stadtbezirke & Veedel, keine externe Gemarkung Berzdorf
  assert.equal(koelnPkg.areas.length, 101, "Köln muss genau 101 administrative Teilgebiete haben");
  const koelnAreaNames = koelnPkg.areas.map(a => a.name);
  assert.ok(!koelnAreaNames.includes("Gemarkung Berzdorf"), "Köln darf 'Gemarkung Berzdorf' (Wesseling) nicht enthalten");
  const expectedKoelnDistricts = ["Innenstadt", "Ehrenfeld", "Lindenthal", "Nippes", "Chorweiler", "Porz", "Kalk", "Mülheim", "Rodenkirchen"];
  for (const dist of expectedKoelnDistricts) {
    assert.ok(koelnAreaNames.includes(dist), `Köln muss Stadtbezirk "${dist}" enthalten`);
  }

  // Olpe: Behält unverändert 2 Ortsteile
  assert.equal(olpePkg.areas.length, 2, "Olpe muss weiterhin genau 2 Ortsteile haben");
  const olpeNames = olpePkg.areas.map(a => a.name).sort();
  assert.deepEqual(olpeNames, ["Olpe", "Unterneger"]);

  // Wenden: Behält unverändert 3 Ortsteile
  assert.equal(wendenPkg.areas.length, 3, "Wenden muss weiterhin genau 3 Ortsteile haben");
  const wendenNames = wendenPkg.areas.map(a => a.name).sort();
  assert.deepEqual(wendenNames, ["Gerlingen", "Möllmicke", "Ottfingen"]);
});

(async () => {
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`\n${passed}/${tests.length} NRW Multi-Dataset Tests erfolgreich bestanden.`);
})();
