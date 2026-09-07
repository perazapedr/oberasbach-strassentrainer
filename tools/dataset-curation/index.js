#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const validator = require("../../city-data-validator.js");
const areaApi = require("../../custom-training-area.js");

const OVERLAY_SCHEMA_VERSION = 1;
const COMPOSER_VERSION = "1.0.0";
const OP_TYPES = new Set([
  "street.rename", "street.alias.add", "street.disable",
  "poi.add", "poi.edit", "poi.remove", "poi.category",
  "area.response.add", "area.response.edit", "area.response.remove"
]);

class CurationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CurationError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value || "").trim();
}

function fail(code, message, details) {
  throw new CurationError(code, message, details);
}

function validateOverlay(overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) fail("CURATION_SCHEMA_INVALID", "Das Curation Overlay ist kein Objekt.");
  if (overlay.schemaVersion !== OVERLAY_SCHEMA_VERSION) fail("CURATION_SCHEMA_INVALID", "Nicht unterstützte Overlay-Schemaversion.");
  for (const field of ["datasetId", "baseDatasetId", "baseVersion", "baseContentHash", "curatedVersion"]) {
    if (!text(overlay[field])) fail("CURATION_SCHEMA_INVALID", `Pflichtfeld ${field} fehlt.`);
  }
  if (!validator.parseSemver(overlay.curatedVersion)) fail("CURATION_SCHEMA_INVALID", "curatedVersion muss SemVer/CalVer entsprechen.");
  if (!/^sha256:[0-9a-f]{64}$/i.test(text(overlay.baseContentHash))) fail("CURATION_SCHEMA_INVALID", "baseContentHash muss ein SHA-256-Hash sein.");
  if (!Array.isArray(overlay.changes)) fail("CURATION_SCHEMA_INVALID", "changes muss ein Array sein.");
  overlay.changes.forEach((change, index) => {
    if (!change || typeof change !== "object" || !OP_TYPES.has(change.op)) {
      fail("CURATION_SCHEMA_INVALID", `Operation an Index ${index} ist ungültig.`);
    }
  });
  return overlay;
}

function assertPinnedBase(base, overlay) {
  const packageMeta = base?.package || {};
  if (text(packageMeta.id) !== text(overlay.baseDatasetId) || text(overlay.datasetId) !== text(overlay.baseDatasetId)) {
    fail("CURATION_BASE_ID_MISMATCH", "Overlay und Base-Dataset-ID stimmen nicht exakt überein.");
  }
  if (text(packageMeta.version) !== text(overlay.baseVersion)) {
    fail("CURATION_BASE_VERSION_MISMATCH", "Overlay und Base-Version stimmen nicht exakt überein.");
  }
  if (text(packageMeta.contentHash).toLowerCase() !== text(overlay.baseContentHash).toLowerCase()) {
    fail("CURATION_BASE_HASH_MISMATCH", "Overlay und Base-contentHash stimmen nicht exakt überein.");
  }
  const hashCheck = validator.verifyPackageHash(base);
  if (!hashCheck.valid) fail("CURATION_BASE_HASH_INVALID", "Der Base-contentHash ist nicht verifizierbar.", hashCheck);
}

function operationTarget(change) {
  if (change.op.startsWith("street.")) return { collection: "streets", id: text(change.streetId || change.targetId) };
  if (change.op.startsWith("poi.")) return { collection: "pois", id: text(change.poiId || change.targetId || change.value?.id) };
  return { collection: "areas", id: text(change.areaId || change.targetId || change.value?.id) };
}

function conflictKey(change) {
  const target = operationTarget(change);
  if (change.op === "street.alias.add") return `${target.collection}:${target.id}:alias:${text(change.alias)}`;
  if (change.op.endsWith(".remove") || change.op.endsWith(".disable")) return `${target.collection}:${target.id}:lifecycle`;
  if (change.op === "street.rename") return `${target.collection}:${target.id}:name`;
  if (change.op === "poi.category") return `${target.collection}:${target.id}:category`;
  if (change.op === "poi.edit" || change.op === "area.response.edit") {
    return Object.keys(change.patch || {}).sort().map(field => `${target.collection}:${target.id}:${field}`).join("|");
  }
  return `${change.op}:${target.id}`;
}

function assertNoConflicts(changes) {
  const seen = new Map();
  for (const change of changes) {
    const target = operationTarget(change);
    const lifecycleKey = `${target.collection}:${target.id}:lifecycle`;
    const key = conflictKey(change);
    const signature = JSON.stringify(change);
    if ((seen.has(key) && seen.get(key) !== signature)
      || (!change.op.endsWith(".remove") && !change.op.endsWith(".disable") && seen.has(lifecycleKey))) {
      fail("CURATION_CONFLICT", `Widersprüchliche Curation für ${target.id || "unbekanntes Ziel"}.`, { change });
    }
    if (change.op.endsWith(".remove") || change.op.endsWith(".disable")) {
      const prefix = `${target.collection}:${target.id}:`;
      if ([...seen.keys()].some(existing => existing.startsWith(prefix) && existing !== lifecycleKey)) {
        fail("CURATION_CONFLICT", `Lifecycle-Operation kollidiert mit einer Änderung an ${target.id}.`, { change });
      }
    }
    seen.set(key, signature);
  }
}

function requireTarget(items, id, kind) {
  const target = items.find(item => item && item.id === id);
  if (!target) fail("CURATION_TARGET_MISSING", `${kind}-Ziel "${id}" existiert im Base-Paket nicht.`, { kind, id });
  return target;
}

function replaceTarget(items, id, replacement) {
  const index = items.findIndex(item => item.id === id);
  items[index] = replacement;
}

  function validatePoiValue(poi, cityId) {
    const candidate = { ...clone(poi), cityId };
    if (!text(candidate.id) || !text(candidate.name) || !text(candidate.category)
    || !candidate.position || !Number.isFinite(Number(candidate.position.lat)) || !Number.isFinite(Number(candidate.position.lon))) {
    fail("CURATION_SCHEMA_INVALID", "POI add/edit enthält keine vollständigen stabilen Felder.");
  }
  return candidate;
}

function responseAreaFromChange(change, base, existingAreas, previous = null) {
  const value = previous ? { ...previous, ...(change.patch || {}) } : clone(change.value || {});
  const id = text(value.id || change.areaId || change.targetId);
  return areaApi.createArea({
    id,
    cityId: base.city.id,
    name: value.name,
    kind: "response_area",
    geometry: value.geometry || value.boundary,
    cityBoundary: base.boundary || base.city.boundary,
    existingAreas: existingAreas.filter(area => area.id !== id),
    source: "curated",
    parentId: value.parentId,
    provenance: value.provenance || { source: "curation", label: "curated response area" },
    now: value.updatedAt || base.package.updatedAt || base.package.createdAt
  });
}

function applyChange(result, change, report) {
  const target = operationTarget(change);
  if (change.op === "street.rename") {
    const street = requireTarget(result.streets, target.id, "Street");
    const name = text(change.name);
    if (!name) fail("CURATION_SCHEMA_INVALID", "Street rename benötigt einen Namen.");
    street.name = name;
  } else if (change.op === "street.alias.add") {
    const street = requireTarget(result.streets, target.id, "Street");
    const alias = text(change.alias);
    if (!alias) fail("CURATION_SCHEMA_INVALID", "Street alias add benötigt einen Alias.");
    street.aliases = [...new Set([...(street.aliases || []), alias])].sort((a, b) => a.localeCompare(b, "de"));
  } else if (change.op === "street.disable") {
    const street = requireTarget(result.streets, target.id, "Street");
    street.active = false;
    street.quizEligible = false;
  } else if (change.op === "poi.add") {
    const poi = validatePoiValue(change.value, result.city.id);
    if (result.pois.some(item => item.id === poi.id)) fail("CURATION_CONFLICT", `POI "${poi.id}" existiert bereits.`);
    result.pois.push(poi);
  } else if (change.op === "poi.edit" || change.op === "poi.category") {
    const poi = requireTarget(result.pois, target.id, "POI");
    const patch = change.op === "poi.category" ? { category: text(change.category) } : clone(change.patch || {});
    const allowed = new Set(["name", "category", "position", "geometry"]);
    if (Object.keys(patch).some(field => !allowed.has(field))) fail("CURATION_SCHEMA_INVALID", "POI edit enthält ein nicht unterstütztes Feld.");
    replaceTarget(result.pois, target.id, validatePoiValue({ ...poi, ...patch, id: poi.id }, result.city.id));
  } else if (change.op === "poi.remove") {
    requireTarget(result.pois, target.id, "POI");
    result.pois = result.pois.filter(item => item.id !== target.id);
  } else if (change.op === "area.response.add") {
    if (result.areas.some(item => item.id === target.id)) fail("CURATION_CONFLICT", `Area "${target.id}" existiert bereits.`);
    result.areas.push(responseAreaFromChange(change, result, result.areas));
  } else if (change.op === "area.response.edit") {
    const previous = requireTarget(result.areas, target.id, "Area");
    if (!areaApi.isResponseArea(previous)) fail("CURATION_CONFLICT", "Nur Response Areas dürfen als Response Area editiert werden.");
    replaceTarget(result.areas, target.id, responseAreaFromChange(change, result, result.areas, previous));
  } else if (change.op === "area.response.remove") {
    const previous = requireTarget(result.areas, target.id, "Area");
    if (!areaApi.isResponseArea(previous)) fail("CURATION_CONFLICT", "Nur Response Areas dürfen über diese Operation entfernt werden.");
    result.areas = result.areas.filter(item => item.id !== target.id);
  }
  report.applied.push({ op: change.op, targetId: target.id });
}

function recalculateResponseMembership(result) {
  const responseAreas = result.areas.filter(areaApi.isResponseArea);
  const responseIds = new Set(responseAreas.map(area => area.id));
  for (const street of result.streets) street.areaIds = (street.areaIds || []).filter(id => !responseIds.has(id));
  for (const poi of result.pois) poi.areaIds = (poi.areaIds || []).filter(id => !responseIds.has(id));
  for (const area of responseAreas) {
    const membership = areaApi.computeMembership(result.city.id, area, result.streets, result.pois, { force: true });
    for (const street of membership.streetTargets) street.areaIds = [...new Set([...(street.areaIds || []), area.id])].sort();
    for (const poi of membership.poiTargets) poi.areaIds = [...new Set([...(poi.areaIds || []), area.id])].sort();
    area.streetCount = membership.streetTargets.length;
    area.poiCount = membership.poiTargets.length;
  }
}

function composeCuratedPackage(baseInput, overlayInput) {
  const base = clone(baseInput);
  const overlay = validateOverlay(clone(overlayInput));
  assertPinnedBase(base, overlay);
  assertNoConflicts(overlay.changes);
  const result = clone(base);
  result.areas = Array.isArray(result.areas) ? result.areas : [];
  const report = { applied: [], unchanged: [], upstreamChanged: [], targetMissing: [], conflicts: [], reviewRequired: [] };
  for (const change of overlay.changes) applyChange(result, change, report);
  result.streets.sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true }));
  result.pois.sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true }));
  result.areas.sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true }));
  recalculateResponseMembership(result);
  result.city.streetCount = result.streets.length;
  result.city.poiCount = result.pois.length;
  result.city.areaCount = result.areas.length;
  result.city.hasAreas = result.areas.length > 0;
  const deterministicTime = text(overlay.curatedAt || base.package.updatedAt || base.package.createdAt || base.exportedAt);
  result.exportedAt = deterministicTime;
  result.package = {
    ...result.package,
    id: overlay.datasetId,
    type: "curated",
    datasetKind: base.package.datasetKind || "municipality",
    version: overlay.curatedVersion,
    title: text(overlay.title) || `${result.city.displayName || result.city.name} – kuratiertes Feuerwehrpaket`,
    source: "curated",
    updatedAt: deterministicTime,
    verification: { status: "unverified", maintainer: null, verifiedAt: null, note: "Integritätsgeprüft; keine kryptografische Publisher-Signatur" }
  };
  result.provenance = {
    source: "curated-composition",
    baseDataset: { id: base.package.id, version: base.package.version, contentHash: base.package.contentHash },
    curation: { version: overlay.curatedVersion, composerVersion: COMPOSER_VERSION, sourceLabel: text(overlay.sourceLabel) || null }
  };
  result.package.contentHash = validator.computePackageHash(result);
  const packageCheck = validator.validateCityPackage(result);
  const cityCheck = validator.validateCityData(result);
  const hashCheck = validator.verifyPackageHash(result);
  if (!packageCheck.valid) fail("CURATION_PACKAGE_VALIDATION_FAILED", "Das komponierte Paket verletzt den Package Contract.", packageCheck.validation);
  if (!cityCheck.valid) fail("CURATION_CITY_VALIDATION_FAILED", "Das komponierte Paket verletzt die City QA.", cityCheck.validation);
  if (!hashCheck.valid) fail("CURATION_HASH_INVALID", "Der Hash des komponierten Pakets ist ungültig.", hashCheck);
  return { packageData: result, report };
}

function rebaseOverlay(overlayInput, oldBaseInput, newBaseInput) {
  const overlay = validateOverlay(clone(overlayInput));
  const oldBase = clone(oldBaseInput);
  const newBase = clone(newBaseInput);
  assertPinnedBase(oldBase, overlay);
  assertNoConflicts(overlay.changes);
  const report = { applied: [], unchanged: [], upstreamChanged: [], targetMissing: [], conflicts: [], reviewRequired: [] };
  for (const change of overlay.changes) {
    if (change.op === "poi.add" || change.op === "area.response.add") {
      report.unchanged.push({ op: change.op, targetId: operationTarget(change).id });
      continue;
    }
    const target = operationTarget(change);
    const oldTarget = (oldBase[target.collection] || []).find(item => item.id === target.id);
    const newTarget = (newBase[target.collection] || []).find(item => item.id === target.id);
    if (!newTarget) {
      report.targetMissing.push({ op: change.op, targetId: target.id });
      report.reviewRequired.push({ reason: "target_missing", op: change.op, targetId: target.id });
    } else if (JSON.stringify(oldTarget) !== JSON.stringify(newTarget)) {
      report.upstreamChanged.push({ op: change.op, targetId: target.id });
      report.reviewRequired.push({ reason: "upstream_changed", op: change.op, targetId: target.id });
    } else {
      report.unchanged.push({ op: change.op, targetId: target.id });
    }
  }
  const rebasedOverlay = {
    ...overlay,
    baseDatasetId: newBase.package.id,
    baseVersion: newBase.package.version,
    baseContentHash: newBase.package.contentHash
  };
  return { overlay: rebasedOverlay, report };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function writeJsonAtomic(file, value) {
  const output = path.resolve(file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, output);
}

function cli(argv = process.argv.slice(2)) {
  const command = argv[0];
  const arg = name => argv[argv.indexOf(name) + 1];
  if (command === "compose") {
    const result = composeCuratedPackage(readJson(arg("--base")), readJson(arg("--overlay")));
    writeJsonAtomic(arg("--output"), result.packageData);
    if (arg("--report")) writeJsonAtomic(arg("--report"), result.report);
    return result;
  }
  if (command === "rebase") {
    const result = rebaseOverlay(readJson(arg("--overlay")), readJson(arg("--old-base")), readJson(arg("--new-base")));
    writeJsonAtomic(arg("--output"), result.overlay);
    if (arg("--report")) writeJsonAtomic(arg("--report"), result.report);
    return result;
  }
  fail("CURATION_USAGE", "Usage: compose --base FILE --overlay FILE --output FILE [--report FILE] | rebase --overlay FILE --old-base FILE --new-base FILE --output FILE [--report FILE]");
}

module.exports = {
  OVERLAY_SCHEMA_VERSION,
  COMPOSER_VERSION,
  CurationError,
  validateOverlay,
  assertPinnedBase,
  composeCuratedPackage,
  rebaseOverlay,
  cli
};

if (require.main === module) {
  try {
    cli();
  } catch (error) {
    process.stderr.write(`${error.code || "CURATION_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
