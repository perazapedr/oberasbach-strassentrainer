(function initializeCityDataValidator(root, factory) {
  "use strict";
  const commonJsGeometry = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./geometry.js")
    : null;
  const api = factory((root && root.StreetGeometry) || commonJsGeometry);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerCityDataValidator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCityDataValidatorApi(geometryApi) {
  "use strict";

  const SUPPORTED_POI_CATEGORIES = Object.freeze([
    "fire_station",
    "school",
    "kindergarten",
    "supermarket"
  ]);
  const SUPPORTED_STREET_HIGHWAY_TYPES = Object.freeze([
    "residential",
    "living_street",
    "unclassified",
    "tertiary",
    "secondary",
    "primary"
  ]);
  const VALID_OSM_TYPES = new Set(["node", "way", "relation"]);

  // Only immediately adjoining street geometries are merged automatically. Eight metres
  // tolerates normal OSM node offsets without joining distinct nearby parallel roads.
  const STREET_MERGE_DISTANCE_METERS = 8;
  // Same-name POIs this close are worth a warning, but are not merged without the much
  // stronger node-inside-polygon evidence.
  const POI_POSSIBLE_DUPLICATE_DISTANCE_METERS = 50;
  // Curated positions can represent entrances while OSM positions represent site centres.
  // Fifty metres is therefore a conservative default for a noteworthy, not fatal, difference.
  const CURATED_POSITION_DIFFERENCE_METERS = 50;
  const CURATED_POI_MATCH_DISTANCE_METERS = 75;
  const COORDINATE_EPSILON = 1e-10;

  const DEFAULT_CURATED_CATEGORY_MAP = Object.freeze({
    fire_station: "fire_station",
    school: "school",
    kindergarten: "kindergarten",
    childcare: "kindergarten",
    supermarket: "supermarket"
  });
  const DEFAULT_CURATED_SUBCATEGORY_MAP = Object.freeze({
    "feuerwehrgerätehaus": "fire_station"
  });

  function cloneValue(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = cloneValue(value[key], seen);
    return copy;
  }

  function trimmedString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function compareText(first, second) {
    return String(first).localeCompare(String(second), "de", { sensitivity: "base" })
      || String(first).localeCompare(String(second), "de")
      || String(first).localeCompare(String(second));
  }

  function compareIds(first, second) {
    return compareText(first.id || "", second.id || "")
      || compareText(first.name || "", second.name || "");
  }

  function normalizeGeneralText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("de-DE")
      .replace(/ß/g, "ss")
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/[.,;:()]+/g, " ")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeStreetComparisonName(value) {
    let normalized;
    if (geometryApi && typeof geometryApi.normalizeStreetName === "function") {
      normalized = geometryApi.normalizeStreetName(value);
    } else {
      normalized = normalizeGeneralText(value)
        .replace(/\bstr\.(?=$|[\s-])/g, "strasse")
        .replace(/\bstr(?=$|[\s-])/g, "strasse");
    }
    return normalized.replace(/str(?=$|[\s-])/g, "strasse");
  }

  function validPosition(position) {
    if (!position || typeof position !== "object" || Array.isArray(position)) return null;
    const lat = finiteNumber(position.lat);
    const lon = finiteNumber(position.lon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  function validCoordinate(coordinate) {
    if (!Array.isArray(coordinate) || coordinate.length !== 2) return false;
    const lon = finiteNumber(coordinate[0]);
    const lat = finiteNumber(coordinate[1]);
    return lon !== null && lat !== null && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
  }

  function coordinatesEqual(first, second, epsilon = COORDINATE_EPSILON) {
    return validCoordinate(first) && validCoordinate(second)
      && Math.abs(first[0] - second[0]) <= epsilon
      && Math.abs(first[1] - second[1]) <= epsilon;
  }

  function ringArea(ring) {
    let twiceArea = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      twiceArea += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
    }
    return twiceArea / 2;
  }

  function validRing(ring) {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(validCoordinate)) return false;
    if (!coordinatesEqual(ring[0], ring[ring.length - 1])) return false;
    const distinct = new Set(ring.slice(0, -1).map(point => `${point[0]},${point[1]}`));
    return distinct.size >= 3 && Math.abs(ringArea(ring)) > 1e-14;
  }

  function validPolygonCoordinates(coordinates) {
    return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(validRing);
  }

  function validAreaGeometry(geometry) {
    if (!geometry || typeof geometry !== "object") return false;
    if (geometry.type === "Polygon") return validPolygonCoordinates(geometry.coordinates);
    return geometry.type === "MultiPolygon"
      && Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && geometry.coordinates.every(validPolygonCoordinates);
  }

  function validStreetGeometry(geometry) {
    return Boolean(geometry
      && geometry.type === "MultiLineString"
      && Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && geometry.coordinates.every(line => (
        Array.isArray(line) && line.length >= 2 && line.every(validCoordinate)
      )));
  }

  function pointOnSegment(point, start, end) {
    const cross = (point[1] - start[1]) * (end[0] - start[0])
      - (point[0] - start[0]) * (end[1] - start[1]);
    const scale = Math.max(1, Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
    if (Math.abs(cross) > COORDINATE_EPSILON * scale) return false;
    return point[0] >= Math.min(start[0], end[0]) - COORDINATE_EPSILON
      && point[0] <= Math.max(start[0], end[0]) + COORDINATE_EPSILON
      && point[1] >= Math.min(start[1], end[1]) - COORDINATE_EPSILON
      && point[1] <= Math.max(start[1], end[1]) + COORDINATE_EPSILON;
  }

  function pointLocationInRing(point, ring) {
    let inside = false;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (pointOnSegment(point, start, end)) return 0;
      const crossesLatitude = (start[1] > point[1]) !== (end[1] > point[1]);
      if (!crossesLatitude) continue;
      const crossingLongitude = ((end[0] - start[0]) * (point[1] - start[1]))
        / (end[1] - start[1]) + start[0];
      if (point[0] < crossingLongitude) inside = !inside;
    }
    return inside ? 1 : -1;
  }

  function pointLocationInPolygon(point, polygonCoordinates) {
    const outerLocation = pointLocationInRing(point, polygonCoordinates[0]);
    if (outerLocation <= 0) return outerLocation;
    for (let index = 1; index < polygonCoordinates.length; index += 1) {
      const holeLocation = pointLocationInRing(point, polygonCoordinates[index]);
      if (holeLocation === 0) return 0;
      if (holeLocation === 1) return -1;
    }
    return 1;
  }

  function pointLocationInGeometry(point, geometry) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let boundary = false;
    for (const polygon of polygons) {
      const location = pointLocationInPolygon(point, polygon);
      if (location === 1) return 1;
      if (location === 0) boundary = true;
    }
    return boundary ? 0 : -1;
  }

  function orientation(first, second, third) {
    return (second[0] - first[0]) * (third[1] - first[1])
      - (second[1] - first[1]) * (third[0] - first[0]);
  }

  function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
    const firstA = orientation(firstStart, firstEnd, secondStart);
    const firstB = orientation(firstStart, firstEnd, secondEnd);
    const secondA = orientation(secondStart, secondEnd, firstStart);
    const secondB = orientation(secondStart, secondEnd, firstEnd);
    if (((firstA > COORDINATE_EPSILON && firstB < -COORDINATE_EPSILON)
      || (firstA < -COORDINATE_EPSILON && firstB > COORDINATE_EPSILON))
      && ((secondA > COORDINATE_EPSILON && secondB < -COORDINATE_EPSILON)
        || (secondA < -COORDINATE_EPSILON && secondB > COORDINATE_EPSILON))) return true;
    return (Math.abs(firstA) <= COORDINATE_EPSILON && pointOnSegment(secondStart, firstStart, firstEnd))
      || (Math.abs(firstB) <= COORDINATE_EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd))
      || (Math.abs(secondA) <= COORDINATE_EPSILON && pointOnSegment(firstStart, secondStart, secondEnd))
      || (Math.abs(secondB) <= COORDINATE_EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd));
  }

  function geometryRings(geometry) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flatMap(polygon => polygon);
  }

  function segmentIntersectsGeometry(start, end, geometry) {
    for (const ring of geometryRings(geometry)) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        if (segmentsIntersect(start, end, ring[index], ring[index + 1])) return true;
      }
    }
    return false;
  }

  function classifyStreetAgainstBoundary(streetGeometry, boundary) {
    let hasInside = false;
    let hasOutside = false;
    let hasIntersection = false;
    for (const line of streetGeometry.coordinates) {
      for (const point of line) {
        if (pointLocationInGeometry(point, boundary) >= 0) hasInside = true;
        else hasOutside = true;
      }
      for (let index = 0; index < line.length - 1; index += 1) {
        if (segmentIntersectsGeometry(line[index], line[index + 1], boundary)) hasIntersection = true;
      }
    }
    if (!hasInside && !hasIntersection) return "outside";
    return hasOutside || (!hasInside && hasIntersection) ? "partial" : "inside";
  }

  function areaGeometryIntersects(firstGeometry, secondGeometry) {
    const firstPolygons = firstGeometry.type === "Polygon" ? [firstGeometry.coordinates] : firstGeometry.coordinates;
    const secondPolygons = secondGeometry.type === "Polygon" ? [secondGeometry.coordinates] : secondGeometry.coordinates;
    for (const polygon of firstPolygons) {
      for (const point of polygon[0]) {
        if (pointLocationInGeometry(point, secondGeometry) >= 0) return true;
      }
    }
    for (const polygon of secondPolygons) {
      for (const point of polygon[0]) {
        if (pointLocationInGeometry(point, firstGeometry) >= 0) return true;
      }
    }
    for (const firstRing of geometryRings(firstGeometry)) {
      for (let firstIndex = 0; firstIndex < firstRing.length - 1; firstIndex += 1) {
        if (segmentIntersectsGeometry(firstRing[firstIndex], firstRing[firstIndex + 1], secondGeometry)) return true;
      }
    }
    return false;
  }

  function areaGeometryPartlyOutside(geometry, boundary) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let inside = false;
    let outside = false;
    for (const polygon of polygons) {
      for (const point of polygon[0]) {
        if (pointLocationInGeometry(point, boundary) >= 0) inside = true;
        else outside = true;
      }
    }
    return outside && (inside || areaGeometryIntersects(geometry, boundary));
  }

  function haversineDistanceMeters(first, second) {
    const radians = degrees => degrees * Math.PI / 180;
    const firstLat = radians(first.lat);
    const secondLat = radians(second.lat);
    const deltaLat = secondLat - firstLat;
    const deltaLon = radians(second.lon - first.lon);
    const value = Math.sin(deltaLat / 2) ** 2
      + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLon / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
  }

  function projectedPoint(coordinate, referenceLatitude) {
    const radians = referenceLatitude * Math.PI / 180;
    return [coordinate[0] * 111320 * Math.cos(radians), coordinate[1] * 110540];
  }

  function pointToSegmentDistanceMeters(point, start, end) {
    const referenceLatitude = (point[1] + start[1] + end[1]) / 3;
    const projected = projectedPoint(point, referenceLatitude);
    const projectedStart = projectedPoint(start, referenceLatitude);
    const projectedEnd = projectedPoint(end, referenceLatitude);
    const deltaX = projectedEnd[0] - projectedStart[0];
    const deltaY = projectedEnd[1] - projectedStart[1];
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((projected[0] - projectedStart[0]) * deltaX + (projected[1] - projectedStart[1]) * deltaY)
        / lengthSquared));
    return Math.hypot(
      projected[0] - (projectedStart[0] + ratio * deltaX),
      projected[1] - (projectedStart[1] + ratio * deltaY)
    );
  }

  function segmentDistanceMeters(firstStart, firstEnd, secondStart, secondEnd) {
    if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
    return Math.min(
      pointToSegmentDistanceMeters(firstStart, secondStart, secondEnd),
      pointToSegmentDistanceMeters(firstEnd, secondStart, secondEnd),
      pointToSegmentDistanceMeters(secondStart, firstStart, firstEnd),
      pointToSegmentDistanceMeters(secondEnd, firstStart, firstEnd)
    );
  }

  function streetGeometriesAreAdjacent(first, second, thresholdMeters) {
    for (const firstLine of first.coordinates) {
      for (let firstIndex = 0; firstIndex < firstLine.length - 1; firstIndex += 1) {
        for (const secondLine of second.coordinates) {
          for (let secondIndex = 0; secondIndex < secondLine.length - 1; secondIndex += 1) {
            if (segmentDistanceMeters(
              firstLine[firstIndex], firstLine[firstIndex + 1],
              secondLine[secondIndex], secondLine[secondIndex + 1]
            ) <= thresholdMeters) return true;
          }
        }
      }
    }
    return false;
  }

  function issue(code, severity, entityType, entityId, message, details) {
    const result = {
      code,
      severity,
      entityType,
      entityId: entityId || null,
      message
    };
    if (details !== undefined) result.details = cloneValue(details);
    return result;
  }

  function createSection(totalInput) {
    return {
      totalInput,
      totalOutput: 0,
      invalidRemoved: 0,
      duplicatesMerged: 0,
      warningCount: 0,
      warnings: [],
      errors: []
    };
  }

  function addWarning(section, warning) {
    section.warnings.push(warning);
    section.warningCount = section.warnings.length;
  }

  function addError(section, error) {
    section.errors.push(error);
  }

  function validateBounds(bounds) {
    if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return false;
    const south = finiteNumber(bounds.south);
    const west = finiteNumber(bounds.west);
    const north = finiteNumber(bounds.north);
    const east = finiteNumber(bounds.east);
    return south !== null && west !== null && north !== null && east !== null
      && south >= -90 && north <= 90 && west >= -180 && east <= 180
      && south <= north && west <= east;
  }

  function validateMunicipality(city, boundary) {
    const municipality = { valid: true, warnings: [], errors: [] };
    const fail = (code, message) => {
      municipality.errors.push(issue(code, "error", "city", city && city.id, message));
      municipality.valid = false;
    };
    if (!city || typeof city !== "object" || Array.isArray(city)) {
      fail("CITY_MISSING", "Stadtmetadaten fehlen oder sind ungültig.");
      if (boundary === null || boundary === undefined) fail("CITY_BOUNDARY_MISSING", "Die administrative Gemeindegrenze fehlt.");
      else if (!validAreaGeometry(boundary)) fail("CITY_BOUNDARY_INVALID", "Die administrative Gemeindegrenze ist geometrisch ungültig.");
      return municipality;
    }
    if (!trimmedString(city.id)) fail("CITY_ID_MISSING", "Die Stadt-ID fehlt.");
    if (!trimmedString(city.name)) fail("CITY_NAME_MISSING", "Der Stadtname fehlt.");
    if (city.osmType !== "relation") fail("CITY_OSM_TYPE_INVALID", "Die Stadt muss auf einer administrativen OSM-Relation beruhen.");
    if (!Number.isSafeInteger(city.osmId) || city.osmId <= 0) fail("CITY_OSM_ID_INVALID", "Die OSM-Relations-ID der Stadt ist ungültig.");
    if (!validateBounds(city.bounds)) fail("CITY_BOUNDS_INVALID", "Die Stadt-Bounds sind strukturell ungültig.");
    const center = validPosition(city.center);
    if (!center) fail("CITY_CENTER_INVALID", "Der Stadtmittelpunkt ist ungültig.");
    if (boundary === null || boundary === undefined) fail("CITY_BOUNDARY_MISSING", "Die administrative Gemeindegrenze fehlt.");
    else if (!validAreaGeometry(boundary)) fail("CITY_BOUNDARY_INVALID", "Die administrative Gemeindegrenze ist geometrisch ungültig.");
    else if (center && pointLocationInGeometry([center.lon, center.lat], boundary) < 0) {
      municipality.warnings.push(issue(
        "CITY_CENTER_OUTSIDE_BOUNDARY",
        "warning",
        "city",
        city.id,
        "Der Stadtmittelpunkt liegt außerhalb der administrativen Grenze."
      ));
    }
    return municipality;
  }

  function streetStructuralError(street, cityId) {
    const entityId = street && trimmedString(street.id);
    if (!street || typeof street !== "object" || Array.isArray(street)) {
      return issue("STREET_INVALID", "error", "street", null, "Der Straßendatensatz ist ungültig.");
    }
    if (!entityId) return issue("STREET_ID_MISSING", "error", "street", null, "Die Straßen-ID fehlt.");
    if (street.cityId !== cityId) {
      return issue("STREET_CITY_ID_INVALID", "error", "street", entityId, "Die Straße verweist nicht auf die validierte Stadt.");
    }
    if (!trimmedString(street.name)) {
      return issue("STREET_NAME_MISSING", "error", "street", entityId, "Der Straßenname fehlt.");
    }
    if (!street.geometry) {
      return issue("STREET_GEOMETRY_MISSING", "error", "street", entityId, "Die Straßengeometrie fehlt.");
    }
    if (!validStreetGeometry(street.geometry)) {
      return issue("STREET_GEOMETRY_INVALID", "error", "street", entityId, "Die Straßengeometrie ist ungültig.");
    }
    if (!Array.isArray(street.osmWayIds) || street.osmWayIds.length === 0
      || street.osmWayIds.some(osmId => !Number.isSafeInteger(osmId) || osmId <= 0)) {
      return issue("STREET_OSM_WAY_IDS_INVALID", "error", "street", entityId, "Die OSM-Way-IDs der Straße fehlen oder sind ungültig.");
    }
    return null;
  }

  function preferredStreetRecord(first, second) {
    const quality = street => {
      const name = trimmedString(street.name);
      const abbreviated = /(?:^|[\s-])str\.?$/i.test(name) || /str\.$/i.test(name);
      const explicitStreet = /straße(?:$|[\s-])/i.test(name) || /strasse(?:$|[\s-])/i.test(name);
      return [abbreviated ? 0 : 1, explicitStreet ? 1 : 0, name.length];
    };
    const firstQuality = quality(first);
    const secondQuality = quality(second);
    for (let index = 0; index < firstQuality.length; index += 1) {
      if (firstQuality[index] !== secondQuality[index]) {
        return firstQuality[index] > secondQuality[index] ? first : second;
      }
    }
    return compareIds(first, second) <= 0 ? first : second;
  }

  function uniqueStrings(values, excludedValue) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
      const text = trimmedString(value);
      if (!text || text === excludedValue || seen.has(text)) continue;
      seen.add(text);
      output.push(text);
    }
    return output.sort(compareText);
  }

  function mergeStreetComponent(component) {
    const sorted = [...component].sort(compareIds);
    const canonical = sorted.reduce(preferredStreetRecord);
    const linesByKey = new Map();
    for (const street of sorted) {
      for (const line of street.geometry.coordinates) {
        const key = JSON.stringify(line);
        if (!linesByKey.has(key)) linesByKey.set(key, cloneValue(line));
      }
    }
    const merged = cloneValue(canonical);
    merged.aliases = uniqueStrings(sorted.flatMap(street => [street.name, ...(street.aliases || [])]), canonical.name);
    merged.geometry = {
      type: "MultiLineString",
      coordinates: [...linesByKey.entries()].sort((first, second) => compareText(first[0], second[0])).map(entry => entry[1])
    };
    merged.osmWayIds = [...new Set(sorted.flatMap(street => street.osmWayIds))].sort((first, second) => first - second);
    return merged;
  }

  function connectedStreetComponents(streets, thresholdMeters) {
    const components = [];
    const visited = new Set();
    for (let startIndex = 0; startIndex < streets.length; startIndex += 1) {
      if (visited.has(startIndex)) continue;
      const stack = [startIndex];
      const component = [];
      visited.add(startIndex);
      while (stack.length > 0) {
        const currentIndex = stack.pop();
        component.push(streets[currentIndex]);
        for (let candidateIndex = 0; candidateIndex < streets.length; candidateIndex += 1) {
          if (visited.has(candidateIndex)) continue;
          if (streetGeometriesAreAdjacent(
            streets[currentIndex].geometry,
            streets[candidateIndex].geometry,
            thresholdMeters
          )) {
            visited.add(candidateIndex);
            stack.push(candidateIndex);
          }
        }
      }
      components.push(component.sort(compareIds));
    }
    return components;
  }

  function validateStreets(rawStreets, cityId, boundary, options, section) {
    const structurallyValid = [];
    for (const rawStreet of rawStreets) {
      const structuralError = streetStructuralError(rawStreet, cityId);
      if (structuralError) {
        section.invalidRemoved += 1;
        addError(section, structuralError);
        continue;
      }
      const street = cloneValue(rawStreet);
      const boundaryClassification = boundary ? classifyStreetAgainstBoundary(street.geometry, boundary) : null;
      if (boundaryClassification === "outside") {
        section.invalidRemoved += 1;
        addError(section, issue(
          "STREET_OUTSIDE_BOUNDARY",
          "error",
          "street",
          street.id,
          "Die Straße liegt vollständig außerhalb der administrativen Gemeindegrenze."
        ));
        continue;
      }
      if (boundaryClassification === "partial") {
        addWarning(section, issue(
          "STREET_PARTLY_OUTSIDE_BOUNDARY",
          "warning",
          "street",
          street.id,
          "Die Straße liegt nur teilweise innerhalb der administrativen Gemeindegrenze."
        ));
      }
      street.aliases = uniqueStrings(Array.isArray(street.aliases) ? street.aliases : [], street.name);
      street.osmWayIds = [...new Set(street.osmWayIds)].sort((first, second) => first - second);
      structurallyValid.push(street);
    }

    const groups = new Map();
    for (const street of structurallyValid.sort(compareIds)) {
      const comparisonName = normalizeStreetComparisonName(street.name);
      if (!groups.has(comparisonName)) groups.set(comparisonName, []);
      groups.get(comparisonName).push(street);
    }

    const output = [];
    const threshold = options.streetMergeDistanceMeters;
    for (const comparisonName of [...groups.keys()].sort(compareText)) {
      const group = groups.get(comparisonName);
      const components = connectedStreetComponents(group, threshold);
      const representatives = [];
      for (const component of components) {
        if (component.length === 1) {
          representatives.push(component[0]);
          continue;
        }
        const merged = mergeStreetComponent(component);
        section.duplicatesMerged += component.length - 1;
        addWarning(section, issue(
          "STREET_DUPLICATE_MERGED",
          "warning",
          "street",
          merged.id,
          `${component.length} sicher zusammengehörige Straßendatensätze wurden zusammengeführt.`,
          { mergedEntityIds: component.map(street => street.id), comparisonName }
        ));
        representatives.push(merged);
      }
      if (representatives.length > 1) {
        addWarning(section, issue(
          "STREET_POSSIBLE_DUPLICATE",
          "warning",
          "street",
          representatives[0].id,
          "Namensäquivalente, räumlich nicht sicher verbundene Straßen wurden nicht automatisch zusammengeführt.",
          { candidateIds: representatives.map(street => street.id).sort(compareText), comparisonName }
        ));
      }
      output.push(...representatives);
    }
    return output.sort(compareIds);
  }

  function derivePositionFromGeometry(geometry) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const ranked = polygons.map(polygon => ({ polygon, area: Math.abs(ringArea(polygon[0])) }))
      .sort((first, second) => second.area - first.area);
    for (const entry of ranked) {
      const ring = entry.polygon[0];
      let areaFactor = 0;
      let centroidX = 0;
      let centroidY = 0;
      for (let index = 0; index < ring.length - 1; index += 1) {
        const cross = ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
        areaFactor += cross;
        centroidX += (ring[index][0] + ring[index + 1][0]) * cross;
        centroidY += (ring[index][1] + ring[index + 1][1]) * cross;
      }
      if (Math.abs(areaFactor) > 1e-14) {
        const coordinate = [centroidX / (3 * areaFactor), centroidY / (3 * areaFactor)];
        if (validCoordinate(coordinate) && pointLocationInPolygon(coordinate, entry.polygon) >= 0) {
          return { lat: coordinate[1], lon: coordinate[0] };
        }
      }
      const fallback = ring[0];
      if (validCoordinate(fallback)) return { lat: fallback[1], lon: fallback[0] };
    }
    return null;
  }

  function poiStructuralError(poi, cityId) {
    const entityId = poi && trimmedString(poi.id);
    if (!poi || typeof poi !== "object" || Array.isArray(poi)) {
      return issue("POI_INVALID", "error", "poi", null, "Der POI-Datensatz ist ungültig.");
    }
    if (!entityId) return issue("POI_ID_MISSING", "error", "poi", null, "Die POI-ID fehlt.");
    if (poi.cityId !== cityId) {
      return issue("POI_CITY_ID_INVALID", "error", "poi", entityId, "Der POI verweist nicht auf die validierte Stadt.");
    }
    if (!trimmedString(poi.name)) return issue("POI_NAME_MISSING", "error", "poi", entityId, "Der POI-Name fehlt.");
    if (!trimmedString(poi.category)) return issue("POI_CATEGORY_MISSING", "error", "poi", entityId, "Die POI-Kategorie fehlt.");
    if (!SUPPORTED_POI_CATEGORIES.includes(poi.category)) {
      return issue("POI_CATEGORY_INVALID", "error", "poi", entityId, "Die POI-Kategorie wird vom aktuellen Importmodell nicht unterstützt.");
    }
    if (!VALID_OSM_TYPES.has(poi.osmType)) {
      return issue("POI_OSM_TYPE_INVALID", "error", "poi", entityId, "Der OSM-Typ des POIs ist ungültig.");
    }
    if (!Number.isSafeInteger(poi.osmId) || poi.osmId <= 0) {
      return issue("POI_OSM_ID_INVALID", "error", "poi", entityId, "Die OSM-ID des POIs ist ungültig.");
    }
    return null;
  }

  function poiNameKeys(poi) {
    return new Set([poi.name, ...(Array.isArray(poi.aliases) ? poi.aliases : [])]
      .map(normalizeGeneralText)
      .filter(Boolean));
  }

  function setsIntersect(first, second) {
    for (const value of first) if (second.has(value)) return true;
    return false;
  }

  function sourceOsmObjects(poi) {
    const sources = [];
    if (VALID_OSM_TYPES.has(poi.osmType) && Number.isSafeInteger(poi.osmId) && poi.osmId > 0) {
      sources.push({ osmType: poi.osmType, osmId: poi.osmId });
    }
    if (Array.isArray(poi.sourceOsmObjects)) {
      for (const source of poi.sourceOsmObjects) {
        if (source && VALID_OSM_TYPES.has(source.osmType)
          && Number.isSafeInteger(source.osmId) && source.osmId > 0) {
          sources.push({ osmType: source.osmType, osmId: source.osmId });
        }
      }
    }
    const typeRank = { node: 0, way: 1, relation: 2 };
    const unique = new Map(sources.map(source => [`${source.osmType}:${source.osmId}`, source]));
    return [...unique.values()].sort((first, second) => (
      typeRank[first.osmType] - typeRank[second.osmType] || first.osmId - second.osmId
    ));
  }

  function safePoiPair(first, second) {
    if (first.category !== second.category || !setsIntersect(poiNameKeys(first), poiNameKeys(second))) return false;
    const firstHasArea = validAreaGeometry(first.geometry);
    const secondHasArea = validAreaGeometry(second.geometry);
    if (firstHasArea === secondHasArea) return false;
    const areaPoi = firstHasArea ? first : second;
    const pointPoi = firstHasArea ? second : first;
    return Boolean(validPosition(pointPoi.position)
      && pointLocationInGeometry([pointPoi.position.lon, pointPoi.position.lat], areaPoi.geometry) >= 0);
  }

  function preferredPoi(first, second) {
    const firstHasArea = validAreaGeometry(first.geometry);
    const secondHasArea = validAreaGeometry(second.geometry);
    if (firstHasArea !== secondHasArea) return firstHasArea ? first : second;
    const rank = { relation: 2, way: 1, node: 0 };
    if (rank[first.osmType] !== rank[second.osmType]) return rank[first.osmType] > rank[second.osmType] ? first : second;
    return compareIds(first, second) <= 0 ? first : second;
  }

  function mergePoiPair(first, second) {
    const canonical = preferredPoi(first, second);
    const merged = cloneValue(canonical);
    merged.aliases = uniqueStrings([
      first.name,
      ...(first.aliases || []),
      second.name,
      ...(second.aliases || [])
    ], canonical.name);
    merged.sourceOsmObjects = sourceOsmObjects({
      osmType: canonical.osmType,
      osmId: canonical.osmId,
      sourceOsmObjects: [...sourceOsmObjects(first), ...sourceOsmObjects(second)]
    });
    const canonicalTags = canonical.tags && typeof canonical.tags === "object" ? canonical.tags : {};
    const other = canonical === first ? second : first;
    const otherTags = other.tags && typeof other.tags === "object" ? other.tags : {};
    merged.tags = { ...cloneValue(otherTags), ...cloneValue(canonicalTags) };
    return merged;
  }

  function poiAddressFromTags(poi) {
    const tags = poi && poi.tags && typeof poi.tags === "object" ? poi.tags : {};
    const street = trimmedString(tags["addr:street"]);
    const houseNumber = trimmedString(tags["addr:housenumber"]);
    const postcode = trimmedString(tags["addr:postcode"]);
    const city = trimmedString(tags["addr:city"]);
    const firstPart = [street, houseNumber].filter(Boolean).join(" ");
    const secondPart = [postcode, city].filter(Boolean).join(" ");
    return [firstPart, secondPart].filter(Boolean).join(", ") || trimmedString(poi && poi.address);
  }

  function normalizeAddress(value) {
    return normalizeGeneralText(value)
      .replace(/\s*,\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function possiblePoiPair(first, second, thresholdMeters) {
    if (first.category !== second.category || !setsIntersect(poiNameKeys(first), poiNameKeys(second))) return false;
    const firstPosition = validPosition(first.position);
    const secondPosition = validPosition(second.position);
    if (firstPosition && secondPosition && haversineDistanceMeters(firstPosition, secondPosition) <= thresholdMeters) return true;
    const firstAddress = normalizeAddress(poiAddressFromTags(first));
    const secondAddress = normalizeAddress(poiAddressFromTags(second));
    return Boolean(firstAddress && firstAddress === secondAddress);
  }

  function validatePois(rawPois, cityId, boundary, options, section) {
    const usable = [];
    for (const rawPoi of rawPois) {
      const structuralError = poiStructuralError(rawPoi, cityId);
      if (structuralError) {
        section.invalidRemoved += 1;
        addError(section, structuralError);
        continue;
      }
      const poi = cloneValue(rawPoi);
      let position = validPosition(poi.position);
      let areaValid = poi.geometry !== null && poi.geometry !== undefined && validAreaGeometry(poi.geometry);
      if (poi.geometry !== null && poi.geometry !== undefined && !areaValid) {
        if (!position) {
          section.invalidRemoved += 1;
          addError(section, issue("POI_GEOMETRY_INVALID", "error", "poi", poi.id,
            "POI-Geometrie und POI-Position sind unbrauchbar."));
          continue;
        }
        poi.geometry = null;
        addWarning(section, issue("POI_GEOMETRY_INVALID", "warning", "poi", poi.id,
          "Die ungültige POI-Geometrie wurde verworfen; die gültige Position bleibt nutzbar."));
        areaValid = false;
      }
      if (!position && areaValid) {
        position = derivePositionFromGeometry(poi.geometry);
        if (position) {
          poi.position = position;
          addWarning(section, issue("POI_POSITION_DERIVED_FROM_GEOMETRY", "warning", "poi", poi.id,
            "Die fehlende oder ungültige POI-Position wurde aus der validen Flächengeometrie abgeleitet."));
        }
      }
      if (!position) {
        section.invalidRemoved += 1;
        addError(section, issue("POI_POSITION_INVALID", "error", "poi", poi.id,
          "Der POI besitzt keine brauchbare Position."));
        continue;
      }
      poi.position = position;
      if (poi.geometry === undefined) poi.geometry = null;
      poi.aliases = uniqueStrings(Array.isArray(poi.aliases) ? poi.aliases : [], poi.name);

      if (boundary) {
        const positionInside = pointLocationInGeometry([position.lon, position.lat], boundary) >= 0;
        const geometryIntersects = areaValid && areaGeometryIntersects(poi.geometry, boundary);
        if (!positionInside && !geometryIntersects) {
          section.invalidRemoved += 1;
          addError(section, issue("POI_OUTSIDE_BOUNDARY", "error", "poi", poi.id,
            "Der POI liegt vollständig außerhalb der administrativen Gemeindegrenze."));
          continue;
        }
        if (areaValid && areaGeometryPartlyOutside(poi.geometry, boundary)) {
          addWarning(section, issue("POI_PARTLY_OUTSIDE_BOUNDARY", "warning", "poi", poi.id,
            "Die POI-Fläche liegt nur teilweise innerhalb der administrativen Gemeindegrenze."));
        }
      }
      usable.push(poi);
    }

    const working = usable.sort(compareIds);
    let mergedPair = true;
    while (mergedPair) {
      mergedPair = false;
      for (let firstIndex = 0; firstIndex < working.length && !mergedPair; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < working.length; secondIndex += 1) {
          if (!safePoiPair(working[firstIndex], working[secondIndex])) continue;
          const originalIds = [working[firstIndex].id, working[secondIndex].id].sort(compareText);
          const merged = mergePoiPair(working[firstIndex], working[secondIndex]);
          working.splice(secondIndex, 1);
          working.splice(firstIndex, 1, merged);
          working.sort(compareIds);
          section.duplicatesMerged += 1;
          addWarning(section, issue("POI_DUPLICATE_MERGED", "warning", "poi", merged.id,
            "Ein sicher äquivalenter Node-/Polygon-POI wurde zusammengeführt.",
            { mergedEntityIds: originalIds, sourceOsmObjects: merged.sourceOsmObjects }));
          mergedPair = true;
          break;
        }
      }
    }

    for (let firstIndex = 0; firstIndex < working.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < working.length; secondIndex += 1) {
        if (!possiblePoiPair(working[firstIndex], working[secondIndex], options.poiPossibleDuplicateDistanceMeters)) continue;
        addWarning(section, issue("POI_POSSIBLE_DUPLICATE", "warning", "poi", working[firstIndex].id,
          "Ähnliche nahe POIs wurden mangels eindeutiger Node-/Polygon-Evidenz nicht zusammengeführt.",
          { candidateIds: [working[firstIndex].id, working[secondIndex].id].sort(compareText) }));
      }
    }
    return working.sort(compareIds);
  }

  function numericOption(options, key, defaultValue) {
    const value = options[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : defaultValue;
  }

  function normalizedValidationOptions(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Validation options must be an object.");
    }
    return {
      streetMergeDistanceMeters: numericOption(options, "streetMergeDistanceMeters", STREET_MERGE_DISTANCE_METERS),
      poiPossibleDuplicateDistanceMeters: numericOption(
        options,
        "poiPossibleDuplicateDistanceMeters",
        POI_POSSIBLE_DUPLICATE_DISTANCE_METERS
      )
    };
  }

  function validateCityData(cityData, options = {}) {
    const normalizedOptions = normalizedValidationOptions(options);
    const input = cityData && typeof cityData === "object" && !Array.isArray(cityData) ? cityData : {};
    const city = input.city && typeof input.city === "object" && !Array.isArray(input.city)
      ? cloneValue(input.city)
      : null;
    const boundaryInput = input.boundary;
    const boundaryValid = validAreaGeometry(boundaryInput);
    const boundary = boundaryInput === undefined ? null : cloneValue(boundaryInput);
    const rawStreets = Array.isArray(input.streets) ? input.streets : [];
    const rawPois = Array.isArray(input.pois) ? input.pois : [];
    const municipality = validateMunicipality(city, boundaryInput);
    const streetsSection = createSection(rawStreets.length);
    const poisSection = createSection(rawPois.length);
    const cityId = city ? city.id : undefined;
    const validatedStreets = validateStreets(
      rawStreets,
      cityId,
      boundaryValid ? boundaryInput : null,
      normalizedOptions,
      streetsSection
    );
    const validatedPois = validatePois(
      rawPois,
      cityId,
      boundaryValid ? boundaryInput : null,
      normalizedOptions,
      poisSection
    );
    streetsSection.totalOutput = validatedStreets.length;
    poisSection.totalOutput = validatedPois.length;

    if (!Array.isArray(input.streets)) {
      addError(streetsSection, issue("CITY_STREETS_INVALID", "error", "city", cityId,
        "Das Stadtpaket enthält kein gültiges Straßen-Array."));
    }
    if (!Array.isArray(input.pois)) {
      addError(poisSection, issue("CITY_POIS_INVALID", "error", "city", cityId,
        "Das Stadtpaket enthält kein gültiges POI-Array."));
    }
    if (validatedStreets.length === 0) {
      municipality.errors.push(issue("CITY_NO_PLAYABLE_STREETS", "error", "city", cityId,
        "Nach der Validierung sind keine spielbaren Straßen vorhanden."));
      municipality.valid = false;
    }

    const validatedCity = city ? {
      ...city,
      streetCount: validatedStreets.length,
      poiCount: validatedPois.length
    } : null;
    const warningCount = municipality.warnings.length + streetsSection.warnings.length + poisSection.warnings.length;
    const errorCount = municipality.errors.length + streetsSection.errors.length + poisSection.errors.length;
    const valid = municipality.valid && validatedStreets.length > 0;
    const validation = {
      valid,
      municipality,
      streets: streetsSection,
      pois: poisSection,
      summary: { warningCount, errorCount }
    };
    return {
      valid,
      city: validatedCity,
      streets: validatedStreets,
      pois: validatedPois,
      boundary,
      validation
    };
  }

  function entitySummary(entity) {
    const summary = {
      id: trimmedString(entity && entity.id) || null,
      name: trimmedString(entity && (entity.name || entity.displayName)) || null
    };
    if (entity && entity.category !== undefined) summary.category = entity.category;
    if (entity && entity.osmType !== undefined) summary.osmType = entity.osmType;
    if (entity && entity.osmId !== undefined) summary.osmId = entity.osmId;
    return summary;
  }

  function streetNameKeys(street) {
    return new Set([street && (street.name || street.displayName), ...(Array.isArray(street && street.aliases) ? street.aliases : [])]
      .map(normalizeStreetComparisonName)
      .filter(Boolean));
  }

  function explicitStreetReferenceMatch(osmStreet, curatedStreet) {
    const curatedIds = new Set([
      ...(Array.isArray(curatedStreet && curatedStreet.osmWayIds) ? curatedStreet.osmWayIds : []),
      curatedStreet && curatedStreet.osmWayId,
      curatedStreet && curatedStreet.osmId
    ].filter(value => Number.isSafeInteger(value) && value > 0));
    return curatedIds.size > 0 && Array.isArray(osmStreet && osmStreet.osmWayIds)
      && osmStreet.osmWayIds.some(value => curatedIds.has(value));
  }

  function excludedCuratedStreet(street) {
    const highway = trimmedString(street && (street.highway || street.highwayType));
    return Boolean(highway && !SUPPORTED_STREET_HIGHWAY_TYPES.includes(highway));
  }

  function compareCuratedStreets(osmStreets, curatedStreets) {
    const report = {
      matched: [],
      onlyInOsm: [],
      onlyInCurated: [],
      notCompared: [],
      nameDifferences: [],
      ambiguous: []
    };
    const osm = osmStreets.map(street => cloneValue(street)).sort(compareIds);
    const curated = curatedStreets.map(street => cloneValue(street)).sort(compareIds);
    const usedOsm = new Set();
    const ambiguousOsm = new Set();

    for (const curatedStreet of curated) {
      if (excludedCuratedStreet(curatedStreet)) {
        report.notCompared.push({
          curated: entitySummary(curatedStreet),
          reason: "unsupportedHighwayType",
          highway: curatedStreet.highway || curatedStreet.highwayType
        });
        continue;
      }
      const available = osm.filter(street => !usedOsm.has(street.id));
      const curatedName = trimmedString(curatedStreet.name || curatedStreet.displayName);
      const stages = [
        { reason: "osm-reference", candidates: available.filter(street => explicitStreetReferenceMatch(street, curatedStreet)) },
        { reason: "exact-name", candidates: available.filter(street => trimmedString(street.name || street.displayName) === curatedName) },
        { reason: "normalized-name", candidates: available.filter(street => (
          normalizeStreetComparisonName(street.name || street.displayName) === normalizeStreetComparisonName(curatedName)
        )) },
        { reason: "alias", candidates: available.filter(street => setsIntersect(streetNameKeys(street), streetNameKeys(curatedStreet))) }
      ];
      const stage = stages.find(candidateStage => candidateStage.candidates.length > 0);
      if (!stage) {
        report.onlyInCurated.push(entitySummary(curatedStreet));
        continue;
      }
      if (stage.candidates.length > 1) {
        stage.candidates.forEach(street => ambiguousOsm.add(street.id));
        report.ambiguous.push({
          curated: entitySummary(curatedStreet),
          osmCandidates: stage.candidates.map(entitySummary),
          reason: stage.reason
        });
        continue;
      }
      const osmStreet = stage.candidates[0];
      usedOsm.add(osmStreet.id);
      const pair = { osm: entitySummary(osmStreet), curated: entitySummary(curatedStreet), matchReason: stage.reason };
      report.matched.push(pair);
      if (trimmedString(osmStreet.name || osmStreet.displayName) !== curatedName) {
        report.nameDifferences.push({
          ...pair,
          osmName: trimmedString(osmStreet.name || osmStreet.displayName),
          curatedName,
          type: stage.reason === "normalized-name" ? "name-variant" : "name-difference"
        });
      }
    }
    report.onlyInOsm = osm.filter(street => !usedOsm.has(street.id) && !ambiguousOsm.has(street.id)).map(entitySummary);
    return report;
  }

  function mappedCuratedCategory(poi, options) {
    const category = trimmedString(poi && poi.category);
    if (options.categoryMap[category]) {
      return { osmCategory: options.categoryMap[category], reportCategory: category };
    }
    const subcategory = normalizeGeneralText(poi && poi.subcategory);
    if (options.subcategoryMap[subcategory]) {
      return {
        osmCategory: options.subcategoryMap[subcategory],
        reportCategory: `${category} / ${trimmedString(poi.subcategory)}`
      };
    }
    return null;
  }

  function curatedPoiPosition(poi) {
    const direct = validPosition(poi && poi.position);
    if (direct) return direct;
    return validPosition({ lat: poi && poi.latitude, lon: poi && poi.longitude });
  }

  function poiMatchScore(osmPoi, curatedPoi, mappedCategory, matchDistanceMeters) {
    const osmPosition = validPosition(osmPoi.position);
    const curatedPosition = curatedPoiPosition(curatedPoi);
    const distanceMeters = osmPosition && curatedPosition ? haversineDistanceMeters(osmPosition, curatedPosition) : null;
    const sameCategory = osmPoi.category === mappedCategory;
    const osmName = trimmedString(osmPoi.name || osmPoi.displayName);
    const curatedName = trimmedString(curatedPoi.name || curatedPoi.displayName);
    const exactReference = Number.isSafeInteger(curatedPoi.osmId)
      && curatedPoi.osmId === osmPoi.osmId
      && (!curatedPoi.osmType || curatedPoi.osmType === osmPoi.osmType);
    const exactName = osmName === curatedName;
    const equivalentName = setsIntersect(poiNameKeys(osmPoi), poiNameKeys({
      name: curatedName,
      aliases: curatedPoi.aliases
    }));
    const osmAddress = normalizeAddress(poiAddressFromTags(osmPoi));
    const curatedAddress = normalizeAddress(curatedPoi.address);
    const sameAddress = Boolean(osmAddress && curatedAddress && osmAddress === curatedAddress);
    const close = distanceMeters !== null && distanceMeters <= matchDistanceMeters;
    if (!exactReference && !exactName && !equivalentName && !sameAddress && !close) return null;

    let score = exactReference ? 1000 : 0;
    if (exactName) score += 600;
    else if (equivalentName) score += 500;
    if (sameAddress) score += 350;
    if (close) score += 300 + Math.max(0, matchDistanceMeters - distanceMeters) / Math.max(1, matchDistanceMeters);
    if (sameCategory) score += 100;
    return {
      score,
      distanceMeters,
      exactReference,
      exactName,
      equivalentName,
      sameAddress,
      sameCategory
    };
  }

  function compareCuratedPois(osmPois, curatedPois, options) {
    const report = {
      matched: [],
      onlyInOsm: [],
      onlyInCurated: [],
      notCompared: [],
      nameDifferences: [],
      addressDifferences: [],
      positionDifferences: [],
      categoryDifferences: [],
      ambiguous: [],
      categories: { compared: [], notCompared: [] }
    };
    const osm = osmPois.map(poi => cloneValue(poi)).sort(compareIds);
    const curated = curatedPois.map(poi => cloneValue(poi)).sort(compareIds);
    const usedOsm = new Set();
    const ambiguousOsm = new Set();
    const comparedCategories = new Set();
    const unsupportedCategories = new Set();

    for (const curatedPoi of curated) {
      const curatedCategory = trimmedString(curatedPoi.category);
      const categoryMapping = mappedCuratedCategory(curatedPoi, options);
      const mappedCategory = categoryMapping && categoryMapping.osmCategory;
      if (!mappedCategory || !SUPPORTED_POI_CATEGORIES.includes(mappedCategory)) {
        unsupportedCategories.add(curatedCategory || "(missing)");
        report.notCompared.push({
          curated: entitySummary(curatedPoi),
          reason: "unsupportedCategory",
          curatedCategory: curatedCategory || null,
          curatedSubcategory: trimmedString(curatedPoi.subcategory) || null
        });
        continue;
      }
      comparedCategories.add(categoryMapping.reportCategory);
      const candidates = [];
      for (const osmPoi of osm) {
        if (usedOsm.has(osmPoi.id)) continue;
        const match = poiMatchScore(osmPoi, curatedPoi, mappedCategory, options.poiMatchDistanceMeters);
        if (match) candidates.push({ osmPoi, match });
      }
      candidates.sort((first, second) => second.match.score - first.match.score || compareIds(first.osmPoi, second.osmPoi));
      if (candidates.length === 0) {
        report.onlyInCurated.push(entitySummary(curatedPoi));
        continue;
      }
      const bestScore = candidates[0].match.score;
      const bestCandidates = candidates.filter(candidate => Math.abs(candidate.match.score - bestScore) < 1e-9);
      if (bestCandidates.length > 1) {
        bestCandidates.forEach(candidate => ambiguousOsm.add(candidate.osmPoi.id));
        report.ambiguous.push({
          curated: entitySummary(curatedPoi),
          osmCandidates: bestCandidates.map(candidate => entitySummary(candidate.osmPoi)),
          reason: "equal-best-match"
        });
        continue;
      }

      const selected = candidates[0];
      const osmPoi = selected.osmPoi;
      const match = selected.match;
      usedOsm.add(osmPoi.id);
      const pair = {
        osm: entitySummary(osmPoi),
        curated: entitySummary(curatedPoi),
        distanceMeters: match.distanceMeters === null ? null : Number(match.distanceMeters.toFixed(1))
      };
      report.matched.push(pair);

      const osmName = trimmedString(osmPoi.name || osmPoi.displayName);
      const curatedName = trimmedString(curatedPoi.name || curatedPoi.displayName);
      if (osmName !== curatedName) {
        report.nameDifferences.push({ ...pair, osmName, curatedName });
      }
      const osmAddress = poiAddressFromTags(osmPoi);
      const curatedAddress = trimmedString(curatedPoi.address);
      if (osmAddress && curatedAddress && normalizeAddress(osmAddress) !== normalizeAddress(curatedAddress)) {
        report.addressDifferences.push({ ...pair, osmAddress, curatedAddress });
      }
      if (match.distanceMeters !== null && match.distanceMeters > options.positionDifferenceThresholdMeters) {
        report.positionDifferences.push({
          ...pair,
          type: "position-difference",
          osmPosition: cloneValue(osmPoi.position),
          curatedPosition: curatedPoiPosition(curatedPoi),
          distanceMeters: Number(match.distanceMeters.toFixed(1)),
          thresholdMeters: options.positionDifferenceThresholdMeters
        });
      }
      if (osmPoi.category !== mappedCategory) {
        report.categoryDifferences.push({
          ...pair,
          osmCategory: osmPoi.category,
          curatedCategory,
          expectedOsmCategory: mappedCategory
        });
      }
    }

    report.onlyInOsm = osm.filter(poi => !usedOsm.has(poi.id) && !ambiguousOsm.has(poi.id)).map(entitySummary);
    report.categories.compared = [...comparedCategories].sort(compareText);
    report.categories.notCompared = [...unsupportedCategories].sort(compareText);
    return report;
  }

  function normalizedComparisonOptions(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Comparison options must be an object.");
    }
    const suppliedMap = options.categoryMap && typeof options.categoryMap === "object" && !Array.isArray(options.categoryMap)
      ? options.categoryMap
      : {};
    const suppliedSubcategoryMap = options.subcategoryMap
      && typeof options.subcategoryMap === "object"
      && !Array.isArray(options.subcategoryMap)
      ? options.subcategoryMap
      : {};
    return {
      positionDifferenceThresholdMeters: numericOption(
        options,
        "positionDifferenceThresholdMeters",
        CURATED_POSITION_DIFFERENCE_METERS
      ),
      poiMatchDistanceMeters: numericOption(options, "poiMatchDistanceMeters", CURATED_POI_MATCH_DISTANCE_METERS),
      categoryMap: { ...DEFAULT_CURATED_CATEGORY_MAP, ...cloneValue(suppliedMap) },
      subcategoryMap: { ...DEFAULT_CURATED_SUBCATEGORY_MAP, ...cloneValue(suppliedSubcategoryMap) }
    };
  }

  function compareWithCuratedData(osmCityData, curatedData, options = {}) {
    const normalizedOptions = normalizedComparisonOptions(options);
    const osmInput = osmCityData && typeof osmCityData === "object" && !Array.isArray(osmCityData) ? osmCityData : {};
    const curatedInput = curatedData && typeof curatedData === "object" && !Array.isArray(curatedData) ? curatedData : {};
    const osmStreets = Array.isArray(osmInput.streets) ? osmInput.streets : [];
    const osmPois = Array.isArray(osmInput.pois) ? osmInput.pois : [];
    const curatedStreets = Array.isArray(curatedInput.streets) ? curatedInput.streets : [];
    const curatedPois = Array.isArray(curatedInput.pois) ? curatedInput.pois : [];
    const streets = compareCuratedStreets(osmStreets, curatedStreets);
    const pois = compareCuratedPois(osmPois, curatedPois, normalizedOptions);
    return {
      cityId: trimmedString(osmInput.city && osmInput.city.id) || null,
      cityName: trimmedString(osmInput.city && osmInput.city.name) || null,
      streets,
      pois,
      summary: {
        streets: {
          matched: streets.matched.length,
          onlyInOsm: streets.onlyInOsm.length,
          onlyInCurated: streets.onlyInCurated.length,
          notCompared: streets.notCompared.length,
          differences: streets.nameDifferences.length,
          ambiguous: streets.ambiguous.length
        },
        pois: {
          matched: pois.matched.length,
          onlyInOsm: pois.onlyInOsm.length,
          onlyInCurated: pois.onlyInCurated.length,
          notCompared: pois.notCompared.length,
          differences: pois.nameDifferences.length + pois.addressDifferences.length
            + pois.positionDifferences.length + pois.categoryDifferences.length,
          ambiguous: pois.ambiguous.length
        }
      }
    };
  }

  return Object.freeze({
    SUPPORTED_POI_CATEGORIES,
    STREET_MERGE_DISTANCE_METERS,
    POI_POSSIBLE_DUPLICATE_DISTANCE_METERS,
    CURATED_POSITION_DIFFERENCE_METERS,
    CURATED_POI_MATCH_DISTANCE_METERS,
    validateCityData,
    compareWithCuratedData
  });
});
