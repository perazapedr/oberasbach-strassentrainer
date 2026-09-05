(function initializeCustomTrainingAreas(root, factory) {
  "use strict";
  const api = factory(
    root && root.turf,
    root && root.StrassentrainerCityDataValidator
  );
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./vendor/turf/turf.min.js"),
      require("./city-data-validator.js")
    );
  }
  if (root) root.StrassentrainerCustomTrainingAreas = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCustomTrainingAreaApi(turfApi, validatorApi) {
  "use strict";

  const AREA_KINDS = Object.freeze({
    ADMINISTRATIVE: "administrative",
    RESPONSE: "response_area",
    CUSTOM: "custom"
  });
  const USER_AREA_NAME_MAX_LENGTH = 80;
  const membershipCache = new Map();

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function areaKind(area) {
    const kind = String(area && area.kind || "").trim();
    return Object.values(AREA_KINDS).includes(kind) ? kind : AREA_KINDS.ADMINISTRATIVE;
  }

  function areaSource(area) {
    const source = String(area && area.source || "").trim();
    if (source) return source;
    return areaKind(area) === AREA_KINDS.ADMINISTRATIVE ? "osm" : "user";
  }

  function isUserArea(area) {
    return Boolean(area) && areaSource(area) === "user"
      && [AREA_KINDS.RESPONSE, AREA_KINDS.CUSTOM].includes(areaKind(area));
  }

  function normalizeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function validateName(value, existingAreas = [], excludedId = null) {
    const name = normalizeName(value);
    if (!name) return { valid: false, code: "NAME_REQUIRED", message: "Bitte gib einen Namen für das Trainingsgebiet ein." };
    if (name.length > USER_AREA_NAME_MAX_LENGTH) {
      return { valid: false, code: "NAME_TOO_LONG", message: `Der Name darf höchstens ${USER_AREA_NAME_MAX_LENGTH} Zeichen lang sein.` };
    }
    const duplicate = (Array.isArray(existingAreas) ? existingAreas : []).some(area =>
      area && area.id !== excludedId
      && normalizeName(area.name).localeCompare(name, "de", { sensitivity: "base" }) === 0);
    if (duplicate) {
      return { valid: false, code: "NAME_DUPLICATE", message: "In dieser Stadt gibt es bereits ein Trainingsgebiet mit diesem Namen." };
    }
    return { valid: true, name };
  }

  function createUserAreaId(uuidFactory) {
    let token = "";
    if (typeof uuidFactory === "function") token = String(uuidFactory() || "").trim();
    else if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") token = crypto.randomUUID();
    else token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    token = token.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return `user-area-${token || Date.now().toString(36)}`;
  }

  function equalCoordinate(first, second) {
    return Array.isArray(first) && Array.isArray(second)
      && Number(first[0]) === Number(second[0]) && Number(first[1]) === Number(second[1]);
  }

  function normalizePolygon(points) {
    const source = Array.isArray(points) ? points : [];
    const ring = [];
    for (const point of source) {
      const lon = Number(Array.isArray(point) ? point[0] : point && (point.lng ?? point.lon));
      const lat = Number(Array.isArray(point) ? point[1] : point && point.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const coordinate = [lon, lat];
      if (!equalCoordinate(ring[ring.length - 1], coordinate)) ring.push(coordinate);
    }
    if (ring.length > 1 && equalCoordinate(ring[0], ring[ring.length - 1])) ring.pop();
    if (new Set(ring.map(point => `${point[0]},${point[1]}`)).size < 3) {
      throw Object.assign(new Error("Ein Polygon benötigt mindestens drei unterschiedliche Punkte."), { code: "POLYGON_TOO_SMALL" });
    }
    ring.push([...ring[0]]);
    const polygon = { type: "Polygon", coordinates: [ring] };
    try {
      const feature = turfApi.polygon(polygon.coordinates);
      if (typeof turfApi.kinks === "function" && turfApi.kinks(feature).features.length > 0) {
        throw Object.assign(new Error("Das Polygon darf sich nicht selbst überschneiden."), { code: "POLYGON_SELF_INTERSECTION" });
      }
      if (Number(turfApi.area(feature)) <= 0) throw new Error("Das Polygon besitzt keine gültige Fläche.");
    } catch (error) {
      if (error && error.code) throw error;
      throw Object.assign(new Error("Das gezeichnete Polygon ist ungültig."), { code: "POLYGON_INVALID" });
    }
    return polygon;
  }

  function leafletLatLngToGeoJsonCoordinate(latlng) {
    const longitude = Number(latlng && latlng.lng);
    const latitude = Number(latlng && latlng.lat);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? [longitude, latitude]
      : null;
  }

  function isAreaGeometry(geometry) {
    return Boolean(geometry) && ["Polygon", "MultiPolygon"].includes(geometry.type)
      && Array.isArray(geometry.coordinates);
  }

  function isContainedInCity(boundary, cityBoundary) {
    if (!isAreaGeometry(boundary) || !isAreaGeometry(cityBoundary)) return false;
    try {
      return Boolean(turfApi.booleanWithin(turfApi.feature(boundary), turfApi.feature(cityBoundary)));
    } catch (_) {
      return false;
    }
  }

  function geometryBounds(geometry) {
    const values = turfApi.bbox(turfApi.feature(geometry));
    return { west: values[0], south: values[1], east: values[2], north: values[3] };
  }

  function geometryCenter(geometry) {
    const point = turfApi.centroid(turfApi.feature(geometry)).geometry.coordinates;
    return { lon: point[0], lat: point[1] };
  }

  function createArea(options = {}) {
    const cityId = String(options.cityId || "").trim();
    if (!cityId) throw Object.assign(new Error("Für das Trainingsgebiet fehlt die Stadt-ID."), { code: "CITY_ID_REQUIRED" });
    const kind = String(options.kind || "").trim();
    if (![AREA_KINDS.RESPONSE, AREA_KINDS.CUSTOM].includes(kind)) {
      throw Object.assign(new Error("Unbekannter Typ des Trainingsgebiets."), { code: "AREA_KIND_INVALID" });
    }
    const nameResult = validateName(options.name, options.existingAreas);
    if (!nameResult.valid) throw Object.assign(new Error(nameResult.message), { code: nameResult.code });
    const boundary = normalizePolygon(options.points || options.boundary?.coordinates?.[0]);
    if (!isAreaGeometry(options.cityBoundary)) {
      throw Object.assign(new Error(
        "Die installierte Stadtgrenze ist nicht verfügbar. Bitte lade das Stadtpaket neu, bevor du ein Trainingsgebiet speicherst."
      ), { code: "CITY_BOUNDARY_REQUIRED" });
    }
    if (!isContainedInCity(boundary, options.cityBoundary)) {
      throw Object.assign(new Error(
        "Das Trainingsgebiet reicht außerhalb des installierten Stadtgebiets. Für gemeindeübergreifende Gebiete ist später ein größerer Datensatz erforderlich."
      ), { code: "AREA_OUTSIDE_CITY" });
    }
    const now = options.now || new Date().toISOString();
    return {
      id: createUserAreaId(options.uuidFactory),
      cityId,
      name: nameResult.name,
      kind,
      source: "user",
      boundary,
      bounds: geometryBounds(boundary),
      center: geometryCenter(boundary),
      invalid: false,
      createdAt: now,
      updatedAt: now
    };
  }

  function normalizedStreetGeometry(street) {
    const geometry = street && street.geometry;
    if (!geometry) return null;
    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) return geometry;
    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
      return { type: "MultiLineString", coordinates: [geometry.coordinates] };
    }
    if (geometry.type === "MultiLineString" && Array.isArray(geometry.sections)) {
      return { type: "MultiLineString", coordinates: geometry.sections };
    }
    return null;
  }

  function entityBounds(entity, kind) {
    if (kind === "poi") {
      const lon = Number(entity.longitude ?? entity.position?.lon ?? entity.geometry?.coordinates?.[0]);
      const lat = Number(entity.latitude ?? entity.position?.lat ?? entity.geometry?.coordinates?.[1]);
      return Number.isFinite(lon) && Number.isFinite(lat)
        ? { west: lon, east: lon, south: lat, north: lat }
        : null;
    }
    const geometry = normalizedStreetGeometry(entity);
    return geometry ? geometryBounds(geometry) : null;
  }

  function boundsOverlap(first, second) {
    return first && second && first.west <= second.east && first.east >= second.west
      && first.south <= second.north && first.north >= second.south;
  }

  function cacheKey(cityId, areaId) {
    return `${String(cityId || "")}::${String(areaId || "")}`;
  }

  function computeMembership(cityId, area, streets, pois, options = {}) {
    if (!area || area.invalid || !isUserArea(area)) {
      return { streetIds: new Set(), poiIds: new Set(), streetTargets: [], poiTargets: [], diagnostics: { streetCandidates: 0, poiCandidates: 0 } };
    }
    const key = cacheKey(cityId, area.id);
    if (!options.force && membershipCache.has(key)) return membershipCache.get(key);
    const areaBounds = area.bounds || geometryBounds(area.boundary);
    const streetTargets = [];
    const poiTargets = [];
    let streetCandidates = 0;
    let poiCandidates = 0;
    for (const street of (Array.isArray(streets) ? streets : [])) {
      const geometry = normalizedStreetGeometry(street);
      if (!geometry || !boundsOverlap(entityBounds(street, "street"), areaBounds)) continue;
      streetCandidates += 1;
      const classification = validatorApi.classifyStreetAgainstBoundary(geometry, area.boundary);
      if (classification === "inside" || classification === "partial") streetTargets.push(street);
    }
    for (const poi of (Array.isArray(pois) ? pois : [])) {
      const bounds = entityBounds(poi, "poi");
      if (!boundsOverlap(bounds, areaBounds)) continue;
      poiCandidates += 1;
      const coordinate = [bounds.west, bounds.south];
      if (turfApi.booleanPointInPolygon(turfApi.point(coordinate), turfApi.feature(area.boundary))) poiTargets.push(poi);
    }
    const result = Object.freeze({
      streetIds: new Set(streetTargets.map(item => item.id)),
      poiIds: new Set(poiTargets.map(item => item.id)),
      streetTargets,
      poiTargets,
      diagnostics: Object.freeze({ streetCandidates, poiCandidates })
    });
    membershipCache.set(key, result);
    return result;
  }

  function invalidateMembership(cityId, areaId) {
    if (!cityId) {
      membershipCache.clear();
      return;
    }
    if (areaId) membershipCache.delete(cacheKey(cityId, areaId));
    else {
      const prefix = `${cityId}::`;
      for (const key of membershipCache.keys()) if (key.startsWith(prefix)) membershipCache.delete(key);
    }
  }

  function revalidateUserAreas(areas, cityBoundary) {
    return (Array.isArray(areas) ? areas : []).map(area => {
      if (!isUserArea(area)) return area;
      const valid = isContainedInCity(area.boundary, cityBoundary);
      return {
        ...clone(area),
        invalid: !valid,
        invalidReason: valid ? null : "Das Gebiet liegt nach der Aktualisierung nicht mehr vollständig innerhalb der Stadtgrenze."
      };
    });
  }

  function createMapDrawingController(map, options = {}) {
    if (!map || typeof map.on !== "function" || typeof map.off !== "function") {
      throw new TypeError("A Leaflet-compatible map is required.");
    }
    const onPoint = typeof options.onPoint === "function" ? options.onPoint : () => {};
    const releaseMaxBounds = options.releaseMaxBounds !== false;
    let active = false;
    let savedMaxBounds = null;
    let hasSavedMaxBounds = false;

    const handleMapClick = event => {
      if (!active || !event || !event.latlng) return;
      onPoint(event.latlng, event);
    };

    function start() {
      if (active) return false;
      if (releaseMaxBounds && typeof map.setMaxBounds === "function") {
        savedMaxBounds = map.options?.maxBounds || null;
        hasSavedMaxBounds = true;
        map.setMaxBounds(null);
      }
      active = true;
      map.on("click", handleMapClick);
      return true;
    }

    function stop() {
      if (!active) return false;
      map.off("click", handleMapClick);
      active = false;
      if (hasSavedMaxBounds && typeof map.setMaxBounds === "function") {
        map.setMaxBounds(savedMaxBounds);
      }
      savedMaxBounds = null;
      hasSavedMaxBounds = false;
      return true;
    }

    return Object.freeze({
      start,
      stop,
      cancel: stop,
      finish: stop,
      isActive: () => active,
      getSavedMaxBounds: () => (hasSavedMaxBounds ? savedMaxBounds : null)
    });
  }

  return Object.freeze({
    AREA_KINDS,
    USER_AREA_NAME_MAX_LENGTH,
    areaKind,
    areaSource,
    isUserArea,
    validateName,
    createUserAreaId,
    normalizePolygon,
    leafletLatLngToGeoJsonCoordinate,
    isAreaGeometry,
    isContainedInCity,
    createArea,
    computeMembership,
    invalidateMembership,
    revalidateUserAreas,
    createMapDrawingController,
    geometryBounds,
    geometryCenter
  });
});
