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
  const CITY_PACKAGE_SCHEMA_VERSION = 1;
  // A download with fewer distinct playable street targets does not provide a
  // meaningful training round. Curated/imported packages keep their established
  // validation contract; the CityManager explicitly selects download mode.
  const MIN_PLAYABLE_STREETS = 5;
  const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

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

  function monotonicNow() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function createProfiler(target) {
    const enabled = Boolean(target && typeof target === "object" && !Array.isArray(target));
    const timings = enabled ? (target.timingsMs = {}) : null;
    const counts = enabled ? (target.counts = {}) : null;
    return {
      enabled,
      start() {
        return enabled ? monotonicNow() : 0;
      },
      end(name, startedAt) {
        if (enabled) timings[name] = (timings[name] || 0) + monotonicNow() - startedAt;
      },
      increment(name, amount = 1) {
        if (enabled) counts[name] = (counts[name] || 0) + amount;
      },
      finish() {
        if (!enabled) return;
        for (const name of Object.keys(timings)) timings[name] = Math.round(timings[name] * 10) / 10;
      }
    };
  }

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

  function coordinateBounds(coordinates) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const coordinate of coordinates) {
      if (coordinate[0] < minLon) minLon = coordinate[0];
      if (coordinate[0] > maxLon) maxLon = coordinate[0];
      if (coordinate[1] < minLat) minLat = coordinate[1];
      if (coordinate[1] > maxLat) maxLat = coordinate[1];
    }
    return { minLon, minLat, maxLon, maxLat };
  }

  function boundsOverlap(first, second, epsilon = COORDINATE_EPSILON) {
    return first.minLon <= second.maxLon + epsilon
      && first.maxLon + epsilon >= second.minLon
      && first.minLat <= second.maxLat + epsilon
      && first.maxLat + epsilon >= second.minLat;
  }

  function prepareRing(ring) {
    const bounds = coordinateBounds(ring);
    const edges = [];
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      edges.push({
        start,
        end,
        bounds: {
          minLon: Math.min(start[0], end[0]),
          minLat: Math.min(start[1], end[1]),
          maxLon: Math.max(start[0], end[0]),
          maxLat: Math.max(start[1], end[1])
        }
      });
    }
    const bucketCount = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(edges.length))));
    const latitudeSpan = bounds.maxLat - bounds.minLat;
    const buckets = Array.from({ length: bucketCount }, () => []);
    const bucketIndex = latitude => {
      if (latitudeSpan <= 0) return 0;
      return Math.max(0, Math.min(bucketCount - 1,
        Math.floor((latitude - bounds.minLat) / latitudeSpan * bucketCount)));
    };
    for (const edge of edges) {
      const firstBucket = bucketIndex(edge.bounds.minLat);
      const lastBucket = bucketIndex(edge.bounds.maxLat);
      for (let index = firstBucket; index <= lastBucket; index += 1) buckets[index].push(edge);
    }
    return { ring, bounds, edges, buckets, bucketIndex };
  }

  function prepareAreaGeometry(geometry) {
    const rawPolygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const polygons = rawPolygons.map(polygon => {
      const rings = polygon.map(prepareRing);
      return { rings, bounds: rings[0].bounds };
    });
    return { geometry, polygons };
  }

  function pointLocationInPreparedRing(point, preparedRing, profiler) {
    const { bounds } = preparedRing;
    if (point[0] < bounds.minLon - COORDINATE_EPSILON
      || point[0] > bounds.maxLon + COORDINATE_EPSILON
      || point[1] < bounds.minLat - COORDINATE_EPSILON
      || point[1] > bounds.maxLat + COORDINATE_EPSILON) return -1;
    const edges = preparedRing.buckets[preparedRing.bucketIndex(point[1])];
    let inside = false;
    for (const edge of edges) {
      profiler.increment("boundaryEdgesTested");
      if (pointOnSegment(point, edge.start, edge.end)) return 0;
      const crossesLatitude = (edge.start[1] > point[1]) !== (edge.end[1] > point[1]);
      if (!crossesLatitude) continue;
      const crossingLongitude = ((edge.end[0] - edge.start[0]) * (point[1] - edge.start[1]))
        / (edge.end[1] - edge.start[1]) + edge.start[0];
      if (point[0] < crossingLongitude) inside = !inside;
    }
    return inside ? 1 : -1;
  }

  function pointLocationInPreparedGeometry(point, prepared, profiler) {
    let boundary = false;
    for (const polygon of prepared.polygons) {
      if (point[0] < polygon.bounds.minLon - COORDINATE_EPSILON
        || point[0] > polygon.bounds.maxLon + COORDINATE_EPSILON
        || point[1] < polygon.bounds.minLat - COORDINATE_EPSILON
        || point[1] > polygon.bounds.maxLat + COORDINATE_EPSILON) continue;
      const outerLocation = pointLocationInPreparedRing(point, polygon.rings[0], profiler);
      if (outerLocation < 0) continue;
      if (outerLocation === 0) {
        boundary = true;
        continue;
      }
      let insideHole = false;
      let onHoleBoundary = false;
      for (let index = 1; index < polygon.rings.length; index += 1) {
        const holeLocation = pointLocationInPreparedRing(point, polygon.rings[index], profiler);
        if (holeLocation === 0) {
          boundary = true;
          onHoleBoundary = true;
          break;
        }
        if (holeLocation === 1) {
          insideHole = true;
          break;
        }
      }
      if (!insideHole && !onHoleBoundary) return 1;
    }
    return boundary ? 0 : -1;
  }

  function preparedEdgesForBounds(prepared, bounds) {
    const matches = new Set();
    for (const polygon of prepared.polygons) {
      if (!boundsOverlap(polygon.bounds, bounds)) continue;
      for (const ring of polygon.rings) {
        if (!boundsOverlap(ring.bounds, bounds)) continue;
        const firstBucket = ring.bucketIndex(bounds.minLat);
        const lastBucket = ring.bucketIndex(bounds.maxLat);
        for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
          for (const edge of ring.buckets[bucket]) {
            if (boundsOverlap(edge.bounds, bounds)) matches.add(edge);
          }
        }
      }
    }
    return matches;
  }

  function segmentIntersectsPreparedGeometry(start, end, prepared, profiler) {
    const bounds = coordinateBounds([start, end]);
    for (const edge of preparedEdgesForBounds(prepared, bounds)) {
      profiler.increment("boundarySegmentPairsTested");
      if (segmentsIntersect(start, end, edge.start, edge.end)) return true;
    }
    return false;
  }

  function segmentIntersectsGeometry(start, end, geometry) {
    for (const ring of geometryRings(geometry)) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        if (segmentsIntersect(start, end, ring[index], ring[index + 1])) return true;
      }
    }
    return false;
  }

  function classifyStreetAgainstBoundary(streetGeometry, boundary, preparedBoundary, profiler) {
    let hasInside = false;
    let hasOutside = false;
    for (const line of streetGeometry.coordinates) {
      for (const point of line) {
        profiler.increment("streetBoundaryPointsTested");
        if (pointLocationInPreparedGeometry(point, preparedBoundary, profiler) >= 0) hasInside = true;
        else hasOutside = true;
      }
    }
    if (hasInside) return hasOutside ? "partial" : "inside";
    for (const line of streetGeometry.coordinates) {
      for (let index = 0; index < line.length - 1; index += 1) {
        profiler.increment("streetBoundarySegmentsTested");
        if (segmentIntersectsPreparedGeometry(line[index], line[index + 1], preparedBoundary, profiler)) {
          return "partial";
        }
      }
    }
    return "outside";
  }

  function geometryBounds(geometry) {
    const coordinates = geometryRings(geometry).flat();
    return coordinateBounds(coordinates);
  }

  function areaGeometryIntersectsPrepared(firstGeometry, secondPrepared, profiler) {
    const firstPolygons = firstGeometry.type === "Polygon" ? [firstGeometry.coordinates] : firstGeometry.coordinates;
    for (const polygon of firstPolygons) {
      for (const point of polygon[0]) {
        profiler.increment("poiBoundaryPointsTested");
        if (pointLocationInPreparedGeometry(point, secondPrepared, profiler) >= 0) return true;
      }
    }
    const firstBounds = geometryBounds(firstGeometry);
    for (const polygon of secondPrepared.polygons) {
      if (!boundsOverlap(firstBounds, polygon.bounds)) continue;
      for (const point of polygon.rings[0].ring) {
        if (point[0] < firstBounds.minLon || point[0] > firstBounds.maxLon
          || point[1] < firstBounds.minLat || point[1] > firstBounds.maxLat) continue;
        if (pointLocationInGeometry(point, firstGeometry) >= 0) return true;
      }
    }
    for (const ring of geometryRings(firstGeometry)) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        if (segmentIntersectsPreparedGeometry(ring[index], ring[index + 1], secondPrepared, profiler)) return true;
      }
    }
    return false;
  }

  function areaGeometryPartlyOutsidePrepared(geometry, boundaryPrepared, profiler) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let inside = false;
    let outside = false;
    for (const polygon of polygons) {
      for (const point of polygon[0]) {
        profiler.increment("poiBoundaryPointsTested");
        if (pointLocationInPreparedGeometry(point, boundaryPrepared, profiler) >= 0) inside = true;
        else outside = true;
      }
    }
    return outside && (inside || areaGeometryIntersectsPrepared(geometry, boundaryPrepared, profiler));
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

  function findDangerousObjectKey(value, path = "$", seen = new WeakSet()) {
    if (value === null || typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    for (const key of Object.keys(value)) {
      const keyPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      if (DANGEROUS_OBJECT_KEYS.has(key)) return { key, path: keyPath };
      const nested = findDangerousObjectKey(value[key], keyPath, seen);
      if (nested) return nested;
    }
    return null;
  }

  function validateBounds(bounds) {
    if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return false;
    const south = finiteNumber(bounds.south);
    const west = finiteNumber(bounds.west);
    const north = finiteNumber(bounds.north);
    const east = finiteNumber(bounds.east);
    return south !== null && west !== null && north !== null && east !== null
      && south >= -90 && north <= 90 && west >= -180 && east <= 180
      && south < north && west < east;
  }

  function importedPackageValidationResult(cityPackage) {
    const municipality = { valid: true, warnings: [], errors: [] };
    const streets = createSection(Array.isArray(cityPackage?.streets) ? cityPackage.streets.length : 0);
    const pois = createSection(Array.isArray(cityPackage?.pois) ? cityPackage.pois.length : 0);
    return { municipality, streets, pois };
  }

  function addMunicipalityError(validation, code, cityId, message, details) {
    validation.municipality.errors.push(issue(code, "error", "city", cityId, message, details));
    validation.municipality.valid = false;
  }

  function addMunicipalityWarning(validation, code, cityId, message, details) {
    validation.municipality.warnings.push(issue(code, "warning", "city", cityId, message, details));
  }

  function validateImportedPoi(poi, cityId) {
    const entityId = poi && trimmedString(poi.id);
    if (!poi || typeof poi !== "object" || Array.isArray(poi)) {
      return issue("POI_INVALID", "error", "poi", null, "Der POI-Datensatz ist ungültig.");
    }
    if (!entityId) return issue("POI_ID_MISSING", "error", "poi", null, "Die POI-ID fehlt.");
    if (poi.cityId !== cityId) {
      return issue("POI_CITY_ID_INVALID", "error", "poi", entityId, "Der POI verweist nicht auf die importierte Stadt.");
    }
    if (!trimmedString(poi.name)) {
      return issue("POI_NAME_MISSING", "error", "poi", entityId, "Der POI-Name fehlt.");
    }
    if (!trimmedString(poi.category)) {
      return issue("POI_CATEGORY_MISSING", "error", "poi", entityId, "Die POI-Kategorie fehlt.");
    }
    if (!validPosition(poi.position)) {
      return issue("POI_POSITION_INVALID", "error", "poi", entityId, "Die POI-Position ist ungültig.");
    }
    if (poi.latitude !== undefined
      && (finiteNumber(poi.latitude) === null || poi.latitude < -90 || poi.latitude > 90)) {
      return issue("POI_POSITION_INVALID", "error", "poi", entityId, "Die POI-Breitengradangabe ist ungültig.");
    }
    if (poi.longitude !== undefined
      && (finiteNumber(poi.longitude) === null || poi.longitude < -180 || poi.longitude > 180)) {
      return issue("POI_POSITION_INVALID", "error", "poi", entityId, "Die POI-Längengradangabe ist ungültig.");
    }
    if (poi.geometry !== undefined && poi.geometry !== null) {
      const pointValid = poi.geometry?.type === "Point" && validCoordinate(poi.geometry.coordinates);
      if (!pointValid && !validAreaGeometry(poi.geometry)) {
        return issue("POI_GEOMETRY_INVALID", "error", "poi", entityId, "Die POI-Geometrie ist ungültig.");
      }
    }
    return null;
  }

  function validateCityPackage(cityPackage) {
    const inputIsObject = Boolean(cityPackage && typeof cityPackage === "object" && !Array.isArray(cityPackage));
    const validation = importedPackageValidationResult(inputIsObject ? cityPackage : null);
    const input = inputIsObject ? cityPackage : null;
    const rawCityId = trimmedString(input?.city?.id) || null;

    if (!input) {
      addMunicipalityError(validation, "CITY_PACKAGE_INVALID", null,
        "Die Stadtdatei verwendet ein nicht unterstütztes Format.");
    } else {
      const dangerousKey = findDangerousObjectKey(input);
      if (dangerousKey) {
        addMunicipalityError(validation, "CITY_PACKAGE_DANGEROUS_KEY", rawCityId,
          "Die Stadtdatei enthält einen aus Sicherheitsgründen unzulässigen Objektschlüssel.", dangerousKey);
      }

      if (input.schemaVersion !== CITY_PACKAGE_SCHEMA_VERSION) {
        const newer = Number.isInteger(input.schemaVersion) && input.schemaVersion > CITY_PACKAGE_SCHEMA_VERSION;
        addMunicipalityError(
          validation,
          newer ? "CITY_PACKAGE_SCHEMA_NEWER" : "CITY_PACKAGE_SCHEMA_UNSUPPORTED",
          rawCityId,
          newer
            ? "Diese Stadtdatei verwendet eine neuere, derzeit nicht unterstützte Version."
            : "Die Stadtdatei verwendet ein nicht unterstütztes Format."
        );
      }

      if (input.exportedAt === undefined) {
        addMunicipalityWarning(validation, "CITY_PACKAGE_EXPORTED_AT_MISSING", rawCityId,
          "Die Stadtdatei enthält keinen Exportzeitpunkt.");
      } else if (!trimmedString(input.exportedAt) || !Number.isFinite(Date.parse(input.exportedAt))) {
        addMunicipalityWarning(validation, "CITY_PACKAGE_EXPORTED_AT_INVALID", rawCityId,
          "Der Exportzeitpunkt der Stadtdatei ist nicht lesbar.");
      }

      const city = input.city;
      if (!city || typeof city !== "object" || Array.isArray(city)) {
        addMunicipalityError(validation, "CITY_MISSING", null, "Stadtmetadaten fehlen oder sind ungültig.");
      } else {
        if (!trimmedString(city.id)) {
          addMunicipalityError(validation, "CITY_ID_MISSING", null, "Die Stadt-ID fehlt.");
        }
        if (!trimmedString(city.name)) {
          addMunicipalityError(validation, "CITY_NAME_MISSING", rawCityId, "Der Stadtname fehlt.");
        }
        if (city.osmType !== "relation") {
          addMunicipalityError(validation, "CITY_OSM_TYPE_INVALID", rawCityId,
            "Die Stadt muss auf einer administrativen OSM-Relation beruhen.");
        }
        if (!Number.isSafeInteger(city.osmId) || city.osmId <= 0) {
          addMunicipalityError(validation, "CITY_OSM_ID_INVALID", rawCityId,
            "Die OSM-Relations-ID der Stadt ist ungültig.");
        }
        if (!validateBounds(city.bounds)) {
          addMunicipalityError(validation, "CITY_BOUNDS_INVALID", rawCityId,
            "Die Stadt-Bounds sind strukturell ungültig.");
        }
        if (!validPosition(city.center)) {
          addMunicipalityError(validation, "CITY_CENTER_INVALID", rawCityId,
            "Der Stadtmittelpunkt ist ungültig.");
        }
      }

      if (!Array.isArray(input.streets)) {
        addError(validation.streets, issue("CITY_STREETS_INVALID", "error", "city", rawCityId,
          "Das Stadtpaket enthält kein gültiges Straßen-Array."));
      } else if (input.streets.length === 0) {
        addError(validation.streets, issue("CITY_NO_PLAYABLE_STREETS", "error", "city", rawCityId,
          "Das Stadtpaket enthält keine spielbaren Straßen."));
      } else {
        const streetIds = new Set();
        for (const street of input.streets) {
          const streetError = streetStructuralError(street, rawCityId);
          if (streetError) addError(validation.streets, streetError);
          const streetId = trimmedString(street?.id);
          if (streetId && streetIds.has(streetId)) {
            addError(validation.streets, issue("STREET_ID_DUPLICATE", "error", "street", streetId,
              "Die Stadtdatei enthält doppelte Straßen-IDs."));
          }
          if (streetId) streetIds.add(streetId);
        }
      }

      if (!Array.isArray(input.pois)) {
        addError(validation.pois, issue("CITY_POIS_INVALID", "error", "city", rawCityId,
          "Das Stadtpaket enthält kein gültiges POI-Array."));
      } else {
        const poiIds = new Set();
        const streetIds = new Set(Array.isArray(input.streets)
          ? input.streets.map(street => trimmedString(street?.id)).filter(Boolean)
          : []);
        for (const poi of input.pois) {
          const poiError = validateImportedPoi(poi, rawCityId);
          if (poiError) addError(validation.pois, poiError);
          const poiId = trimmedString(poi?.id);
          if (poiId && poiIds.has(poiId)) {
            addError(validation.pois, issue("POI_ID_DUPLICATE", "error", "poi", poiId,
              "Die Stadtdatei enthält doppelte POI-IDs."));
          }
          if (poiId && streetIds.has(poiId)) {
            addError(validation.pois, issue("CITY_ENTITY_ID_DUPLICATE", "error", "poi", poiId,
              "Eine ID wird gleichzeitig für eine Straße und einen POI verwendet."));
          }
          if (poiId) poiIds.add(poiId);
        }
      }

      if (city && Array.isArray(input.streets) && city.streetCount !== undefined
        && city.streetCount !== input.streets.length) {
        addMunicipalityError(validation, "CITY_STREET_COUNT_INVALID", rawCityId,
          "Die angegebene Straßenanzahl stimmt nicht mit dem Paketinhalt überein.");
      }
      if (city && Array.isArray(input.pois) && city.poiCount !== undefined
        && city.poiCount !== input.pois.length) {
        addMunicipalityError(validation, "CITY_POI_COUNT_INVALID", rawCityId,
          "Die angegebene POI-Anzahl stimmt nicht mit dem Paketinhalt überein.");
      }
    }

    validation.streets.totalOutput = validation.streets.errors.length === 0 && Array.isArray(input?.streets)
      ? input.streets.length
      : 0;
    validation.pois.totalOutput = validation.pois.errors.length === 0 && Array.isArray(input?.pois)
      ? input.pois.length
      : 0;
    const warningCount = validation.municipality.warnings.length
      + validation.streets.warnings.length + validation.pois.warnings.length;
    const errorCount = validation.municipality.errors.length
      + validation.streets.errors.length + validation.pois.errors.length;
    const valid = errorCount === 0;
    validation.valid = valid;
    validation.summary = { warningCount, errorCount };

    return {
      valid,
      schemaVersion: input?.schemaVersion,
      exportedAt: input?.exportedAt,
      city: valid ? cloneValue(input.city) : null,
      streets: valid ? cloneValue(input.streets) : [],
      pois: valid ? cloneValue(input.pois) : [],
      validation
    };
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

  function connectedStreetComponents(streets, thresholdMeters, profiler) {
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
          profiler.increment("streetDuplicateCandidatePairsTested");
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

  function validateStreets(rawStreets, cityId, boundary, preparedBoundary, options, section, profiler) {
    const structurallyValid = [];
    for (const rawStreet of rawStreets) {
      const structureStartedAt = profiler.start();
      const structuralError = streetStructuralError(rawStreet, cityId);
      profiler.end("streetGeometryValidationMs", structureStartedAt);
      if (structuralError) {
        section.invalidRemoved += 1;
        addError(section, structuralError);
        continue;
      }
      const cloneStartedAt = profiler.start();
      const street = cloneValue(rawStreet);
      profiler.end("streetCloneMs", cloneStartedAt);
      const boundaryStartedAt = profiler.start();
      const boundaryClassification = boundary
        ? classifyStreetAgainstBoundary(street.geometry, boundary, preparedBoundary, profiler)
        : null;
      profiler.end("streetBoundaryMs", boundaryStartedAt);
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
      const normalizationStartedAt = profiler.start();
      street.aliases = uniqueStrings(Array.isArray(street.aliases) ? street.aliases : [], street.name);
      street.osmWayIds = [...new Set(street.osmWayIds)].sort((first, second) => first - second);
      profiler.end("streetNormalizationMs", normalizationStartedAt);
      structurallyValid.push(street);
    }

    let startedAt = profiler.start();
    const groups = new Map();
    for (const street of structurallyValid.sort(compareIds)) {
      const comparisonName = normalizeStreetComparisonName(street.name);
      if (!groups.has(comparisonName)) groups.set(comparisonName, []);
      groups.get(comparisonName).push(street);
    }
    profiler.end("streetGroupingMs", startedAt);

    const output = [];
    const threshold = options.streetMergeDistanceMeters;
    for (const comparisonName of [...groups.keys()].sort(compareText)) {
      const group = groups.get(comparisonName);
      startedAt = profiler.start();
      const components = connectedStreetComponents(group, threshold, profiler);
      profiler.end("streetDuplicateDetectionMs", startedAt);
      const representatives = [];
      for (const component of components) {
        if (component.length === 1) {
          representatives.push(component[0]);
          continue;
        }
        startedAt = profiler.start();
        const merged = mergeStreetComponent(component);
        profiler.end("streetMergeMs", startedAt);
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

  function poiStructuralError(poi, cityId, options) {
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
    if (!options.curated && !SUPPORTED_POI_CATEGORIES.includes(poi.category)) {
      return issue("POI_CATEGORY_INVALID", "error", "poi", entityId, "Die POI-Kategorie wird vom aktuellen Importmodell nicht unterstützt.");
    }
    if (!options.curated && !VALID_OSM_TYPES.has(poi.osmType)) {
      return issue("POI_OSM_TYPE_INVALID", "error", "poi", entityId, "Der OSM-Typ des POIs ist ungültig.");
    }
    if (!options.curated && (!Number.isSafeInteger(poi.osmId) || poi.osmId <= 0)) {
      return issue("POI_OSM_ID_INVALID", "error", "poi", entityId, "Die OSM-ID des POIs ist ungültig.");
    }
    return null;
  }

  function poiNameKeys(poi) {
    return new Set([poi.name, ...(Array.isArray(poi.aliases) ? poi.aliases : [])]
      .map(normalizeGeneralText)
      .filter(Boolean));
  }

  function poiAnalysis(poi, cache, profiler) {
    if (cache.has(poi)) return cache.get(poi);
    const startedAt = profiler.start();
    const analysis = {
      nameKeys: poiNameKeys(poi),
      areaValid: validAreaGeometry(poi.geometry),
      position: validPosition(poi.position),
      address: normalizeAddress(poiAddressFromTags(poi))
    };
    cache.set(poi, analysis);
    profiler.increment("poiNormalFormsPrepared");
    profiler.end("poiNormalFormMs", startedAt);
    return analysis;
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

  function safePoiPair(first, second, analysisCache, profiler) {
    profiler.increment("poiSafeCandidatePairsTested");
    const firstAnalysis = poiAnalysis(first, analysisCache, profiler);
    const secondAnalysis = poiAnalysis(second, analysisCache, profiler);
    if (first.category !== second.category || !setsIntersect(firstAnalysis.nameKeys, secondAnalysis.nameKeys)) return false;
    const firstHasArea = firstAnalysis.areaValid;
    const secondHasArea = secondAnalysis.areaValid;
    if (firstHasArea === secondHasArea) return false;
    const areaPoi = firstHasArea ? first : second;
    const pointAnalysis = firstHasArea ? secondAnalysis : firstAnalysis;
    return Boolean(pointAnalysis.position
      && pointLocationInGeometry([pointAnalysis.position.lon, pointAnalysis.position.lat], areaPoi.geometry) >= 0);
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

  function possiblePoiPair(first, second, thresholdMeters, analysisCache, profiler) {
    profiler.increment("poiPossibleCandidatePairsTested");
    const firstAnalysis = poiAnalysis(first, analysisCache, profiler);
    const secondAnalysis = poiAnalysis(second, analysisCache, profiler);
    if (first.category !== second.category || !setsIntersect(firstAnalysis.nameKeys, secondAnalysis.nameKeys)) return false;
    const firstPosition = firstAnalysis.position;
    const secondPosition = secondAnalysis.position;
    if (firstPosition && secondPosition && haversineDistanceMeters(firstPosition, secondPosition) <= thresholdMeters) return true;
    const firstAddress = firstAnalysis.address;
    const secondAddress = secondAnalysis.address;
    return Boolean(firstAddress && firstAddress === secondAddress);
  }

  function poiCandidatePairs(pois, analysisCache, profiler) {
    const indexes = new Map();
    for (let index = 0; index < pois.length; index += 1) {
      const analysis = poiAnalysis(pois[index], analysisCache, profiler);
      for (const nameKey of analysis.nameKeys) {
        const key = `${pois[index].category}\u0000${nameKey}`;
        if (!indexes.has(key)) indexes.set(key, []);
        indexes.get(key).push(index);
      }
    }
    const pairKeys = new Set();
    const pairs = [];
    for (const candidates of indexes.values()) {
      for (let first = 0; first < candidates.length; first += 1) {
        for (let second = first + 1; second < candidates.length; second += 1) {
          const firstIndex = candidates[first];
          const secondIndex = candidates[second];
          const key = `${firstIndex}:${secondIndex}`;
          if (pairKeys.has(key)) continue;
          pairKeys.add(key);
          pairs.push([firstIndex, secondIndex]);
        }
      }
    }
    pairs.sort((first, second) => first[0] - second[0] || first[1] - second[1]);
    profiler.increment("poiIndexedCandidatePairs", pairs.length);
    return pairs;
  }

  function validatePois(rawPois, cityId, boundary, preparedBoundary, options, section, profiler) {
    const usable = [];
    for (const rawPoi of rawPois) {
      const structureStartedAt = profiler.start();
      const structuralError = poiStructuralError(rawPoi, cityId, options);
      profiler.end("poiGeometryValidationMs", structureStartedAt);
      if (structuralError) {
        section.invalidRemoved += 1;
        addError(section, structuralError);
        continue;
      }
      const cloneStartedAt = profiler.start();
      const poi = cloneValue(rawPoi);
      profiler.end("poiCloneMs", cloneStartedAt);
      let position = validPosition(poi.position);
      let areaValid = poi.geometry !== null && poi.geometry !== undefined && validAreaGeometry(poi.geometry);
      const curatedPointGeometry = options.curated
        && poi.geometry?.type === "Point"
        && validCoordinate(poi.geometry.coordinates);
      if (poi.geometry !== null && poi.geometry !== undefined && !areaValid && !curatedPointGeometry) {
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
        const boundaryStartedAt = profiler.start();
        profiler.increment("poiBoundaryPointsTested");
        const positionInside = pointLocationInPreparedGeometry(
          [position.lon, position.lat],
          preparedBoundary,
          profiler
        ) >= 0;
        const geometryIntersects = areaValid
          && areaGeometryIntersectsPrepared(poi.geometry, preparedBoundary, profiler);
        if (!positionInside && !geometryIntersects && !options.curated) {
          section.invalidRemoved += 1;
          addError(section, issue("POI_OUTSIDE_BOUNDARY", "error", "poi", poi.id,
            "Der POI liegt vollständig außerhalb der administrativen Gemeindegrenze."));
          continue;
        }
        if (!positionInside && !geometryIntersects && options.curated) {
          addWarning(section, issue("CURATED_POI_OUTSIDE_BOUNDARY", "warning", "poi", poi.id,
            "Der kuratierte POI liegt außerhalb der administrativen Gemeindegrenze und bleibt zur Rückwärtskompatibilität erhalten."));
        }
        if (areaValid && areaGeometryPartlyOutsidePrepared(poi.geometry, preparedBoundary, profiler)) {
          addWarning(section, issue("POI_PARTLY_OUTSIDE_BOUNDARY", "warning", "poi", poi.id,
            "Die POI-Fläche liegt nur teilweise innerhalb der administrativen Gemeindegrenze."));
        }
        profiler.end("poiBoundaryMs", boundaryStartedAt);
      }
      usable.push(poi);
    }

    const working = usable.sort(compareIds);
    if (options.curated) return working;
    const analysisCache = new WeakMap();
    let mergedPair = true;
    while (mergedPair) {
      mergedPair = false;
      const candidateStartedAt = profiler.start();
      const candidates = poiCandidatePairs(working, analysisCache, profiler);
      profiler.end("poiCandidateIndexMs", candidateStartedAt);
      const duplicateStartedAt = profiler.start();
      for (const [firstIndex, secondIndex] of candidates) {
        if (!safePoiPair(working[firstIndex], working[secondIndex], analysisCache, profiler)) continue;
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
      profiler.end("poiDuplicateDetectionMs", duplicateStartedAt);
    }

    const possibleStartedAt = profiler.start();
    const possibleCandidates = poiCandidatePairs(working, analysisCache, profiler);
    for (const [firstIndex, secondIndex] of possibleCandidates) {
      if (!possiblePoiPair(
        working[firstIndex],
        working[secondIndex],
        options.poiPossibleDuplicateDistanceMeters,
        analysisCache,
        profiler
      )) continue;
      addWarning(section, issue("POI_POSSIBLE_DUPLICATE", "warning", "poi", working[firstIndex].id,
        "Ähnliche nahe POIs wurden mangels eindeutiger Node-/Polygon-Evidenz nicht zusammengeführt.",
        { candidateIds: [working[firstIndex].id, working[secondIndex].id].sort(compareText) }));
    }
    profiler.end("poiPossibleDuplicateMs", possibleStartedAt);
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
      curated: options.sourceMode === "curated",
      minimumPlayableStreets: options.sourceMode === "download"
        ? Math.max(1, Math.floor(numericOption(options, "minimumPlayableStreets", MIN_PLAYABLE_STREETS)))
        : 1,
      streetMergeDistanceMeters: numericOption(options, "streetMergeDistanceMeters", STREET_MERGE_DISTANCE_METERS),
      poiPossibleDuplicateDistanceMeters: numericOption(
        options,
        "poiPossibleDuplicateDistanceMeters",
        POI_POSSIBLE_DUPLICATE_DISTANCE_METERS
      )
    };
  }

  function validateCityData(cityData, options = {}) {
    const totalStartedAt = monotonicNow();
    const profiler = createProfiler(options && options.diagnostics);
    const normalizedOptions = normalizedValidationOptions(options);
    const input = cityData && typeof cityData === "object" && !Array.isArray(cityData) ? cityData : {};
    const city = input.city && typeof input.city === "object" && !Array.isArray(input.city)
      ? cloneValue(input.city)
      : null;
    const boundaryInput = input.boundary;
    let startedAt = profiler.start();
    const boundaryValid = validAreaGeometry(boundaryInput);
    profiler.end("boundaryGeometryValidationMs", startedAt);
    startedAt = profiler.start();
    const preparedBoundary = boundaryValid ? prepareAreaGeometry(boundaryInput) : null;
    profiler.end("boundaryPreparationMs", startedAt);
    startedAt = profiler.start();
    const boundary = boundaryInput === undefined ? null : cloneValue(boundaryInput);
    profiler.end("boundaryCloneMs", startedAt);
    const rawStreets = Array.isArray(input.streets) ? input.streets : [];
    const rawPois = Array.isArray(input.pois) ? input.pois : [];
    startedAt = profiler.start();
    const municipality = validateMunicipality(city, boundaryInput);
    profiler.end("boundaryMunicipalityValidationMs", startedAt);
    const streetsSection = createSection(rawStreets.length);
    const poisSection = createSection(rawPois.length);
    const cityId = city ? city.id : undefined;
    const validatedStreets = validateStreets(
      rawStreets,
      cityId,
      boundaryValid ? boundaryInput : null,
      preparedBoundary,
      normalizedOptions,
      streetsSection,
      profiler
    );
    const validatedPois = validatePois(
      rawPois,
      cityId,
      boundaryValid ? boundaryInput : null,
      preparedBoundary,
      normalizedOptions,
      poisSection,
      profiler
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
    } else if (validatedStreets.length < normalizedOptions.minimumPlayableStreets) {
      municipality.errors.push(issue(
        "CITY_TOO_FEW_PLAYABLE_STREETS",
        "error",
        "city",
        cityId,
        `Es wurden nur ${validatedStreets.length} spielbare Straßen gefunden. Diese Gemeinde eignet sich derzeit nicht für den Straßentrainer.`,
        { streetCount: validatedStreets.length, minimumStreetCount: normalizedOptions.minimumPlayableStreets }
      ));
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
    if (profiler.enabled) {
      options.diagnostics.timingsMs.validatorTotalMs = monotonicNow() - totalStartedAt;
      profiler.finish();
    }
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
    CITY_PACKAGE_SCHEMA_VERSION,
    MIN_PLAYABLE_STREETS,
    STREET_MERGE_DISTANCE_METERS,
    POI_POSSIBLE_DUPLICATE_DISTANCE_METERS,
    CURATED_POSITION_DIFFERENCE_METERS,
    CURATED_POI_MATCH_DISTANCE_METERS,
    validateCityData,
    validateCityPackage,
    compareWithCuratedData
  });
});
