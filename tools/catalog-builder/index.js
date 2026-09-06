"use strict";

const fs = require("node:fs");
const path = require("node:path");
const validator = require("../../city-data-validator.js");

const SCHEMA_VERSION = 1;

class CatalogBuilderError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "CatalogBuilderError";
    this.code = code;
    if (options.file) this.file = options.file;
    if (options.issues) this.issues = options.issues;
  }
}

function assertSafeRelativePath(relPath) {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new CatalogBuilderError("UNSAFE_DOWNLOAD_PATH", "Der Download-Pfad darf nicht leer sein.");
  }
  const normalized = relPath.trim();
  if (normalized.includes("\\")) {
    throw new CatalogBuilderError("UNSAFE_DOWNLOAD_PATH", `Backslashes sind im Download-Pfad unzulässig: "${relPath}".`);
  }
  if (path.isAbsolute(normalized) || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new CatalogBuilderError("UNSAFE_DOWNLOAD_PATH", `Absolute Pfade sind als Download-Pfad unzulässig: "${relPath}".`);
  }
  const parts = normalized.split("/");
  if (parts.some(part => part === ".." || part === ".")) {
    throw new CatalogBuilderError("UNSAFE_DOWNLOAD_PATH", `Pfadtraversal (".." oder ".") ist unzulässig: "${relPath}".`);
  }
  if (!normalized.endsWith(".json")) {
    throw new CatalogBuilderError("UNSAFE_DOWNLOAD_PATH", `Download-Pfad muss auf ".json" enden: "${relPath}".`);
  }
  return normalized;
}

function validationIssues(result, kind = "errors") {
  if (!result || !result.validation) return [];
  return ["package", "municipality", "streets", "pois", "areas"].flatMap(sectionName => {
    const issues = result.validation[sectionName]?.[kind];
    return Array.isArray(issues) ? issues : [];
  });
}

function extractCatalogEntry(parsedPackage, filePath, catalogOutputFile) {
  const catalogDir = path.dirname(path.resolve(catalogOutputFile));
  const absFilePath = path.resolve(filePath);

  // Download-Pfad relativ zum Katalog-Verzeichnis
  let rawRelPath = path.relative(catalogDir, absFilePath).split(path.sep).join("/");
  const safeDownloadPath = assertSafeRelativePath(rawRelPath);

  const stat = fs.statSync(absFilePath);
  const fileSize = stat.size;

  const pkg = parsedPackage.package || {};
  const city = parsedPackage.city || {};

  const id = String(pkg.id || "").trim();
  if (!id) {
    throw new CatalogBuilderError("MISSING_PACKAGE_ID", "Das Datenpaket besitzt keine package.id.", { file: filePath });
  }

  const name = String(city.name || "").trim();
  const displayName = String(city.displayName || name).trim();
  if (!name) {
    throw new CatalogBuilderError("MISSING_CITY_NAME", "Das Datenpaket besitzt keinen city.name.", { file: filePath });
  }

  // datasetKind: Beschreibt das geografische Trainingsgebiet.
  // Für Olpe und Oberasbach: "municipality". Falls pkg.datasetKind "curated" war, auf "municipality" abbilden.
  let datasetKind = "municipality";
  if (pkg.datasetKind && pkg.datasetKind !== "curated") {
    datasetKind = String(pkg.datasetKind).trim();
  }

  const state = String(city.state || "").trim();
  if (!state) {
    throw new CatalogBuilderError("MISSING_STATE", "Das Datenpaket besitzt kein Bundesland (city.state).", { file: filePath });
  }

  const country = String(city.country || "Deutschland").trim();
  const district = city.district ? String(city.district).trim() : null;
  const postalCodes = Array.isArray(city.postalCodes) ? city.postalCodes.map(String) : [];

  const cityId = String(city.id || "").trim();
  if (!cityId) {
    throw new CatalogBuilderError("MISSING_CITY_ID", "Das Datenpaket besitzt keine city.id.", { file: filePath });
  }

  const osmType = city.osmType ? String(city.osmType).trim() : (cityId.startsWith("osm-relation-") ? "relation" : null);
  let osmRelationId = null;
  if (Number.isSafeInteger(city.osmId)) {
    osmRelationId = city.osmId;
  } else if (cityId.startsWith("osm-relation-")) {
    const parsedId = Number(cityId.replace("osm-relation-", ""));
    if (Number.isSafeInteger(parsedId)) osmRelationId = parsedId;
  }

  const packageType = String(pkg.type || "").trim();
  const version = String(pkg.version || "").trim();
  if (!version) {
    throw new CatalogBuilderError("MISSING_VERSION", "Das Datenpaket besitzt keine package.version.", { file: filePath });
  }

  const contentHash = String(pkg.contentHash || "").trim();
  if (!contentHash) {
    throw new CatalogBuilderError("MISSING_CONTENT_HASH", "Das Datenpaket besitzt keinen package.contentHash.", { file: filePath });
  }

  const streetCount = Number.isInteger(city.streetCount)
    ? city.streetCount
    : (Array.isArray(parsedPackage.streets) ? parsedPackage.streets.length : 0);

  const poiCount = Number.isInteger(city.poiCount)
    ? city.poiCount
    : (Array.isArray(parsedPackage.pois) ? parsedPackage.pois.length : 0);

  const areaCount = Number.isInteger(city.areaCount)
    ? city.areaCount
    : (Array.isArray(parsedPackage.areas) ? parsedPackage.areas.length : 0);

  if (!city.center || typeof city.center.lat !== "number" || typeof city.center.lon !== "number") {
    throw new CatalogBuilderError("INVALID_CENTER", "Das Datenpaket besitzt kein gültiges city.center.", { file: filePath });
  }

  if (!city.bounds || typeof city.bounds.south !== "number" || typeof city.bounds.north !== "number"
    || typeof city.bounds.west !== "number" || typeof city.bounds.east !== "number") {
    throw new CatalogBuilderError("INVALID_BOUNDS", "Das Datenpaket besitzt keine gültigen city.bounds.", { file: filePath });
  }

  const entry = {
    id,
    name,
    displayName,
    datasetKind,
    state,
    district,
    country,
    postalCodes,
    cityId,
    osmType: osmType || undefined,
    osmRelationId: osmRelationId !== null ? osmRelationId : undefined,
    packageType: packageType || undefined,
    version,
    contentHash,
    streetCount,
    poiCount,
    areaCount,
    center: {
      lat: Number(city.center.lat),
      lon: Number(city.center.lon)
    },
    bounds: {
      south: Number(city.bounds.south),
      west: Number(city.bounds.west),
      north: Number(city.bounds.north),
      east: Number(city.bounds.east)
    },
    downloadPath: safeDownloadPath,
    fileSize
  };

  if (pkg.title) entry.title = String(pkg.title).trim();
  if (pkg.source || city.source) entry.source = String(pkg.source || city.source).trim();

  // Bereinige undefined Properties
  Object.keys(entry).forEach(key => {
    if (entry[key] === undefined) delete entry[key];
  });

  return entry;
}

function processPackageFile(filePath, catalogOutputFile, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new CatalogBuilderError("FILE_NOT_FOUND", `Paketdatei existiert nicht: "${filePath}".`, { file: filePath });
  }

  let raw;
  try {
    raw = fs.readFileSync(absPath, "utf8");
  } catch (error) {
    throw new CatalogBuilderError("FILE_READ_FAILED", `Paketdatei konnte nicht gelesen werden: "${filePath}".`, {
      file: filePath,
      cause: error
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CatalogBuilderError("INVALID_JSON", `Paketdatei enthält ungültiges JSON: "${filePath}".`, {
      file: filePath,
      cause: error
    });
  }

  // 1. Schema / Package Contract prüfen
  const validationResult = validator.validateCityPackage(parsed);
  const errors = validationIssues(validationResult, "errors");
  if (!validationResult.valid || errors.length > 0) {
    if (errors.some(e => e.code === "PACKAGE_HASH_MISMATCH")) {
      throw new CatalogBuilderError(
        "PACKAGE_HASH_MISMATCH",
        `contentHash-Prüfung fehlgeschlagen für "${filePath}".`,
        { file: filePath, issues: errors }
      );
    }
    const errorCodes = errors.map(e => e.code || e.message).join(", ");
    throw new CatalogBuilderError(
      "PACKAGE_VALIDATION_FAILED",
      `Paketvalidierung fehlgeschlagen für "${filePath}": ${errorCodes}`,
      { file: filePath, issues: errors }
    );
  }

  // 2. contentHash prüfen
  const hashCheck = validator.verifyPackageHash(parsed);
  if (!hashCheck.valid) {
    throw new CatalogBuilderError(
      "PACKAGE_HASH_MISMATCH",
      `contentHash-Prüfung fehlgeschlagen für "${filePath}". Erwartet: ${hashCheck.expectedHash}, Berechnet: ${hashCheck.actualHash}`,
      { file: filePath }
    );
  }

  // 3. Metadaten extrahieren
  return extractCatalogEntry(parsed, filePath, catalogOutputFile);
}

function buildCatalog(options = {}) {
  const rootDir = path.resolve(__dirname, "../..");
  const defaultOutputFile = path.join(rootDir, "data/catalog.json");
  const catalogOutputFile = path.resolve(options.output || defaultOutputFile);

  let inputFiles = [];
  if (Array.isArray(options.inputs) && options.inputs.length > 0) {
    inputFiles = options.inputs.map(p => path.resolve(p));
  } else if (typeof options.input === "string" && options.input.trim()) {
    const inputPath = path.resolve(options.input);
    if (fs.statSync(inputPath).isDirectory()) {
      inputFiles = fs.readdirSync(inputPath)
        .filter(f => f.endsWith(".json"))
        .map(f => path.join(inputPath, f));
    } else {
      inputFiles = [inputPath];
    }
  } else {
    // Default: Offizielle Pakete in data/cities/
    const defaultPackages = [
      "oberasbach.json",
      "de-nw-olpe.json",
      "de-nw-wenden.json",
      "de-nw-siegen.json",
      "de-nw-koeln.json"
    ];
    inputFiles = defaultPackages
      .map(file => path.join(rootDir, "data/cities", file))
      .filter(file => fs.existsSync(file));
  }

  if (inputFiles.length === 0) {
    throw new CatalogBuilderError("NO_INPUT_PACKAGES", "Keine Paketdateien für den Katalog gefunden.");
  }

  const entries = [];
  const seenIds = new Set();

  for (const filePath of inputFiles) {
    const entry = processPackageFile(filePath, catalogOutputFile, options);

    // Eindeutigkeit der Dataset-ID erzwingen
    if (seenIds.has(entry.id)) {
      throw new CatalogBuilderError(
        "DUPLICATE_DATASET_ID",
        `Doppelte Dataset-ID "${entry.id}" im Katalog (Datei: "${filePath}").`,
        { file: filePath }
      );
    }
    seenIds.add(entry.id);
    entries.push(entry);
  }

  // Deterministische Sortierung: country, state, name, id
  entries.sort((a, b) => {
    const countryDiff = (a.country || "").localeCompare(b.country || "", "de");
    if (countryDiff !== 0) return countryDiff;
    const stateDiff = (a.state || "").localeCompare(b.state || "", "de");
    if (stateDiff !== 0) return stateDiff;
    const nameDiff = (a.name || "").localeCompare(b.name || "", "de");
    if (nameDiff !== 0) return nameDiff;
    return (a.id || "").localeCompare(b.id || "", "de");
  });

  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    datasets: entries
  };

  const jsonString = JSON.stringify(catalog, null, 2) + "\n";

  if (!options.dryRun) {
    const outDir = path.dirname(catalogOutputFile);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(catalogOutputFile, jsonString, "utf8");
  }

  return {
    catalog,
    catalogOutputFile,
    jsonString,
    count: entries.length
  };
}

// CLI Execution
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--output" && args[i + 1]) {
        options.output = args[++i];
      } else if (args[i] === "--input" && args[i + 1]) {
        options.input = args[++i];
      } else if (args[i] === "--dry-run") {
        options.dryRun = true;
      }
    }
    const result = buildCatalog(options);
    console.log(`✓ Katalog erfolgreich erzeugt: ${result.catalogOutputFile} (${result.count} Datensätze)`);
  } catch (error) {
    console.error(`✗ Fehler bei der Katalogerstellung [${error.code || "UNKNOWN"}]: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  SCHEMA_VERSION,
  CatalogBuilderError,
  assertSafeRelativePath,
  extractCatalogEntry,
  processPackageFile,
  buildCatalog
};
