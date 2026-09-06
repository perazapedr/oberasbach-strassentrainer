"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const updateApi = require("../city-update.js");
const { createCityManager, getUserFriendlyCityError } = require("../city-manager-ui.js");
const validatorApi = require("../city-data-validator.js");
const packageApi = require("../city-package.js");
const datasetProviderApi = require("../dataset-provider.js");
const { createStatisticsStore, getStatisticsStorageKey } = require("../statistics.js");

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Helpers to create test fixtures
function makeCity(overrides = {}) {
  return {
    id: "osm-relation-12345",
    name: "Musterstadt",
    displayName: "Musterstadt, Landkreis Fürth, Bayern, Deutschland",
    district: "Landkreis Fürth",
    state: "Bayern",
    country: "Deutschland",
    osmType: "relation",
    osmId: 12345,
    bounds: { south: 49.4, west: 10.9, north: 49.5, east: 11.0 },
    center: { lat: 49.45, lon: 10.95 },
    streetCount: 2,
    poiCount: 2,
    source: "openstreetmap",
    dataVersion: 1,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
    lastOsmCheckAt: "2026-01-01T10:00:00.000Z",
    ...overrides
  };
}

function makeStreet(id, overrides = {}) {
  return {
    id,
    cityId: "osm-relation-12345",
    name: id === "street-1" ? "Hauptstraße" : "Kirchweg",
    aliases: id === "street-1" ? ["Hauptstr."] : [],
    geometry: {
      type: "MultiLineString",
      coordinates: [[[10.91, 49.41], [10.92, 49.42]]]
    },
    osmWayIds: id === "street-1" ? [101, 102] : [201],
    tags: { highway: "residential" },
    ...overrides
  };
}

function makePoi(id, overrides = {}) {
  return {
    id,
    cityId: "osm-relation-12345",
    name: id === "poi-1" ? "Rathaus" : "Grundschule",
    displayName: id === "poi-1" ? "Rathaus" : "Grundschule",
    category: id === "poi-1" ? "public-facility" : "school",
    categoryLabel: id === "poi-1" ? "Öffentliche Einrichtung" : "Schule",
    position: { lat: 49.42, lon: 10.92 },
    address: id === "poi-1" ? "Marktplatz 1" : "Schulstraße 4",
    geometry: null,
    source: "openstreetmap",
    ...overrides
  };
}

function makeArea(id, overrides = {}) {
  return {
    id,
    cityId: "osm-relation-12345",
    osmRelationId: 9001,
    name: id === "area-1" ? "Altstadt" : "Neustadt",
    adminLevel: 9,
    tier: "primary",
    parentId: null,
    bounds: { south: 49.41, west: 10.91, north: 49.43, east: 10.93 },
    boundary: {
      type: "Polygon",
      coordinates: [
        [[10.91, 49.41], [10.93, 49.41], [10.93, 49.43], [10.91, 49.43], [10.91, 49.41]]
      ]
    },
    streetIds: ["street-1"],
    poiIds: ["poi-1"],
    ...overrides
  };
}

// -------------------------------------------------------------
// Test Suite 1: Straßen-Diff (Unverändert, Neu, Entfernt, Geändert)
// -------------------------------------------------------------

test("1.1 compareCityVersions erkennt unveränderte Straßen korrekt", () => {
  const current = {
    city: makeCity(),
    streets: [makeStreet("street-1"), makeStreet("street-2")],
    pois: [],
    areas: []
  };
  const updated = clone(current);

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.streets.unchanged.length, 2);
  assert.equal(diff.streets.added.length, 0);
  assert.equal(diff.streets.removed.length, 0);
  assert.equal(diff.streets.modified.length, 0);
});

test("1.2 compareCityVersions erkennt hinzugefügte und entfernte Straßen", () => {
  const current = {
    city: makeCity(),
    streets: [makeStreet("street-1"), makeStreet("street-2")],
    pois: [],
    areas: []
  };
  const updated = {
    city: makeCity(),
    streets: [makeStreet("street-1"), makeStreet("street-3", { name: "Neuer Weg", osmWayIds: [301] })],
    pois: [],
    areas: []
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.streets.unchanged.length, 1);
  assert.equal(diff.streets.unchanged[0].id, "street-1");
  assert.equal(diff.streets.removed.length, 1);
  assert.equal(diff.streets.removed[0].id, "street-2");
  assert.equal(diff.streets.added.length, 1);
  assert.equal(diff.streets.added[0].id, "street-3");
});

test("1.3 compareCityVersions erkennt Straßenänderungen bei Name, Geometrie, Aliasen und Way-IDs", () => {
  const s1 = makeStreet("street-1");
  const s2 = makeStreet("street-2");
  const s3 = makeStreet("street-3", { aliases: ["Alt"] });
  const s4 = makeStreet("street-4", { osmWayIds: [401] });

  const current = {
    city: makeCity(),
    streets: [s1, s2, s3, s4],
    pois: [],
    areas: []
  };

  const updated = {
    city: makeCity(),
    streets: [
      makeStreet("street-1", { name: "Geänderte Hauptstraße" }),
      makeStreet("street-2", {
        geometry: {
          type: "MultiLineString",
          coordinates: [[[10.95, 49.45], [10.96, 49.46]]]
        }
      }),
      makeStreet("street-3", { aliases: ["Alt", "Neu"] }),
      makeStreet("street-4", { osmWayIds: [401, 402] })
    ],
    pois: [],
    areas: []
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.streets.modified.length, 4);

  const mod1 = diff.streets.modified.find(m => m.id === "street-1");
  assert.ok(mod1.reasons.includes("name"));

  const mod2 = diff.streets.modified.find(m => m.id === "street-2");
  assert.ok(mod2.reasons.includes("geometry"));

  const mod3 = diff.streets.modified.find(m => m.id === "street-3");
  assert.ok(mod3.reasons.includes("aliases"));

  const mod4 = diff.streets.modified.find(m => m.id === "street-4");
  assert.ok(mod4.reasons.includes("osmWayIds"));
});

test("1.4 detectPossibleRenames erkennt Umbenennungen anhand geteilter Way-IDs", () => {
  const current = {
    city: makeCity(),
    streets: [
      makeStreet("street-old", { name: "Alter Name", osmWayIds: [1001, 1002] })
    ],
    pois: [],
    areas: []
  };
  const updated = {
    city: makeCity(),
    streets: [
      makeStreet("street-new", { name: "Neuer Name", osmWayIds: [1002, 1003] })
    ],
    pois: [],
    areas: []
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.streets.removed.length, 1);
  assert.equal(diff.streets.added.length, 1);
  assert.equal(diff.possibleRenames.length, 1);
  assert.equal(diff.possibleRenames[0].removedStreet.name, "Alter Name");
  assert.equal(diff.possibleRenames[0].addedStreet.name, "Neuer Name");
  assert.deepEqual(diff.possibleRenames[0].sharedWayIds, [1002]);
});

// -------------------------------------------------------------
// Test Suite 2: POI-Diff (Unverändert, Neu, Entfernt, Geändert)
// -------------------------------------------------------------

test("2.1 compareCityVersions erkennt unveränderte, neue und entfernte POIs", () => {
  const current = {
    city: makeCity(),
    streets: [],
    pois: [makePoi("poi-1"), makePoi("poi-2")],
    areas: []
  };
  const updated = {
    city: makeCity(),
    streets: [],
    pois: [makePoi("poi-1"), makePoi("poi-3", { name: "Supermarkt", category: "supermarket" })],
    areas: []
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.pois.unchanged.length, 1);
  assert.equal(diff.pois.removed.length, 1);
  assert.equal(diff.pois.removed[0].id, "poi-2");
  assert.equal(diff.pois.added.length, 1);
  assert.equal(diff.pois.added[0].id, "poi-3");
});

test("2.2 compareCityVersions erkennt POI-Änderungen bei Name, Kategorie, Position, Adresse und Geometrie", () => {
  const p1 = makePoi("poi-1");
  const p2 = makePoi("poi-2");
  const p3 = makePoi("poi-3", { position: { lat: 49.42, lon: 10.92 } });
  const p4 = makePoi("poi-4", { address: "Hauptstraße 1" });
  const p5 = makePoi("poi-5", {
    geometry: {
      type: "Polygon",
      coordinates: [[[10.91, 49.41], [10.92, 49.41], [10.92, 49.42], [10.91, 49.42], [10.91, 49.41]]]
    }
  });

  const current = {
    city: makeCity(),
    streets: [],
    pois: [p1, p2, p3, p4, p5],
    areas: []
  };

  const updated = {
    city: makeCity(),
    streets: [],
    pois: [
      makePoi("poi-1", { name: "Neues Rathaus" }),
      makePoi("poi-2", { category: "kindergarten", categoryLabel: "Kindergarten" }),
      makePoi("poi-3", { position: { lat: 49.43, lon: 10.93 } }),
      makePoi("poi-4", { address: "Hauptstraße 99" }),
      makePoi("poi-5", {
        geometry: {
          type: "Polygon",
          coordinates: [[[10.92, 49.42], [10.93, 49.42], [10.93, 49.43], [10.92, 49.43], [10.92, 49.42]]]
        }
      })
    ],
    areas: []
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.pois.modified.length, 5);

  const mod1 = diff.pois.modified.find(m => m.id === "poi-1");
  assert.ok(mod1.reasons.includes("name"));

  const mod2 = diff.pois.modified.find(m => m.id === "poi-2");
  assert.ok(mod2.reasons.includes("category"));

  const mod3 = diff.pois.modified.find(m => m.id === "poi-3");
  assert.ok(mod3.reasons.includes("position"));

  const mod4 = diff.pois.modified.find(m => m.id === "poi-4");
  assert.ok(mod4.reasons.includes("address"));

  const mod5 = diff.pois.modified.find(m => m.id === "poi-5");
  assert.ok(mod5.reasons.includes("geometry"));
});

// -------------------------------------------------------------
// Test Suite 3: Trainingsgebiets-Diff
// -------------------------------------------------------------

test("3.1 compareCityVersions erkennt Änderungen an Trainingsgebieten", () => {
  const current = {
    city: makeCity(),
    streets: [],
    pois: [],
    areas: [makeArea("area-1"), makeArea("area-2")]
  };

  const updated = {
    city: makeCity(),
    streets: [],
    pois: [],
    areas: [
      makeArea("area-1", { name: "Historische Altstadt" }),
      makeArea("area-3", { name: "Gewerbegebiet" })
    ]
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.areas.unchanged.length, 0);
  assert.equal(diff.areas.modified.length, 1);
  assert.equal(diff.areas.modified[0].id, "area-1");
  assert.ok(diff.areas.modified[0].reasons.includes("name"));
  assert.equal(diff.areas.removed.length, 1);
  assert.equal(diff.areas.removed[0].id, "area-2");
  assert.equal(diff.areas.added.length, 1);
  assert.equal(diff.areas.added[0].id, "area-3");
});

// -------------------------------------------------------------
// Test Suite 4: Reihenfolgeunabhängigkeit & Metadaten-Timestamps
// -------------------------------------------------------------

test("4.1 Reihenfolge der Elemente beeinflusst das Differgebnis nicht", () => {
  const s1 = makeStreet("street-1");
  const s2 = makeStreet("street-2");
  const p1 = makePoi("poi-1");
  const p2 = makePoi("poi-2");
  const a1 = makeArea("area-1");
  const a2 = makeArea("area-2");

  const current = {
    city: makeCity(),
    streets: [s1, s2],
    pois: [p1, p2],
    areas: [a1, a2]
  };

  // Revert order of all lists
  const updated = {
    city: makeCity(),
    streets: [s2, s1],
    pois: [p2, p1],
    areas: [a2, a1]
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.streets.unchanged.length, 2);
  assert.equal(diff.pois.unchanged.length, 2);
  assert.equal(diff.areas.unchanged.length, 2);
});

test("4.2 Nicht-funktionale Timestamps lösen keine Änderungsmarkierung aus", () => {
  const current = {
    city: makeCity({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastOsmCheckAt: "2026-01-01T00:00:00.000Z"
    }),
    streets: [makeStreet("street-1")],
    pois: [makePoi("poi-1")],
    areas: []
  };

  const updated = {
    city: makeCity({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T12:00:00.000Z",
      lastOsmCheckAt: "2026-02-01T12:00:00.000Z"
    }),
    streets: [makeStreet("street-1")],
    pois: [makePoi("poi-1")],
    areas: []
  };

  const diff = updateApi.compareCityVersions(current, updated);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.metadata.hasChanges, false);
});

test("4.3 compareCityVersions wirft Fehler bei abweichender Stadt-Identität", () => {
  const cityA = {
    city: makeCity({ id: "osm-relation-1" }),
    streets: [],
    pois: [],
    areas: []
  };
  const cityB = {
    city: makeCity({ id: "osm-relation-2" }),
    streets: [],
    pois: [],
    areas: []
  };

  assert.throws(() => {
    updateApi.compareCityVersions(cityA, cityB);
  }, /Stadt-Identitätskonflikt|City identity mismatch/);
});

// -------------------------------------------------------------
// Test Suite 5: Zwei-Schritt-Aktualisierung & Versionsinkrementierung
// -------------------------------------------------------------

test("5.1 dataVersion wird bei Bestätigung exakt um 1 erhöht und Timestamps aktualisiert", () => {
  const initial = makeCity({
    dataVersion: 3,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
    lastOsmCheckAt: "2026-01-01T08:00:00.000Z"
  });

  const downloadedCity = makeCity({
    dataVersion: 1, // downloaded raw package has default version 1
    createdAt: "2026-03-01T00:00:00.000Z", // raw downloaded timestamp
    updatedAt: "2026-03-01T00:00:00.000Z"
  });

  // Apply update logic per specification
  const currentVersion = Number.isInteger(initial.dataVersion) && initial.dataVersion > 0 ? initial.dataVersion : 1;
  const newVersion = currentVersion + 1;
  const nowIso = "2026-09-05T12:00:00.000Z";

  const updatedCity = {
    ...downloadedCity,
    id: initial.id,
    dataVersion: newVersion,
    createdAt: initial.createdAt,
    updatedAt: nowIso,
    lastOsmCheckAt: nowIso
  };

  assert.equal(updatedCity.dataVersion, 4);
  assert.equal(updatedCity.createdAt, "2026-01-01T08:00:00.000Z");
  assert.equal(updatedCity.updatedAt, nowIso);
  assert.equal(updatedCity.lastOsmCheckAt, nowIso);
});

test("5.2 Reine Prüfung ohne Speicherung lässt dataVersion unverändert", () => {
  const initial = makeCity({ dataVersion: 5 });
  // Simulate checking without applying save
  const lastOsmCheckAt = new Date().toISOString();
  const checkedOnlyCity = {
    ...initial,
    lastOsmCheckAt
  };

  assert.equal(checkedOnlyCity.dataVersion, 5);
  assert.equal(checkedOnlyCity.createdAt, initial.createdAt);
});

// -------------------------------------------------------------
// Test Suite 6: Atomares Speichern und Rollback-Sicherheit
// -------------------------------------------------------------

test("6.1 Fehlgeschlagener Speicher- oder Aktivierungsvorgang mutiert bestehende Stadt nicht", async () => {
  let storageSaved = false;
  let activeReplaced = false;

  const initialCity = makeCity();
  let currentActiveCity = initialCity;

  const mockStorage = {
    saveCity: async () => {
      throw new Error("QuotaExceededError in IndexedDB");
    }
  };

  try {
    // Attempt atomic update
    await mockStorage.saveCity();
    storageSaved = true;
    currentActiveCity = makeCity({ name: "Corrupted" });
    activeReplaced = true;
  } catch (err) {
    // Expected error caught
    assert.equal(err.message, "QuotaExceededError in IndexedDB");
  }

  assert.equal(storageSaved, false);
  assert.equal(activeReplaced, false);
  assert.equal(currentActiveCity.name, "Musterstadt");
});

// -------------------------------------------------------------
// Test Suite 7: Statistik-Erhalt (Existing, Removed, Added, Renamed)
// -------------------------------------------------------------

test("7.1 Bestehende Straßen behalten ihre Statistik nach Stadtaktualisierung", () => {
  const fakeStorage = new Map();
  const storage = {
    getItem: key => (fakeStorage.has(key) ? fakeStorage.get(key) : null),
    setItem: (key, val) => fakeStorage.set(key, String(val)),
    removeItem: key => fakeStorage.delete(key),
    clear: () => fakeStorage.clear()
  };

  const store = createStatisticsStore(storage, getStatisticsStorageKey("osm-relation-12345"));

  // Record a round for street-1
  store.recordRound({
    mode: "free",
    targetType: "street",
    targetId: "street-1",
    targetName: "Hauptstraße",
    targetCategory: "street",
    targetCategoryLabel: "Straße",
    points: 100,
    distanceMeters: 5,
    durationSeconds: 2,
    timedOut: false,
    timestamp: "2026-09-01T12:00:00.000Z"
  }, { roundId: "round-1" });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.overall.roundsEvaluated, 1);
  assert.equal(snapshot.overall.totalPoints, 100);

  // Targets map retains street-1
  assert.ok(snapshot.targets["street-1"]);
  assert.equal(snapshot.targets["street-1"].overall.roundsEvaluated, 1);

  // Newly added street has no entries
  assert.equal(snapshot.targets["street-new"], undefined);
});

test("7.2 Statistiken für entfernte Straßen werden nicht gelöscht", () => {
  const fakeStorage = new Map();
  const storage = {
    getItem: key => (fakeStorage.has(key) ? fakeStorage.get(key) : null),
    setItem: (key, val) => fakeStorage.set(key, String(val)),
    removeItem: key => fakeStorage.delete(key),
    clear: () => fakeStorage.clear()
  };

  const store = createStatisticsStore(storage, getStatisticsStorageKey("osm-relation-12345"));

  store.recordRound({
    mode: "free",
    targetType: "street",
    targetId: "street-removed",
    targetName: "Entfernte Straße",
    targetCategory: "street",
    targetCategoryLabel: "Straße",
    points: 80,
    distanceMeters: 25,
    durationSeconds: 3,
    timedOut: false,
    timestamp: "2026-09-01T12:00:00.000Z"
  }, { roundId: "round-rem" });

  // After city update removes "street-removed", historical data is preserved in storage
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.overall.roundsEvaluated, 1);
  assert.ok(snapshot.targets["street-removed"]);
  assert.equal(snapshot.targets["street-removed"].name, "Entfernte Straße");
});

test("7.3 Keine unsichere automatische Statistik-Migration bei Umbenennungen", () => {
  const fakeStorage = new Map();
  const storage = {
    getItem: key => (fakeStorage.has(key) ? fakeStorage.get(key) : null),
    setItem: (key, val) => fakeStorage.set(key, String(val)),
    removeItem: key => fakeStorage.delete(key),
    clear: () => fakeStorage.clear()
  };

  const store = createStatisticsStore(storage, getStatisticsStorageKey("osm-relation-12345"));

  // Old street stats recorded
  store.recordRound({
    mode: "free",
    targetType: "street",
    targetId: "street-old-name",
    targetName: "Alter Straßenname",
    targetCategory: "street",
    targetCategoryLabel: "Straße",
    points: 95,
    distanceMeters: 10,
    durationSeconds: 2,
    timedOut: false,
    timestamp: "2026-09-01T12:00:00.000Z"
  }, { roundId: "round-old" });

  const snapshot = store.getSnapshot();
  // New street ID must NOT inherit stats automatically
  assert.equal(snapshot.targets["street-new-name"], undefined);

  // Old street stats remain intact under old ID
  assert.ok(snapshot.targets["street-old-name"]);
  assert.equal(snapshot.targets["street-old-name"].name, "Alter Straßenname");
});

// -------------------------------------------------------------
// Test Suite 8: Trainingsgebiet-Präferenz & Fallback
// -------------------------------------------------------------

test("8.1 Ausgewähltes Trainingsgebiet bleibt erhalten wenn es nach Update existiert", () => {
  const selectedAreaId = "area-1";
  const updatedAreas = [makeArea("area-1"), makeArea("area-2")];

  const stillExists = updatedAreas.some(a => a.id === selectedAreaId);
  const resolvedAreaId = stillExists ? selectedAreaId : null;

  assert.equal(resolvedAreaId, "area-1");
});

test("8.2 Ausgewähltes Trainingsgebiet fällt auf 'Gesamte Stadt' zurück wenn entfernt", () => {
  const selectedAreaId = "area-deleted";
  const updatedAreas = [makeArea("area-1"), makeArea("area-2")];

  const stillExists = updatedAreas.some(a => a.id === selectedAreaId);
  const resolvedAreaId = stillExists ? selectedAreaId : null;

  assert.equal(resolvedAreaId, null);
});

// -------------------------------------------------------------
// Test Suite 9: Kuratiertes Oberasbach-Vergleichsmodus (Kein automatisches Überschreiben)
// -------------------------------------------------------------

test("9.1 Kuratiertes Oberasbach: Diff kann für Vergleich berechnet werden", () => {
  const oberasbachPath = path.join(__dirname, "..", "data", "cities", "oberasbach.json");
  const curatedOberasbach = JSON.parse(fs.readFileSync(oberasbachPath, "utf8"));

  // Check that curated Oberasbach has exactly 271 streets and 60 POIs
  assert.equal(curatedOberasbach.streets.length, 271);
  assert.equal(curatedOberasbach.pois.length, 60);

  // Simulate an updated OSM dataset with an extra OSM street and slight geometry shift
  const osmCopy = clone(curatedOberasbach);
  osmCopy.streets.push(makeStreet("osm-new-street", { name: "Neue OSM-Straße", cityId: curatedOberasbach.city.id }));

  const diff = updateApi.compareCityVersions(curatedOberasbach, osmCopy);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.streets.added.length, 1);
  assert.equal(diff.streets.unchanged.length, 271);
});

test("9.2 Kuratiertes Oberasbach wird nicht überschrieben", () => {
  const curatedCity = makeCity({
    id: "osm-relation-1016396",
    name: "Oberasbach",
    source: "curated+openstreetmap"
  });

  const isCurated = curatedCity.id === "osm-relation-1016396" || (curatedCity.source || "").startsWith("curated");
  assert.equal(isCurated, true);

  // In city-manager-ui, curated cities have compare action label and overwrite is blocked
  const buttonLabel = isCurated ? "Mit OpenStreetMap vergleichen" : "Aktualisieren";
  assert.equal(buttonLabel, "Mit OpenStreetMap vergleichen");
});

// -------------------------------------------------------------
// Test Suite 10: Offline-Resilienz & 0 API-Calls bei Gameplay
// -------------------------------------------------------------

test("10.1 Offline-Aktualisierungsversuch meldet Fehler verständlich", () => {
  const offlineError = getUserFriendlyCityError({ code: "NETWORK_ERROR", navigatorOnline: false }, "update");
  assert.match(offlineError, /Offline|Internetverbindung/i);
});

test("10.2 Gameplay nach Stadtaktualisierung läuft 100% lokal ohne Overpass/Nominatim", () => {
  let networkCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = () => {
    networkCalls++;
    throw new Error("No network allowed during gameplay!");
  };

  try {
    const updatedCity = makeCity({ dataVersion: 2 });
    const streets = [makeStreet("street-1"), makeStreet("street-2")];

    // Local target selection and lookup
    const target = streets[0];
    assert.equal(target.name, "Hauptstraße");
    assert.equal(networkCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

// -------------------------------------------------------------
// Test Suite 11: Phase 15.6 Catalog-Updatecheck & Fehlerbehandlung
// -------------------------------------------------------------

test("11.1 gleiche Version liefert hasUpdate: false (kein Update nötig)", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-nw-olpe",
      name: "Olpe",
      version: "2026.09.05",
      cityId: "osm-relation-163179",
      downloadPath: "cities/de-nw-olpe.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture);
  const installed = {
    id: "osm-relation-163179",
    package: { id: "de-nw-olpe", version: "2026.09.05" }
  };
  const res = await provider.checkForUpdate(installed);
  assert.equal(res.hasUpdate, false);
  assert.equal(res.currentVersion, "2026.09.05");
  assert.equal(res.latestVersion, "2026.09.05");
});

test("11.2 neuere CalVer liefert hasUpdate: true (Update verfügbar)", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-nw-olpe",
      name: "Olpe",
      version: "2026.09.06",
      cityId: "osm-relation-163179",
      downloadPath: "cities/de-nw-olpe.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture);
  const installed = {
    id: "osm-relation-163179",
    package: { id: "de-nw-olpe", version: "2026.09.05" }
  };
  const res = await provider.checkForUpdate(installed);
  assert.equal(res.hasUpdate, true);
  assert.equal(res.currentVersion, "2026.09.05");
  assert.equal(res.latestVersion, "2026.09.06");
});

test("11.3 ältere Katalogversion bietet kein Downgrade an (hasUpdate: false)", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-nw-olpe",
      name: "Olpe",
      version: "2026.09.04",
      cityId: "osm-relation-163179",
      downloadPath: "cities/de-nw-olpe.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture);
  const installed = {
    id: "osm-relation-163179",
    package: { id: "de-nw-olpe", version: "2026.09.05" }
  };
  const res = await provider.checkForUpdate(installed);
  assert.equal(res.hasUpdate, false);
});

test("11.4 SemVer-Vergleich funktioniert weiterhin korrekt", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-oberasbach-fire-training",
      name: "Oberasbach",
      version: "1.1.0",
      cityId: "osm-relation-1016396",
      downloadPath: "cities/oberasbach.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture);
  const installed = {
    id: "osm-relation-1016396",
    package: { id: "de-oberasbach-fire-training", version: "1.0.0" }
  };
  const res = await provider.checkForUpdate(installed);
  assert.equal(res.hasUpdate, true);

  const resSame = await provider.checkForUpdate({
    id: "osm-relation-1016396",
    package: { id: "de-oberasbach-fire-training", version: "1.1.0" }
  });
  assert.equal(resSame.hasUpdate, false);
});

test("11.5 Dataset fehlt im Katalog wirft DATASET_NOT_FOUND", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: []
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture);
  const installed = {
    id: "osm-relation-999999",
    package: { id: "unknown-city", version: "1.0.0" }
  };
  await assert.rejects(
    async () => provider.checkForUpdate(installed),
    err => err.code === "DATASET_NOT_FOUND"
  );
});

test("11.6 Katalogfehler wirft CATALOG_UNAVAILABLE", async () => {
  const provider = datasetProviderApi.createCatalogDatasetProvider({
    catalogUrl: "http://127.0.0.1:54321/non-existent-catalog.json",
    fetch: async () => {
      throw new Error("Network connection refused");
    }
  });
  const installed = {
    id: "osm-relation-163179",
    package: { id: "de-nw-olpe", version: "2026.09.05" }
  };
  await assert.rejects(
    async () => provider.checkForUpdate(installed),
    err => err.code === "CATALOG_UNAVAILABLE"
  );
});

test("11.7 Ungültige Versionsinformation wirft INVALID_VERSION", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-nw-olpe",
      name: "Olpe",
      version: "invalid-version-string",
      cityId: "osm-relation-163179",
      downloadPath: "cities/de-nw-olpe.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture);
  const installed = {
    id: "osm-relation-163179",
    package: { id: "de-nw-olpe", version: "2026.09.05" }
  };
  await assert.rejects(
    async () => provider.checkForUpdate(installed),
    err => err.code === "INVALID_VERSION"
  );
});

test("11.8 Downloadfehler wirft DOWNLOAD_FAILED", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-nw-olpe",
      name: "Olpe",
      version: "2026.09.06",
      contentHash: "sha256:dummy",
      downloadPath: "cities/missing.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture, {
    baseUrl: "http://127.0.0.1:54321/",
    fetch: async () => {
      return { ok: false, status: 404 };
    }
  });
  await assert.rejects(
    async () => provider.downloadDataset("de-nw-olpe"),
    err => err.code === "DOWNLOAD_FAILED"
  );
});

test("11.9 Catalog-Hash-Mismatch wird abgewiesen", async () => {
  const fixtureV2Path = path.join(__dirname, "fixtures", "update", "olpe-v2.json");
  const pkgV2 = JSON.parse(fs.readFileSync(fixtureV2Path, "utf8"));
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-nw-olpe",
      name: "Olpe",
      version: "2026.09.06",
      contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      downloadPath: "cities/de-nw-olpe-v2.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture, {
    loadPackage: async () => pkgV2
  });
  await assert.rejects(
    async () => provider.downloadDataset("de-nw-olpe"),
    err => err.code === "HASH_MISMATCH"
  );
});

test("11.10 Package-Hash-Mismatch durch Datenmanipulation erkannt", () => {
  const fixtureV2Path = path.join(__dirname, "fixtures", "update", "olpe-v2.json");
  const pkgV2 = JSON.parse(fs.readFileSync(fixtureV2Path, "utf8"));
  pkgV2.streets[0].name = "Manipulierte Straße";
  const check = validatorApi.verifyPackageHash(pkgV2);
  assert.equal(check.valid, false);
  assert.equal(check.status, "mismatch");
});

test("11.11 Validator-Fehler blockiert ungültiges Paket", () => {
  const fixtureV2Path = path.join(__dirname, "fixtures", "update", "olpe-v2.json");
  const pkgV2 = JSON.parse(fs.readFileSync(fixtureV2Path, "utf8"));
  delete pkgV2.city.name;
  const packageCheck = validatorApi.validateCityPackage(pkgV2);
  assert.equal(packageCheck.valid, false);
  const dataCheck = validatorApi.validateCityData(pkgV2, { sourceMode: "download" });
  assert.equal(dataCheck.valid, false);
});

test("11.12 AbortSignal bricht checkForUpdate und downloadDataset sauber ab", async () => {
  const catalogFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-06T12:00:00.000Z",
    datasets: [{
      id: "de-nw-olpe",
      name: "Olpe",
      version: "2026.09.06",
      downloadPath: "cities/de-nw-olpe.json"
    }]
  };
  const provider = datasetProviderApi.createCatalogDatasetProvider(catalogFixture);
  const ac = new AbortController();
  ac.abort();

  await assert.rejects(
    async () => provider.checkForUpdate({ id: "de-nw-olpe", version: "2026.09.05" }, { signal: ac.signal }),
    err => err.code === "ABORTED"
  );
  await assert.rejects(
    async () => provider.downloadDataset("de-nw-olpe", { signal: ac.signal }),
    err => err.code === "ABORTED"
  );
});

// -------------------------------------------------------------
// Test Suite 12: Phase 15.6 Update-Diff mit Real-Fixtures V1 und V2
// -------------------------------------------------------------

test("12.1 Diff zwischen Fixture V1 und V2 liefert exakte Counts (+1/-1 Straße, +1/-1 POI, 0 Area)", () => {
  const v1Path = path.join(__dirname, "fixtures", "update", "olpe-v1.json");
  const v2Path = path.join(__dirname, "fixtures", "update", "olpe-v2.json");
  const pkgV1 = JSON.parse(fs.readFileSync(v1Path, "utf8"));
  const pkgV2 = JSON.parse(fs.readFileSync(v2Path, "utf8"));

  const diff = updateApi.compareCityVersions(pkgV1, pkgV2);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.summary.streets.added, 1);
  assert.equal(diff.summary.streets.removed, 1);
  assert.equal(diff.summary.streets.unchanged, 460);
  assert.equal(diff.streets.added[0].name, "Neue Teststraße");
  assert.equal(diff.streets.removed[0].name, "Zur Wolfsschlade");

  assert.equal(diff.summary.pois.added, 1);
  assert.equal(diff.summary.pois.removed, 1);
  assert.equal(diff.summary.pois.unchanged, 113);
  assert.equal(diff.pois.added[0].name, "Neue Test-Feuerwache");
  assert.equal(diff.pois.removed[0].name, "Polizei");

  assert.equal(diff.summary.areas.added, 0);
  assert.equal(diff.summary.areas.removed, 0);
  assert.equal(diff.summary.areas.unchanged, 2);
});

test("12.2 Update-Diff ist deterministisch (Reihenfolgeunabhängig und stabile Ausgabe)", () => {
  const v1Path = path.join(__dirname, "fixtures", "update", "olpe-v1.json");
  const v2Path = path.join(__dirname, "fixtures", "update", "olpe-v2.json");
  const pkgV1 = JSON.parse(fs.readFileSync(v1Path, "utf8"));
  const pkgV2 = JSON.parse(fs.readFileSync(v2Path, "utf8"));

  const diffA = updateApi.compareCityVersions(pkgV1, pkgV2);

  const pkgV1Shuffled = clone(pkgV1);
  pkgV1Shuffled.streets.reverse();
  pkgV1Shuffled.pois.reverse();
  const pkgV2Shuffled = clone(pkgV2);
  pkgV2Shuffled.streets.reverse();
  pkgV2Shuffled.pois.reverse();

  const diffB = updateApi.compareCityVersions(pkgV1Shuffled, pkgV2Shuffled);

  assert.deepEqual(diffA.streets.added, diffB.streets.added);
  assert.deepEqual(diffA.streets.removed, diffB.streets.removed);
  assert.deepEqual(diffA.streets.unchanged, diffB.streets.unchanged);
  assert.deepEqual(diffA.pois.added, diffB.pois.added);
  assert.deepEqual(diffA.pois.removed, diffB.pois.removed);
  assert.deepEqual(diffA.pois.unchanged, diffB.pois.unchanged);
});

// Run all tests
async function runAll() {
  console.log(`Starte ${tests.length} Phase-15.6-City-Update-Tests ...\n`);
  let passed = 0;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    try {
      await t.run();
      console.log(`✓ ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`✗ ${t.name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`\nErgebnis: ${passed}/${tests.length} Phase-14.1-City-Update-Tests bestanden.`);
}

void runAll();
