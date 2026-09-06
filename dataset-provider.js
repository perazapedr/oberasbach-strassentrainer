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

  let defaultProvider = null;

  function getDefaultProvider() {
    if (!defaultProvider) {
      const osmService = root && root.StrassentrainerOsmService;
      if (!osmService) {
        throw new DatasetProviderError("PROVIDER_UNAVAILABLE", "Der Standard-DatasetProvider ist nicht verfügbar.");
      }
      defaultProvider = createLegacyOsmDatasetProvider(osmService);
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
