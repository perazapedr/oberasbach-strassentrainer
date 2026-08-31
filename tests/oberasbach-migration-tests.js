"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const geometryApi = require("../geometry.js");
const targetApi = require("../targets.js");
const statisticsApi = require("../statistics.js");
const validatorApi = require("../city-data-validator.js");
const defaultCityApi = require("../default-city.js");

const ROOT = path.join(__dirname, "..");
const PACKAGE_PATH = path.join(ROOT, "data/cities/oberasbach.json");
const CITY_ID = "osm-relation-1016396";

function loadLegacyData() {
  const context = {};
  context.window = context;
  vm.createContext(context);
  for (const relativePath of ["data/oberasbach-streets.js", "data/oberasbach-pois.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), "utf8"), context, {
      filename: relativePath
    });
  }
  return {
    streets: JSON.parse(JSON.stringify(context.OBERASBACH_STREETS)),
    pois: JSON.parse(JSON.stringify(context.OBERASBACH_POIS))
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function memoryLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function memoryCityStorage(initialPackages = []) {
  const packages = new Map(initialPackages.map(cityPackage => [cityPackage.city.id, clone(cityPackage)]));
  let activeCityId = null;
  const calls = { saveCity: 0, setActiveCityId: 0 };
  return {
    calls,
    getAllCities: async () => [...packages.values()].map(cityPackage => clone(cityPackage.city)),
    hasCity: async cityId => packages.has(cityId),
    saveCity: async (city, streets, pois) => {
      calls.saveCity += 1;
      packages.set(city.id, clone({ city, streets, pois }));
    },
    setActiveCityId: async cityId => {
      calls.setActiveCityId += 1;
      if (cityId && !packages.has(cityId)) throw new Error("city missing");
      activeCityId = cityId || null;
    },
    getActiveCityId: () => activeCityId,
    getCityData: async cityId => packages.has(cityId) ? clone(packages.get(cityId)) : null
  };
}

const legacy = loadLegacyData();
const cityPackage = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("Paketstruktur und kanonische Stadt-ID", () => {
  assert.equal(cityPackage.schemaVersion, 1);
  assert.equal(cityPackage.city.id, CITY_ID);
  assert.equal(cityPackage.city.osmType, "relation");
  assert.equal(cityPackage.city.osmId, 1016396);
  assert.equal(cityPackage.city.source, "curated+openstreetmap");
  assert.equal(cityPackage.city.dataVersion, 1);
  assert.ok(cityPackage.city.bounds && cityPackage.city.center);
});

test("Paket-Counts entsprechen exakt den Arrays", () => {
  assert.equal(cityPackage.city.streetCount, cityPackage.streets.length);
  assert.equal(cityPackage.city.poiCount, cityPackage.pois.length);
  assert.equal(cityPackage.streets.length, 271);
  assert.equal(cityPackage.pois.length, 60);
});

test("jede kuratierte Straße ist mit unverändertem Hauptnamen enthalten", () => {
  const names = new Set(cityPackage.streets.map(street => street.name));
  assert.deepEqual([...names].sort(), legacy.streets.map(street => street.name).sort());
});

test("Straßen-IDs sind eindeutig, stabil und cityId-basiert", () => {
  const ids = cityPackage.streets.map(street => street.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => id.startsWith(`${CITY_ID}:street-`)));
  assert.ok(cityPackage.streets.every(street => street.cityId === CITY_ID));
});

test("alle Straßen besitzen vollständige lokale MultiLineString-Geometrien", () => {
  const targets = targetApi.prepareStreetTargets(cityPackage.streets, geometryApi);
  assert.equal(targets.length, 271);
  assert.ok(targets.every(target => geometryApi.isValidStreetGeometry(target.geometry, target.id)));
  assert.ok(cityPackage.streets.every(street => street.geometry.type === "MultiLineString"
    && street.geometry.coordinates.length > 0
    && street.geometry.coordinates.every(line => line.length >= 2)));
});

test("alle Straßenkoordinaten sind endliche gültige [lon, lat]", () => {
  for (const street of cityPackage.streets) {
    for (const line of street.geometry.coordinates) {
      for (const coordinate of line) {
        assert.equal(coordinate.length >= 2, true, street.name);
        assert.equal(Number.isFinite(coordinate[0]) && Math.abs(coordinate[0]) <= 180, true, street.name);
        assert.equal(Number.isFinite(coordinate[1]) && Math.abs(coordinate[1]) <= 90, true, street.name);
      }
    }
  }
});

test("mehrteilige Straßen behalten alle eindeutigen OSM-Way-IDs", () => {
  assert.ok(cityPackage.streets.every(street => street.osmWayIds.length > 0));
  assert.ok(cityPackage.streets.every(street => new Set(street.osmWayIds).size === street.osmWayIds.length));
  assert.ok(cityPackage.streets.some(street => street.osmWayIds.length > 1));
});

test("jeder kuratierte POI bleibt über legacyId nachvollziehbar erhalten", () => {
  const byLegacyId = new Map(cityPackage.pois.map(poi => [poi.legacyId, poi]));
  assert.equal(byLegacyId.size, legacy.pois.length);
  for (const legacyPoi of legacy.pois) assert.ok(byLegacyId.has(legacyPoi.id), legacyPoi.id);
});

test("kuratierte POI-Felder, Positionen und Geometrien bleiben unverändert", () => {
  const byLegacyId = new Map(cityPackage.pois.map(poi => [poi.legacyId, poi]));
  for (const legacyPoi of legacy.pois) {
    const migrated = byLegacyId.get(legacyPoi.id);
    for (const field of [
      "displayName", "category", "subcategory", "address", "active", "quizEligible",
      "geometryScope", "source", "sourceUrl", "needsReview", "reviewNote"
    ]) assert.deepEqual(migrated[field], legacyPoi[field], `${legacyPoi.id}.${field}`);
    assert.deepEqual(migrated.aliases, legacyPoi.aliases, `${legacyPoi.id}.aliases`);
    assert.deepEqual(migrated.geometry, legacyPoi.geometry, `${legacyPoi.id}.geometry`);
    assert.deepEqual(migrated.position, { lat: legacyPoi.latitude, lon: legacyPoi.longitude });
  }
});

test("POI-Kategorien bleiben vollständig erhalten", () => {
  const legacyCategories = [...new Set(legacy.pois.map(poi => poi.category))].sort();
  const migratedCategories = [...new Set(cityPackage.pois.map(poi => poi.category))].sort();
  assert.deepEqual(migratedCategories, legacyCategories);
  assert.equal(migratedCategories.length, 11);
});

test("POI-IDs sind eindeutig und alle POIs gehören zu Oberasbach", () => {
  const ids = cityPackage.pois.map(poi => poi.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => id.startsWith(`${CITY_ID}:poi-`)));
  assert.ok(cityPackage.pois.every(poi => poi.cityId === CITY_ID && poi.name && poi.category));
});

test("alle drei kuratierten Feuerwehrgerätehäuser bleiben als Marker ableitbar", () => {
  const stations = cityPackage.pois.filter(poi => poi.category === "fire_station"
    || poi.subcategory === "Feuerwehrgerätehaus");
  assert.deepEqual(stations.map(poi => poi.legacyId).sort(), [
    "poi-orientation-fire-altenberg",
    "poi-orientation-fire-oberasbach",
    "poi-orientation-fire-rehdorf"
  ]);
});

test("kuratierter Validator-Modus erhält Paket und Counts vollständig", () => {
  const validated = validatorApi.validateCityData(cityPackage, { sourceMode: "curated" });
  assert.equal(validated.valid, true);
  assert.equal(validated.validation.summary.errorCount, 0);
  assert.equal(validated.streets.length, 271);
  assert.equal(validated.pois.length, 60);
});

test("Paketgeneration ist deterministisch und benötigt kein Netzwerk", () => {
  const before = fs.readFileSync(PACKAGE_PATH, "utf8");
  childProcess.execFileSync(process.execPath, [path.join(ROOT, "scripts/build-oberasbach-package.js")], {
    cwd: ROOT,
    stdio: "pipe"
  });
  assert.equal(fs.readFileSync(PACKAGE_PATH, "utf8"), before);
});

test("lokale Paketladefunktion lädt ausschließlich den gebündelten Pfad", async () => {
  const calls = [];
  const loaded = await defaultCityApi.loadBundledDefaultCity({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => clone(cityPackage) };
    }
  });
  assert.equal(loaded.city.id, CITY_ID);
  assert.deepEqual(calls.map(call => call.url), ["data/cities/oberasbach.json"]);
});

test("leere Datenbank installiert und aktiviert Oberasbach", async () => {
  const storage = memoryCityStorage();
  const result = await defaultCityApi.installBundledDefaultCityIfNeeded(storage, { packageData: cityPackage });
  assert.equal(result.installed, true);
  assert.equal(storage.calls.saveCity, 1);
  assert.equal(storage.getActiveCityId(), CITY_ID);
  const data = await storage.getCityData(CITY_ID);
  assert.equal(data.streets.length, 271);
  assert.equal(data.pois.length, 60);
});

test("Default-Import ist bei wiederholtem Startup idempotent", async () => {
  const storage = memoryCityStorage();
  await defaultCityApi.installBundledDefaultCityIfNeeded(storage, { packageData: cityPackage });
  const second = await defaultCityApi.installBundledDefaultCityIfNeeded(storage, { packageData: cityPackage });
  assert.equal(second.installed, false);
  assert.equal(second.reason, "cities-exist");
  assert.equal(storage.calls.saveCity, 1);
});

test("vorhandene andere Stadt und aktive Auswahl werden nicht verändert", async () => {
  const zirndorf = clone(cityPackage);
  zirndorf.city.id = "osm-relation-zirndorf";
  zirndorf.city.name = zirndorf.city.displayName = "Zirndorf";
  zirndorf.streets = zirndorf.streets.slice(0, 1).map(street => ({ ...street, id: "z:street", cityId: zirndorf.city.id }));
  zirndorf.pois = [];
  const storage = memoryCityStorage([zirndorf]);
  await storage.setActiveCityId(zirndorf.city.id);
  const result = await defaultCityApi.installBundledDefaultCityIfNeeded(storage, { packageData: cityPackage });
  assert.equal(result.reason, "cities-exist");
  assert.equal(storage.calls.saveCity, 0);
  assert.equal(storage.getActiveCityId(), zirndorf.city.id);
  assert.equal(await storage.hasCity(CITY_ID), false);
});

test("bereits installierte OSM-Oberasbach-Version wird nicht überschrieben", async () => {
  const existing = clone(cityPackage);
  existing.city.source = "openstreetmap";
  existing.city.dataVersion = 99;
  existing.streets = existing.streets.slice(0, 1);
  existing.pois = [];
  const storage = memoryCityStorage([existing]);
  const result = await defaultCityApi.installBundledDefaultCityIfNeeded(storage, { packageData: cityPackage });
  assert.equal(result.reason, "cities-exist");
  assert.equal(storage.calls.saveCity, 0);
  assert.equal((await storage.getCityData(CITY_ID)).city.dataVersion, 99);
});

test("Legacy-Statistik wird verlustfrei kopiert und der alte Key bleibt erhalten", () => {
  const workingStorage = memoryLocalStorage();
  const store = statisticsApi.createStatisticsStore(workingStorage, "source");
  store.recordGameStarted("free", { gameId: "g1", contentSelection: "streets", timestamp: "2026-08-01T10:00:00.000Z" });
  store.recordRound({
    mode: "free", targetType: "street", targetId: "street-a", targetName: "Teststraße",
    points: 750, distanceMeters: 42, durationSeconds: 8, timestamp: "2026-08-01T10:00:08.000Z"
  }, { roundId: "r1" });
  const legacyStatistics = store.getSnapshot();
  const storage = memoryLocalStorage({
    [defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY]: JSON.stringify(legacyStatistics)
  });
  const result = defaultCityApi.migrateLegacyOberasbachStatistics(storage, statisticsApi);
  const newKey = statisticsApi.getStatisticsStorageKey(CITY_ID);
  assert.equal(result.status, "copied");
  assert.deepEqual(JSON.parse(storage.getItem(newKey)), legacyStatistics);
  assert.deepEqual(JSON.parse(storage.getItem(defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY)), legacyStatistics);
  const once = storage.getItem(newKey);
  assert.equal(defaultCityApi.migrateLegacyOberasbachStatistics(storage, statisticsApi).status, "already-processed");
  assert.equal(storage.getItem(newKey), once);
});

test("vorhandener neuer Statistik-Key wird niemals überschrieben", () => {
  const legacyStatistics = statisticsApi.createEmptyStatistics();
  legacyStatistics.overall.gamesStarted = 250;
  const newStatistics = statisticsApi.createEmptyStatistics();
  newStatistics.overall.gamesStarted = 7;
  const newKey = statisticsApi.getStatisticsStorageKey(CITY_ID);
  const storage = memoryLocalStorage({
    [defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY]: JSON.stringify(legacyStatistics),
    [newKey]: JSON.stringify(newStatistics)
  });
  const result = defaultCityApi.migrateLegacyOberasbachStatistics(storage, statisticsApi);
  assert.equal(result.status, "conflict-existing-new-key");
  assert.deepEqual(JSON.parse(storage.getItem(newKey)), newStatistics);
  assert.ok(storage.getItem(defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY));
  assert.ok(storage.getItem(defaultCityApi.STATISTICS_MIGRATION_MARKER_KEY));
});

test("Statistik-Schema 1 wird über den alten Oberasbach-Key korrekt migriert", () => {
  const legacyVersionOne = {
    version: 1,
    gamesStarted: 12,
    gamesFinished: 9,
    roundsAnswered: 47,
    totalPoints: 32100,
    bestPoints: 990,
    bestDistanceMeters: 8,
    lastPlayedAt: "2026-07-01T12:00:00.000Z"
  };
  const storage = memoryLocalStorage({
    [defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY]: JSON.stringify(legacyVersionOne)
  });
  assert.equal(defaultCityApi.migrateLegacyOberasbachStatistics(storage, statisticsApi).status, "copied");
  const migrated = JSON.parse(storage.getItem(statisticsApi.getStatisticsStorageKey(CITY_ID)));
  assert.equal(migrated.overall.gamesStarted, 12);
  assert.equal(migrated.overall.gamesCompleted, 9);
  assert.equal(migrated.overall.roundsEvaluated, 47);
  assert.equal(migrated.overall.totalPoints, 32100);
  assert.equal(migrated.overall.bestPoints, 990);
  assert.equal(migrated.overall.bestDistanceMeters, 8);
  assert.deepEqual(JSON.parse(storage.getItem(defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY)), legacyVersionOne);
});

test("beschädigte Legacy-Statistik bleibt unangetastet und erzeugt keinen Marker", () => {
  const legacyText = '{"schemaVersion":2,"overall":"defekt"}';
  const storage = memoryLocalStorage({
    [defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY]: legacyText
  });
  const result = defaultCityApi.migrateLegacyOberasbachStatistics(storage, statisticsApi);
  assert.equal(result.status, "invalid-legacy-statistics");
  assert.equal(storage.getItem(defaultCityApi.LEGACY_STATISTICS_STORAGE_KEY), legacyText);
  assert.equal(storage.getItem(statisticsApi.getStatisticsStorageKey(CITY_ID)), null);
  assert.equal(storage.getItem(defaultCityApi.STATISTICS_MIGRATION_MARKER_KEY), null);
});

test("alte Oberasbach-Runtimepfade und Runtime-Skriptdaten sind entfernt", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const forbidden of [
    "buildLegacyCityContext", "legacyGeometryResolver", "resolveStreetGeometry",
    "geocodeWithNominatim", "readGeometryCache", "geocoderDelayMs", "OBERASBACH_STREETS",
    "OBERASBACH_POIS", "nominatim.openstreetmap.org"
  ]) assert.equal(appSource.includes(forbidden), false, forbidden);
  assert.equal(html.includes("data/oberasbach-streets.js"), false);
  assert.equal(html.includes("data/oberasbach-pois.js"), false);
  assert.equal(html.includes("default-city.js"), true);
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
  console.log(`\n${passed}/${tests.length} Oberasbach-Migrationstests bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
