(function initializeCityPackage(root, factory) {
  "use strict";
  const commonJsValidator = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./city-data-validator.js")
    : null;
  const api = factory((root && root.StrassentrainerCityDataValidator) || commonJsValidator, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerCityPackage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCityPackageApi(validatorApi, root) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_IMPORT_FILE_SIZE_BYTES = 25 * 1024 * 1024;

  class CityPackageError extends Error {
    constructor(code, message, options = {}) {
      super(message, options);
      this.name = "CityPackageError";
      this.code = code;
    }
  }

  function requireValidator() {
    if (!validatorApi || typeof validatorApi.validateCityPackage !== "function") {
      throw new CityPackageError("VALIDATOR_UNAVAILABLE", "Die Stadtdatei kann momentan nicht geprüft werden.");
    }
    return validatorApi;
  }

  function displayName(city) {
    return String(city?.displayName || city?.name || "").trim();
  }

  function slugifyCityName(value) {
    const normalized = String(value || "")
      .trim()
      .toLocaleLowerCase("de-DE")
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-")
      .slice(0, 80);
    return normalized || "stadt";
  }

  function cityPackageFilename(city, schemaVersion = SCHEMA_VERSION, packageMeta = null) {
    const pkg = packageMeta || city?.package;
    if (pkg?.type === "curated" && pkg?.version) {
      return `${slugifyCityName(displayName(city))}-training-v${pkg.version}.json`;
    }
    const version = Number.isInteger(schemaVersion) ? schemaVersion : SCHEMA_VERSION;
    return `${slugifyCityName(displayName(city))}-strassentrainer-v${version}.json`;
  }

  function isoTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value);
    if (!Number.isFinite(date.getTime())) {
      throw new CityPackageError("EXPORT_TIME_INVALID", "Der Exportzeitpunkt konnte nicht erzeugt werden.");
    }
    return date.toISOString();
  }

  function validationIssues(result, kind = "errors") {
    if (!result?.validation) return [];
    return ["package", "municipality", "streets", "pois", "areas"].flatMap(sectionName => {
      const issues = result.validation[sectionName]?.[kind];
      return Array.isArray(issues) ? issues : [];
    });
  }

  function validationErrorMessage(result) {
    const codes = new Set(validationIssues(result).map(entry => entry.code));
    if (codes.has("PACKAGE_HASH_MISMATCH")) {
      return "Die Prüfsumme des Stadtpakets stimmt nicht mit dem Inhalt überein. Die Datei ist möglicherweise beschädigt.";
    }
    if (codes.has("PACKAGE_VERSION_INVALID")) {
      return "Die kuratierte Paketversion ist ungültig (erwartet: MAJOR.MINOR.PATCH).";
    }
    if (codes.has("PACKAGE_ID_INVALID") || codes.has("PACKAGE_TYPE_INVALID")) {
      return "Die Paketidentität oder der Pakettyp ist ungültig.";
    }
    if (codes.has("PACKAGE_MAINTAINER_MISSING") || codes.has("PACKAGE_VERIFICATION_INVALID")) {
      return "Die Prüfmetadaten des Pakets sind unvollständig oder ungültig.";
    }
    if (codes.has("PACKAGE_TITLE_INVALID")) {
      return "Der Pakettitel ist ungültig oder fehlt.";
    }
    if (codes.has("CITY_PACKAGE_SCHEMA_NEWER")) {
      return "Diese Stadtdatei verwendet eine neuere, derzeit nicht unterstützte Version.";
    }
    if (codes.has("CITY_PACKAGE_DANGEROUS_KEY")) {
      return "Die Stadtdatei enthält unsichere Daten und wurde blockiert.";
    }
    if (codes.has("STREET_ID_DUPLICATE") || codes.has("POI_ID_DUPLICATE")
      || codes.has("AREA_ID_DUPLICATE") || codes.has("CITY_ENTITY_ID_DUPLICATE")) {
      return "Die Stadtdatei enthält doppelte IDs.";
    }
    if (codes.has("AREA_PARENT_CYCLE")) {
      return "Die Hierarchie der Trainingsgebiete enthält einen unzulässigen Zyklus.";
    }
    if (codes.has("STREET_GEOMETRY_INVALID") || codes.has("STREET_GEOMETRY_MISSING")) {
      return "Die Stadtdatei enthält ungültige Straßengeometrien.";
    }
    if (codes.has("POI_GEOMETRY_INVALID") || codes.has("POI_POSITION_INVALID")) {
      return "Die Stadtdatei enthält ungültige POI-Koordinaten oder -Geometrien.";
    }
    if (codes.has("CITY_BOUNDS_INVALID") || codes.has("CITY_CENTER_INVALID")
      || codes.has("AREA_BOUNDS_INVALID") || codes.has("AREA_CENTER_INVALID")) {
      return "Die Stadtdatei enthält ungültige Kartengrenzen oder Koordinaten.";
    }
    return "Die Stadtdatei verwendet ein nicht unterstütztes Format oder enthält ungültige Daten.";
  }

  function createCityPackage(city, streets, pois, areasOrOptions = [], options = {}) {
    let areas = [];
    let packageOptions = options;
    if (Array.isArray(areasOrOptions)) {
      areas = areasOrOptions;
      packageOptions = options || {};
    } else if (areasOrOptions && typeof areasOrOptions === "object") {
      areas = [];
      packageOptions = areasOrOptions;
    }

    const hasAreas = Array.isArray(areas) && areas.length > 0;
    let pkg = null;
    if (packageOptions.package && typeof packageOptions.package === "object") {
      pkg = JSON.parse(JSON.stringify(packageOptions.package));
    } else if (city?.package && typeof city.package === "object") {
      pkg = JSON.parse(JSON.stringify(city.package));
    } else if (city?.id === "osm-relation-1016396" && (city?.source?.includes("curated") || !city?.source)) {
      pkg = {
        id: "de-oberasbach-fire-training",
        type: "curated",
        version: "1.0.0",
        title: "Oberasbach – geprüftes Trainingspaket",
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
        source: "curated",
        verification: {
          status: "verified",
          verifiedAt: "2026-09-05T00:00:00.000Z",
          maintainer: "Straßentrainer",
          note: "Straßen und relevante Einrichtungen redaktionell geprüft"
        }
      };
    }

    const candidate = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: isoTimestamp(packageOptions.exportedAt),
      city,
      streets,
      pois
    };
    if (hasAreas) {
      candidate.areas = areas;
    }
    if (pkg) {
      candidate.package = pkg;
      if (pkg.type === "curated") {
        const val = requireValidator();
        if (typeof val.computePackageHash === "function") {
          pkg.contentHash = val.computePackageHash(candidate);
        }
      }
    }

    const validated = requireValidator().validateCityPackage(candidate);
    if (!validated.valid) {
      throw new CityPackageError("EXPORT_DATA_INVALID", validationErrorMessage(validated));
    }
    const result = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: candidate.exportedAt,
      city: validated.city,
      streets: validated.streets,
      pois: validated.pois
    };
    if (hasAreas) {
      result.areas = validated.areas || [];
    }
    if (validated.package && !validated.package.legacy) {
      result.package = validated.package;
    }
    return result;
  }

  async function exportCityPackage(cityId, options = {}) {
    const storage = options.storage || (root && root.StrassentrainerCityStorage);
    const normalizedCityId = String(cityId || "").trim();
    if (!normalizedCityId) {
      throw new CityPackageError("CITY_ID_INVALID", "Für den Export fehlt eine gültige Stadt-ID.");
    }
    if (!storage || typeof storage.getCity !== "function"
      || typeof storage.getCityStreets !== "function" || typeof storage.getCityPois !== "function") {
      throw new CityPackageError("STORAGE_UNAVAILABLE", "Der lokale Stadtspeicher ist nicht verfügbar.");
    }

    const queries = [
      storage.getCity(normalizedCityId),
      storage.getCityStreets(normalizedCityId),
      storage.getCityPois(normalizedCityId)
    ];
    const hasGetCityAreas = typeof storage.getCityAreas === "function";
    if (hasGetCityAreas) {
      queries.push(storage.getCityAreas(normalizedCityId));
    }
    const results = await Promise.all(queries);
    const city = results[0];
    const streets = results[1];
    const pois = results[2];
    const areas = hasGetCityAreas ? results[3] : [];

    if (!city) {
      throw new CityPackageError("CITY_NOT_FOUND", "Die ausgewählte Stadt wurde lokal nicht gefunden.");
    }
    const packageData = createCityPackage(city, streets, pois, areas, {
      exportedAt: options.exportedAt,
      package: options.package || city.package
    });
    return {
      packageData,
      filename: cityPackageFilename(city, packageData.schemaVersion, packageData.package),
      json: `${JSON.stringify(packageData, null, 2)}\n`
    };
  }

  function downloadExportedCity(exported, options = {}) {
    const documentRef = options.document || (root && root.document);
    const URLApi = options.URL || (root && root.URL);
    const BlobClass = options.Blob || (root && root.Blob);
    if (!documentRef || !URLApi || typeof URLApi.createObjectURL !== "function" || !BlobClass) {
      throw new CityPackageError("DOWNLOAD_UNAVAILABLE", "Die Stadtdatei konnte nicht heruntergeladen werden.");
    }
    const blob = new BlobClass([exported.json], { type: "application/json;charset=utf-8" });
    const url = URLApi.createObjectURL(blob);
    try {
      const link = documentRef.createElement("a");
      link.href = url;
      link.download = exported.filename;
      link.hidden = true;
      const parent = documentRef.body || documentRef.documentElement;
      if (parent && typeof parent.appendChild === "function") parent.appendChild(link);
      link.click();
      if (typeof link.remove === "function") link.remove();
    } finally {
      if (typeof URLApi.revokeObjectURL === "function") URLApi.revokeObjectURL(url);
    }
    return exported;
  }

  async function exportAndDownloadCityPackage(cityId, options = {}) {
    const exported = await exportCityPackage(cityId, options);
    return downloadExportedCity(exported, options);
  }

  function utf8ByteLength(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).byteLength;
    let bytes = 0;
    for (const character of String(text)) {
      const codePoint = character.codePointAt(0);
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return bytes;
  }

  function parseCityPackageText(text, options = {}) {
    const maximum = Number.isSafeInteger(options.maxFileSizeBytes)
      ? options.maxFileSizeBytes
      : MAX_IMPORT_FILE_SIZE_BYTES;
    if (typeof text !== "string") {
      throw new CityPackageError("FILE_READ_FAILED", "Die ausgewählte Stadtdatei konnte nicht gelesen werden.");
    }
    if (utf8ByteLength(text) > maximum) {
      throw new CityPackageError("FILE_TOO_LARGE", "Die ausgewählte Stadtdatei ist zu groß.");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new CityPackageError("INVALID_JSON", "Die Datei ist keine gültige JSON-Datei.", { cause: error });
    }
    return requireValidator().validateCityPackage(parsed);
  }

  function isJsonFile(file) {
    const name = String(file?.name || "").trim().toLocaleLowerCase("de-DE");
    const type = String(file?.type || "").trim().toLocaleLowerCase("en-US").split(";")[0];
    return name.endsWith(".json") || type === "application/json" || type.endsWith("+json");
  }

  async function readCityPackageFile(file, options = {}) {
    const maximum = Number.isSafeInteger(options.maxFileSizeBytes)
      ? options.maxFileSizeBytes
      : MAX_IMPORT_FILE_SIZE_BYTES;
    if (!file || typeof file.text !== "function") {
      throw new CityPackageError("FILE_MISSING", "Bitte wähle eine JSON-Stadtdatei aus.");
    }
    if (!isJsonFile(file)) {
      throw new CityPackageError("FILE_TYPE_INVALID", "Bitte wähle eine JSON-Stadtdatei aus.");
    }
    if (Number.isFinite(file.size) && file.size > maximum) {
      throw new CityPackageError("FILE_TOO_LARGE", "Die ausgewählte Stadtdatei ist zu groß.");
    }
    let text;
    try {
      text = await file.text();
    } catch (error) {
      throw new CityPackageError("FILE_READ_FAILED", "Die ausgewählte Stadtdatei konnte nicht gelesen werden.", { cause: error });
    }
    return parseCityPackageText(text, { maxFileSizeBytes: maximum });
  }

  function comparePackageVersions(a, b) {
    return requireValidator().comparePackageVersions(a, b);
  }

  function computePackageHash(packageData) {
    return requireValidator().computePackageHash(packageData);
  }

  function verifyPackageHash(packageData) {
    return requireValidator().verifyPackageHash(packageData);
  }

  function parseSemver(versionString) {
    return requireValidator().parseSemver(versionString);
  }

  return Object.freeze({
    SCHEMA_VERSION,
    MAX_IMPORT_FILE_SIZE_BYTES,
    CityPackageError,
    slugifyCityName,
    cityPackageFilename,
    validationIssues,
    validationErrorMessage,
    createCityPackage,
    exportCityPackage,
    downloadExportedCity,
    exportAndDownloadCityPackage,
    parseCityPackageText,
    readCityPackageFile,
    comparePackageVersions,
    computePackageHash,
    verifyPackageHash,
    parseSemver
  });
});
