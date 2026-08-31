"use strict";

const assert = require("assert");
const {
  DB_NAME,
  DB_VERSION,
  STORE_CITIES,
  STORE_STREETS,
  STORE_POIS,
  INDEX_CITY_ID,
  ACTIVE_CITY_STORAGE_KEY,
  createCityStorage
} = require("../city-storage.js");

// --- In-Memory IndexedDB Mock für isolierte Node.js-Tests ---

class MockIDBKeyRange {
  constructor(lower, upper, lowerOpen = false, upperOpen = false) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }
  static only(value) {
    return new MockIDBKeyRange(value, value, false, false);
  }
  includes(value) {
    if (this.lower !== undefined) {
      if (this.lowerOpen ? value <= this.lower : value < this.lower) return false;
    }
    if (this.upper !== undefined) {
      if (this.upperOpen ? value >= this.upper : value > this.upper) return false;
    }
    return true;
  }
}

class MockIDBRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.readyState = "pending";
    this.onsuccess = null;
    this.onerror = null;
  }
  _success(result) {
    this.result = result;
    this.readyState = "done";
    if (typeof this.onsuccess === "function") {
      this.onsuccess({ target: this });
    }
  }
  _error(error) {
    this.error = error instanceof Error ? error : new Error(String(error));
    this.readyState = "done";
    if (typeof this.onerror === "function") {
      this.onerror({ target: this });
    }
  }
}

class MockIDBCursor {
  constructor(entries, sourceStore, isKeyOnly = false) {
    this._entries = entries; // Array of [primaryKey, value]
    this._index = 0;
    this._sourceStore = sourceStore;
    this._isKeyOnly = isKeyOnly;
    this._current = entries.length > 0 ? entries[0] : null;
    this._request = null;
  }
  get key() {
    return this._current ? this._current[0] : undefined;
  }
  get primaryKey() {
    return this._current ? this._current[0] : undefined;
  }
  get value() {
    return this._isKeyOnly ? undefined : (this._current ? this._current[1] : undefined);
  }
  continue() {
    this._index += 1;
    this._current = this._index < this._entries.length ? this._entries[this._index] : null;
    queueMicrotask(() => {
      this._request._success(this._current ? this : null);
    });
  }
  delete() {
    if (this._current) {
      this._sourceStore.delete(this._current[0]);
    }
  }
}

class MockIndex {
  constructor(name, keyPath, options, objectStore) {
    this.name = name;
    this.keyPath = keyPath;
    this.unique = Boolean(options?.unique);
    this.objectStore = objectStore;
  }
  _matches(value, query) {
    if (query === undefined) return true;
    const targetValue = value ? value[this.keyPath] : undefined;
    if (query instanceof MockIDBKeyRange) {
      return query.includes(targetValue);
    }
    return targetValue === query;
  }
  getAll(query) {
    const req = new MockIDBRequest();
    this.objectStore.transaction._enqueue(() => {
      const results = [];
      for (const val of this.objectStore._records.values()) {
        if (this._matches(val, query)) results.push(JSON.parse(JSON.stringify(val)));
      }
      req._success(results);
    });
    return req;
  }
  count(query) {
    const req = new MockIDBRequest();
    this.objectStore.transaction._enqueue(() => {
      let count = 0;
      for (const val of this.objectStore._records.values()) {
        if (this._matches(val, query)) count += 1;
      }
      req._success(count);
    });
    return req;
  }
  openKeyCursor(query) {
    const req = new MockIDBRequest();
    this.objectStore.transaction._enqueue(() => {
      const matchingEntries = [];
      for (const [pk, val] of this.objectStore._records.entries()) {
        if (this._matches(val, query)) {
          matchingEntries.push([pk, val]);
        }
      }
      const cursor = new MockIDBCursor(matchingEntries, this.objectStore, true);
      cursor._request = req;
      req._success(matchingEntries.length > 0 ? cursor : null);
    });
    return req;
  }
  openCursor(query) {
    const req = new MockIDBRequest();
    this.objectStore.transaction._enqueue(() => {
      const matchingEntries = [];
      for (const [pk, val] of this.objectStore._records.entries()) {
        if (this._matches(val, query)) {
          matchingEntries.push([pk, JSON.parse(JSON.stringify(val))]);
        }
      }
      const cursor = new MockIDBCursor(matchingEntries, this.objectStore, false);
      cursor._request = req;
      req._success(matchingEntries.length > 0 ? cursor : null);
    });
    return req;
  }
}

class MockObjectStore {
  constructor(name, options, transaction, recordsMap) {
    this.name = name;
    this.keyPath = options?.keyPath || "id";
    this.transaction = transaction;
    this._records = recordsMap; // Map of primaryKey -> object
    this._indexes = new Map();
    this.indexNames = { contains: name => this._indexes.has(name) };
  }
  createIndex(name, keyPath, options) {
    const index = new MockIndex(name, keyPath, options, this);
    this._indexes.set(name, index);
    return index;
  }
  index(name) {
    const idx = this._indexes.get(name);
    if (!idx) throw new Error(`Index "${name}" existiert nicht.`);
    idx.objectStore = this;
    return idx;
  }
  get(key) {
    const req = new MockIDBRequest();
    this.transaction._enqueue(() => {
      const val = this._records.get(key);
      req._success(val ? JSON.parse(JSON.stringify(val)) : undefined);
    });
    return req;
  }
  getAll(query) {
    const req = new MockIDBRequest();
    this.transaction._enqueue(() => {
      const results = [];
      for (const [k, val] of this._records.entries()) {
        if (query === undefined || (query instanceof MockIDBKeyRange ? query.includes(k) : query === k)) {
          results.push(JSON.parse(JSON.stringify(val)));
        }
      }
      req._success(results);
    });
    return req;
  }
  count(query) {
    const req = new MockIDBRequest();
    this.transaction._enqueue(() => {
      if (query === undefined) {
        req._success(this._records.size);
      } else {
        let c = 0;
        for (const k of this._records.keys()) {
          if (query instanceof MockIDBKeyRange ? query.includes(k) : query === k) c += 1;
        }
        req._success(c);
      }
    });
    return req;
  }
  put(value) {
    const req = new MockIDBRequest();
    this.transaction._enqueue(() => {
      const key = value ? value[this.keyPath] : undefined;
      if (!key) {
        req._error(new Error(`Fehlender keyPath "${this.keyPath}".`));
        return;
      }
      this._records.set(key, JSON.parse(JSON.stringify(value)));
      req._success(key);
    });
    return req;
  }
  delete(key) {
    const req = new MockIDBRequest();
    this.transaction._enqueue(() => {
      this._records.delete(key);
      req._success(undefined);
    });
    return req;
  }
  clear() {
    const req = new MockIDBRequest();
    this.transaction._enqueue(() => {
      this._records.clear();
      req._success(undefined);
    });
    return req;
  }
}

class MockTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.mode = mode;
    this.objectStoreNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._queue = [];
    this._running = false;
    this._aborted = false;
    this._completed = false;

    // Snapshot für Transaktionssicherheit (Rollback bei Fehler)
    this._snapshots = new Map();
    for (const sName of this.objectStoreNames) {
      const records = db._storeData.get(sName);
      if (records) {
        this._snapshots.set(sName, new Map(records));
      }
    }
  }

  objectStore(name) {
    if (!this.objectStoreNames.includes(name)) {
      throw new Error(`Store "${name}" nicht in Transaktion enthalten.`);
    }
    const storeDef = this.db._storeDefinitions.get(name);
    const storeData = this.db._storeData.get(name);
    const store = new MockObjectStore(name, storeDef, this, storeData);
    for (const [idxName, idxDef] of storeDef.indexes.entries()) {
      store._indexes.set(idxName, new MockIndex(idxName, idxDef.keyPath, idxDef.options, store));
    }
    return store;
  }

  abort() {
    this._aborted = true;
    this._rollback();
    if (typeof this.onabort === "function") this.onabort({ target: this });
  }

  _rollback() {
    for (const [sName, snapshot] of this._snapshots.entries()) {
      this.db._storeData.set(sName, new Map(snapshot));
    }
  }

  _enqueue(fn) {
    if (this._aborted) return;
    this._queue.push(fn);
    if (!this._running) {
      this._running = true;
      queueMicrotask(() => this._processQueue());
    }
  }

  _processQueue() {
    while (this._queue.length > 0) {
      if (this._aborted) return;
      const fn = this._queue.shift();
      try {
        fn();
      } catch (err) {
        this._aborted = true;
        this.error = err;
        this._rollback();
        if (typeof this.onerror === "function") this.onerror({ target: this });
        return;
      }
    }
    this._running = false;
    queueMicrotask(() => {
      if (!this._running && !this._aborted && this._queue.length === 0 && !this._completed) {
        this._completed = true;
        if (typeof this.oncomplete === "function") this.oncomplete({ target: this });
      }
    });
  }
}

class MockDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this._storeDefinitions = new Map();
    this._storeData = new Map();
    this.objectStoreNames = {
      contains: name => this._storeDefinitions.has(name)
    };
    this.onversionchange = null;
    this.onclose = null;
  }
  createObjectStore(name, options) {
    const def = { name, keyPath: options?.keyPath || "id", indexes: new Map() };
    this._storeDefinitions.set(name, def);
    if (!this._storeData.has(name)) {
      this._storeData.set(name, new Map());
    }
    const store = new MockObjectStore(name, options, null, this._storeData.get(name));
    store.createIndex = (idxName, keyPath, idxOptions) => {
      def.indexes.set(idxName, { keyPath, options: idxOptions });
      return new MockIndex(idxName, keyPath, idxOptions, store);
    };
    return store;
  }
  transaction(storeNames, mode = "readonly") {
    return new MockTransaction(this, storeNames, mode);
  }
  close() {
    if (typeof this.onclose === "function") this.onclose({ target: this });
  }
}

class MockIDBFactory {
  constructor() {
    this._databases = new Map();
  }
  open(name, version = 1) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      let db = this._databases.get(name);
      const isNew = !db;
      if (isNew) {
        db = new MockDatabase(name, version);
        this._databases.set(name, db);
      }
      req.result = db;
      if (isNew || db.version < version) {
        if (typeof req.onupgradeneeded === "function") {
          req.onupgradeneeded({ target: req, oldVersion: 0, newVersion: version });
        }
      }
      req._success(db);
    });
    return req;
  }
  deleteDatabase(name) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      this._databases.delete(name);
      req._success(undefined);
    });
    return req;
  }
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    clear: () => map.clear(),
    _map: map
  };
}

function createTestHarness(options = {}) {
  const idb = new MockIDBFactory();
  const storage = options.storage || createMemoryStorage();
  const cityStorage = createCityStorage({
    dbName: "test-strassentrainer-db",
    dbVersion: 1,
    indexedDB: idb,
    localStorage: storage,
    IDBKeyRange: MockIDBKeyRange,
    activeCityStorageKey: "test-active-city-v1"
  });
  return { idb, storage, cityStorage };
}

// --- Test-Fixtures ---

const cityA = {
  id: "osm-relation-123456",
  name: "Oberasbach",
  displayName: "Oberasbach",
  district: "Landkreis Fürth",
  state: "Bayern",
  country: "Deutschland",
  postalCodes: ["90522"],
  bounds: { south: 49.4017, west: 10.9384, north: 49.4454, east: 10.9987 },
  center: { lat: 49.4356, lon: 10.9694 },
  defaultZoom: 13,
  streetCount: 2,
  poiCount: 2
};

const streetsA = [
  {
    id: "osm-relation-123456:street:rothenburger-strasse",
    cityId: "osm-relation-123456",
    name: "Rothenburger Straße",
    aliases: ["Rothenburger Str."],
    geometry: {
      type: "MultiLineString",
      coordinates: [[[10.95, 49.43], [10.96, 49.44]]]
    }
  },
  {
    id: "osm-relation-123456:street:hauptstrasse",
    cityId: "osm-relation-123456",
    name: "Hauptstraße",
    aliases: ["Hauptstr."],
    geometry: {
      type: "MultiLineString",
      coordinates: [[[10.952, 49.431], [10.958, 49.435]]]
    }
  }
];

const poisA = [
  {
    id: "osm-relation-123456:poi:node-101",
    cityId: "osm-relation-123456",
    name: "Rathaus Oberasbach",
    category: "public-facility",
    categoryLabel: "Öffentliche Einrichtung",
    position: { lat: 49.4312, lon: 10.9698 },
    geometry: null
  },
  {
    id: "osm-relation-123456:poi:way-202",
    cityId: "osm-relation-123456",
    name: "Pestalozzi-Grundschule",
    category: "school",
    categoryLabel: "Schule",
    position: { lat: 49.4274, lon: 10.9712 },
    geometry: {
      type: "Polygon",
      coordinates: [[[10.97, 49.42], [10.98, 49.42], [10.98, 49.43], [10.97, 49.43], [10.97, 49.42]]]
    }
  }
];

const cityB = {
  id: "osm-relation-654321",
  name: "Zirndorf",
  displayName: "Zirndorf",
  district: "Landkreis Fürth",
  state: "Bayern",
  country: "Deutschland",
  postalCodes: ["90513"],
  bounds: { south: 49.43, west: 10.92, north: 49.47, east: 10.98 },
  center: { lat: 49.4538, lon: 10.9553 },
  defaultZoom: 13,
  streetCount: 1,
  poiCount: 1
};

const streetsB = [
  {
    id: "osm-relation-654321:street:nuernberger-strasse",
    cityId: "osm-relation-654321",
    name: "Nürnberger Straße",
    aliases: ["Nürnberger Str."],
    geometry: {
      type: "MultiLineString",
      coordinates: [[[10.955, 49.45], [10.96, 49.455]]]
    }
  }
];

const poisB = [
  {
    id: "osm-relation-654321:poi:node-303",
    cityId: "osm-relation-654321",
    name: "Zimmermannspark",
    category: "sports-leisure",
    categoryLabel: "Sport/Freizeit",
    position: { lat: 49.455, lon: 10.956 },
    geometry: null
  }
];

// --- Ausführung der Testsuite ---

(async () => {
  // Konstanten prüfen
  assert.equal(DB_NAME, "strassentrainer-db");
  assert.equal(DB_VERSION, 1);
  assert.equal(STORE_CITIES, "cities");
  assert.equal(STORE_STREETS, "streets");
  assert.equal(STORE_POIS, "pois");
  assert.equal(INDEX_CITY_ID, "cityId");
  assert.equal(ACTIVE_CITY_STORAGE_KEY, "strassentrainer-active-city-v1");

  // Test 1 – Leere Datenbank
  {
    const { cityStorage } = createTestHarness();
    const cities = await cityStorage.getAllCities();
    assert.deepEqual(cities, [], "Leere Datenbank muss leeres Städte-Array liefern.");
    assert.equal(cityStorage.getActiveCityId(), null, "Initial darf keine Stadt aktiv sein.");
    assert.equal(await cityStorage.getActiveCity(), null);
    assert.equal(await cityStorage.getActiveCityData(), null);
  }

  // Test 2 – Stadt speichern und laden
  {
    const { cityStorage } = createTestHarness();
    const saveDiagnostics = {};
    const saved = await cityStorage.saveCity(cityA, streetsA, poisA, { diagnostics: saveDiagnostics });
    assert.equal(saved.id, cityA.id);
    assert.ok(saveDiagnostics.timingsMs.saveCityMs >= 0,
      "Optionale Save-Diagnostik muss die vollständige Transaktionsdauer melden.");

    const loaded = await cityStorage.getCity(cityA.id);
    assert.ok(loaded, "Stadt muss geladen werden können.");
    assert.equal(loaded.id, cityA.id);
    assert.equal(loaded.name, "Oberasbach");
    assert.equal(loaded.displayName, "Oberasbach");
    assert.deepEqual(loaded.postalCodes, ["90522"]);
    const readDiagnostics = {};
    const bundle = await cityStorage.getCityData(cityA.id, { diagnostics: readDiagnostics });
    assert.equal(bundle.streets.length, streetsA.length);
    assert.ok(readDiagnostics.timingsMs.indexedDbReadMs >= 0,
      "Optionale Read-Diagnostik muss die vollständige Readonly-Transaktion messen.");
  }

  // Test 3 – Straßengeometrie bleibt verlustfrei erhalten
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    const loadedStreets = await cityStorage.getCityStreets(cityA.id);
    assert.equal(loadedStreets.length, 2);
    const rothenburger = loadedStreets.find(s => s.name === "Rothenburger Straße");
    assert.ok(rothenburger);
    assert.equal(rothenburger.geometry.type, "MultiLineString");
    assert.deepEqual(rothenburger.geometry.coordinates, [[[10.95, 49.43], [10.96, 49.44]]]);
  }

  // Test 4 – POI-Geometrie und Position bleiben erhalten (Point & Polygon)
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    const loadedPois = await cityStorage.getCityPois(cityA.id);
    assert.equal(loadedPois.length, 2);

    const rathaus = loadedPois.find(p => p.id === "osm-relation-123456:poi:node-101");
    assert.ok(rathaus);
    assert.deepEqual(rathaus.position, { lat: 49.4312, lon: 10.9698 });
    assert.equal(rathaus.geometry, null);

    const schule = loadedPois.find(p => p.id === "osm-relation-123456:poi:way-202");
    assert.ok(schule);
    assert.equal(schule.geometry.type, "Polygon");
    assert.deepEqual(schule.geometry.coordinates, [[[10.97, 49.42], [10.98, 49.42], [10.98, 49.43], [10.97, 49.43], [10.97, 49.42]]]);
  }

  // Test 5 – Mehrere Städte speichern und alphabetisch sortiert auflisten
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityB, streetsB, poisB);
    await cityStorage.saveCity(cityA, streetsA, poisA);

    const cities = await cityStorage.getAllCities();
    assert.equal(cities.length, 2);
    assert.equal(cities[0].name, "Oberasbach", "Alphabetische Sortierung nach displayName/name.");
    assert.equal(cities[1].name, "Zirndorf");
  }

  // Test 6 – Straßen nach cityId filtern
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);

    const streetsOfA = await cityStorage.getCityStreets(cityA.id);
    assert.equal(streetsOfA.length, 2);
    assert.ok(streetsOfA.every(s => s.cityId === cityA.id));

    const streetsOfB = await cityStorage.getCityStreets(cityB.id);
    assert.equal(streetsOfB.length, 1);
    assert.equal(streetsOfB[0].name, "Nürnberger Straße");
    assert.equal(streetsOfB[0].cityId, cityB.id);
  }

  // Test 7 – POIs nach cityId filtern
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);

    const poisOfA = await cityStorage.getCityPois(cityA.id);
    assert.equal(poisOfA.length, 2);
    assert.ok(poisOfA.every(p => p.cityId === cityA.id));

    const poisOfB = await cityStorage.getCityPois(cityB.id);
    assert.equal(poisOfB.length, 1);
    assert.equal(poisOfB[0].name, "Zimmermannspark");
  }

  // Test 8 – Aktive Stadt setzen
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);

    await cityStorage.setActiveCityId(cityB.id);
    assert.equal(cityStorage.getActiveCityId(), cityB.id);

    const active = await cityStorage.getActiveCity();
    assert.ok(active);
    assert.equal(active.id, cityB.id);
    assert.equal(active.name, "Zirndorf");
  }

  // Test 9 – Aktive Stadt wechseln
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);

    await cityStorage.setActiveCityId(cityA.id);
    assert.equal(cityStorage.getActiveCityId(), cityA.id);

    await cityStorage.setActiveCityId(cityB.id);
    assert.equal(cityStorage.getActiveCityId(), cityB.id);
    assert.equal((await cityStorage.getActiveCity()).id, cityB.id);
  }

  // Test 10 – Nicht vorhandene Stadt aktivieren schlägt kontrolliert fehl
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.setActiveCityId(cityA.id);

    await assert.rejects(
      async () => {
        await cityStorage.setActiveCityId("nicht-vorhandene-stadt-id");
      },
      /existiert nicht in der Datenbank/,
      "Aktivieren einer unbekannten Stadt muss abgewiesen werden."
    );

    assert.equal(cityStorage.getActiveCityId(), cityA.id, "Bisherige aktive Stadt bleibt erhalten.");
  }

  // Test 11 – getActiveCityData() liefert vollständiges Paket der aktiven Stadt
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);

    await cityStorage.setActiveCityId(cityA.id);
    const dataA = await cityStorage.getActiveCityData();
    assert.ok(dataA);
    assert.equal(dataA.city.id, cityA.id);
    assert.equal(dataA.streets.length, 2);
    assert.equal(dataA.pois.length, 2);
    assert.ok(dataA.streets.every(s => s.cityId === cityA.id));
    assert.ok(dataA.pois.every(p => p.cityId === cityA.id));
  }

  // Test 11a – getCityData() liest ein vollständiges Stadtpaket in einer Readonly-Transaktion
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);
    const db = await cityStorage.openDatabase();
    const originalTransaction = db.transaction.bind(db);
    const readTransactions = [];
    db.transaction = (storeNames, mode = "readonly") => {
      if (Array.isArray(storeNames)
        && storeNames.includes(STORE_CITIES)
        && storeNames.includes(STORE_STREETS)
        && storeNames.includes(STORE_POIS)) {
        readTransactions.push({ storeNames: [...storeNames], mode });
      }
      return originalTransaction(storeNames, mode);
    };

    const dataA = await cityStorage.getCityData(cityA.id);
    assert.ok(dataA);
    assert.equal(dataA.city.id, cityA.id);
    assert.deepEqual(dataA.streets.map(street => street.id).sort(),
      streetsA.map(street => street.id).sort());
    assert.deepEqual(dataA.pois.map(poi => poi.id).sort(),
      poisA.map(poi => poi.id).sort());
    assert.ok(dataA.streets.every(street => street.cityId === cityA.id));
    assert.ok(dataA.pois.every(poi => poi.cityId === cityA.id));
    assert.deepEqual(readTransactions, [{
      storeNames: [STORE_CITIES, STORE_STREETS, STORE_POIS],
      mode: "readonly"
    }], "Metadaten, Straßen und POIs müssen aus genau einer gemeinsamen Readonly-Transaktion stammen");
  }

  // Test 11b – getCityData() liefert für unbekannte oder ungültige IDs null
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    assert.equal(await cityStorage.getCityData("nicht-installiert"), null);
    assert.equal(await cityStorage.getCityData(""), null);
    assert.equal(await cityStorage.getCityData("   "), null);
    assert.equal(await cityStorage.getCityData(null), null);
  }

  // Test 11c – Unveränderte veraltete Active-ID wird nach atomarer Paketabfrage bereinigt
  {
    const staleCityId = "osm-relation-nicht-mehr-vorhanden";
    const storage = createMemoryStorage({ "test-active-city-v1": staleCityId });
    const { cityStorage } = createTestHarness({ storage });
    assert.equal(cityStorage.getActiveCityId(), staleCityId);
    assert.equal(await cityStorage.getActiveCityData(), null);
    assert.equal(cityStorage.getActiveCityId(), null,
      "Eine weiterhin unveränderte veraltete Active-ID muss entfernt werden");
  }

  // Test 11d – Parallel neu gesetzte Active-ID wird nicht von einer veralteten Abfrage gelöscht
  {
    const staleCityId = "osm-relation-nicht-mehr-vorhanden";
    const activeStorageKey = "test-active-city-v1";
    const memoryStorage = createMemoryStorage({ [activeStorageKey]: staleCityId });
    let activeIdReads = 0;
    const raceStorage = {
      ...memoryStorage,
      getItem(key) {
        if (key === activeStorageKey) {
          activeIdReads += 1;
          if (activeIdReads === 2) memoryStorage.setItem(key, cityB.id);
        }
        return memoryStorage.getItem(key);
      }
    };
    const { cityStorage } = createTestHarness({ storage: raceStorage });
    await cityStorage.saveCity(cityB, streetsB, poisB);

    const staleResult = await cityStorage.getActiveCityData();
    assert.equal(staleResult, null,
      "Die laufende Abfrage darf nicht stillschweigend Daten einer inzwischen anderen Active-ID liefern");
    assert.equal(cityStorage.getActiveCityId(), cityB.id,
      "Eine parallel neu gesetzte Active-ID darf durch die Bereinigung des alten Requests nicht verloren gehen");

    const currentResult = await cityStorage.getActiveCityData();
    assert.equal(currentResult.city.id, cityB.id);
    assert.equal(currentResult.streets.length, streetsB.length);
    assert.equal(currentResult.pois.length, poisB.length);
  }

  // Test 12 – Stadt löschen (Metadaten, Straßen, POIs)
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);

    const deleted = await cityStorage.deleteCity(cityA.id);
    assert.equal(deleted, true);

    assert.equal(await cityStorage.getCity(cityA.id), null);
    assert.deepEqual(await cityStorage.getCityStreets(cityA.id), []);
    assert.deepEqual(await cityStorage.getCityPois(cityA.id), []);
    assert.equal(await cityStorage.hasCity(cityA.id), false);
  }

  // Test 13 – Andere Städte bleiben beim Löschen vollständig erhalten
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);

    await cityStorage.deleteCity(cityA.id);

    const cityBLoaded = await cityStorage.getCity(cityB.id);
    assert.ok(cityBLoaded);
    assert.equal(cityBLoaded.id, cityB.id);
    assert.equal((await cityStorage.getCityStreets(cityB.id)).length, 1);
    assert.equal((await cityStorage.getCityPois(cityB.id)).length, 1);
  }

  // Test 14 – Aktive Stadt löschen setzt activeCityId auf null zurück
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.setActiveCityId(cityA.id);
    assert.equal(cityStorage.getActiveCityId(), cityA.id);

    await cityStorage.deleteCity(cityA.id);
    assert.equal(cityStorage.getActiveCityId(), null, "Gelöschte aktive Stadt muss localStorage bereinigen.");
    assert.equal(await cityStorage.getActiveCity(), null);
    assert.equal(await cityStorage.getActiveCityData(), null);
  }

  // Test 15 – Stadt aktualisieren hinterlässt keine veralteten Datensätze
  {
    const { cityStorage } = createTestHarness();
    // 1. Initial 2 Straßen, 2 POIs
    await cityStorage.saveCity(cityA, streetsA, poisA);

    // 2. Update mit 1 neuen Straße und 1 neuem POI
    const updatedStreets = [
      {
        id: "osm-relation-123456:street:neue-strasse",
        cityId: cityA.id,
        name: "Neue Straße",
        geometry: null
      }
    ];
    const updatedPois = [
      {
        id: "osm-relation-123456:poi:neuer-poi",
        cityId: cityA.id,
        name: "Neuer POI",
        category: "fuel"
      }
    ];

    await cityStorage.saveCity(cityA, updatedStreets, updatedPois);

    const currentStreets = await cityStorage.getCityStreets(cityA.id);
    assert.equal(currentStreets.length, 1, "Alte Straßen müssen vollständig entfernt worden sein.");
    assert.equal(currentStreets[0].id, "osm-relation-123456:street:neue-strasse");

    const currentPois = await cityStorage.getCityPois(cityA.id);
    assert.equal(currentPois.length, 1, "Alte POIs müssen vollständig entfernt worden sein.");
    assert.equal(currentPois[0].id, "osm-relation-123456:poi:neuer-poi");
  }

  // Test 16 – Andere Städte beim Update schützen
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);

    const updatedStreetsA = [
      {
        id: "osm-relation-123456:street:einzelstrasse",
        cityId: cityA.id,
        name: "Einzelstraße"
      }
    ];
    await cityStorage.saveCity(cityA, updatedStreetsA, []);

    const streetsOfB = await cityStorage.getCityStreets(cityB.id);
    assert.equal(streetsOfB.length, 1);
    assert.equal(streetsOfB[0].name, "Nürnberger Straße");
    const poisOfB = await cityStorage.getCityPois(cityB.id);
    assert.equal(poisOfB.length, 1);
  }

  // Test 17 – updateCityMetadata()
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);

    const updated = await cityStorage.updateCityMetadata(cityA.id, {
      streetCount: 274,
      poiCount: 63,
      updatedAt: "2026-08-27T12:00:00.000Z"
    });

    assert.equal(updated.streetCount, 274);
    assert.equal(updated.poiCount, 63);
    assert.equal(updated.name, "Oberasbach");

    // Straßen und POIs unverändert
    assert.equal((await cityStorage.getCityStreets(cityA.id)).length, 2);
    assert.equal((await cityStorage.getCityPois(cityA.id)).length, 2);

    // ID-Änderung ablehnen
    await assert.rejects(
      async () => {
        await cityStorage.updateCityMetadata(cityA.id, { id: "andere-stadt-id" });
      },
      /Stadt-ID darf über updateCityMetadata nicht geändert werden/
    );
  }

  // Test 18 – Ungültige Stadt ablehnen
  {
    const { cityStorage } = createTestHarness();
    await assert.rejects(async () => {
      await cityStorage.saveCity(null, [], []);
    }, /Stadt muss ein gültiges Objekt sein/);

    await assert.rejects(async () => {
      await cityStorage.saveCity({ name: "Ohne ID" }, [], []);
    }, /Stadt-ID muss ein nichtleerer String sein/);

    await assert.rejects(async () => {
      await cityStorage.saveCity({ id: "id-1", name: "" }, [], []);
    }, /Stadtname muss ein nichtleerer String sein/);
  }

  // Test 19 – Ungültige Straße ablehnen
  {
    const { cityStorage } = createTestHarness();
    await assert.rejects(async () => {
      await cityStorage.saveCity(cityA, [{ id: "s-1", cityId: "falsche-stadt", name: "Str." }], []);
    }, /gehört nicht zur Stadt/);

    await assert.rejects(async () => {
      await cityStorage.saveCity(cityA, [{ id: "", cityId: cityA.id, name: "Str." }], []);
    }, /besitzt keine gültige ID/);
  }

  // Test 20 – Ungültigen POI ablehnen
  {
    const { cityStorage } = createTestHarness();
    await assert.rejects(async () => {
      await cityStorage.saveCity(cityA, [], [{ id: "p-1", cityId: "falsche-stadt", name: "POI" }]);
    }, /gehört nicht zur Stadt/);
  }

  // Test 21 – Doppelte Straßen-ID in einem Paket ablehnen
  {
    const { cityStorage } = createTestHarness();
    const dupStreets = [
      { id: "street-dup", cityId: cityA.id, name: "Straße 1" },
      { id: "street-dup", cityId: cityA.id, name: "Straße 2" }
    ];
    await assert.rejects(async () => {
      await cityStorage.saveCity(cityA, dupStreets, []);
    }, /Doppelte Straßen-ID erkannt/);
  }

  // Test 22 – Doppelte POI-ID in einem Paket ablehnen
  {
    const { cityStorage } = createTestHarness();
    const dupPois = [
      { id: "poi-dup", cityId: cityA.id, name: "POI 1" },
      { id: "poi-dup", cityId: cityA.id, name: "POI 2" }
    ];
    await assert.rejects(async () => {
      await cityStorage.saveCity(cityA, [], dupPois);
    }, /Doppelte POI-ID erkannt/);
  }

  // Test 23 – Transaktionssicherheit (Fehlschlag hinterlässt keine halbe Stadt)
  {
    const { cityStorage } = createTestHarness();
    // Vorab Zustand herstellen
    await cityStorage.saveCity(cityA, streetsA, poisA);

    // Save-Versuch mit fehlerhafter Straße
    try {
      await cityStorage.saveCity(cityB, [{ id: "s-bad", cityId: "wrong-id", name: "Bad" }], []);
    } catch (_) {
      // Erwarteter Fehler
    }

    assert.equal(await cityStorage.hasCity(cityB.id), false, "Stadt B darf nicht angelegt worden sein.");
    assert.deepEqual(await cityStorage.getCityStreets(cityB.id), []);

    // Stadt A bleibt unberührt
    assert.equal(await cityStorage.hasCity(cityA.id), true);
    assert.equal((await cityStorage.getCityStreets(cityA.id)).length, 2);
  }

  // Test 24 – clearDatabase() leert alle Stores und entfernt activeCityId
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.saveCity(cityB, streetsB, poisB);
    await cityStorage.setActiveCityId(cityA.id);

    await cityStorage.clearDatabase();

    assert.deepEqual(await cityStorage.getAllCities(), []);
    assert.deepEqual(await cityStorage.getCityStreets(cityA.id), []);
    assert.deepEqual(await cityStorage.getCityPois(cityA.id), []);
    assert.equal(cityStorage.getActiveCityId(), null);
    assert.equal(await cityStorage.getActiveCity(), null);
  }

  // Test 25 – Unicode-Straßennamen & Umlaute
  {
    const { cityStorage } = createTestHarness();
    const unicodeStreets = [
      { id: "osm:street:johannis", cityId: cityA.id, name: "Sankt-Johannis-Straße" },
      { id: "osm:street:fuerther", cityId: cityA.id, name: "Fürther Straße" },
      { id: "osm:street:kuehbuck", cityId: cityA.id, name: "Am Kühbuck" },
      { id: "osm:street:schloesser", cityId: cityA.id, name: "Schlößergasse" }
    ];
    await cityStorage.saveCity(cityA, unicodeStreets, []);
    const loaded = await cityStorage.getCityStreets(cityA.id);
    assert.equal(loaded.length, 4);
    assert.ok(loaded.some(s => s.name === "Fürther Straße"));
    assert.ok(loaded.some(s => s.name === "Schlößergasse"));
  }

  // Test 26 – setActiveCityId(null) entfernt aktive Stadt bewusst
  {
    const { cityStorage } = createTestHarness();
    await cityStorage.saveCity(cityA, streetsA, poisA);
    await cityStorage.setActiveCityId(cityA.id);
    assert.equal(cityStorage.getActiveCityId(), cityA.id);

    await cityStorage.setActiveCityId(null);
    assert.equal(cityStorage.getActiveCityId(), null);
    assert.equal(await cityStorage.getActiveCity(), null);
  }

  // Test 27 – hasCity() liefert strikt Boolean
  {
    const { cityStorage } = createTestHarness();
    assert.strictEqual(await cityStorage.hasCity("unbekannt"), false);
    await cityStorage.saveCity(cityA, streetsA, poisA);
    assert.strictEqual(await cityStorage.hasCity(cityA.id), true);
    assert.strictEqual(await cityStorage.hasCity(""), false);
    assert.strictEqual(await cityStorage.hasCity(null), false);
  }

  // Test 28 – Leere Straßen- oder POI-Listen sind zulässig
  {
    const { cityStorage } = createTestHarness();
    const cityEmpty = { id: "empty-city", name: "Leerestadt" };
    await cityStorage.saveCity(cityEmpty, [], []);
    assert.equal(await cityStorage.hasCity("empty-city"), true);
    assert.deepEqual(await cityStorage.getCityStreets("empty-city"), []);
    assert.deepEqual(await cityStorage.getCityPois("empty-city"), []);
  }

  // Test 29 – Unbekannte zusätzliche Metadaten bleiben erhalten
  {
    const { cityStorage } = createTestHarness();
    const richCity = {
      id: "rich-city",
      name: "Reichstadt",
      customTag: "feuerwehr-spezial",
      nestedMeta: { region: "Franken", version: 42 }
    };
    await cityStorage.saveCity(richCity, [], []);
    const loaded = await cityStorage.getCity("rich-city");
    assert.equal(loaded.customTag, "feuerwehr-spezial");
    assert.deepEqual(loaded.nestedMeta, { region: "Franken", version: 42 });
  }

  // Test 30 – Mehrfaches Öffnen und Schließen (closeDatabase)
  {
    const { cityStorage } = createTestHarness();
    const db1 = await cityStorage.openDatabase();
    const db2 = await cityStorage.openDatabase();
    assert.strictEqual(db1, db2, "Cached Promise liefert dieselbe DB-Instanz.");
    cityStorage.closeDatabase();
    const db3 = await cityStorage.openDatabase();
    assert.ok(db3);
  }

  console.log("City-Storage-Tests erfolgreich:");
  console.log("- Leere Datenbank und Initialzustand");
  console.log("- Stadt speichern und laden");
  console.log("- Vollständige Straßengeometrien (MultiLineString)");
  console.log("- POI-Punkte und -Polygone");
  console.log("- Mehrere Städte und alphabetische Sortierung");
  console.log("- Isolierte Abfrage von Straßen und POIs nach cityId");
  console.log("- Aktive Stadt setzen, wechseln, löschen und verifizieren");
  console.log("- Abweisung nicht existierender aktiver Städte");
  console.log("- Vollständige Datenbündel über getActiveCityData()");
  console.log("- Atomare Datenbündel beliebiger Städte über getCityData() in einer Readonly-Transaktion");
  console.log("- Race-sichere Bereinigung veralteter Active-IDs ohne Verlust einer neueren Auswahl");
  console.log("- Löschen einer Stadt entfernt Metadaten, Straßen und POIs rückstandsfrei");
  console.log("- Andere Städte bleiben beim Löschen und Aktualisieren unberührt");
  console.log("- Aktualisieren einer Stadt bereinigt veraltete Datensätze vollständig");
  console.log("- updateCityMetadata() aktualisiert Metadaten ohne Auswirkung auf Straßen/POIs und schützt die ID");
  console.log("- Strikte Validierung: fehlende Pflichtfelder, falsche Zuordnungen und doppelte IDs");
  console.log("- Transaktionssicherheit und automatischer Rollback");
  console.log("- Vollständiger Reset über clearDatabase()");
  console.log("- Unicode, Umlaute, Sonderzeichen und erweiterte Metadaten");
  console.log("- Verbindungsmanagement und closeDatabase()");
})().catch(error => {
  console.error("Testfehler in city-storage-tests:", error);
  process.exit(1);
});
