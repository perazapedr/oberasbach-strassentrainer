"use strict";

const path = require("node:path");
const geometryApi = require("../../../geometry.js");
const validator = require("../../../city-data-validator.js");
const poiCategories = require("../../../poi-categories.js");
const osmService = require("../../../osm-service.js");
const turf = require("../../../vendor/turf/turf.min.js");

const BUILDER_VERSION = "0.1.0";
const ALTERNATIVE_NAME_TAGS = Object.freeze(["official_name", "alt_name", "short_name", "loc_name"]);
const ALLOWED_HIGHWAYS = new Set(osmService.DEFAULT_STREET_HIGHWAY_TYPES);
const GERMAN_BASE_COLLATOR = new Intl.Collator("de", { sensitivity: "base" });
const GERMAN_COLLATOR = new Intl.Collator("de");

function compareNames(first, second) {
  return GERMAN_BASE_COLLATOR.compare(first, second)
    || GERMAN_COLLATOR.compare(first, second)
    || String(first).localeCompare(String(second));
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeOpl(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

function parseOplTags(raw) {
  const tags = {};
  if (!raw) return tags;
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    const key = decodeOpl(separator < 0 ? pair : pair.slice(0, separator));
    const value = decodeOpl(separator < 0 ? "" : pair.slice(separator + 1));
    if (key) tags[key] = value;
  }
  return tags;
}

function parseBoundaryRelationOpl(text) {
  const candidates = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const idMatch = line.match(/^r(\d+)\b/);
    if (!idMatch) continue;
    const tagMatch = line.match(/(?:^|\s)T([^\s]*)/);
    candidates.push({ id: Number(idMatch[1]), tags: parseOplTags(tagMatch ? tagMatch[1] : "") });
  }
  return candidates;
}

function selectMunicipalityRelation(candidates, municipality, relationId = null) {
  const expectedName = normalizeText(municipality);
  if (!expectedName) throw new Error("Municipality name is required.");
  const expectedId = relationId === null || relationId === undefined ? null : Number(relationId);
  if (expectedId !== null && (!Number.isSafeInteger(expectedId) || expectedId <= 0)) {
    throw new Error("The explicit relation ID must be a positive integer.");
  }

  const administrative = (Array.isArray(candidates) ? candidates : []).filter(candidate => (
    candidate && Number.isSafeInteger(candidate.id) && candidate.id > 0
    && candidate.tags && candidate.tags.boundary === "administrative"
  ));
  const selectedById = expectedId === null ? administrative : administrative.filter(candidate => candidate.id === expectedId);
  if (expectedId !== null && selectedById.length === 0) {
    throw new Error(`Administrative municipality relation ${expectedId} was not found in the PBF.`);
  }

  const matching = selectedById.filter(candidate => {
    const tags = candidate.tags;
    const candidateName = tags.name || tags["name:de"];
    return normalizeText(candidateName) === expectedName && Number(tags.admin_level) === 8;
  });
  if (matching.length === 0) {
    throw new Error(`No admin_level=8 municipality boundary named "${municipality}" was found.`);
  }
  if (matching.length > 1) {
    const details = matching.map(candidate => {
      const ags = candidate.tags["de:amtlicher_gemeindeschluessel"] || "ohne AGS";
      return `${candidate.id} (${ags})`;
    }).join(", ");
    throw new Error(`Municipality boundary is ambiguous: ${details}. Use --relation-id.`);
  }
  return matching[0];
}

function validCoordinate(coordinate) {
  return Array.isArray(coordinate) && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1]));
}

function normalizeCoordinate(coordinate) {
  return [Number(coordinate[0]), Number(coordinate[1])];
}

function normalizeAreaGeometry(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
  const copyRing = ring => Array.isArray(ring) && ring.every(validCoordinate)
    ? ring.map(normalizeCoordinate)
    : null;
  if (geometry.type === "Polygon") {
    const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates.map(copyRing) : [];
    return rings.length > 0 && rings.every(Boolean) ? { type: "Polygon", coordinates: rings } : null;
  }
  const polygons = Array.isArray(geometry.coordinates)
    ? geometry.coordinates.map(polygon => Array.isArray(polygon) ? polygon.map(copyRing) : [])
    : [];
  return polygons.length > 0 && polygons.every(polygon => polygon.length > 0 && polygon.every(Boolean))
    ? { type: "MultiPolygon", coordinates: polygons }
    : null;
}

function canonicalizeAreaGeometry(geometry) {
  const normalized = normalizeAreaGeometry(geometry);
  if (!normalized) return null;
  if (normalized.type === "MultiPolygon" && Array.isArray(normalized.coordinates) && normalized.coordinates.length === 1) {
    return { type: "Polygon", coordinates: normalized.coordinates[0] };
  }
  return normalized;
}

function formatDatasetVersion(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "1.0.0";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

function geometryBounds(geometry) {
  const bounds = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
  function visit(value) {
    if (validCoordinate(value)) {
      const [lon, lat] = normalizeCoordinate(value);
      bounds.south = Math.min(bounds.south, lat);
      bounds.west = Math.min(bounds.west, lon);
      bounds.north = Math.max(bounds.north, lat);
      bounds.east = Math.max(bounds.east, lon);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  }
  visit(geometry && geometry.coordinates);
  return Object.values(bounds).every(Number.isFinite) ? bounds : null;
}

function geometryPosition(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Point" && validCoordinate(geometry.coordinates)) {
    return { lat: Number(geometry.coordinates[1]), lon: Number(geometry.coordinates[0]) };
  }
  const coordinates = [];
  function collect(value) {
    if (validCoordinate(value)) coordinates.push(normalizeCoordinate(value));
    else if (Array.isArray(value)) value.forEach(collect);
  }
  collect(geometry.coordinates);
  if (coordinates.length === 0) return null;
  const total = coordinates.reduce((sum, coordinate) => ({
    lon: sum.lon + coordinate[0], lat: sum.lat + coordinate[1]
  }), { lon: 0, lat: 0 });
  return { lat: total.lat / coordinates.length, lon: total.lon / coordinates.length };
}

function municipalityCenter(boundary) {
  const feature = turf.feature(boundary);
  let point = turf.centerOfMass(feature);
  if (!turf.booleanPointInPolygon(point, feature)) point = turf.pointOnFeature(feature);
  return {
    lat: Number(point.geometry.coordinates[1].toFixed(7)),
    lon: Number(point.geometry.coordinates[0].toFixed(7))
  };
}

function parseAlternativeNames(tags, primaryName) {
  const aliases = [];
  const seen = new Set([primaryName]);
  for (const key of ALTERNATIVE_NAME_TAGS) {
    if (typeof tags[key] !== "string") continue;
    for (const value of tags[key].split(";")) {
      const alias = value.trim();
      if (!alias || seen.has(alias)) continue;
      seen.add(alias);
      aliases.push(alias);
    }
  }
  return aliases.sort(compareNames);
}

function polygonBoundaryLines(boundary) {
  const result = [];
  const converted = turf.polygonToLine(turf.feature(boundary));
  const features = converted.type === "FeatureCollection" ? converted.features : [converted];
  for (const feature of features) {
    if (!feature || !feature.geometry) continue;
    if (feature.geometry.type === "LineString") result.push(feature);
    if (feature.geometry.type === "MultiLineString") {
      feature.geometry.coordinates.forEach(line => result.push(turf.lineString(line)));
    }
  }
  return result;
}

function lineMidpointFeature(lineFeature) {
  const length = turf.length(lineFeature, { units: "kilometers" });
  return length > 0 ? turf.along(lineFeature, length / 2, { units: "kilometers" }) : null;
}

function clipLineStringToBoundary(coordinates, boundary) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(validCoordinate)) return [];
  const polygon = turf.feature(boundary);
  let pieces = [turf.lineString(coordinates.map(normalizeCoordinate))];
  for (const splitter of polygonBoundaryLines(boundary)) {
    const next = [];
    for (const piece of pieces) {
      try {
        const split = turf.lineSplit(piece, splitter);
        if (split.features.length > 0) next.push(...split.features);
        else next.push(piece);
      } catch (_) {
        next.push(piece);
      }
    }
    pieces = next;
  }
  return pieces.filter(piece => {
    const midpoint = lineMidpointFeature(piece);
    return midpoint && turf.booleanPointInPolygon(midpoint, polygon, { ignoreBoundary: false });
  }).map(piece => piece.geometry.coordinates.map(normalizeCoordinate))
    .filter(line => line.length >= 2);
}

function osmFeatureIdentity(feature) {
  const properties = feature && feature.properties && typeof feature.properties === "object"
    ? feature.properties
    : {};
  const type = trimmedString(properties["@type"]);
  const id = Number(properties["@id"]);
  return ["node", "way", "relation"].includes(type) && Number.isSafeInteger(id) && id > 0
    ? { type, id, properties }
    : null;
}

function copyTags(properties) {
  const tags = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (key.startsWith("@")) continue;
    if (["string", "number", "boolean"].includes(typeof value)) tags[key] = value;
  }
  return tags;
}

function collectRelevantFeatures(features, boundary, diagnostics = {}) {
  const streetWays = new Map();
  const poiObjects = new Map();
  const areaObjects = new Map();
  diagnostics.featuresRead = 0;
  diagnostics.rawStreetWays = 0;
  diagnostics.eligibleStreetWays = 0;
  diagnostics.streetWaysOutside = 0;
  diagnostics.streetWaysClipped = 0;
  diagnostics.rawPoiCandidates = 0;
  diagnostics.poiNodes = 0;
  diagnostics.poiWays = 0;
  diagnostics.poiRelations = 0;
  diagnostics.rawAreaCandidates = 0;

  for (const feature of features) {
    diagnostics.featuresRead += 1;
    const identity = osmFeatureIdentity(feature);
    if (!identity) continue;
    const tags = copyTags(identity.properties);
    const name = trimmedString(tags.name);
    const geometry = feature.geometry;

    if (identity.type === "way" && ALLOWED_HIGHWAYS.has(trimmedString(tags.highway))) {
      diagnostics.rawStreetWays += 1;
      if (name && geometry && geometry.type === "LineString") {
        const clipped = clipLineStringToBoundary(geometry.coordinates, boundary);
        if (clipped.length === 0) {
          diagnostics.streetWaysOutside += 1;
        } else {
          diagnostics.eligibleStreetWays += 1;
          const changed = JSON.stringify(clipped) !== JSON.stringify([geometry.coordinates]);
          if (changed) diagnostics.streetWaysClipped += 1;
          streetWays.set(identity.id, { id: identity.id, name, tags, lines: clipped });
        }
      }
    }

    const category = name ? poiCategories.matchOsmCategory(tags) : null;
    if (category) {
      diagnostics.rawPoiCandidates += 1;
      const key = `${identity.type}:${identity.id}`;
      const existing = poiObjects.get(key);
      const rank = geometry && ["Polygon", "MultiPolygon"].includes(geometry.type) ? 3
        : (geometry && geometry.type === "Point" ? 2 : 1);
      if (!existing || rank > existing.rank) {
        poiObjects.set(key, { identity, tags, name, category, geometry, rank });
      }
    }

    const adminLevel = Number(tags.admin_level);
    const areaCandidate = name && ["way", "relation"].includes(identity.type)
      && ((tags.boundary === "administrative" && [8, 9, 10, 11].includes(adminLevel))
        || ["borough", "suburb", "quarter"].includes(tags.place));
    if (areaCandidate && normalizeAreaGeometry(geometry)) {
      diagnostics.rawAreaCandidates += 1;
      areaObjects.set(`${identity.type}:${identity.id}`, { identity, tags, geometry: normalizeAreaGeometry(geometry) });
    }
  }
  return { streetWays, poiObjects, areaObjects };
}

function buildStreets(streetWays, cityId) {
  const groups = new Map();
  for (const way of streetWays.values()) {
    if (!groups.has(way.name)) groups.set(way.name, []);
    groups.get(way.name).push(way);
  }
  const usedIds = new Set();
  return [...groups.keys()].sort(compareNames).map(name => {
    const ways = groups.get(name).sort((a, b) => a.id - b.id);
    const baseId = `${cityId}:${geometryApi.createStreetId(name)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    const aliases = [...new Set(ways.flatMap(way => parseAlternativeNames(way.tags, name)))].sort(compareNames);
    return {
      id,
      cityId,
      name,
      aliases,
      geometry: { type: "MultiLineString", coordinates: ways.flatMap(way => way.lines) },
      osmWayIds: ways.map(way => way.id).sort((a, b) => a - b),
      geometrySource: "openstreetmap-pbf"
    };
  });
}

function buildPois(poiObjects, cityId, diagnostics = {}) {
  const pois = [];
  for (const candidate of poiObjects.values()) {
    const { identity, tags, category } = candidate;
    const areaGeometry = normalizeAreaGeometry(candidate.geometry);
    const position = geometryPosition(candidate.geometry);
    if (!position) continue;
    diagnostics[`poi${identity.type[0].toUpperCase()}${identity.type.slice(1)}s`] += 1;
    pois.push({
      id: `${cityId}:poi:${identity.type}-${identity.id}`,
      cityId,
      name: candidate.name,
      category: category.id,
      categoryLabel: category.singularLabel || category.label,
      aliases: parseAlternativeNames(tags, candidate.name),
      position,
      geometry: identity.type === "node" ? null : areaGeometry,
      osmType: identity.type,
      osmId: identity.id,
      tags
    });
  }
  return pois.sort((a, b) => compareNames(a.name, b.name) || a.osmType.localeCompare(b.osmType) || a.osmId - b.osmId);
}

function areaFeatureToOsmElement(candidate) {
  const { identity, tags, geometry } = candidate;
  if (identity.type === "way") {
    const polygon = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates[0];
    return {
      type: "way", id: identity.id, tags,
      geometry: polygon[0].map(([lon, lat]) => ({ lon, lat }))
    };
  }
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const members = [];
  let ref = 1;
  polygons.forEach(polygon => polygon.forEach((ring, ringIndex) => {
    members.push({
      type: "way", ref: ref++, role: ringIndex === 0 ? "outer" : "inner",
      geometry: ring.map(([lon, lat]) => ({ lon, lat }))
    });
  }));
  return { type: "relation", id: identity.id, tags, members };
}

function buildAreas(areaObjects, municipality, boundary) {
  const elements = [...areaObjects.values()]
    .filter(candidate => !(candidate.identity.type === "relation" && candidate.identity.id === municipality.osmId))
    .map(areaFeatureToOsmElement);
  return osmService.discoverTrainingAreas({ elements, municipalityInfo: municipality, boundary, options: {} });
}

function categoriesForPackage() {
  return poiCategories.getAll().map(category => ({
    id: category.id,
    label: category.label,
    pluralLabel: category.pluralLabel,
    singularLabel: category.singularLabel,
    order: category.order
  }));
}

function allValidationIssues(result, kind) {
  return ["package", "municipality", "streets", "pois", "areas"]
    .flatMap(section => Array.isArray(result && result.validation && result.validation[section] && result.validation[section][kind])
      ? result.validation[section][kind]
      : []);
}

function assemblePackage(options) {
  const {
    relation, boundary, featureCollections, municipalityName, state = "Nordrhein-Westfalen",
    country = "Deutschland", pbfTimestamp, sourcePbf
  } = options;
  const cityId = `osm-relation-${relation.id}`;
  const bounds = geometryBounds(boundary);
  const cityBase = {
    id: cityId,
    name: trimmedString(relation.tags.name) || municipalityName,
    displayName: trimmedString(relation.tags.name) || municipalityName,
    district: trimmedString(relation.tags["is_in:county"]) || null,
    state,
    country,
    postalCodes: [],
    osmType: "relation",
    osmId: relation.id,
    adminLevel: Number(relation.tags.admin_level),
    officialMunicipalityKey: trimmedString(relation.tags["de:amtlicher_gemeindeschluessel"]) || null,
    regionalKey: trimmedString(relation.tags["de:regionalschluessel"]) || null,
    bounds,
    center: municipalityCenter(boundary),
    defaultZoom: 12,
    source: "osm-pbf",
    dataVersion: 1,
    createdAt: pbfTimestamp,
    updatedAt: pbfTimestamp
  };
  const diagnostics = {};
  const collected = collectRelevantFeatures(featureCollections, boundary, diagnostics);
  const streets = buildStreets(collected.streetWays, cityId);
  const pois = buildPois(collected.poiObjects, cityId, diagnostics);
  const areas = buildAreas(collected.areaObjects, { ...cityBase, osmId: relation.id }, boundary);
  const rawDataset = { city: cityBase, boundary, streets, pois, areas };
  const normalized = validator.validateCityData(rawDataset, { sourceMode: "download", diagnostics: {} });
  if (!normalized.valid) {
    const codes = allValidationIssues(normalized, "errors").map(issue => issue.code).join(", ");
    throw new Error(`Existing city-data validator rejected the builder output: ${codes || "unknown error"}`);
  }

  const city = {
    ...normalized.city,
    hasAreas: normalized.areas.length > 0,
    areaCount: normalized.areas.length
  };
  const datasetVersion = (options && options.version) || formatDatasetVersion(pbfTimestamp);
  const packageMeta = {
    id: municipalityName.toLocaleLowerCase("de-DE") === "olpe" ? "de-nw-olpe" : `osm-relation-${relation.id}`,
    type: "osm",
    datasetKind: "municipality",
    version: datasetVersion,
    title: `${city.displayName} – OpenStreetMap-PBF-Dataset`,
    createdAt: pbfTimestamp,
    updatedAt: pbfTimestamp,
    source: "osm-pbf",
    verification: { status: "unverified" }
  };
  const packageData = {
    schemaVersion: validator.CITY_PACKAGE_SCHEMA_VERSION,
    exportedAt: pbfTimestamp,
    package: packageMeta,
    city,
    boundary: canonicalizeAreaGeometry(normalized.boundary) || normalized.boundary,
    streets: normalized.streets.sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true })),
    pois: normalized.pois.sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true })),
    areas: normalized.areas.sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true })),
    categories: categoriesForPackage(),
    provenance: {
      source: "OpenStreetMap PBF",
      sourcePbf: path.basename(sourcePbf),
      osmDataTimestamp: pbfTimestamp,
      builderVersion: BUILDER_VERSION,
      generatedAt: pbfTimestamp,
      municipalityRelation: relation.id,
      municipalityKey: city.officialMunicipalityKey
    },
    build: {
      warnings: (allValidationIssues(normalized, "warnings") || []).map(warning => ({
        code: warning.code,
        severity: "warning",
        message: warning.message,
        entityType: warning.field || "dataset"
      }))
    }
  };
  packageMeta.contentHash = validator.computePackageHash(packageData);
  city.package = JSON.parse(JSON.stringify(packageMeta));
  const packageValidation = validator.validateCityPackage(packageData);
  if (!packageValidation.valid) {
    const codes = allValidationIssues(packageValidation, "errors").map(issue => issue.code).join(", ");
    throw new Error(`Existing package validator rejected the generated package: ${codes || "unknown error"}`);
  }
  diagnostics.rawStreets = streets.length;
  diagnostics.rawPois = pois.length;
  diagnostics.finalStreets = packageData.streets.length;
  diagnostics.finalPois = packageData.pois.length;
  diagnostics.finalAreas = packageData.areas.length;
  diagnostics.invalidStreetsRemoved = normalized.validation.streets.invalidRemoved;
  diagnostics.invalidPoisRemoved = normalized.validation.pois.invalidRemoved;
  diagnostics.streetDuplicatesMerged = normalized.validation.streets.duplicatesMerged;
  diagnostics.poiDuplicatesMerged = normalized.validation.pois.duplicatesMerged;
  diagnostics.validatorErrors = allValidationIssues(normalized, "errors");
  diagnostics.validatorWarnings = allValidationIssues(normalized, "warnings");
  diagnostics.packageWarnings = allValidationIssues(packageValidation, "warnings");
  return { packageData, diagnostics, validation: normalized.validation, packageValidation: packageValidation.validation };
}

module.exports = {
  BUILDER_VERSION,
  ALLOWED_HIGHWAYS,
  normalizeText,
  parseOplTags,
  parseBoundaryRelationOpl,
  selectMunicipalityRelation,
  normalizeAreaGeometry,
  canonicalizeAreaGeometry,
  formatDatasetVersion,
  geometryBounds,
  clipLineStringToBoundary,
  collectRelevantFeatures,
  buildStreets,
  buildPois,
  areaFeatureToOsmElement,
  buildAreas,
  assemblePackage
};
