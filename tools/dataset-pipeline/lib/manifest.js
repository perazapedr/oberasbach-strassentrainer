"use strict";

const fs = require("node:fs");
const path = require("node:path");

class ManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManifestError";
    this.code = code;
  }
}

class RegionConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RegionConfigError";
    this.code = code;
  }
}

function loadRegions(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new RegionConfigError("REGIONS_CONFIG_NOT_FOUND", `Regionen-Konfiguration nicht gefunden: ${resolved}`);
  }

  let content;
  try {
    content = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new RegionConfigError("REGIONS_INVALID_JSON", `Regionen-Konfiguration enthält ungültiges JSON: ${error.message}`);
  }

  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new RegionConfigError("REGIONS_INVALID_STRUCTURE", "Regionen-Konfiguration muss ein Objekt sein.");
  }

  if (content.schemaVersion !== 1) {
    throw new RegionConfigError("REGIONS_UNSUPPORTED_SCHEMA", `Nicht unterstützte schemaVersion: ${content.schemaVersion}`);
  }

  if (!content.regions || typeof content.regions !== "object" || Array.isArray(content.regions)) {
    throw new RegionConfigError("REGIONS_EMPTY_OR_INVALID", "Regionen-Konfiguration muss ein 'regions'-Objekt enthalten.");
  }

  const validatedRegions = {};
  for (const [key, reg] of Object.entries(content.regions)) {
    if (!reg || typeof reg !== "object") {
      throw new RegionConfigError("REGION_INVALID_ENTRY", `Ungültiger Eintrag für Region "${key}".`);
    }

    const regionId = String(reg.regionId || key).trim();
    if (!regionId || regionId !== key) {
      throw new RegionConfigError("REGION_KEY_MISMATCH", `Region-Schlüssel "${key}" stimmt nicht mit regionId "${reg.regionId}" überein.`);
    }

    const country = String(reg.country || "").trim();
    if (!country) {
      throw new RegionConfigError("REGION_MISSING_COUNTRY", `Region "${regionId}" hat kein Land (country).`);
    }

    const state = String(reg.state || "").trim();
    if (!state) {
      throw new RegionConfigError("REGION_MISSING_STATE", `Region "${regionId}" hat kein Bundesland (state).`);
    }

    const stateCode = String(reg.stateCode || "").trim().toUpperCase();
    if (!stateCode || !/^[A-Z]{2}$/.test(stateCode)) {
      throw new RegionConfigError("REGION_INVALID_STATE_CODE", `Region "${regionId}" hat ungültigen stateCode "${reg.stateCode}".`);
    }

    validatedRegions[regionId] = {
      regionId,
      country,
      state,
      stateCode
    };
  }

  return {
    schemaVersion: content.schemaVersion,
    regions: validatedRegions
  };
}

function loadManifest(filePath, regionsConfig = null) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new ManifestError("MANIFEST_NOT_FOUND", `Manifest-Datei nicht gefunden: ${resolved}`);
  }

  let content;
  try {
    content = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new ManifestError("MANIFEST_INVALID_JSON", `Manifest enthält ungültiges JSON: ${error.message}`);
  }

  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new ManifestError("MANIFEST_INVALID_STRUCTURE", "Manifest muss ein JSON-Objekt sein.");
  }

  if (content.schemaVersion !== 1) {
    throw new ManifestError("MANIFEST_UNSUPPORTED_SCHEMA", `Nicht unterstützte schemaVersion: ${content.schemaVersion}`);
  }

  if (!content.regionId || typeof content.regionId !== "string" || !content.regionId.trim()) {
    throw new ManifestError("MANIFEST_MISSING_REGION", "Manifest benötigt eine gültige 'regionId'.");
  }

  const regionId = content.regionId.trim();
  if (regionsConfig && regionsConfig.regions && !regionsConfig.regions[regionId]) {
    throw new ManifestError("UNKNOWN_REGION", `Manifest referenziert unbekannte Region "${regionId}".`);
  }

  if (!Array.isArray(content.datasets) || content.datasets.length === 0) {
    throw new ManifestError("MANIFEST_EMPTY_DATASETS", "Manifest muss mindestens einen Datensatz enthalten.");
  }

  const seenDatasetIds = new Set();
  const seenRelationIds = new Set();
  const validatedDatasets = [];

  for (const ds of content.datasets) {
    if (!ds || typeof ds !== "object") {
      throw new ManifestError("MANIFEST_INVALID_ENTRY", "Datensatz-Eintrag muss ein Objekt sein.");
    }

    const datasetId = String(ds.datasetId || "").trim();
    if (!datasetId || !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(datasetId)) {
      throw new ManifestError("MANIFEST_INVALID_DATASET_ID", `Ungültige datasetId: "${datasetId}".`);
    }

    if (seenDatasetIds.has(datasetId)) {
      throw new ManifestError("MANIFEST_DUPLICATE_DATASET_ID", `Doppelte datasetId im Manifest: "${datasetId}".`);
    }
    seenDatasetIds.add(datasetId);

    const name = String(ds.name || "").trim();
    if (!name) {
      throw new ManifestError("MANIFEST_MISSING_NAME", `Datensatz "${datasetId}" hat keinen Namen.`);
    }

    // Oberasbach-Schutzregel: Oberasbach darf niemals als PBF-Target konfiguriert werden
    if (name.toLowerCase() === "oberasbach" || datasetId.includes("oberasbach")) {
      throw new ManifestError(
        "OBERASBACH_PROTECTED",
        `Oberasbach ist ein geschütztes Curated-Golden-Dataset und darf nicht im Manifest als PBF-Build-Target definiert werden.`
      );
    }

    const relationId = Number(ds.relationId);
    if (!Number.isSafeInteger(relationId) || relationId <= 0) {
      throw new ManifestError("MANIFEST_INVALID_RELATION_ID", `Datensatz "${datasetId}" hat ungültige relationId: ${ds.relationId}`);
    }

    if (seenRelationIds.has(relationId)) {
      throw new ManifestError("MANIFEST_DUPLICATE_RELATION_ID", `Doppelte relationId im Manifest: ${relationId}`);
    }
    seenRelationIds.add(relationId);

    const adminLevel = ds.adminLevel !== undefined ? Number(ds.adminLevel) : 8;
    if (!Number.isSafeInteger(adminLevel) || adminLevel <= 0) {
      throw new ManifestError("MANIFEST_INVALID_ADMIN_LEVEL", `Datensatz "${datasetId}" hat ungültiges adminLevel: ${ds.adminLevel}`);
    }

    const targetType = String(ds.targetType || "municipality").trim();
    if (!["municipality", "district"].includes(targetType)) {
      throw new ManifestError("MANIFEST_INVALID_TARGET_TYPE", `Datensatz "${datasetId}" hat ungültigen targetType: ${ds.targetType}`);
    }

    const version = ds.version === undefined ? null : String(ds.version).trim();
    if (ds.version !== undefined && !version) {
      throw new ManifestError("MANIFEST_INVALID_VERSION", `Datensatz "${datasetId}" hat eine leere version.`);
    }

    validatedDatasets.push({
      datasetId,
      name,
      relationId,
      adminLevel,
      targetType,
      ...(version ? { version } : {}),
      enabled: ds.enabled !== false
    });
  }

  return {
    schemaVersion: content.schemaVersion,
    regionId: content.regionId.trim(),
    description: content.description || "",
    datasets: validatedDatasets
  };
}

function filterTargets(manifest, options = {}) {
  const { all = false, dataset = null } = options;

  if (dataset) {
    const singleId = String(dataset).trim();
    if (singleId.toLowerCase().includes("oberasbach")) {
      throw new ManifestError("OBERASBACH_PROTECTED", "Oberasbach ist ein geschütztes Curated-Golden-Dataset.");
    }
    const match = manifest.datasets.find(ds => ds.datasetId === singleId);
    if (!match) {
      throw new ManifestError("DATASET_NOT_FOUND", `Datensatz "${singleId}" wurde nicht im Manifest gefunden.`);
    }
    return [match];
  }

  if (all) {
    const enabled = manifest.datasets.filter(ds => ds.enabled);
    if (enabled.length === 0) {
      throw new ManifestError("NO_TARGETS_ENABLED", "Keine aktiven Datensätze im Manifest vorhanden.");
    }
    return enabled;
  }

  throw new ManifestError("NO_TARGET_SPECIFIED", "Weder --all noch --dataset angegeben.");
}

module.exports = {
  ManifestError,
  RegionConfigError,
  loadRegions,
  loadManifest,
  filterTargets
};
