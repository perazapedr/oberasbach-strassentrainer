(function initializeDatasetProvider(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerDatasetProvider = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDatasetProviderApi(root) {
  "use strict";

  const REQUIRED_METHODS = Object.freeze([
    "searchDatasets",
    "getDatasetMetadata",
    "downloadDataset",
    "checkForUpdate"
  ]);

  class DatasetProviderError extends Error {
    constructor(code, message, options = {}) {
      super(message, options.cause ? { cause: options.cause } : undefined);
      this.name = "DatasetProviderError";
      this.code = code;
      if (options.provider) this.provider = options.provider;
    }
  }

  function asText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function throwIfAborted(signal) {
    if (!signal || !signal.aborted) return;
    throw new DatasetProviderError("ABORTED", "Dataset-Vorgang wurde abgebrochen.");
  }

  function normalizeError(error, fallbackCode, provider) {
    if (error && asText(error.code)) return error;
    return new DatasetProviderError(
      fallbackCode,
      asText(error && error.message) || "Dataset-Vorgang fehlgeschlagen.",
      { cause: error, provider }
    );
  }

  function osmDatasetId(candidate) {
    const osmType = asText(candidate && candidate.osmType);
    const osmId = Number(candidate && candidate.osmId);
    if (!osmType || !Number.isSafeInteger(osmId) || osmId <= 0) return "";
    return `osm-${osmType}-${osmId}`;
  }

  function normalizeDatasetMetadata(candidate, provider = "unknown") {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new DatasetProviderError("INVALID_DATASET", "Dataset-Metadaten müssen ein Objekt sein.", { provider });
    }
    const id = asText(candidate.id) || osmDatasetId(candidate);
    const name = asText(candidate.name) || asText(candidate.displayName);
    if (!id || !name) {
      throw new DatasetProviderError("INVALID_DATASET", "Dataset-Metadaten benötigen ID und Namen.", { provider });
    }
    return {
      ...candidate,
      id,
      name,
      displayName: asText(candidate.displayName) || name,
      datasetKind: asText(candidate.datasetKind) || "municipality",
      provider: asText(candidate.provider) || provider
    };
  }

  function assertDatasetProvider(provider) {
    if (!provider || typeof provider !== "object") {
      throw new TypeError("DatasetProvider muss ein Objekt sein.");
    }
    const missing = REQUIRED_METHODS.filter(method => typeof provider[method] !== "function");
    if (missing.length) {
      throw new TypeError(`DatasetProvider-Methoden fehlen: ${missing.join(", ")}`);
    }
    return provider;
  }

  function createLegacyOsmDatasetProvider(osmService, options = {}) {
    if (!osmService || typeof osmService !== "object") {
      throw new TypeError("LegacyOsmDatasetProvider benötigt den bestehenden OSM-Service.");
    }
    const providerId = asText(options.providerId) || "legacy-osm";
    const candidates = new Map();

    function metadataFromOsm(value) {
      const metadata = normalizeDatasetMetadata({
        ...value,
        datasetKind: "municipality",
        provider: providerId,
        providerRef: value && value.providerRef ? value.providerRef : {
          osmType: asText(value && value.osmType),
          osmId: Number(value && value.osmId)
        }
      }, providerId);
      candidates.set(metadata.id, { metadata, source: metadata });
      return metadata;
    }

    async function searchDatasets(query, searchOptions = {}) {
      try {
        if (typeof osmService.searchMunicipalities !== "function") {
          throw new DatasetProviderError("PROVIDER_UNAVAILABLE", "Die OSM-Suche ist nicht verfügbar.", { provider: providerId });
        }
        const results = await osmService.searchMunicipalities(query, searchOptions);
        return (Array.isArray(results) ? results : []).map(metadataFromOsm);
      } catch (error) {
        throw normalizeError(error, "SEARCH_FAILED", providerId);
      }
    }

    function resolveDatasetMetadata(datasetId, metadataOptions = {}) {
      const id = asText(datasetId);
      if (!id) throw new DatasetProviderError("DATASET_NOT_FOUND", "Dataset-ID fehlt.", { provider: providerId });
      if (candidates.has(id)) return candidates.get(id).metadata;
      const supplied = metadataOptions.metadata || metadataOptions.installedDataset;
      if (supplied) return metadataFromOsm(supplied);
      throw new DatasetProviderError("DATASET_NOT_FOUND", `Dataset "${id}" wurde nicht gefunden.`, { provider: providerId });
    }

    async function getDatasetMetadata(datasetId, metadataOptions = {}) {
      return resolveDatasetMetadata(datasetId, metadataOptions);
    }

    async function downloadDataset(datasetId, downloadOptions = {}) {
      const id = asText(datasetId);
      try {
        if (typeof osmService.fetchCityData !== "function") {
          throw new DatasetProviderError("PROVIDER_UNAVAILABLE", "Der OSM-Download ist nicht verfügbar.", { provider: providerId });
        }
        const metadata = resolveDatasetMetadata(id, downloadOptions);
        const cached = candidates.get(id);
        const source = cached ? cached.source : metadata;
        const { metadata: _metadata, installedDataset: _installedDataset, ...serviceOptions } = downloadOptions;
        const dataset = await osmService.fetchCityData(source, serviceOptions);
        return { datasetId: id, metadata, dataset };
      } catch (error) {
        throw normalizeError(error, "DOWNLOAD_FAILED", providerId);
      }
    }

    async function checkForUpdate(installedDataset, updateOptions = {}) {
      if (!installedDataset || typeof installedDataset !== "object") {
        throw new DatasetProviderError("DATASET_NOT_FOUND", "Installiertes Dataset fehlt.", { provider: providerId });
      }
      const metadata = metadataFromOsm(installedDataset);
      return downloadDataset(metadata.id, { ...updateOptions, installedDataset });
    }

    const provider = {
      id: providerId,
      requiresNetwork(operation) {
        return ["search", "download", "update"].includes(operation);
      },
      searchDatasets,
      getDatasetMetadata,
      downloadDataset,
      checkForUpdate,
      formatErrorDiagnostics: typeof osmService.formatOverpassErrorDiagnostics === "function"
        ? error => osmService.formatOverpassErrorDiagnostics(error)
        : null
    };
    return Object.freeze(provider);
  }

  function createStaticDatasetProvider(entries = [], options = {}) {
    if (!Array.isArray(entries)) throw new TypeError("StaticDatasetProvider erwartet ein Array.");
    const providerId = asText(options.providerId) || "static";
    const datasets = new Map();
    entries.forEach(entry => {
      const metadataInput = entry && entry.metadata ? entry.metadata : entry;
      const dataset = entry && Object.prototype.hasOwnProperty.call(entry, "dataset")
        ? entry.dataset
        : null;
      const metadata = normalizeDatasetMetadata({ ...metadataInput, provider: providerId }, providerId);
      if (!dataset || typeof dataset !== "object") {
        throw new DatasetProviderError("INVALID_DATASET", `Dataset "${metadata.id}" enthält keine Daten.`, { provider: providerId });
      }
      datasets.set(metadata.id, { metadata, dataset });
    });

    async function searchDatasets(query, searchOptions = {}) {
      throwIfAborted(searchOptions.signal);
      if (typeof query !== "string") throw new TypeError("Dataset-Suchbegriff muss ein String sein.");
      const normalizedQuery = query.trim().toLocaleLowerCase("de");
      if (!normalizedQuery) return [];
      return [...datasets.values()]
        .filter(entry => [entry.metadata.name, entry.metadata.displayName, entry.metadata.state]
          .some(value => asText(value).toLocaleLowerCase("de").includes(normalizedQuery)))
        .map(entry => clone(entry.metadata));
    }

    async function getDatasetMetadata(datasetId, metadataOptions = {}) {
      throwIfAborted(metadataOptions.signal);
      const entry = datasets.get(asText(datasetId));
      if (!entry) {
        throw new DatasetProviderError("DATASET_NOT_FOUND", `Dataset "${asText(datasetId)}" wurde nicht gefunden.`, { provider: providerId });
      }
      return clone(entry.metadata);
    }

    async function downloadDataset(datasetId, downloadOptions = {}) {
      throwIfAborted(downloadOptions.signal);
      const metadata = await getDatasetMetadata(datasetId, downloadOptions);
      const entry = datasets.get(metadata.id);
      if (typeof downloadOptions.onProgress === "function") {
        downloadOptions.onProgress({ stage: "dataset-ready", message: "Lokales Dataset ist bereit …", progress: 100 });
      }
      throwIfAborted(downloadOptions.signal);
      return { datasetId: metadata.id, metadata, dataset: clone(entry.dataset) };
    }

    async function checkForUpdate(installedDataset, updateOptions = {}) {
      const id = asText(installedDataset && installedDataset.id);
      return downloadDataset(id, updateOptions);
    }

    return Object.freeze({
      id: providerId,
      requiresNetwork() { return false; },
      searchDatasets,
      getDatasetMetadata,
      downloadDataset,
      checkForUpdate
    });
  }

  function assertSafeRelativePath(relPath, provider = "catalog") {
    if (typeof relPath !== "string" || !relPath.trim()) {
      throw new DatasetProviderError("UNSAFE_DOWNLOAD_PATH", "Der Download-Pfad darf nicht leer sein.", { provider });
    }
    const normalized = relPath.trim();
    if (normalized.includes("\\")) {
      throw new DatasetProviderError("UNSAFE_DOWNLOAD_PATH", `Backslashes sind im Download-Pfad unzulässig: "${relPath}".`, { provider });
    }
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      throw new DatasetProviderError("UNSAFE_DOWNLOAD_PATH", `Absolute Pfade sind als Download-Pfad unzulässig: "${relPath}".`, { provider });
    }
    const parts = normalized.split("/");
    if (parts.some(part => part === ".." || part === ".")) {
      throw new DatasetProviderError("UNSAFE_DOWNLOAD_PATH", `Pfadtraversal (".." oder ".") ist unzulässig: "${relPath}".`, { provider });
    }
    if (!normalized.endsWith(".json")) {
      throw new DatasetProviderError("UNSAFE_DOWNLOAD_PATH", `Download-Pfad muss auf ".json" enden: "${relPath}".`, { provider });
    }
    return normalized;
  }

  function comparePackageVersions(a, b) {
    let commonJsValidator = null;
    try {
      if (typeof module === "object" && module.exports && typeof require === "function") {
        commonJsValidator = require("./city-data-validator.js");
      }
    } catch (_) {}
    const validatorApi = (root && root.StrassentrainerCityDataValidator) || commonJsValidator;
    if (validatorApi && typeof validatorApi.comparePackageVersions === "function") {
      return validatorApi.comparePackageVersions(a, b);
    }
    const parse = str => {
      const match = String(str || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
      if (!match) throw new Error(`Ungültige Version: "${str}".`);
      const base = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (match[4] !== undefined) base.push(Number(match[4]));
      return base;
    };
    const parsedA = parse(a);
    const parsedB = parse(b);
    const len = Math.max(parsedA.length, parsedB.length);
    for (let i = 0; i < len; i++) {
      const valA = parsedA[i] !== undefined ? parsedA[i] : 0;
      const valB = parsedB[i] !== undefined ? parsedB[i] : 0;
      if (valA !== valB) return valA > valB ? 1 : -1;
    }
    return 0;
  }

  function createCatalogDatasetProvider(catalogSource, options = {}) {
    let source = catalogSource;
    let opts = options;
    if (catalogSource && typeof catalogSource === "object" && !catalogSource.datasets && !catalogSource.schemaVersion) {
      opts = catalogSource;
      source = opts.catalog || opts.catalogUrl || opts.catalogData || "data/catalog.json";
    }
    const providerId = asText(opts.providerId) || "catalog";
    let cachedCatalog = null;
    let catalogBase = opts.baseUrl || opts.basePath || "";

    function parseCatalogData(raw) {
      let data = raw;
      if (typeof raw === "string") {
        try {
          data = JSON.parse(raw);
        } catch (error) {
          throw new DatasetProviderError("INVALID_CATALOG", "Katalogdatei enthält ungültiges JSON.", { cause: error, provider: providerId });
        }
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new DatasetProviderError("INVALID_CATALOG", "Katalog muss ein JSON-Objekt sein.", { provider: providerId });
      }
      if (data.schemaVersion !== 1) {
        throw new DatasetProviderError("INVALID_CATALOG", `Nicht unterstützte Catalog Schema-Version: ${data.schemaVersion}.`, { provider: providerId });
      }
      if (!Array.isArray(data.datasets)) {
        throw new DatasetProviderError("INVALID_CATALOG", "Katalog-Eigenschaft 'datasets' muss ein Array sein.", { provider: providerId });
      }
      const map = new Map();
      const seenIds = new Set();
      data.datasets.forEach(item => {
        if (!item || typeof item !== "object") {
          throw new DatasetProviderError("INVALID_DATASET", "Ungültiger Katalogeintrag.", { provider: providerId });
        }
        const id = asText(item.id);
        if (!id) {
          throw new DatasetProviderError("INVALID_DATASET", "Katalogeintrag besitzt keine ID.", { provider: providerId });
        }
        if (seenIds.has(id)) {
          throw new DatasetProviderError("INVALID_CATALOG", `Doppelte Dataset-ID "${id}" im Katalog.`, { provider: providerId });
        }
        seenIds.add(id);

        const pathCandidate = item.downloadPath || item.packageUrl;
        if (pathCandidate) {
          assertSafeRelativePath(pathCandidate, providerId);
        }

        const normalized = normalizeDatasetMetadata({
          ...item,
          downloadPath: pathCandidate,
          packageUrl: item.packageUrl || pathCandidate,
          provider: providerId
        }, providerId);
        map.set(id, normalized);
        if (item.cityId && !map.has(item.cityId)) {
          map.set(item.cityId, normalized);
        }
      });

      return { raw: data, map, list: Array.from(new Set(map.values())) };
    }

    async function loadCatalog(signal, loadOptions = {}) {
      throwIfAborted(signal);
      const shouldReload = Boolean(loadOptions && loadOptions.reload);
      if (cachedCatalog && !opts.noCache && !shouldReload) return cachedCatalog;

      if (typeof opts.loadCatalog === "function") {
        try {
          const loaded = await opts.loadCatalog({ signal });
          cachedCatalog = parseCatalogData(loaded);
          return cachedCatalog;
        } catch (error) {
          throw normalizeError(error, "CATALOG_UNAVAILABLE", providerId);
        }
      }

      if (source && typeof source === "object") {
        cachedCatalog = parseCatalogData(source);
        return cachedCatalog;
      }

      const sourceStr = asText(source) || "data/catalog.json";
      let isHttp = /^https?:\/\//i.test(sourceStr);
      let catalogUrl = null;

      if (isHttp) {
        try {
          catalogUrl = new URL(sourceStr);
        } catch (_) {}
      } else if (typeof window !== "undefined" && window.location && window.location.href) {
        try {
          catalogUrl = new URL(sourceStr, window.location.href);
          isHttp = true;
        } catch (_) {}
      } else if (typeof document !== "undefined" && document.baseURI) {
        try {
          catalogUrl = new URL(sourceStr, document.baseURI);
          isHttp = true;
        } catch (_) {}
      }

      if (!catalogBase) {
        if (catalogUrl) {
          catalogBase = catalogUrl.href.substring(0, catalogUrl.href.lastIndexOf("/") + 1);
        } else if (isHttp) {
          catalogBase = sourceStr.substring(0, sourceStr.lastIndexOf("/") + 1);
        } else {
          const lastSlash = Math.max(sourceStr.lastIndexOf("/"), sourceStr.lastIndexOf("\\"));
          catalogBase = lastSlash >= 0 ? sourceStr.substring(0, lastSlash + 1) : "";
        }
      }

      const hasFetch = typeof fetch === "function";
      const hasFs = typeof process !== "undefined" && typeof require === "function";
      const fetchFn = opts.fetch || (typeof fetch === "function" ? fetch : null);

      if (isHttp || (!hasFs && hasFetch)) {
        try {
          if (!fetchFn) {
            throw new DatasetProviderError("CATALOG_UNAVAILABLE", "Keine Fetch-Funktion verfügbar.", { provider: providerId });
          }
          const fetchTarget = catalogUrl ? catalogUrl.href : sourceStr;
          const response = await fetchFn(fetchTarget, { signal });
          if (!response || !response.ok) {
            throw new DatasetProviderError("CATALOG_UNAVAILABLE", `Katalog konnte nicht geladen werden (HTTP ${response ? response.status : "unknown"}).`, { provider: providerId });
          }
          const text = await response.text();
          cachedCatalog = parseCatalogData(text);
          return cachedCatalog;
        } catch (error) {
          throwIfAborted(signal);
          throw normalizeError(error, "CATALOG_UNAVAILABLE", providerId);
        }
      }

      if (hasFs) {
        try {
          const fs = require("node:fs");
          const path = require("node:path");
          const absPath = path.isAbsolute(sourceStr) ? sourceStr : path.resolve(process.cwd(), sourceStr);
          if (!fs.existsSync(absPath)) {
            throw new DatasetProviderError("CATALOG_UNAVAILABLE", `Katalogdatei nicht gefunden: "${sourceStr}".`, { provider: providerId });
          }
          const text = fs.readFileSync(absPath, "utf8");
          cachedCatalog = parseCatalogData(text);
          return cachedCatalog;
        } catch (error) {
          throwIfAborted(signal);
          throw normalizeError(error, "CATALOG_UNAVAILABLE", providerId);
        }
      }

      throw new DatasetProviderError("CATALOG_UNAVAILABLE", "Katalog konnte nicht geladen werden.", { provider: providerId });
    }

    async function searchDatasets(query, searchOptions = {}) {
      throwIfAborted(searchOptions.signal);
      if (typeof query !== "string") {
        throw new TypeError("Dataset-Suchbegriff muss ein String sein.");
      }
      const normalizedQuery = query.trim().toLocaleLowerCase("de");
      if (!normalizedQuery) return [];

      const catalog = await loadCatalog(searchOptions.signal);
      throwIfAborted(searchOptions.signal);

      return catalog.list
        .filter(entry => {
          const searchable = [
            entry.name,
            entry.displayName,
            entry.state,
            entry.district,
            entry.country,
            ...(Array.isArray(entry.postalCodes) ? entry.postalCodes : [])
          ];
          return searchable.some(val => asText(val).toLocaleLowerCase("de").includes(normalizedQuery));
        })
        .map(entry => clone(entry));
    }

    async function getDatasetMetadata(datasetId, metadataOptions = {}) {
      throwIfAborted(metadataOptions.signal);
      const id = asText(datasetId);
      if (!id) {
        throw new DatasetProviderError("DATASET_NOT_FOUND", "Dataset-ID fehlt.", { provider: providerId });
      }
      const catalog = await loadCatalog(metadataOptions.signal, metadataOptions);
      throwIfAborted(metadataOptions.signal);

      const entry = catalog.map.get(id);
      if (!entry) {
        throw new DatasetProviderError("DATASET_NOT_FOUND", `Dataset "${id}" wurde nicht gefunden.`, { provider: providerId });
      }
      return clone(entry);
    }

    async function downloadDataset(datasetId, downloadOptions = {}) {
      throwIfAborted(downloadOptions.signal);
      const metadata = await getDatasetMetadata(datasetId, downloadOptions);
      throwIfAborted(downloadOptions.signal);

      const downloadPath = assertSafeRelativePath(metadata.downloadPath || metadata.packageUrl, providerId);

      if (typeof downloadOptions.onProgress === "function") {
        downloadOptions.onProgress({ stage: "downloading", message: `${metadata.name} wird geladen …`, progress: 20 });
      }

      let packageData;
      if (typeof downloadOptions.loadPackage === "function") {
        packageData = await downloadOptions.loadPackage(downloadPath, { metadata, signal: downloadOptions.signal });
      } else if (typeof opts.loadPackage === "function") {
        packageData = await opts.loadPackage(downloadPath, { metadata, signal: downloadOptions.signal });
      } else {
        const isHttp = /^https?:\/\//i.test(catalogBase);
        const hasFetch = typeof fetch === "function";
        const hasFs = typeof process !== "undefined" && typeof require === "function";

        if (isHttp || (!hasFs && hasFetch)) {
          const fetchFn = downloadOptions.fetch || opts.fetch || fetch;
          let resolvedBase = catalogBase;
          if (!/^https?:\/\//i.test(resolvedBase)) {
            const docBase = typeof window !== "undefined" && window.location && window.location.href
              ? window.location.href
              : (typeof document !== "undefined" && document.baseURI ? document.baseURI : "http://localhost/");
            try {
              resolvedBase = new URL(catalogBase || "", docBase).href;
            } catch (_) {
              resolvedBase = docBase;
            }
          }
          const url = new URL(downloadPath, resolvedBase).href;
          try {
            const response = await fetchFn(url, { signal: downloadOptions.signal });
            if (!response || !response.ok) {
              throw new DatasetProviderError("DOWNLOAD_FAILED", `Package-Download fehlgeschlagen (HTTP ${response ? response.status : "unknown"}).`, { provider: providerId });
            }
            const text = await response.text();
            packageData = JSON.parse(text);
          } catch (error) {
            throwIfAborted(downloadOptions.signal);
            throw normalizeError(error, "DOWNLOAD_FAILED", providerId);
          }
        } else if (hasFs) {
          const fs = require("node:fs");
          const path = require("node:path");
          const basePath = catalogBase ? (path.isAbsolute(catalogBase) ? catalogBase : path.resolve(process.cwd(), catalogBase)) : process.cwd();
          const targetPath = path.resolve(basePath, downloadPath);
          try {
            const raw = fs.readFileSync(targetPath, "utf8");
            packageData = JSON.parse(raw);
          } catch (error) {
            throwIfAborted(downloadOptions.signal);
            throw normalizeError(error, "DOWNLOAD_FAILED", providerId);
          }
        } else {
          throw new DatasetProviderError("DOWNLOAD_FAILED", "Keine Lademethode für Datenpaket verfügbar.", { provider: providerId });
        }
      }

      throwIfAborted(downloadOptions.signal);

      if (typeof downloadOptions.onProgress === "function") {
        downloadOptions.onProgress({ stage: "verifying", message: "Integrität wird geprüft …", progress: 80 });
      }

      // Hash-Verifikation: catalog.contentHash == package.package.contentHash
      const pkgHash = asText(packageData && packageData.package && packageData.package.contentHash);
      const catalogHash = asText(metadata.contentHash);
      if (catalogHash && pkgHash && catalogHash !== pkgHash) {
        throw new DatasetProviderError(
          "HASH_MISMATCH",
          `Integritätsprüfung fehlgeschlagen: Katalog-Hash (${catalogHash}) stimmt nicht mit Paket-Hash (${pkgHash}) überein.`,
          { provider: providerId }
        );
      }

      if (typeof downloadOptions.onProgress === "function") {
        downloadOptions.onProgress({ stage: "dataset-ready", message: "Dataset ist bereit.", progress: 100 });
      }

      return {
        datasetId: metadata.id,
        metadata,
        dataset: packageData
      };
    }

    async function checkForUpdate(installedDataset, updateOptions = {}) {
      throwIfAborted(updateOptions.signal);
      if (!installedDataset || typeof installedDataset !== "object") {
        throw new DatasetProviderError("INVALID_DATASET", "Installiertes Dataset fehlt für die Update-Prüfung.", { provider: providerId });
      }
      const id = asText(installedDataset.package && installedDataset.package.id)
        || asText(installedDataset.id)
        || asText(installedDataset.city && installedDataset.city.id)
        || asText(installedDataset.cityId)
        || osmDatasetId(installedDataset);
      if (!id) {
        throw new DatasetProviderError("DATASET_NOT_FOUND", "Installiertes Dataset besitzt keine gültige ID.", { provider: providerId });
      }

      const shouldReload = updateOptions.reload !== false;
      const catalogEntry = await getDatasetMetadata(id, { ...updateOptions, reload: shouldReload });
      throwIfAborted(updateOptions.signal);

      const currentVersion = asText(installedDataset.package && installedDataset.package.version)
        || asText(installedDataset.city && installedDataset.city.package && installedDataset.city.package.version)
        || asText(installedDataset.version);
      const latestVersion = asText(catalogEntry && catalogEntry.version);

      if (!currentVersion) {
        throw new DatasetProviderError(
          "INVALID_VERSION",
          "Installiertes Dataset besitzt keine gültige Versionsangabe.",
          { provider: providerId }
        );
      }
      if (!latestVersion) {
        throw new DatasetProviderError(
          "INVALID_VERSION",
          "Katalogeintrag besitzt keine gültige Versionsangabe.",
          { provider: providerId }
        );
      }

      let comparison = 0;
      try {
        comparison = comparePackageVersions(latestVersion, currentVersion);
      } catch (error) {
        throw new DatasetProviderError(
          "INVALID_VERSION",
          `Versionsvergleich fehlgeschlagen: ${error && error.message ? error.message : error}`,
          { cause: error, provider: providerId }
        );
      }

      // comparison > 0 means latestVersion is strictly newer than currentVersion.
      // comparison <= 0 means up to date or older (downgrade not offered).
      const hasUpdate = comparison > 0;

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        metadata: catalogEntry
      };
    }

    return Object.freeze({
      id: providerId,
      requiresNetwork(operation) {
        if (operation === "search" || operation === "metadata") {
          return Boolean(!cachedCatalog && opts.requiresNetwork);
        }
        return true;
      },
      searchDatasets,
      getDatasetMetadata,
      downloadDataset,
      checkForUpdate,
      reloadCatalog: () => { cachedCatalog = null; }
    });
  }

  let defaultProvider = null;

  function getDefaultProvider() {
    if (!defaultProvider) {
      defaultProvider = createCatalogDatasetProvider();
    }
    return defaultProvider;
  }

  return Object.freeze({
    REQUIRED_METHODS,
    DatasetProviderError,
    assertDatasetProvider,
    normalizeDatasetMetadata,
    createLegacyOsmDatasetProvider,
    createStaticDatasetProvider,
    createCatalogDatasetProvider,
    getDefaultProvider,
    searchDatasets: (...args) => getDefaultProvider().searchDatasets(...args),
    getDatasetMetadata: (...args) => getDefaultProvider().getDatasetMetadata(...args),
    downloadDataset: (...args) => getDefaultProvider().downloadDataset(...args),
    checkForUpdate: (...args) => getDefaultProvider().checkForUpdate(...args),
    requiresNetwork: operation => getDefaultProvider().requiresNetwork(operation),
    formatErrorDiagnostics: error => {
      const provider = getDefaultProvider();
      return typeof provider.formatErrorDiagnostics === "function"
        ? provider.formatErrorDiagnostics(error)
        : null;
    }
  });
});
