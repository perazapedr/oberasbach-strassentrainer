"use strict";

const fs = require("node:fs");
const path = require("node:path");
const validator = require("../../../city-data-validator.js");
const poiCategories = require("../../../poi-categories.js");
const turf = require("../../../vendor/turf/turf.min.js");

class QaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "QaError";
    this.code = code;
    this.details = details;
  }
}

function loadQaPolicy(policyPath) {
  const resolved = path.resolve(policyPath);
  if (!fs.existsSync(resolved)) {
    throw new QaError("QA_POLICY_NOT_FOUND", `QA-Policy-Datei nicht gefunden: ${resolved}`);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err) {
    throw new QaError("QA_POLICY_INVALID_JSON", `QA-Policy enthält ungültiges JSON: ${err.message}`);
  }
}

function loadPublishedState(statePath) {
  const resolved = path.resolve(statePath);
  if (!fs.existsSync(resolved)) {
    return { schemaVersion: 1, datasets: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err) {
    throw new QaError("PUBLISHED_STATE_INVALID_JSON", `published-state.json enthält ungültiges JSON: ${err.message}`);
  }
}

function computeContainment(candidateGeometry, boundaryGeometry) {
  try {
    const candidateFeature = turf.feature(candidateGeometry);
    const boundaryFeature = turf.feature(boundaryGeometry);
    const candidateArea = turf.area(candidateFeature);
    if (candidateArea <= 0) return { ratioInside: 0, centerInside: false };

    let intersectionArea = 0;
    try {
      const intersection = turf.intersect(turf.featureCollection([candidateFeature, boundaryFeature]));
      if (intersection) {
        intersectionArea = turf.area(intersection);
      }
    } catch (_) {}

    const ratioInside = Number((intersectionArea / candidateArea).toFixed(6));

    let centerInside = false;
    try {
      const centerCoord = turf.center(candidateFeature).geometry.coordinates;
      const centerPoint = turf.point(centerCoord);
      centerInside = turf.booleanPointInPolygon(centerPoint, boundaryFeature, { ignoreBoundary: false });
    } catch (_) {}

    return { ratioInside, centerInside };
  } catch (_) {
    return { ratioInside: 0, centerInside: false };
  }
}

function evaluateCandidatePackage(packageData, buildReport, qaPolicy, publishedState, options = {}) {
  const errors = [];
  const warnings = [];
  const metrics = {
    areaQa: {
      totalAreas: 0,
      minAcceptedRatioInside: 1.0,
      maxRejectedRatioInside: 0.0,
      rejectedReasons: {
        SAME_ADMIN_LEVEL: 0,
        OUTSIDE: 0,
        TOUCHING_BOUNDARY: 0,
        PARTIAL_OVERLAP: 0,
        INVALID_GEOMETRY: 0,
        OTHER: 0
      }
    },
    streetQa: {
      count: 0,
      dropRatio: 0
    },
    poiQa: {
      count: 0,
      dropRatio: 0
    }
  };

  const datasetId = packageData?.package?.id;
  const publishedEntry = publishedState?.datasets?.[datasetId] || null;

  // 1. Hash-Validierung
  const hashCheck = validator.verifyPackageHash(packageData);
  if (!hashCheck.valid) {
    errors.push({
      code: "PACKAGE_HASH_MISMATCH",
      message: `contentHash ungültig. Erwartet: ${hashCheck.expectedHash}, Tatsächlich: ${hashCheck.actualHash}`
    });
  }

  // 2. Package Contract
  const pkgValidation = validator.validateCityPackage(packageData);
  if (!pkgValidation.valid) {
    const issues = ["package", "municipality", "streets", "pois", "areas"].flatMap(
      k => pkgValidation?.validation?.[k]?.errors || []
    );
    for (const issue of issues) {
      errors.push({
        code: issue.code || "PACKAGE_CONTRACT_ERROR",
        message: `Package-Contract Fehler: ${issue.message || issue.code}`
      });
    }
  }

  // 3. City Data Validation
  const rawDataset = {
    city: packageData.city,
    boundary: packageData.boundary,
    streets: packageData.streets,
    pois: packageData.pois,
    areas: packageData.areas
  };
  const cityValidation = validator.validateCityData(rawDataset, { sourceMode: "download", diagnostics: {} });
  if (!cityValidation.valid) {
    const issues = ["municipality", "streets", "pois", "areas"].flatMap(
      k => cityValidation?.validation?.[k]?.errors || []
    );
    for (const issue of issues) {
      errors.push({
        code: issue.code || "CITY_DATA_VALIDATION_ERROR",
        message: `City-Data-Validator Fehler: ${issue.message || issue.code}`
      });
    }
  }

  // 4. Area QA (Phase 15.7a Pflichtgate)
  const municipalityAdminLevel = Number(packageData?.city?.adminLevel || 8);
  const areas = Array.isArray(packageData.areas) ? packageData.areas : [];
  metrics.areaQa.totalAreas = areas.length;

  let minRatio = 1.0;
  for (const area of areas) {
    const areaAdminLevel = Number(area.adminLevel || 0);
    // Hierarchieprüfung: candidate.adminLevel > municipality.adminLevel
    if (areaAdminLevel > 0 && areaAdminLevel <= municipalityAdminLevel) {
      errors.push({
        code: "AREA_HIERARCHY_VIOLATION",
        message: `Area "${area.name}" (${area.id}) hat adminLevel ${areaAdminLevel} <= Gemeinde ${municipalityAdminLevel}.`
      });
    }

    // Geometrische Containment-Prüfung
    const areaGeom = area.polygon || area.geometry;
    const { ratioInside, centerInside } = computeContainment(areaGeom, packageData.boundary);
    if (ratioInside < minRatio) minRatio = ratioInside;

    if (ratioInside < qaPolicy.area.containmentThreshold) {
      errors.push({
        code: "AREA_CONTAINMENT_FAILED",
        message: `Area "${area.name}" (${area.id}) liegt nur zu ${(ratioInside * 100).toFixed(1)}% innerhalb (Schwelle: ${(qaPolicy.area.containmentThreshold * 100)}%).`
      });
    }

    if (!centerInside) {
      errors.push({
        code: "AREA_CENTER_OUTSIDE",
        message: `Zentrum der Area "${area.name}" (${area.id}) liegt außerhalb der Gemeindegrenze.`
      });
    }
  }
  metrics.areaQa.minAcceptedRatioInside = areas.length > 0 ? minRatio : 1.0;

  // Klassifikationsbericht prüfen (aus Build Report falls vorhanden)
  const classReport = buildReport?.areaClassification || buildReport?.counts?.areaClassificationReport || [];
  if (Array.isArray(classReport)) {
    const packageAreaIds = new Set(areas.map(a => a.id));
    let maxRejRatio = 0.0;

    for (const item of classReport) {
      if (item.decision === "rejected") {
        const rejRatio = Number(item.ratioInside || 0);
        if (rejRatio > maxRejRatio) maxRejRatio = rejRatio;

        const reason = String(item.reason || "");
        if (reason.includes("SAME_ADMIN_LEVEL")) metrics.areaQa.rejectedReasons.SAME_ADMIN_LEVEL++;
        else if (reason.includes("OUTSIDE")) metrics.areaQa.rejectedReasons.OUTSIDE++;
        else if (reason.includes("TOUCHING")) metrics.areaQa.rejectedReasons.TOUCHING_BOUNDARY++;
        else if (reason.includes("PARTIAL")) metrics.areaQa.rejectedReasons.PARTIAL_OVERLAP++;
        else if (reason.includes("INVALID")) metrics.areaQa.rejectedReasons.INVALID_GEOMETRY++;
        else metrics.areaQa.rejectedReasons.OTHER++;

        // Darf keine abgewiesene Area im finalen Paket sein
        if (packageAreaIds.has(item.id) || (item.name && packageAreaIds.has(`osm-relation-${item.id}`))) {
          errors.push({
            code: "REJECTED_AREA_IN_PACKAGE",
            message: `Abgewiesenes Gebiet "${item.name}" (${item.id}) befindet sich im finalen Paket!`
          });
        }
      }
    }
    metrics.areaQa.maxRejectedRatioInside = maxRejRatio;
  }

  // 5. Street QA
  const streets = Array.isArray(packageData.streets) ? packageData.streets : [];
  metrics.streetQa.count = streets.length;
  if (streets.length < qaPolicy.street.minCount) {
    errors.push({
      code: "NO_STREETS_IN_PACKAGE",
      message: `Paket enthält keine Straßen (min: ${qaPolicy.street.minCount}).`
    });
  }

  // Drop-Ratio gegen Published State
  if (publishedEntry && Number.isInteger(publishedEntry.streetCount) && publishedEntry.streetCount > 0) {
    const drop = (publishedEntry.streetCount - streets.length) / publishedEntry.streetCount;
    metrics.streetQa.dropRatio = Math.max(0, Number(drop.toFixed(4)));
    if (drop > qaPolicy.street.maxDropRatio) {
      errors.push({
        code: "STREET_DROP_EXCEEDED",
        message: `Straßenanzahl um ${(drop * 100).toFixed(1)}% gesunken (max erlaubt: ${(qaPolicy.street.maxDropRatio * 100)}%). Vorher: ${publishedEntry.streetCount}, Jetzt: ${streets.length}`
      });
    }
  }

  // 6. POI QA
  const pois = Array.isArray(packageData.pois) ? packageData.pois : [];
  metrics.poiQa.count = pois.length;
  for (const poi of pois) {
    if (!poiCategories.getById(poi.category)) {
      errors.push({
        code: "INVALID_POI_CATEGORY",
        message: `POI "${poi.name}" (${poi.id}) besitzt unbekannte Kategorie "${poi.category}".`
      });
    }
  }

  if (publishedEntry && Number.isInteger(publishedEntry.poiCount) && publishedEntry.poiCount > 0) {
    const drop = (publishedEntry.poiCount - pois.length) / publishedEntry.poiCount;
    metrics.poiQa.dropRatio = Math.max(0, Number(drop.toFixed(4)));
    if (drop > qaPolicy.poi.maxDropRatio) {
      errors.push({
        code: "POI_DROP_EXCEEDED",
        message: `POI-Anzahl um ${(drop * 100).toFixed(1)}% gesunken (max erlaubt: ${(qaPolicy.poi.maxDropRatio * 100)}%). Vorher: ${publishedEntry.poiCount}, Jetzt: ${pois.length}`
      });
    }
  }

  // 7. Version / Hash Invariant Check
  let classification = "NEW";
  const candidateVersion = String(packageData?.package?.version || "").trim();
  const candidateHash = String(packageData?.package?.contentHash || "").trim();

  if (publishedEntry) {
    const pubVersion = String(publishedEntry.version || "").trim();
    const pubHash = String(publishedEntry.contentHash || "").trim();

    if (candidateHash === pubHash) {
      classification = "UNCHANGED";
    } else {
      // Neuer Hash -> Version MUSS erhöht sein!
      const cmp = validator.comparePackageVersions(candidateVersion, pubVersion);
      if (cmp === 0) {
        errors.push({
          code: "SAME_VERSION_DIFFERENT_CONTENT",
          message: `Invariante verletzt: Datensatz "${datasetId}" hat geänderten contentHash bei gleicher Version "${candidateVersion}". Version muss erhöht werden!`
        });
      } else if (cmp < 0) {
        errors.push({
          code: "VERSION_REGRESSION",
          message: `Versionsrückschritt für "${datasetId}": Kandidat ${candidateVersion} < Publiziert ${pubVersion}.`
        });
      } else {
        classification = "CHANGED";
      }
    }
  }

  const passed = errors.length === 0;

  return {
    status: passed ? "PASS" : "FAIL",
    classification: passed ? classification : "FAILED",
    datasetId,
    version: candidateVersion,
    contentHash: candidateHash,
    streetCount: streets.length,
    poiCount: pois.length,
    areaCount: areas.length,
    errors,
    warnings,
    metrics
  };
}

module.exports = {
  QaError,
  loadQaPolicy,
  loadPublishedState,
  evaluateCandidatePackage
};
