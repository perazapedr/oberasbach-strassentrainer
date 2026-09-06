"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const validator = require("../../city-data-validator.js");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_SOURCE_DIR = path.join(ROOT, "data/cities");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "dist/dataset-repository");
const CATALOG_SCHEMA_PATH = path.join(ROOT, "schemas/strassentrainer-catalog.schema.json");

class PublisherError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PublisherError";
    this.code = code;
    this.details = details;
  }
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assertSafeDatasetId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-_.]*$/.test(id)) {
    throw new PublisherError("INVALID_DATASET_ID", `Ungültige Dataset-ID für Publishing-Repository: "${id}".`);
  }
  return id;
}

function assertPathInsideDir(baseDir, targetPath) {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PublisherError("PATH_TRAVERSAL_DETECTED", `Pfad bricht aus Zielverzeichnis aus: "${targetPath}" relativ zu "${baseDir}".`);
  }
}

function loadAndValidatePackage(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new PublisherError("FILE_NOT_FOUND", `Datensatz-Datei nicht gefunden: ${filePath}`, { filePath });
  }

  const rawBuffer = fs.readFileSync(filePath);
  let parsed = null;
  try {
    parsed = JSON.parse(rawBuffer.toString("utf8"));
  } catch (err) {
    throw new PublisherError("INVALID_JSON", `Ungültiges JSON in ${filePath}: ${err.message}`, { filePath, cause: err });
  }

  const pkgCheck = validator.validateCityPackage(parsed);
  if (!pkgCheck.valid) {
    throw new PublisherError("PACKAGE_VALIDATION_FAILED", `Package-Validierung fehlgeschlagen für ${filePath}`, {
      filePath,
      errors: pkgCheck.validation?.package?.errors || []
    });
  }

  const cityCheck = validator.validateCityData(parsed);
  if (!cityCheck.valid) {
    throw new PublisherError("CITY_VALIDATION_FAILED", `City-Validierung fehlgeschlagen für ${filePath}`, {
      filePath,
      errors: cityCheck.validation?.package?.errors || []
    });
  }

  const hashResult = validator.verifyPackageHash(parsed);
  if (!hashResult.valid) {
    throw new PublisherError("HASH_VERIFICATION_FAILED", `Hash-Prüfung fehlgeschlagen für ${filePath}`, {
      filePath,
      expected: hashResult.expected,
      actual: hashResult.actual
    });
  }

  return {
    rawBuffer,
    parsed,
    filePath
  };
}

function buildCatalogEntry(datasetId, parsedPackage, rawBuffer, gzBuffer, brBuffer) {
  const pkg = parsedPackage.package || {};
  const city = parsedPackage.city || {};

  let datasetKind = "municipality";
  if (pkg.datasetKind && pkg.datasetKind !== "curated") {
    datasetKind = String(pkg.datasetKind).trim();
  }

  const cityId = String(city.id || "").trim();
  let osmType = city.osmType ? String(city.osmType).trim() : (cityId.startsWith("osm-relation-") ? "relation" : undefined);
  let osmRelationId = undefined;
  if (Number.isSafeInteger(city.osmId)) {
    osmRelationId = city.osmId;
  } else if (cityId.startsWith("osm-relation-")) {
    const parsedId = Number(cityId.replace("osm-relation-", ""));
    if (Number.isSafeInteger(parsedId)) osmRelationId = parsedId;
  }

  const relativePackagePath = `datasets/${datasetId}/package.json`;
  const relativeManifestPath = `datasets/${datasetId}/manifest.json`;

  const entry = {
    id: datasetId,
    name: String(city.name || "").trim(),
    displayName: String(city.displayName || city.name || "").trim(),
    datasetKind,
    state: String(city.state || "").trim(),
    district: city.district ? String(city.district).trim() : null,
    country: String(city.country || "Deutschland").trim(),
    postalCodes: Array.isArray(city.postalCodes) ? city.postalCodes.map(String) : [],
    cityId,
    osmType,
    osmRelationId,
    packageType: pkg.type ? String(pkg.type).trim() : undefined,
    version: String(pkg.version || "").trim(),
    contentHash: String(pkg.contentHash || "").trim(),
    streetCount: Number.isInteger(city.streetCount) ? city.streetCount : (parsedPackage.streets || []).length,
    poiCount: Number.isInteger(city.poiCount) ? city.poiCount : (parsedPackage.pois || []).length,
    areaCount: Number.isInteger(city.areaCount) ? city.areaCount : (parsedPackage.areas || []).length,
    center: {
      lat: Number(city.center?.lat || 0),
      lon: Number(city.center?.lon || 0)
    },
    bounds: {
      south: Number(city.bounds?.south || 0),
      west: Number(city.bounds?.west || 0),
      north: Number(city.bounds?.north || 0),
      east: Number(city.bounds?.east || 0)
    },
    downloadPath: relativePackagePath,
    packageUrl: relativePackagePath,
    manifestUrl: relativeManifestPath,
    fileSize: rawBuffer.length,
    sizeBytes: rawBuffer.length,
    gzipSizeBytes: gzBuffer ? gzBuffer.length : undefined,
    brotliSizeBytes: brBuffer ? brBuffer.length : undefined,
    title: city.title ? String(city.title).trim() : `${city.displayName || city.name} – Trainingsdatensatz`,
    source: pkg.source || (pkg.type === "curated" ? "curated" : "osm-pbf")
  };

  // Remove undefined fields
  Object.keys(entry).forEach(k => {
    if (entry[k] === undefined) delete entry[k];
  });

  return entry;
}

function buildManifest(datasetId, parsedPackage, rawBuffer, gzBuffer, brBuffer, publishedAt) {
  const pkg = parsedPackage.package || {};
  const city = parsedPackage.city || {};

  const files = {
    package: {
      path: "package.json",
      sizeBytes: rawBuffer.length,
      sha256: sha256Buffer(rawBuffer)
    }
  };

  if (gzBuffer) {
    files.gzip = {
      path: "package.json.gz",
      sizeBytes: gzBuffer.length,
      sha256: sha256Buffer(gzBuffer)
    };
  }

  if (brBuffer) {
    files.brotli = {
      path: "package.json.br",
      sizeBytes: brBuffer.length,
      sha256: sha256Buffer(brBuffer)
    };
  }

  return {
    schemaVersion: 1,
    datasetId,
    name: String(city.name || ""),
    displayName: String(city.displayName || city.name || ""),
    version: String(pkg.version || ""),
    contentHash: String(pkg.contentHash || ""),
    publishedAt,
    counts: {
      streetCount: Number.isInteger(city.streetCount) ? city.streetCount : (parsedPackage.streets || []).length,
      poiCount: Number.isInteger(city.poiCount) ? city.poiCount : (parsedPackage.pois || []).length,
      areaCount: Number.isInteger(city.areaCount) ? city.areaCount : (parsedPackage.areas || []).length
    },
    files
  };
}

async function publishRepository(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || DEFAULT_SOURCE_DIR);
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR);
  const includes = (options.includes || []).map(p => path.resolve(p));
  const precompress = options.precompress !== false;
  const dryRun = Boolean(options.dryRun);
  const runId = `${Date.now()}-${process.pid}`;

  console.log(`\n=== Straßentrainer Dataset Publisher (Phase 16.2) ===`);
  console.log(`Source: ${sourceDir}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Precompress (.gz/.br): ${precompress}`);
  console.log(`Dry Run: ${dryRun}`);

  // 1. Sammle alle Quell-Dateien
  const filesToProcess = new Map();

  if (fs.existsSync(sourceDir)) {
    const entries = fs.readdirSync(sourceDir);
    for (const entry of entries) {
      if (entry.endsWith(".json") && !entry.startsWith(".")) {
        const full = path.join(sourceDir, entry);
        if (fs.statSync(full).isFile()) {
          const id = path.basename(entry, ".json");
          filesToProcess.set(id, full);
          try {
            const raw = fs.readFileSync(full, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && parsed.package && parsed.city) {
              const id = parsed.package.id || path.basename(entry, ".json");
              filesToProcess.set(id, full);
            } else {
              console.log(`  [Info] Überspringe Nicht-Paket-Datei in Quellverzeichnis: ${entry}`);
            }
          } catch (_) {}
        }
      }
    }
  }

  // Zirndorf (aus fixtures) automatisch aufnehmen, falls im Standard-Modus vorhanden
  const defaultZirndorfPath = path.join(ROOT, "tests/fixtures/de-by-zirndorf.json");
  if (!options.sourceDir && fs.existsSync(defaultZirndorfPath) && !filesToProcess.has("de-by-zirndorf")) {
    filesToProcess.set("de-by-zirndorf", defaultZirndorfPath);
  }

  for (const inc of includes) {
    if (fs.existsSync(inc)) {
      const id = path.basename(inc, ".json");
      filesToProcess.set(id, inc);
      try {
        const raw = fs.readFileSync(inc, "utf8");
        const parsed = JSON.parse(raw);
        const id = parsed.package?.id || path.basename(inc, ".json");
        filesToProcess.set(id, inc);
      } catch (err) {
        throw new PublisherError("INVALID_JSON", `Einzuschließende Datei ungültig: ${inc}`);
      }
    } else {
      throw new PublisherError("INCLUDE_NOT_FOUND", `Einzuschließende Datei nicht gefunden: ${inc}`);
    }
  }

  if (filesToProcess.size === 0) {
    throw new PublisherError("NO_DATASETS_FOUND", `Keine Datensätze in ${sourceDir} gefunden.`);
  }

  console.log(`\nVerifiziere ${filesToProcess.size} Datensätze vor Veröffentlichung:`);

  // 2. Validiere alle Datensätze vorab (Quality Gate)
  const loadedDatasets = [];
  for (const [id, filePath] of filesToProcess.entries()) {
    assertSafeDatasetId(id);
    process.stdout.write(`  - [QA Check] ${id} (${path.basename(filePath)}) ... `);
    const loaded = loadAndValidatePackage(filePath);
    console.log(`PASS (${(loaded.rawBuffer.length / 1024).toFixed(1)} KB)`);
    loadedDatasets.push({ id, ...loaded });
  }

  // Sortierung: Oberasbach (Golden Master) immer an erster Stelle, danach alphabetisch
  loadedDatasets.sort((a, b) => {
    if (a.id === "oberasbach") return -1;
    if (b.id === "oberasbach") return 1;
    const isA = a.id === "oberasbach" || a.id === "de-oberasbach-fire-training";
    const isB = b.id === "oberasbach" || b.id === "de-oberasbach-fire-training";
    if (isA && !isB) return -1;
    if (!isA && isB) return 1;
    return a.id.localeCompare(b.id, "de");
  });

  if (dryRun) {
    console.log(`\n[Dry Run] Alle ${loadedDatasets.length} Datensätze sind valide. Abbruch ohne Dateisystem-Änderung.`);
    return {
      status: "DRY_RUN_PASS",
      datasetCount: loadedDatasets.length,
      datasets: loadedDatasets.map(d => d.id)
    };
  }

  // 3. Staging Verzeichnis anlegen
  const parentOutputDir = path.dirname(outputDir);
  fs.mkdirSync(parentOutputDir, { recursive: true });
  const stagingDir = path.join(parentOutputDir, `.tmp-dataset-repository-${runId}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  const publishedAt = new Date().toISOString();
  const catalogDatasets = [];

  try {
    const datasetsStagingDir = path.join(stagingDir, "datasets");
    fs.mkdirSync(datasetsStagingDir, { recursive: true });

    for (const ds of loadedDatasets) {
      const targetDatasetDir = path.join(datasetsStagingDir, ds.id);
      assertPathInsideDir(stagingDir, targetDatasetDir);
      fs.mkdirSync(targetDatasetDir, { recursive: true });

      // A. Write package.json (formatiertes, kanonisches JSON)
      const canonicalJson = JSON.stringify(ds.parsed, null, 2) + "\n";
      const packageBuffer = Buffer.from(canonicalJson, "utf8");
      const packageFile = path.join(targetDatasetDir, "package.json");
      fs.writeFileSync(packageFile, packageBuffer);

      // B. Precompression (.gz und .br)
      let gzBuffer = null;
      let brBuffer = null;
      if (precompress) {
        gzBuffer = zlib.gzipSync(packageBuffer, { level: 9 });
        fs.writeFileSync(path.join(targetDatasetDir, "package.json.gz"), gzBuffer);

        brBuffer = zlib.brotliCompressSync(packageBuffer, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
        });
        fs.writeFileSync(path.join(targetDatasetDir, "package.json.br"), brBuffer);
      }

      // C. Write manifest.json
      const manifest = buildManifest(ds.id, ds.parsed, packageBuffer, gzBuffer, brBuffer, publishedAt);
      const manifestFile = path.join(targetDatasetDir, "manifest.json");
      fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");

      // D. Collect catalog entry
      const catEntry = buildCatalogEntry(ds.id, ds.parsed, packageBuffer, gzBuffer, brBuffer);
      catalogDatasets.push(catEntry);
    }

    // 4. Generate catalog.json
    const catalog = {
      schemaVersion: 1,
      generatedAt: publishedAt,
      datasets: catalogDatasets
    };

    const catalogFile = path.join(stagingDir, "catalog.json");
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + "\n", "utf8");

    // 5. Atomic Promotion (Staging -> Output)
    console.log(`\nPromotiere Staging nach Zielverzeichnis: ${outputDir}`);
    const backupDir = path.join(parentOutputDir, `.tmp-backup-dataset-repository-${runId}`);

    if (fs.existsSync(outputDir)) {
      // Vorhandenes Output-Verzeichnis sichern
      fs.renameSync(outputDir, backupDir);
    }

    try {
      fs.renameSync(stagingDir, outputDir);
      // Wenn erfolgreich, Backup löschen
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (swapErr) {
      // Rollback bei Rename-Fehler
      console.error(`Fehler bei Verzeichnis-Tausch, führe Rollback durch:`, swapErr);
      if (fs.existsSync(backupDir)) {
        if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
        fs.renameSync(backupDir, outputDir);
      }
      throw swapErr;
    }

    console.log(`\n✓ Dataset Repository erfolgreich veröffentlicht:`);
    console.log(`  Katalog: ${path.join(outputDir, "catalog.json")}`);
    console.log(`  Datensätze: ${catalogDatasets.length} (${catalogDatasets.map(d => d.id).join(", ")})`);

    return {
      status: "PUBLISHED",
      outputDir,
      catalogFile: path.join(outputDir, "catalog.json"),
      datasetCount: catalogDatasets.length,
      datasets: catalogDatasets
    };
  } catch (err) {
    // Bereinigung des Staging-Verzeichnisses bei Fehler
    if (fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch (_) {}
    }
    throw err;
  }
}

function parseCliArgs(args) {
  const options = {
    includes: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source" && i + 1 < args.length) {
      options.sourceDir = args[++i];
    } else if (arg === "--output" && i + 1 < args.length) {
      options.outputDir = args[++i];
    } else if (arg === "--include" && i + 1 < args.length) {
      options.includes.push(args[++i]);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-compress") {
      options.precompress = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Straßentrainer Dataset Publisher CLI
Verwendung: node tools/dataset-publisher/index.js [Optionen]

Optionen:
  --source <dir>      Quellverzeichnis mit Datenpaketen (Standard: data/cities)
  --output <dir>      Zielverzeichnis des Repositorys (Standard: dist/dataset-repository)
  --include <file>    Zusätzliches Datenpaket zur Veröffentlichung einbinden (mehrfach erlaubt)
  --dry-run           Führt nur Validierung und Staging durch, ohne Ziel zu verändern
  --no-compress       Überspringt .gz- und .br-Kompression (schneller für Tests)
  --help, -h          Zeigt diese Hilfe an
`);
      process.exit(0);
    }
  }

  return options;
}

if (require.main === module) {
  const options = parseCliArgs(process.argv.slice(2));
  publishRepository(options)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n❌ Publisher-Fehler:", err.message);
      if (err.details) console.error("Details:", JSON.stringify(err.details, null, 2));
      process.exit(1);
    });
}

module.exports = {
  PublisherError,
  publishRepository,
  loadAndValidatePackage,
  buildCatalogEntry,
  buildManifest,
  assertSafeDatasetId,
  assertPathInsideDir
};
