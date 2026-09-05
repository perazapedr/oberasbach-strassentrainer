(function initializeCityStorage(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerCityStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCityStorageApi() {
  "use strict";

  const DB_NAME = "strassentrainer-db";
  const DB_VERSION = 2;

  const STORE_CITIES = "cities";
  const STORE_STREETS = "streets";
  const STORE_POIS = "pois";
  const STORE_AREAS = "areas";

  const INDEX_CITY_ID = "cityId";
  const ACTIVE_CITY_STORAGE_KEY = "strassentrainer-active-city-v1";

  function monotonicNow() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function recordTiming(options, name, startedAt) {
    const diagnostics = options && options.diagnostics;
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return;
    if (!diagnostics.timingsMs) diagnostics.timingsMs = {};
    diagnostics.timingsMs[name] = Math.round((monotonicNow() - startedAt) * 10) / 10;
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB-Anfrage fehlgeschlagen."));
    });
  }

  function transactionToPromise(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB-Transaktion fehlgeschlagen."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB-Transaktion abgebrochen."));
    });
  }

  function validateCity(city) {
    if (!city || typeof city !== "object" || Array.isArray(city)) {
      throw new Error("Stadt muss ein gültiges Objekt sein.");
    }
    if (typeof city.id !== "string" || city.id.trim().length === 0) {
      throw new Error("Stadt-ID muss ein nichtleerer String sein.");
    }
    if (typeof city.name !== "string" || city.name.trim().length === 0) {
      throw new Error("Stadtname muss ein nichtleerer String sein.");
    }
  }

  function validateStreets(streets, cityId) {
    if (!Array.isArray(streets)) {
      throw new Error("Straßen müssen als Array übergeben werden.");
    }
    const seenIds = new Set();
    for (let index = 0; index < streets.length; index += 1) {
      const street = streets[index];
      if (!street || typeof street !== "object" || Array.isArray(street)) {
        throw new Error(`Straße an Index ${index} ist ungültig.`);
      }
      if (typeof street.id !== "string" || street.id.trim().length === 0) {
        throw new Error(`Straße an Index ${index} besitzt keine gültige ID.`);
      }
      if (seenIds.has(street.id)) {
        throw new Error(`Doppelte Straßen-ID erkannt: "${street.id}".`);
      }
      seenIds.add(street.id);
      if (street.cityId !== cityId) {
        throw new Error(`Straße "${street.id}" gehört nicht zur Stadt "${cityId}" (hat cityId "${street.cityId}").`);
      }
      if (typeof street.name !== "string" || street.name.trim().length === 0) {
        throw new Error(`Straße "${street.id}" besitzt keinen gültigen Namen.`);
      }
    }
  }

  function validatePois(pois, cityId) {
    if (!Array.isArray(pois)) {
      throw new Error("POIs müssen als Array übergeben werden.");
    }
    const seenIds = new Set();
    for (let index = 0; index < pois.length; index += 1) {
      const poi = pois[index];
      if (!poi || typeof poi !== "object" || Array.isArray(poi)) {
        throw new Error(`POI an Index ${index} ist ungültig.`);
      }
      if (typeof poi.id !== "string" || poi.id.trim().length === 0) {
        throw new Error(`POI an Index ${index} besitzt keine gültige ID.`);
      }
      if (seenIds.has(poi.id)) {
        throw new Error(`Doppelte POI-ID erkannt: "${poi.id}".`);
      }
      seenIds.add(poi.id);
      if (poi.cityId !== cityId) {
        throw new Error(`POI "${poi.id}" gehört nicht zur Stadt "${cityId}" (hat cityId "${poi.cityId}").`);
      }
      if (typeof poi.name !== "string" || poi.name.trim().length === 0) {
        throw new Error(`POI "${poi.id}" besitzt keinen gültigen Namen.`);
      }
    }
  }

  function validateAreas(areas, cityId) {
    if (!Array.isArray(areas)) {
      throw new Error("Gebiete müssen als Array übergeben werden.");
    }
    const seenIds = new Set();
    for (let index = 0; index < areas.length; index += 1) {
      const area = areas[index];
      if (!area || typeof area !== "object" || Array.isArray(area)) {
        throw new Error(`Gebiet an Index ${index} ist ungültig.`);
      }
      if (typeof area.id !== "string" || area.id.trim().length === 0) {
        throw new Error(`Gebiet an Index ${index} besitzt keine gültige ID.`);
      }
      if (seenIds.has(area.id)) {
        throw new Error(`Doppelte Gebiets-ID erkannt: "${area.id}".`);
      }
      seenIds.add(area.id);
      if (area.cityId !== cityId) {
        throw new Error(`Gebiet "${area.id}" gehört nicht zur Stadt "${cityId}" (hat cityId "${area.cityId}").`);
      }
      if (typeof area.name !== "string" || area.name.trim().length === 0) {
        throw new Error(`Gebiet "${area.id}" besitzt keinen gültigen Namen.`);
      }
    }
  }

  function deleteRecordsByIndex(store, indexName, key, idbKeyRangeFactory) {
    return new Promise((resolve, reject) => {
      try {
        const index = store.index(indexName);
        const range = idbKeyRangeFactory ? idbKeyRangeFactory.only(key) : key;
        const request = index.openKeyCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error || new Error(`Löschen über Index "${indexName}" fehlgeschlagen.`));
      } catch (error) {
        reject(error);
      }
    });
  }

  function createCityStorage(options = {}) {
    const dbName = options.dbName || DB_NAME;
    const dbVersion = options.dbVersion || DB_VERSION;
    const idb = options.indexedDB
      || (typeof globalThis !== "undefined" && globalThis.indexedDB ? globalThis.indexedDB : null)
      || (typeof window !== "undefined" && window.indexedDB ? window.indexedDB : null);
    const storage = options.localStorage
      || (typeof globalThis !== "undefined" && globalThis.localStorage ? globalThis.localStorage : null)
      || (typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
    const activeCityStorageKey = options.activeCityStorageKey || ACTIVE_CITY_STORAGE_KEY;
    const idbKeyRange = options.IDBKeyRange
      || (typeof globalThis !== "undefined" && globalThis.IDBKeyRange ? globalThis.IDBKeyRange : null)
      || (typeof window !== "undefined" && window.IDBKeyRange ? window.IDBKeyRange : null);

    let dbPromise = null;

    function getIndexedDB() {
      if (!idb) {
        throw new Error("IndexedDB ist in dieser Umgebung nicht verfügbar.");
      }
      return idb;
    }

    function openDatabase() {
      if (dbPromise) return dbPromise;

      dbPromise = new Promise((resolve, reject) => {
        try {
          const factory = getIndexedDB();
          const request = factory.open(dbName, dbVersion);

          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_CITIES)) {
              db.createObjectStore(STORE_CITIES, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_STREETS)) {
              const streetStore = db.createObjectStore(STORE_STREETS, { keyPath: "id" });
              streetStore.createIndex(INDEX_CITY_ID, INDEX_CITY_ID, { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_POIS)) {
              const poiStore = db.createObjectStore(STORE_POIS, { keyPath: "id" });
              poiStore.createIndex(INDEX_CITY_ID, INDEX_CITY_ID, { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_AREAS)) {
              const areaStore = db.createObjectStore(STORE_AREAS, { keyPath: "id" });
              areaStore.createIndex(INDEX_CITY_ID, INDEX_CITY_ID, { unique: false });
            }
          };

          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => {
              try { db.close(); } catch (_) {}
              dbPromise = null;
            };
            db.onclose = () => {
              dbPromise = null;
            };
            resolve(db);
          };

          request.onerror = () => {
            dbPromise = null;
            reject(request.error || new Error("Fehler beim Öffnen der IndexedDB."));
          };

          request.onblocked = () => {
            // Andere Verbindungen blockieren das Upgrade
          };
        } catch (error) {
          dbPromise = null;
          reject(error);
        }
      });

      return dbPromise;
    }

    function closeDatabase() {
      if (dbPromise) {
        dbPromise.then(db => {
          try { db.close(); } catch (_) {}
        }).catch(() => {});
        dbPromise = null;
      }
    }

    async function saveCity(city, streets, pois, areasOrOptions = [], options = {}) {
      const startedAt = monotonicNow();
      let areas = [];
      let saveOptions = options;
      if (Array.isArray(areasOrOptions)) {
        areas = areasOrOptions;
        saveOptions = options || {};
      } else if (areasOrOptions && typeof areasOrOptions === "object") {
        areas = [];
        saveOptions = areasOrOptions;
      }

      validateCity(city);
      validateStreets(streets, city.id);
      validatePois(pois, city.id);
      validateAreas(areas, city.id);

      const db = await openDatabase();
      const hasAreas = db.objectStoreNames.contains(STORE_AREAS);
      const storeNames = hasAreas
        ? [STORE_CITIES, STORE_STREETS, STORE_POIS, STORE_AREAS]
        : [STORE_CITIES, STORE_STREETS, STORE_POIS];
      const tx = db.transaction(storeNames, "readwrite");
      const txPromise = transactionToPromise(tx);
      const cityStore = tx.objectStore(STORE_CITIES);
      const streetStore = tx.objectStore(STORE_STREETS);
      const poiStore = tx.objectStore(STORE_POIS);
      const areaStore = hasAreas ? tx.objectStore(STORE_AREAS) : null;

      // Vorherige Straßen, POIs und Gebiete dieser Stadt bereinigen, um veraltete Datensätze beim Update auszuschließen
      const deletions = [
        deleteRecordsByIndex(streetStore, INDEX_CITY_ID, city.id, idbKeyRange),
        deleteRecordsByIndex(poiStore, INDEX_CITY_ID, city.id, idbKeyRange)
      ];
      if (areaStore) {
        deletions.push(deleteRecordsByIndex(areaStore, INDEX_CITY_ID, city.id, idbKeyRange));
      }
      await Promise.all(deletions);

      for (let index = 0; index < streets.length; index += 1) {
        streetStore.put(streets[index]);
      }
      for (let index = 0; index < pois.length; index += 1) {
        poiStore.put(pois[index]);
      }
      if (areaStore) {
        for (let index = 0; index < areas.length; index += 1) {
          areaStore.put(areas[index]);
        }
      }

      cityStore.put(city);

      await txPromise;
      recordTiming(saveOptions, "saveCityMs", startedAt);
      return city;
    }

    async function getAllCities() {
      const db = await openDatabase();
      const tx = db.transaction(STORE_CITIES, "readonly");
      const txPromise = transactionToPromise(tx);
      const store = tx.objectStore(STORE_CITIES);
      const cities = await requestToPromise(store.getAll());
      await txPromise;
      return (cities || []).sort((first, second) => {
        const nameA = String(first.displayName || first.name || "");
        const nameB = String(second.displayName || second.name || "");
        return nameA.localeCompare(nameB, "de", { sensitivity: "base" });
      });
    }

    async function getCity(cityId) {
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        return null;
      }
      const db = await openDatabase();
      const tx = db.transaction(STORE_CITIES, "readonly");
      const txPromise = transactionToPromise(tx);
      const store = tx.objectStore(STORE_CITIES);
      const result = await requestToPromise(store.get(cityId));
      await txPromise;
      return result || null;
    }

    async function getCityStreets(cityId) {
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        return [];
      }
      const db = await openDatabase();
      const tx = db.transaction(STORE_STREETS, "readonly");
      const txPromise = transactionToPromise(tx);
      const store = tx.objectStore(STORE_STREETS);
      const index = store.index(INDEX_CITY_ID);
      const query = idbKeyRange ? idbKeyRange.only(cityId) : cityId;
      const streets = await requestToPromise(index.getAll(query));
      await txPromise;
      return streets || [];
    }

    async function getCityPois(cityId) {
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        return [];
      }
      const db = await openDatabase();
      const tx = db.transaction(STORE_POIS, "readonly");
      const txPromise = transactionToPromise(tx);
      const store = tx.objectStore(STORE_POIS);
      const index = store.index(INDEX_CITY_ID);
      const query = idbKeyRange ? idbKeyRange.only(cityId) : cityId;
      const pois = await requestToPromise(index.getAll(query));
      await txPromise;
      return pois || [];
    }

    async function getCityAreas(cityId) {
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        return [];
      }
      const db = await openDatabase();
      if (!db.objectStoreNames.contains(STORE_AREAS)) {
        return [];
      }
      const tx = db.transaction(STORE_AREAS, "readonly");
      const txPromise = transactionToPromise(tx);
      const store = tx.objectStore(STORE_AREAS);
      const index = store.index(INDEX_CITY_ID);
      const query = idbKeyRange ? idbKeyRange.only(cityId) : cityId;
      const areas = await requestToPromise(index.getAll(query));
      await txPromise;
      return (areas || []).sort((first, second) => {
        const nameA = String(first.displayName || first.name || "");
        const nameB = String(second.displayName || second.name || "");
        return nameA.localeCompare(nameB, "de", { sensitivity: "base" });
      });
    }

    async function getCityData(cityId, options = {}) {
      const startedAt = monotonicNow();
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        return null;
      }
      const db = await openDatabase();
      const hasAreas = db.objectStoreNames.contains(STORE_AREAS);
      const storeNames = hasAreas
        ? [STORE_CITIES, STORE_STREETS, STORE_POIS, STORE_AREAS]
        : [STORE_CITIES, STORE_STREETS, STORE_POIS];
      const tx = db.transaction(storeNames, "readonly");
      const txPromise = transactionToPromise(tx);
      const cityRequest = tx.objectStore(STORE_CITIES).get(cityId);
      const streetIndex = tx.objectStore(STORE_STREETS).index(INDEX_CITY_ID);
      const poiIndex = tx.objectStore(STORE_POIS).index(INDEX_CITY_ID);
      const query = idbKeyRange ? idbKeyRange.only(cityId) : cityId;
      const requests = [
        requestToPromise(cityRequest),
        requestToPromise(streetIndex.getAll(query)),
        requestToPromise(poiIndex.getAll(query))
      ];
      if (hasAreas) {
        const areaIndex = tx.objectStore(STORE_AREAS).index(INDEX_CITY_ID);
        requests.push(requestToPromise(areaIndex.getAll(query)));
      }
      const results = await Promise.all(requests);
      const city = results[0];
      const streets = results[1];
      const pois = results[2];
      const areas = hasAreas ? results[3] : [];
      await txPromise;
      recordTiming(options, "indexedDbReadMs", startedAt);
      return city ? { city, streets: streets || [], pois: pois || [], areas: areas || [] } : null;
    }

    async function hasCity(cityId) {
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        return false;
      }
      const db = await openDatabase();
      const tx = db.transaction(STORE_CITIES, "readonly");
      const txPromise = transactionToPromise(tx);
      const store = tx.objectStore(STORE_CITIES);
      const query = idbKeyRange ? idbKeyRange.only(cityId) : cityId;
      const count = await requestToPromise(store.count(query));
      await txPromise;
      return count > 0;
    }

    function getActiveCityId() {
      try {
        const value = storage ? storage.getItem(activeCityStorageKey) : null;
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
      } catch (_) {
        return null;
      }
    }

    async function setActiveCityId(cityId) {
      if (cityId === null || cityId === undefined || cityId === "") {
        try {
          if (storage) storage.removeItem(activeCityStorageKey);
        } catch (_) {}
        return null;
      }
      if (typeof cityId !== "string") {
        throw new Error("cityId muss ein String oder null sein.");
      }
      const exists = await hasCity(cityId);
      if (!exists) {
        throw new Error(`Stadt mit ID "${cityId}" existiert nicht in der Datenbank.`);
      }
      try {
        if (storage) storage.setItem(activeCityStorageKey, cityId);
      } catch (error) {
        throw new Error(`Konnte aktive Stadt nicht im localStorage speichern: ${error.message}`);
      }
      return cityId;
    }

    async function getActiveCity() {
      const activeId = getActiveCityId();
      if (!activeId) return null;
      const city = await getCity(activeId);
      if (!city) {
        try {
          if (storage && getActiveCityId() === activeId) storage.removeItem(activeCityStorageKey);
        } catch (_) {}
        return null;
      }
      return city;
    }

    async function getActiveCityData() {
      const activeId = getActiveCityId();
      if (!activeId) return null;
      const cityData = await getCityData(activeId);
      if (!cityData) {
        try {
          if (storage && getActiveCityId() === activeId) storage.removeItem(activeCityStorageKey);
        } catch (_) {}
      }
      return cityData;
    }

    async function updateCityMetadata(cityId, updates) {
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        throw new Error("Gültige cityId erforderlich.");
      }
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        throw new Error("Updates müssen als Objekt übergeben werden.");
      }
      if (updates.id !== undefined && updates.id !== cityId) {
        throw new Error("Die Stadt-ID darf über updateCityMetadata nicht geändert werden.");
      }

      const db = await openDatabase();
      const tx = db.transaction(STORE_CITIES, "readwrite");
      const txPromise = transactionToPromise(tx);
      const store = tx.objectStore(STORE_CITIES);
      const existing = await requestToPromise(store.get(cityId));
      if (!existing) {
        throw new Error(`Stadt mit ID "${cityId}" wurde nicht gefunden.`);
      }

      const updatedCity = {
        ...existing,
        ...updates,
        id: cityId
      };

      validateCity(updatedCity);
      store.put(updatedCity);
      await txPromise;
      return updatedCity;
    }

    async function deleteCity(cityId) {
      if (typeof cityId !== "string" || cityId.trim().length === 0) {
        throw new Error("Gültige cityId erforderlich.");
      }

      const db = await openDatabase();
      const hasAreas = db.objectStoreNames.contains(STORE_AREAS);
      const storeNames = hasAreas
        ? [STORE_CITIES, STORE_STREETS, STORE_POIS, STORE_AREAS]
        : [STORE_CITIES, STORE_STREETS, STORE_POIS];
      const tx = db.transaction(storeNames, "readwrite");
      const txPromise = transactionToPromise(tx);
      const cityStore = tx.objectStore(STORE_CITIES);
      const streetStore = tx.objectStore(STORE_STREETS);
      const poiStore = tx.objectStore(STORE_POIS);
      const areaStore = hasAreas ? tx.objectStore(STORE_AREAS) : null;

      cityStore.delete(cityId);
      const deletions = [
        deleteRecordsByIndex(streetStore, INDEX_CITY_ID, cityId, idbKeyRange),
        deleteRecordsByIndex(poiStore, INDEX_CITY_ID, cityId, idbKeyRange)
      ];
      if (areaStore) {
        deletions.push(deleteRecordsByIndex(areaStore, INDEX_CITY_ID, cityId, idbKeyRange));
      }
      await Promise.all(deletions);

      await txPromise;

      if (getActiveCityId() === cityId) {
        try {
          if (storage) storage.removeItem(activeCityStorageKey);
        } catch (_) {}
      }

      return true;
    }

    async function clearDatabase() {
      const db = await openDatabase();
      const hasAreas = db.objectStoreNames.contains(STORE_AREAS);
      const storeNames = hasAreas
        ? [STORE_CITIES, STORE_STREETS, STORE_POIS, STORE_AREAS]
        : [STORE_CITIES, STORE_STREETS, STORE_POIS];
      const tx = db.transaction(storeNames, "readwrite");
      const txPromise = transactionToPromise(tx);
      tx.objectStore(STORE_CITIES).clear();
      tx.objectStore(STORE_STREETS).clear();
      tx.objectStore(STORE_POIS).clear();
      if (hasAreas) {
        tx.objectStore(STORE_AREAS).clear();
      }
      await txPromise;

      try {
        if (storage) storage.removeItem(activeCityStorageKey);
      } catch (_) {}

      return true;
    }

    return {
      DB_NAME: dbName,
      DB_VERSION: dbVersion,
      STORE_CITIES,
      STORE_STREETS,
      STORE_POIS,
      STORE_AREAS,
      INDEX_CITY_ID,
      ACTIVE_CITY_STORAGE_KEY: activeCityStorageKey,
      openDatabase,
      closeDatabase,
      saveCity,
      getAllCities,
      getCity,
      getCityStreets,
      getCityPois,
      getCityAreas,
      getCityData,
      hasCity,
      getActiveCityId,
      setActiveCityId,
      getActiveCity,
      getActiveCityData,
      updateCityMetadata,
      deleteCity,
      clearDatabase
    };
  }

  const defaultInstance = createCityStorage();

  return {
    DB_NAME,
    DB_VERSION,
    STORE_CITIES,
    STORE_STREETS,
    STORE_POIS,
    STORE_AREAS,
    INDEX_CITY_ID,
    ACTIVE_CITY_STORAGE_KEY,
    createCityStorage,
    openDatabase: defaultInstance.openDatabase,
    closeDatabase: defaultInstance.closeDatabase,
    saveCity: defaultInstance.saveCity,
    getAllCities: defaultInstance.getAllCities,
    getCity: defaultInstance.getCity,
    getCityStreets: defaultInstance.getCityStreets,
    getCityPois: defaultInstance.getCityPois,
    getCityAreas: defaultInstance.getCityAreas,
    getCityData: defaultInstance.getCityData,
    hasCity: defaultInstance.hasCity,
    getActiveCityId: defaultInstance.getActiveCityId,
    setActiveCityId: defaultInstance.setActiveCityId,
    getActiveCity: defaultInstance.getActiveCity,
    getActiveCityData: defaultInstance.getActiveCityData,
    updateCityMetadata: defaultInstance.updateCityMetadata,
    deleteCity: defaultInstance.deleteCity,
    clearDatabase: defaultInstance.clearDatabase
  };
});
