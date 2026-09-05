(function initializeDefaultCity(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerDefaultCity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDefaultCityApi() {
  "use strict";

  const DEFAULT_CITY_ID = "osm-relation-1016396";
  const DEFAULT_CITY_PACKAGE_URL = "data/cities/oberasbach.json";
  const LEGACY_STATISTICS_STORAGE_KEY = "oberasbach-strassentrainer-statistik-v1";
  const STATISTICS_MIGRATION_MARKER_KEY = "strassentrainer-migration-oberasbach-v1";
  const installPromises = new WeakMap();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function validateBundledPackage(cityPackage) {
    if (!cityPackage || typeof cityPackage !== "object" || Array.isArray(cityPackage)) {
      throw new Error("Das gebündelte Default-Stadtpaket ist ungültig.");
    }
    if (cityPackage.schemaVersion !== 1 || cityPackage.city?.id !== DEFAULT_CITY_ID) {
      throw new Error("Das gebündelte Default-Stadtpaket besitzt ein unbekanntes Schema oder eine falsche Stadt-ID.");
    }
    if (!Array.isArray(cityPackage.streets) || !Array.isArray(cityPackage.pois)) {
      throw new Error("Das gebündelte Default-Stadtpaket ist unvollständig.");
    }
    if (cityPackage.city.streetCount !== cityPackage.streets.length
      || cityPackage.city.poiCount !== cityPackage.pois.length) {
      throw new Error("Die Zähler des gebündelten Default-Stadtpakets sind inkonsistent.");
    }
    const streetIds = new Set();
    for (const street of cityPackage.streets) {
      const coordinates = street?.geometry?.coordinates;
      const geometryValid = street?.geometry?.type === "MultiLineString"
        && Array.isArray(coordinates)
        && coordinates.length > 0
        && coordinates.every(line => Array.isArray(line) && line.length >= 2
          && line.every(coordinate => Array.isArray(coordinate)
            && Number.isFinite(Number(coordinate[0]))
            && Number.isFinite(Number(coordinate[1]))));
      if (!street?.id || streetIds.has(street.id) || street.cityId !== DEFAULT_CITY_ID
        || !String(street.name || "").trim() || !geometryValid) {
        throw new Error("Das gebündelte Default-Stadtpaket enthält eine ungültige oder doppelte Straße.");
      }
      streetIds.add(street.id);
    }
    const poiIds = new Set();
    for (const poi of cityPackage.pois) {
      const lat = Number(poi?.position?.lat);
      const lon = Number(poi?.position?.lon);
      if (!poi?.id || poiIds.has(poi.id) || poi.cityId !== DEFAULT_CITY_ID
        || !String(poi.name || "").trim() || !String(poi.category || "").trim()
        || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error("Das gebündelte Default-Stadtpaket enthält einen ungültigen oder doppelten POI.");
      }
      poiIds.add(poi.id);
    }
    return cityPackage;
  }

  async function loadBundledDefaultCity(options = {}) {
    if (options.packageData) return clone(validateBundledPackage(options.packageData));
    const fetchImpl = options.fetch
      || (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null);
    if (!fetchImpl) throw new Error("Das gebündelte Default-Stadtpaket kann nicht lokal geladen werden.");
    const response = await fetchImpl(options.packageUrl || DEFAULT_CITY_PACKAGE_URL, {
      headers: { Accept: "application/json" }
    });
    if (!response?.ok) {
      throw new Error(`Das gebündelte Default-Stadtpaket konnte nicht geladen werden (HTTP ${response?.status || "?"}).`);
    }
    return validateBundledPackage(await response.json());
  }

  function installBundledDefaultCityIfNeeded(storage, options = {}) {
    if (!storage || typeof storage.getAllCities !== "function"
      || typeof storage.saveCity !== "function"
      || typeof storage.setActiveCityId !== "function") {
      return Promise.reject(new Error("Der lokale Stadtspeicher unterstützt den Default-Import nicht."));
    }
    if (installPromises.has(storage)) return installPromises.get(storage);
    const promise = (async () => {
      const cities = await storage.getAllCities();
      if (cities.length > 0) return { installed: false, reason: "cities-exist", city: null };
      const cityPackage = await loadBundledDefaultCity(options);
      const currentCities = await storage.getAllCities();
      if (currentCities.length > 0) return { installed: false, reason: "cities-exist", city: null };
      const alreadyInstalled = typeof storage.hasCity === "function"
        ? await storage.hasCity(DEFAULT_CITY_ID)
        : false;
      if (!alreadyInstalled) {
        const cityToSave = cityPackage.boundary && !cityPackage.city.boundary
          ? { ...cityPackage.city, boundary: cityPackage.boundary }
          : cityPackage.city;
        await storage.saveCity(cityToSave, cityPackage.streets, cityPackage.pois);
      }
      await storage.setActiveCityId(DEFAULT_CITY_ID);
      return {
        installed: !alreadyInstalled,
        reason: alreadyInstalled ? "already-installed" : "empty-database",
        city: clone(cityPackage.city)
      };
    })();
    installPromises.set(storage, promise);
    void promise.finally(() => installPromises.delete(storage)).catch(() => {});
    return promise;
  }

  function migrateLegacyOberasbachStatistics(storage, statisticsApi) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      return { status: "storage-unavailable", migrated: false };
    }
    if (!statisticsApi || typeof statisticsApi.getStatisticsStorageKey !== "function"
      || typeof statisticsApi.migrateStatistics !== "function"
      || typeof statisticsApi.validateStatistics !== "function") {
      return { status: "statistics-api-unavailable", migrated: false };
    }
    const newKey = statisticsApi.getStatisticsStorageKey(DEFAULT_CITY_ID);
    const marker = storage.getItem(STATISTICS_MIGRATION_MARKER_KEY);
    if (marker) return { status: "already-processed", migrated: false, newKey };
    const legacyText = storage.getItem(LEGACY_STATISTICS_STORAGE_KEY);
    if (!legacyText) return { status: "no-legacy-statistics", migrated: false, newKey };
    if (storage.getItem(newKey)) {
      storage.setItem(STATISTICS_MIGRATION_MARKER_KEY, JSON.stringify({
        version: 1,
        status: "conflict-existing-new-key",
        processedAt: new Date().toISOString()
      }));
      return { status: "conflict-existing-new-key", migrated: false, newKey };
    }
    try {
      const legacyStatistics = JSON.parse(legacyText);
      statisticsApi.validateStatistics(legacyStatistics);
      const migrated = statisticsApi.migrateStatistics(legacyStatistics);
      storage.setItem(newKey, JSON.stringify(migrated));
      storage.setItem(STATISTICS_MIGRATION_MARKER_KEY, JSON.stringify({
        version: 1,
        status: "copied",
        processedAt: new Date().toISOString()
      }));
      return { status: "copied", migrated: true, newKey };
    } catch (error) {
      return { status: "invalid-legacy-statistics", migrated: false, newKey, error };
    }
  }

  return Object.freeze({
    DEFAULT_CITY_ID,
    DEFAULT_CITY_PACKAGE_URL,
    LEGACY_STATISTICS_STORAGE_KEY,
    STATISTICS_MIGRATION_MARKER_KEY,
    validateBundledPackage,
    loadBundledDefaultCity,
    installBundledDefaultCityIfNeeded,
    migrateLegacyOberasbachStatistics
  });
});
