(function initializeTargets(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerTargets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTargetsApi() {
  "use strict";

  const TARGET_TYPES = Object.freeze({ STREET: "street", POI: "poi" });

  function prepareStreetTargets(rawStreets, geometryApi) {
    return geometryApi.prepareStreetRecords(rawStreets).map(street => ({
      ...street,
      targetType: TARGET_TYPES.STREET,
      category: "street",
      categoryLabel: "Straße",
      subcategory: null,
      geometry: null,
      active: true,
      quizEligible: true,
      needsReview: false
    }));
  }

  function preparePoiTargets(rawPois, categories = []) {
    const labels = new Map(categories.map(category => [category.id, category.label]));
    return (Array.isArray(rawPois) ? rawPois : []).map(rawPoi => ({
      id: String(rawPoi.id || ""),
      displayName: String(rawPoi.displayName || "").trim(),
      aliases: [...new Set(rawPoi.aliases || [])],
      targetType: TARGET_TYPES.POI,
      category: String(rawPoi.category || "other-relevant"),
      categoryLabel: rawPoi.categoryLabel
        || labels.get(rawPoi.category)
        || String(rawPoi.category || "Ort"),
      subcategory: rawPoi.subcategory || null,
      latitude: Number(rawPoi.latitude),
      longitude: Number(rawPoi.longitude),
      address: rawPoi.address || null,
      geometry: rawPoi.geometry || {
        type: "Point",
        coordinates: [Number(rawPoi.longitude), Number(rawPoi.latitude)]
      },
      active: rawPoi.active !== false,
      quizEligible: rawPoi.quizEligible !== false,
      source: rawPoi.source || null,
      sourceUrl: rawPoi.sourceUrl || null,
      needsReview: Boolean(rawPoi.needsReview),
      reviewNote: rawPoi.reviewNote || null
    }));
  }

  function isFiniteCoordinate(coordinate) {
    return Array.isArray(coordinate)
      && coordinate.length >= 2
      && Number.isFinite(Number(coordinate[0]))
      && Number.isFinite(Number(coordinate[1]));
  }

  function isValidTargetGeometry(target, geometryApi) {
    if (!target?.geometry) return false;
    if (target.targetType === TARGET_TYPES.STREET) {
      return geometryApi.isValidStreetGeometry(target.geometry, target.id);
    }
    if (target.geometry.type === "Point") {
      return isFiniteCoordinate(target.geometry.coordinates);
    }
    if (target.geometry.type === "Polygon") {
      return Array.isArray(target.geometry.coordinates)
        && target.geometry.coordinates.some(ring => Array.isArray(ring) && ring.length >= 3);
    }
    if (target.geometry.type === "MultiPolygon") {
      return Array.isArray(target.geometry.coordinates)
        && target.geometry.coordinates.some(polygon => Array.isArray(polygon)
          && polygon.some(ring => Array.isArray(ring) && ring.length >= 3));
    }
    return false;
  }

  function haversineDistanceMeters(first, second) {
    const toRadians = degrees => degrees * Math.PI / 180;
    const [firstLon, firstLat] = first.map(Number);
    const [secondLon, secondLat] = second.map(Number);
    const latitudeDelta = toRadians(secondLat - firstLat);
    const longitudeDelta = toRadians(secondLon - firstLon);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(toRadians(firstLat)) * Math.cos(toRadians(secondLat))
      * Math.sin(longitudeDelta / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getPolygonRings(geometry) {
    if (geometry.type === "Polygon") return geometry.coordinates;
    if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
    return [];
  }

  function evaluateTargetDistance(target, clickedCoordinates, turfApi, geometryApi) {
    if (!isValidTargetGeometry(target, geometryApi) || !isFiniteCoordinate(clickedCoordinates)) {
      return null;
    }
    if (target.targetType === TARGET_TYPES.STREET) {
      return geometryApi.findNearestPointOnSections(
        target.geometry.sections,
        clickedCoordinates,
        turfApi
      );
    }
    if (target.geometry.type === "Point") {
      const targetCoordinate = target.geometry.coordinates.map(Number);
      return {
        distanceMeters: haversineDistanceMeters(clickedCoordinates, targetCoordinate),
        nearestCoordinate: targetCoordinate,
        sectionIndex: null
      };
    }

    const clickedPoint = turfApi.point(clickedCoordinates);
    if (typeof turfApi.booleanPointInPolygon === "function"
      && turfApi.booleanPointInPolygon(clickedPoint, target.geometry)) {
      return {
        distanceMeters: 0,
        nearestCoordinate: clickedCoordinates.map(Number),
        sectionIndex: null
      };
    }
    return geometryApi.findNearestPointOnSections(
      getPolygonRings(target.geometry),
      clickedCoordinates,
      turfApi
    );
  }

  function calculateTargetScore(distanceMeters, target) {
    const distance = Math.max(0, Number(distanceMeters) || 0);
    if (target?.targetType === TARGET_TYPES.POI) {
      if (distance <= 15) return 1000;
      return Math.max(0, Math.round(1000 * Math.exp(-distance / 250)));
    }
    if (distance <= 10) return 1000;
    return Math.max(0, Math.round(1000 * Math.exp(-distance / 500)));
  }

  return {
    TARGET_TYPES,
    prepareStreetTargets,
    preparePoiTargets,
    isValidTargetGeometry,
    haversineDistanceMeters,
    evaluateTargetDistance,
    calculateTargetScore
  };
});
