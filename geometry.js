(function initializeStreetGeometry(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StreetGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStreetGeometryApi() {
  "use strict";

  const DASHES = /[‐‑‒–—―]/g;

  function normalizeStreetName(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("de-DE")
      .replace(/ß/g, "ss")
      .replace(DASHES, "-")
      .replace(/\bstr\.(?=$|[\s-])/g, "strasse")
      .replace(/\bstr(?=$|[\s-])/g, "strasse")
      .replace(/[.,;:]+/g, " ")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function createStreetId(displayName) {
    const normalized = normalizeStreetName(displayName);
    const slug = normalized
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "strasse";
    return `street-${slug}-${hashString(normalized)}`;
  }

  function prepareStreetRecords(rawStreets) {
    const usedIds = new Set();
    return (Array.isArray(rawStreets) ? rawStreets : []).map(rawStreet => {
      const displayName = String(rawStreet.displayName || rawStreet.name || "").trim();
      const aliases = [...new Set([displayName, ...(rawStreet.aliases || [])].filter(Boolean))];
      let id = String(rawStreet.id || createStreetId(displayName));
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${createStreetId(displayName)}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      return { id, displayName, aliases };
    });
  }

  function getStreetNameKeys(street) {
    return new Set([street.displayName, ...(street.aliases || [])]
      .map(normalizeStreetName)
      .filter(Boolean));
  }

  function featureMatchesStreet(feature, street) {
    const properties = feature?.properties || {};
    const address = properties.address || {};
    const candidate = properties.name || address.road || String(properties.display_name || "").split(",")[0];
    return getStreetNameKeys(street).has(normalizeStreetName(candidate));
  }

  function featureBelongsToMunicipality(feature, municipalityName, postalCode) {
    const properties = feature?.properties || {};
    const address = properties.address || {};
    const expectedMunicipality = normalizeStreetName(municipalityName);
    const municipalityFields = [
      address.city, address.town, address.village, address.municipality, address.locality
    ].map(normalizeStreetName);
    const matchingPlace = municipalityFields.includes(expectedMunicipality);
    const matchingPostcode = String(address.postcode || "").split(";").some(value => value.trim() === String(postalCode));
    const normalizedDisplayName = normalizeStreetName(properties.display_name || "");
    const matchingDisplayName = normalizedDisplayName.includes(expectedMunicipality)
      && normalizedDisplayName.includes(String(postalCode));
    return matchingPlace || matchingPostcode || matchingDisplayName;
  }

  function coordinatesEqual(first, second, epsilon = 1e-10) {
    return Array.isArray(first) && Array.isArray(second)
      && Math.abs(first[0] - second[0]) <= epsilon
      && Math.abs(first[1] - second[1]) <= epsilon;
  }

  function clipSegmentToBbox(start, end, bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const p = [-dx, dx, -dy, dy];
    const q = [start[0] - minLon, maxLon - start[0], start[1] - minLat, maxLat - start[1]];
    let lower = 0;
    let upper = 1;

    for (let index = 0; index < 4; index += 1) {
      if (p[index] === 0) {
        if (q[index] < 0) return null;
        continue;
      }
      const ratio = q[index] / p[index];
      if (p[index] < 0) lower = Math.max(lower, ratio);
      else upper = Math.min(upper, ratio);
      if (lower > upper) return null;
    }

    return [
      [start[0] + lower * dx, start[1] + lower * dy],
      [start[0] + upper * dx, start[1] + upper * dy]
    ];
  }

  function clipLineToBbox(coordinates, bbox) {
    const sections = [];
    let current = null;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const clipped = clipSegmentToBbox(coordinates[index], coordinates[index + 1], bbox);
      if (!clipped) {
        if (current?.length >= 2) sections.push(current);
        current = null;
        continue;
      }

      if (!current || !coordinatesEqual(current[current.length - 1], clipped[0])) {
        if (current?.length >= 2) sections.push(current);
        current = [clipped[0]];
      }
      if (!coordinatesEqual(current[current.length - 1], clipped[1])) current.push(clipped[1]);
    }

    if (current?.length >= 2) sections.push(current);
    return sections;
  }

  function extractLineSections(geometry, bbox) {
    if (!geometry?.type) return [];
    let lines = [];
    if (geometry.type === "LineString") lines = [geometry.coordinates];
    else if (geometry.type === "MultiLineString") lines = geometry.coordinates;
    else if (geometry.type === "GeometryCollection") {
      return geometry.geometries.flatMap(item => extractLineSections(item, bbox));
    } else return [];

    return lines.flatMap(line => {
      if (!Array.isArray(line) || line.length < 2) return [];
      return bbox ? clipLineToBbox(line, bbox) : [line];
    });
  }

  function sectionSignature(section) {
    const serialize = coordinates => coordinates
      .map(([lon, lat]) => `${Number(lon).toFixed(7)},${Number(lat).toFixed(7)}`)
      .join(";");
    const forward = serialize(section);
    const reverse = serialize([...section].reverse());
    return forward < reverse ? forward : reverse;
  }

  function mergeStreetFeatures(features, street, bbox, source = "nominatim") {
    const sections = [];
    const signatures = new Set();
    const featureIds = [];
    const sourceGeometryTypes = new Set();

    for (const feature of features) {
      sourceGeometryTypes.add(feature.geometry?.type || "Unbekannt");
      const extracted = extractLineSections(feature.geometry, bbox);
      for (const section of extracted) {
        const signature = sectionSignature(section);
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        sections.push(section);
      }
      const properties = feature.properties || {};
      if (properties.osm_type && properties.osm_id) {
        featureIds.push(`${properties.osm_type}/${properties.osm_id}`);
      }
    }

    if (sections.length === 0) return null;
    return {
      streetId: street.id,
      displayName: street.displayName,
      type: "MultiLineString",
      sections,
      source,
      featureIds: [...new Set(featureIds)],
      sourceGeometryTypes: [...sourceGeometryTypes]
    };
  }

  function isValidStreetGeometry(geometry, streetId) {
    return geometry?.type === "MultiLineString"
      && (!streetId || geometry.streetId === streetId)
      && Array.isArray(geometry.sections)
      && geometry.sections.some(section => Array.isArray(section) && section.length >= 2);
  }

  function findNearestPointOnSections(sections, clickedCoordinates, turfApi) {
    const clickedPoint = turfApi.point(clickedCoordinates);
    let best = null;

    sections.forEach((coordinates, sectionIndex) => {
      if (!Array.isArray(coordinates) || coordinates.length < 2) return;
      const line = turfApi.lineString(coordinates);
      const distanceMeters = turfApi.pointToLineDistance(clickedPoint, line, { units: "meters" });
      const nearest = turfApi.nearestPointOnLine(line, clickedPoint, { units: "meters" });
      if (!best || distanceMeters < best.distanceMeters) {
        best = {
          distanceMeters,
          nearestCoordinate: nearest.geometry.coordinates,
          sectionIndex
        };
      }
    });
    return best;
  }

  return {
    normalizeStreetName,
    createStreetId,
    prepareStreetRecords,
    getStreetNameKeys,
    featureMatchesStreet,
    featureBelongsToMunicipality,
    clipLineToBbox,
    extractLineSections,
    mergeStreetFeatures,
    isValidStreetGeometry,
    findNearestPointOnSections
  };
});
