"use strict";

const path = require("node:path");
const turf = require("../../vendor/turf/turf.min.js");
const validator = require("../../city-data-validator.js");
const poiCategories = require("../../poi-categories.js");
const geometry = require("../../geometry.js");

const STANDARD_POI_CATEGORIES = new Set(
  typeof poiCategories.getAllCategoryIds === "function"
    ? poiCategories.getAllCategoryIds()
    : [
        "fire_station", "school", "kindergarten", "supermarket", "police",
        "hospital", "nursing_care", "fuel", "company", "hotel", "restaurant",
        "sports_facility", "public_building"
      ]
);

const LEGACY_POI_CATEGORIES = new Set([
  "childcare", "senior-care", "health", "public-facility",
  "sports-leisure", "hospitality", "other-relevant"
]);

const VALID_AREA_KINDS = new Set(["administrative", "response_area", "custom"]);
const VALID_AREA_SOURCES = new Set(["osm", "curated", "user"]);

/**
 * Runs a deep QA audit on a dataset package according to Phase 19.28 - 19.32 specs.
 *
 * @param {Object} pkg The parsed dataset package object.
 * @param {Object} [options] Audit configuration options.
 * @returns {Object} Comprehensive QA Report.
 */
function auditDatasetPackage(pkg, options = {}) {
  const issues = {
    errors: [],
    warnings: []
  };

  function addError(section, code, message, details = {}) {
    issues.errors.push({ section, code, message, ...details });
  }

  function addWarning(section, code, message, details = {}) {
    issues.warnings.push({ section, code, message, ...details });
  }

  // --- 1. Package Schema & Contract Baseline ---
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    addError("package", "PACKAGE_NOT_OBJECT", "Paket ist kein gültiges Objekt.");
    return finalizeReport(pkg, issues, null);
  }

  const contractValidation = validator.validateCityPackage(pkg);
  if (!contractValidation.valid) {
    const errs = contractValidation.validation;
    for (const sec of ["package", "municipality", "streets", "pois", "areas"]) {
      if (errs[sec]?.errors) {
        for (const e of errs[sec].errors) {
          addError(sec, e.code || "CONTRACT_ERROR", e.message || JSON.stringify(e));
        }
      }
      if (errs[sec]?.warnings) {
        for (const w of errs[sec].warnings) {
          addWarning(sec, w.code || "CONTRACT_WARNING", w.message || JSON.stringify(w));
        }
      }
    }
  }

  // Verify hash
  const hashResult = validator.verifyPackageHash(pkg);
  if (!hashResult.valid) {
    addError("package", "PACKAGE_HASH_MISMATCH", `Hash-Integritätsprüfung fehlgeschlagen. Erwartet: ${hashResult.expectedHash}, Berechnet: ${hashResult.actualHash}`);
  }

  const city = pkg.city || {};
  const streets = Array.isArray(pkg.streets) ? pkg.streets : [];
  const pois = Array.isArray(pkg.pois) ? pkg.pois : [];
  const areas = Array.isArray(pkg.areas) ? pkg.areas : [];
  const boundary = pkg.boundary || city.boundary || null;

  // --- 2. Streets Audit (Phase 19.28, 19.29) ---
  const streetIds = new Set();
  const osmStreetIdentities = new Set();
  const streetsByName = new Map();
  let quizEligibleStreets = 0;
  let boundaryStreetsCount = 0;

  for (let i = 0; i < streets.length; i++) {
    const st = streets[i];
    const sId = String(st?.id || "").trim();

    // Unique ID
    if (!sId) {
      addError("streets", "STREET_ID_MISSING", `Straße an Index ${i} hat keine ID.`);
    } else if (streetIds.has(sId)) {
      addError("streets", "STREET_ID_DUPLICATE", `Doppelte Straßen-ID: "${sId}".`, { streetId: sId });
    } else {
      streetIds.add(sId);
    }

    // Name
    const sName = String(st?.name || "").trim();
    if (!sName) {
      addError("streets", "STREET_NAME_EMPTY", `Straße "${sId}" hat keinen Namen.`, { streetId: sId });
    } else {
      if (!streetsByName.has(sName)) streetsByName.set(sName, []);
      streetsByName.get(sName).push(st);
    }

    // Quiz eligibility
    if (st?.quizEligible === true) {
      quizEligibleStreets++;
    } else if (st?.quizEligible !== false && st?.quizEligible !== undefined) {
      addWarning("streets", "STREET_QUIZ_ELIGIBLE_NON_BOOLEAN", `Straße "${sId}" hat ungültiges quizEligible.`, { streetId: sId });
    }

    // Boundary streets
    if (st?.isBoundaryStreet || (Array.isArray(st?.areaIds) && st.areaIds.length > 1)) {
      boundaryStreetsCount++;
    }

    // Geometry validation
    const geom = st?.geometry;
    if (!geom) {
      addError("streets", "STREET_GEOMETRY_NULL", `Straße "${sId}" besitzt keine Geometrie.`, { streetId: sId });
      continue;
    }

    if (geom.type !== "MultiLineString" && geom.type !== "LineString") {
      addError("streets", "STREET_GEOMETRY_TYPE", `Straße "${sId}" hat unerwarteten Geometrietyp "${geom.type}".`, { streetId: sId });
    }

    const lines = geom.type === "MultiLineString" ? geom.coordinates : [geom.coordinates];
    let totalLengthMeters = 0;
    let hasZeroSegment = false;
    let hasNullCoordinates = false;

    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) {
        addError("streets", "STREET_LINE_TOO_SHORT", `Straße "${sId}" hat eine Linie mit weniger als 2 Koordinaten.`, { streetId: sId });
        continue;
      }
      for (let c = 0; c < line.length; c++) {
        const coord = line[c];
        if (!Array.isArray(coord) || coord.length < 2 || typeof coord[0] !== "number" || typeof coord[1] !== "number" || isNaN(coord[0]) || isNaN(coord[1])) {
          hasNullCoordinates = true;
          break;
        }
        // Zero-coordinate check: [0, 0] in German bounding box is corrupt
        if (Math.abs(coord[0]) < 0.0001 && Math.abs(coord[1]) < 0.0001) {
          hasZeroSegment = true;
        }
      }

      // Calculate length & detect zero-length sub-segments
      for (let c = 0; c < line.length - 1; c++) {
        const p1 = line[c];
        const p2 = line[c + 1];
        const segLen = turf.distance(turf.point(p1), turf.point(p2), { units: "kilometers" }) * 1000;
        totalLengthMeters += segLen;
        if (segLen < 0.0001) {
          hasZeroSegment = true;
        }
      }
    }

    if (hasNullCoordinates) {
      addError("streets", "STREET_NULL_COORDINATE", `Straße "${sId}" enthält Null- oder NaN-Koordinaten.`, { streetId: sId });
    }

    if (hasZeroSegment) {
      addError("streets", "STREET_ZERO_SEGMENT", `Straße "${sId}" enthält numerische Nullsegmente oder Nullkoordinaten (Phase 19.28 Regression).`, { streetId: sId });
    }

    if (totalLengthMeters <= 0.01) {
      addError("streets", "STREET_ZERO_LENGTH", `Straße "${sId}" hat Gesamtlänge 0 Meter.`, { streetId: sId });
    }

    // Duplicate OSM identity
    const osmIds = Array.isArray(st?.osmIds) ? st.osmIds : (st?.osmId ? [st.osmId] : []);
    for (const osmId of osmIds) {
      const key = `${sName}::${osmId}`;
      if (osmStreetIdentities.has(key)) {
        addWarning("streets", "STREET_OSM_IDENTITY_DUPLICATE", `Gleiche OSM-Identität mehrfach zugeordnet: "${key}".`, { streetId: sId, osmId });
      }
      osmStreetIdentities.add(key);
    }
  }

  // Cross-municipality name separation check for district datasets
  if (city.datasetKind === "district" || pkg.package?.datasetKind === "district") {
    for (const [name, stList] of streetsByName.entries()) {
      if (stList.length > 1) {
        const mNames = new Set(stList.map(s => s.municipalityName || (s.properties && s.properties.municipalityName)).filter(Boolean));
        if (mNames.size > 1) {
          const displayNames = new Set(stList.map(s => s.displayName || s.name));
          if (displayNames.size < mNames.size) {
            addWarning("streets", "CROSS_MUNICIPALITY_NAME_AMBIGUITY", `Gleichnamige Straße "${name}" in mehreren Gemeinden (${Array.from(mNames).join(", ")}) ohne eindeutigen displayName.`, { name });
          }
        }
      }
    }
  }

  // --- 3. POIs Audit (Phase 19.30) ---
  const poiIds = new Set();
  const poisByLocation = new Map();
  let quizEligiblePois = 0;
  let fireStationCount = 0;

  for (let i = 0; i < pois.length; i++) {
    const p = pois[i];
    const pId = String(p?.id || "").trim();

    // Unique ID
    if (!pId) {
      addError("pois", "POI_ID_MISSING", `POI an Index ${i} hat keine ID.`);
    } else if (poiIds.has(pId)) {
      addError("pois", "POI_ID_DUPLICATE", `Doppelte POI-ID: "${pId}".`, { poiId: pId });
    } else {
      poiIds.add(pId);
    }

    // Category valid
    const cat = String(p?.category || "").trim();
    const pkgCategories = Array.isArray(pkg.categories) ? new Set(pkg.categories.map(c => c && c.id).filter(Boolean)) : null;
    const isCatValid = STANDARD_POI_CATEGORIES.has(cat) || LEGACY_POI_CATEGORIES.has(cat) || (pkgCategories && pkgCategories.has(cat));
    if (!isCatValid) {
      addError("pois", "POI_CATEGORY_INVALID", `POI "${pId}" hat unbekannte Kategorie "${cat}".`, { poiId: pId, category: cat });
    }
    if (cat === "fire_station") {
      fireStationCount++;
    }

    // Coordinates / position valid
    const pos = p?.position || (p?.geometry?.type === "Point" ? { lat: p.geometry.coordinates[1], lon: p.geometry.coordinates[0] } : null);
    if (!pos || typeof pos.lat !== "number" || typeof pos.lon !== "number" || isNaN(pos.lat) || isNaN(pos.lon)) {
      addError("pois", "POI_POSITION_INVALID", `POI "${pId}" besitzt keine gültigen Koordinaten.`, { poiId: pId });
    } else {
      // Coordinate range in Germany: lat 47-56, lon 5-16
      if (pos.lat < 47 || pos.lat > 56 || pos.lon < 5 || pos.lon > 16) {
        addError("pois", "POI_POSITION_OUT_OF_BOUNDS", `POI "${pId}" Koordinaten (${pos.lat}, ${pos.lon}) liegen außerhalb Deutschlands.`, { poiId: pId });
      }

      // Check containment inside dataset boundary if boundary exists
      if (boundary) {
        try {
          const pt = turf.point([pos.lon, pos.lat]);
          const inside = turf.booleanPointInPolygon(pt, boundary);
          if (!inside) {
            addWarning("pois", "POI_OUTSIDE_BOUNDARY", `POI "${pId}" (${p?.name}) liegt außerhalb der administrativen Grenze.`, { poiId: pId });
          }
        } catch (_) {}
      }

      // Proximity duplicates check
      const locKey = `${pos.lat.toFixed(4)}:${pos.lon.toFixed(4)}:${cat}`;
      if (poisByLocation.has(locKey)) {
        addWarning("pois", "POI_POSSIBLE_DUPLICATE", `Möglicher doppelter POI bei (${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}) Kategorie ${cat}: "${p?.name}" vs "${poisByLocation.get(locKey)?.name}".`, { poiId: pId });
      } else {
        poisByLocation.set(locKey, p);
      }
    }

    // Quiz eligibility
    if (p?.quizEligible === true) {
      quizEligiblePois++;
      if (cat === "fire_station") {
        addError("pois", "FIRE_STATION_QUIZ_ELIGIBLE", `Feuerwehrgerätehaus "${pId}" darf nicht quizEligible sein.`, { poiId: pId });
      }
    }
    if (p?.active !== true && p?.active !== false && p?.active !== undefined) {
      addWarning("pois", "POI_ACTIVE_NON_BOOLEAN", `POI "${pId}" hat ungültiges active-Attribut.`, { poiId: pId });
    }
  }

  // --- 4. Areas Audit (Phase 19.31) ---
  const areaIds = new Set();
  const areaById = new Map();
  const administrativeAreas = [];
  const responseAreas = [];
  const customAreas = [];

  const topLevelCityId = String(city?.id || city?.cityId || "").trim();
  const topLevelOsmId = city?.osmId || city?.osmRelationId ? `osm-relation-${city.osmId || city.osmRelationId}` : null;

  for (let i = 0; i < areas.length; i++) {
    const ar = areas[i];
    const aId = String(ar?.id || "").trim();

    // Unique ID
    if (!aId) {
      addError("areas", "AREA_ID_MISSING", `Gebiet an Index ${i} hat keine ID.`);
    } else if (areaIds.has(aId)) {
      addError("areas", "AREA_ID_DUPLICATE", `Doppelte Gebiets-ID: "${aId}".`, { areaId: aId });
    } else {
      areaIds.add(aId);
      areaById.set(aId, ar);
    }

    // Name
    if (!String(ar?.name || "").trim()) {
      addError("areas", "AREA_NAME_EMPTY", `Gebiet "${aId}" hat keinen Namen.`, { areaId: aId });
    }

    // Kind
    const kind = ar?.kind || "administrative";
    if (!VALID_AREA_KINDS.has(kind)) {
      addError("areas", "AREA_KIND_INVALID", `Gebiet "${aId}" hat unbekannten Typ "${kind}".`, { areaId: aId, kind });
    } else {
      if (kind === "administrative") administrativeAreas.push(ar);
      else if (kind === "response_area") responseAreas.push(ar);
      else if (kind === "custom") customAreas.push(ar);
    }

    // Source
    const src = ar?.source || "osm";
    if (!VALID_AREA_SOURCES.has(src)) {
      addError("areas", "AREA_SOURCE_INVALID", `Gebiet "${aId}" hat ungültige Quelle "${src}".`, { areaId: aId, source: src });
    }

    // Geometry candidate: support ar.geometry, ar.polygon, ar.boundary
    const g = ar?.geometry
      || (ar?.polygon && typeof ar.polygon === "object" ? ar.polygon : null)
      || (ar?.boundary && typeof ar.boundary === "object" ? ar.boundary : null);

    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) {
      addError("areas", "AREA_GEOMETRY_INVALID", `Gebiet "${aId}" besitzt keine gültige Polygon-Geometrie.`, { areaId: aId });
    } else {
      try {
        const polyArea = turf.area(g);
        if (polyArea <= 0) {
          addError("areas", "AREA_GEOMETRY_ZERO_AREA", `Gebiet "${aId}" hat Fläche <= 0 m².`, { areaId: aId });
        }
      } catch (err) {
        addError("areas", "AREA_GEOMETRY_PARSE_ERROR", `Gebiet "${aId}" Geometrie nicht parsebar: ${err.message}`, { areaId: aId });
      }
    }
  }

  // Parent/child hierarchy and cycle check
  for (const ar of areas) {
    const parentId = String(ar.parentId || ar.parentAreaId || "").trim();
    if (parentId) {
      const isTopLevelDistrict = parentId === topLevelCityId || (topLevelOsmId && parentId === topLevelOsmId);
      if (!areaById.has(parentId) && !isTopLevelDistrict) {
        addError("areas", "AREA_PARENT_NOT_FOUND", `Gebiet "${ar.id}" verweist auf nicht existierenden parent "${parentId}".`, { areaId: ar.id, parentId });
      }
      // Cycle detection
      let cur = ar;
      const visited = new Set([cur.id]);
      let curParent = String(cur.parentId || cur.parentAreaId || "").trim();
      while (curParent && areaById.has(curParent)) {
        if (visited.has(curParent)) {
          addError("areas", "AREA_PARENT_CYCLE", `Zyklische Gebiets-Hierarchie bei "${ar.id}" -> "${curParent}".`, { areaId: ar.id });
          break;
        }
        visited.add(curParent);
        cur = areaById.get(curParent);
        curParent = String(cur?.parentId || cur?.parentAreaId || "").trim();
      }
    }
  }

  // Membership integrity check: entity areaIds refer to existing areas
  let invalidAreaRefs = 0;
  for (const st of streets) {
    if (Array.isArray(st.areaIds)) {
      for (const aId of st.areaIds) {
        if (!areaIds.has(aId)) {
          invalidAreaRefs++;
        }
      }
    }
  }
  for (const p of pois) {
    if (Array.isArray(p.areaIds)) {
      for (const aId of p.areaIds) {
        if (!areaIds.has(aId)) {
          invalidAreaRefs++;
        }
      }
    }
  }
  if (invalidAreaRefs > 0) {
    addError("areas", "AREA_MEMBERSHIP_BROKEN", `${invalidAreaRefs} Entitäten verweisen auf nicht existierende Gebiets-IDs.`);
  }

  return finalizeReport(pkg, issues, {
    streetsCount: streets.length,
    quizEligibleStreets,
    boundaryStreetsCount,
    poisCount: pois.length,
    quizEligiblePois,
    fireStationCount,
    areasCount: areas.length,
    administrativeAreasCount: administrativeAreas.length,
    responseAreasCount: responseAreas.length,
    customAreasCount: customAreas.length
  });
}

function finalizeReport(pkg, issues, stats) {
  const datasetId = pkg?.package?.id || pkg?.city?.id || "unknown";
  const datasetName = pkg?.city?.name || pkg?.package?.title || datasetId;
  const status = issues.errors.length === 0 ? "PASS" : "FAIL";

  return {
    datasetId,
    datasetName,
    status,
    pass: issues.errors.length === 0,
    timestamp: new Date().toISOString(),
    stats: stats || {},
    errorsCount: issues.errors.length,
    warningsCount: issues.warnings.length,
    errors: issues.errors,
    warnings: issues.warnings
  };
}

module.exports = {
  auditDatasetPackage,
  STANDARD_POI_CATEGORIES,
  LEGACY_POI_CATEGORIES,
  VALID_AREA_KINDS,
  VALID_AREA_SOURCES
};
