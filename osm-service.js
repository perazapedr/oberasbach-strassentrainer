(function initializeOsmService(root, factory) {
  "use strict";
  const commonJsGeometry = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./geometry.js")
    : null;
  const commonJsValidator = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./city-data-validator.js")
    : null;
  const api = factory(
    (root && root.StreetGeometry) || commonJsGeometry,
    (root && root.StrassentrainerCityDataValidator) || commonJsValidator
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerOsmService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOsmServiceApi(defaultGeometryApi, defaultValidatorApi) {
  "use strict";

  const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
  const NOMINATIM_COUNTRY_CODE = "de";
  const NOMINATIM_TIMEOUT_MS = 12000;
  const NOMINATIM_REQUEST_INTERVAL_MS = 1000;
  const NOMINATIM_RAW_RESULT_LIMIT = 20;
  const MUNICIPALITY_RESULT_LIMIT = 10;

  const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
  const OVERPASS_TIMEOUT_MS = 120000;
  const OVERPASS_QUERY_TIMEOUT_SECONDS = 90;
  const OVERPASS_RETRY_DELAY_MS = 1200;
  const MAX_DOWNLOAD_RETRIES = 1;
  const DOWNLOAD_CHUNK_AREA_THRESHOLD_KM2 = 120;
  const DOWNLOAD_CHUNK_MAX_SPAN_KM = 30;
  const MAX_INITIAL_CHUNK_DEPTH = 2;
  const MAX_CHUNK_DEPTH = 3;
  const MAX_CHUNK_REQUESTS = 96;
  const CITY_DATA_VERSION = 1;
  const DEFAULT_CITY_ZOOM = 13;

  const DEFAULT_STREET_HIGHWAY_TYPES = Object.freeze([
    "residential",
    "living_street",
    "unclassified",
    "tertiary",
    "secondary",
    "primary"
  ]);

  const ALTERNATIVE_NAME_TAGS = Object.freeze([
    "official_name",
    "alt_name",
    "short_name",
    "loc_name"
  ]);

  const POI_CATEGORY_DEFINITIONS = Object.freeze([
    Object.freeze({
      category: "fire_station",
      categoryLabel: "Feuerwehr",
      key: "amenity",
      value: "fire_station"
    }),
    Object.freeze({
      category: "school",
      categoryLabel: "Schule",
      key: "amenity",
      value: "school"
    }),
    Object.freeze({
      category: "kindergarten",
      categoryLabel: "Kindergarten",
      key: "amenity",
      value: "kindergarten"
    }),
    Object.freeze({
      category: "supermarket",
      categoryLabel: "Supermarkt",
      key: "shop",
      value: "supermarket"
    })
  ]);

  const VALID_OSM_TYPES = new Set(["node", "way", "relation"]);
  const GERMAN_BASE_COLLATOR = new Intl.Collator("de", { sensitivity: "base" });
  const GERMAN_COLLATOR = new Intl.Collator("de");
  const DEFAULT_COLLATOR = new Intl.Collator();
  const MUNICIPALITY_TYPES = new Set(["city", "town", "village", "municipality"]);
  const EXCLUDED_PLACE_TYPES = new Set([
    "borough", "city_block", "city_district", "croft", "farm", "hamlet",
    "isolated_dwelling", "locality", "neighbourhood", "quarter", "suburb"
  ]);

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
      start() { return enabled ? monotonicNow() : 0; },
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

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizedText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("de-DE")
      .replace(/\s+/g, " ")
      .trim();
  }

  function trimmedString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function validOsmId(value) {
    const id = finiteNumber(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function validLonLat(point) {
    if (!point || typeof point !== "object") return null;
    const lat = finiteNumber(point.lat);
    const lon = finiteNumber(point.lon);
    if (lat === null || lon === null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  function toGeoJsonCoordinate(point) {
    const position = validLonLat(point);
    return position ? [position.lon, position.lat] : null;
  }

  function coordinatesEqual(first, second, epsilon = 1e-10) {
    return Array.isArray(first) && Array.isArray(second)
      && Math.abs(first[0] - second[0]) <= epsilon
      && Math.abs(first[1] - second[1]) <= epsilon;
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function compareNames(first, second) {
    return GERMAN_BASE_COLLATOR.compare(first, second)
      || GERMAN_COLLATOR.compare(first, second)
      || DEFAULT_COLLATOR.compare(first, second);
  }

  function parseBoundingBox(value) {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const south = finiteNumber(value[0]);
    const north = finiteNumber(value[1]);
    const west = finiteNumber(value[2]);
    const east = finiteNumber(value[3]);
    if ([south, north, west, east].some(coordinate => coordinate === null)) return null;
    if (south < -90 || north > 90 || west < -180 || east > 180) return null;
    if (south > north || west > east) return null;
    return { south, west, north, east };
  }

  function parseCenter(raw) {
    const lat = finiteNumber(raw && raw.lat);
    const lon = finiteNumber(raw && raw.lon);
    if (lat === null || lon === null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  function parsePostalCodes(raw) {
    const address = raw && raw.address && typeof raw.address === "object" ? raw.address : {};
    const values = [address.postcode, raw && raw.postcode]
      .filter(value => typeof value === "string")
      .flatMap(value => value.match(/\b\d{5}\b/g) || []);
    return [...new Set(values)];
  }

  function getResultCategory(raw) {
    return normalizedText(raw && (raw.category || raw.class));
  }

  function getMunicipalityKind(raw) {
    const addressType = normalizedText(raw && raw.addresstype);
    const type = normalizedText(raw && raw.type);
    if (MUNICIPALITY_TYPES.has(addressType)) return addressType;
    if (MUNICIPALITY_TYPES.has(type)) return type;
    return "";
  }

  function getAdminLevel(raw) {
    const extraTags = raw && raw.extratags && typeof raw.extratags === "object" ? raw.extratags : {};
    const value = finiteNumber(extraTags.admin_level !== undefined ? extraTags.admin_level : raw && raw.admin_level);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function getMunicipalityName(raw) {
    const address = raw && raw.address && typeof raw.address === "object" ? raw.address : {};
    const nameDetails = raw && raw.namedetails && typeof raw.namedetails === "object" ? raw.namedetails : {};
    const municipalityKind = getMunicipalityKind(raw);
    const candidates = [
      raw && raw.name,
      nameDetails.name,
      nameDetails["name:de"],
      municipalityKind && address[municipalityKind],
      address.city,
      address.town,
      address.village,
      address.municipality
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
  }

  function isGermanResult(raw) {
    const address = raw && raw.address && typeof raw.address === "object" ? raw.address : {};
    const countryCode = normalizedText(address.country_code || raw && raw.country_code);
    if (countryCode) return countryCode === NOMINATIM_COUNTRY_CODE;
    const country = normalizedText(address.country || raw && raw.country);
    return country === "deutschland" || country === "germany" || country === "bundesrepublik deutschland";
  }

  function hasDifferentParentMunicipality(raw, name, municipalityKind) {
    const address = raw && raw.address && typeof raw.address === "object" ? raw.address : {};
    const ownName = normalizedText(name);
    if (!ownName) return true;

    const parentFieldsByKind = {
      city: ["municipality"],
      town: ["city", "municipality"],
      village: ["city", "town", "municipality"],
      municipality: ["city", "town"]
    };
    const parentFields = parentFieldsByKind[municipalityKind] || ["city", "town", "municipality"];
    return parentFields.some(field => {
      const parentName = normalizedText(address[field]);
      return parentName && parentName !== ownName;
    });
  }

  function isPlausibleGermanMunicipality(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    if (!isGermanResult(raw)) return false;

    const category = getResultCategory(raw);
    const type = normalizedText(raw.type);
    const addressType = normalizedText(raw.addresstype);
    const municipalityKind = getMunicipalityKind(raw);
    if (!municipalityKind) return false;
    if (EXCLUDED_PLACE_TYPES.has(type) || EXCLUDED_PLACE_TYPES.has(addressType)) return false;
    const adminLevel = getAdminLevel(raw);
    if (addressType === "municipality" && adminLevel !== null && adminLevel !== 8) return false;

    const isAdministrativeBoundary = category === "boundary"
      && type === "administrative"
      && MUNICIPALITY_TYPES.has(addressType);
    const isMunicipalPlace = category === "place"
      && MUNICIPALITY_TYPES.has(type)
      && MUNICIPALITY_TYPES.has(addressType);
    if (!isAdministrativeBoundary && !isMunicipalPlace) return false;

    const name = getMunicipalityName(raw);
    if (!name || hasDifferentParentMunicipality(raw, name, municipalityKind)) return false;

    const osmType = normalizedText(raw.osm_type);
    const osmId = finiteNumber(raw.osm_id);
    if (!VALID_OSM_TYPES.has(osmType) || !Number.isSafeInteger(osmId) || osmId <= 0) return false;
    return Boolean(parseBoundingBox(raw.boundingbox) && parseCenter(raw));
  }

  function normalizeMunicipality(raw) {
    if (!isPlausibleGermanMunicipality(raw)) return null;
    const address = raw.address && typeof raw.address === "object" ? raw.address : {};
    const name = getMunicipalityName(raw);
    return {
      name,
      displayName: name,
      district: typeof address.county === "string" && address.county.trim()
        ? address.county.trim()
        : (typeof address.district === "string" && address.district.trim() ? address.district.trim() : null),
      state: typeof address.state === "string" && address.state.trim() ? address.state.trim() : null,
      country: "Deutschland",
      countryCode: NOMINATIM_COUNTRY_CODE,
      postalCodes: parsePostalCodes(raw),
      osmType: normalizedText(raw.osm_type),
      osmId: Number(raw.osm_id),
      bounds: parseBoundingBox(raw.boundingbox),
      center: parseCenter(raw),
      addresstype: normalizedText(raw.addresstype),
      placeType: normalizedText(raw.type),
      adminLevel: getAdminLevel(raw)
    };
  }

  function buildNominatimSearchUrl(query, endpoint = NOMINATIM_SEARCH_URL, rawResultLimit = NOMINATIM_RAW_RESULT_LIMIT) {
    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("extratags", "1");
    url.searchParams.set("countrycodes", NOMINATIM_COUNTRY_CODE);
    url.searchParams.set("accept-language", "de");
    url.searchParams.set("limit", String(rawResultLimit));
    return url.toString();
  }

  function buildBoundaryQuery(relationId, queryTimeoutSeconds = OVERPASS_QUERY_TIMEOUT_SECONDS) {
    const id = validOsmId(relationId);
    if (id === null) throw new TypeError("A valid municipality relation ID is required.");
    const timeout = Math.max(1, Math.floor(queryTimeoutSeconds));
    return [
      `[out:json][timeout:${timeout}];`,
      `relation(${id});`,
      "out body geom;"
    ].join("\n");
  }

  function buildChunkDataQuery(relationId, chunk, queryTimeoutSeconds = OVERPASS_QUERY_TIMEOUT_SECONDS) {
    const id = validOsmId(relationId);
    if (id === null) throw new TypeError("A valid municipality relation ID is required.");
    if (!chunk || !normalizeMunicipalityBounds(chunk)) {
      throw new TypeError("A valid DownloadChunk is required.");
    }
    const timeout = Math.max(1, Math.floor(queryTimeoutSeconds));
    const highwayPattern = DEFAULT_STREET_HIGHWAY_TYPES.join("|");
    const amenityPattern = POI_CATEGORY_DEFINITIONS
      .filter(definition => definition.key === "amenity")
      .map(definition => definition.value)
      .join("|");

    const bbox = [chunk.south, chunk.west, chunk.north, chunk.east]
      .map(value => Number(value).toFixed(7))
      .join(",");
    return [
      `[out:json][timeout:${timeout}];`,
      `relation(${id})->.boundary;`,
      ".boundary map_to_area -> .searchArea;",
      "(",
      `  way(area.searchArea)(${bbox})["highway"~"^(${highwayPattern})$"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["amenity"~"^(${amenityPattern})$"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["shop"="supermarket"]["name"];`,
      ");",
      "out tags geom;"
    ].join("\n");
  }

  function buildAreaDiscoveryQuery(relationId, queryTimeoutSeconds = OVERPASS_QUERY_TIMEOUT_SECONDS) {
    const id = validOsmId(relationId);
    if (id === null) throw new TypeError("A valid municipality relation ID is required.");
    const timeout = Math.max(1, Math.floor(queryTimeoutSeconds));
    return [
      `[out:json][timeout:${timeout}];`,
      `relation(${id})->.boundary;`,
      ".boundary map_to_area -> .searchArea;",
      "(",
      '  relation(area.searchArea)["boundary"="administrative"]["admin_level"~"^(8|9|10|11)$"];',
      '  relation(area.searchArea)["place"~"^(borough|suburb|quarter)$"];',
      '  way(area.searchArea)["boundary"="administrative"]["admin_level"~"^(8|9|10|11)$"];',
      '  way(area.searchArea)["place"~"^(borough|suburb|quarter)$"];',
      ");",
      "out body geom;"
    ].join("\n");
  }

  function parseAlternativeNames(tags, primaryName) {
    const aliases = [];
    const seen = new Set([primaryName]);
    for (const tagName of ALTERNATIVE_NAME_TAGS) {
      const rawValue = tags && tags[tagName];
      if (typeof rawValue !== "string") continue;
      for (const part of rawValue.split(";")) {
        const alias = part.trim();
        if (!alias || seen.has(alias)) continue;
        seen.add(alias);
        aliases.push(alias);
      }
    }
    return aliases;
  }

  function copyOsmTags(tags) {
    if (!tags || typeof tags !== "object" || Array.isArray(tags)) return {};
    const copied = {};
    for (const [key, value] of Object.entries(tags)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        copied[key] = value;
      }
    }
    return copied;
  }

  function parseWayLine(element) {
    if (!element || !Array.isArray(element.geometry)) return null;
    const coordinates = element.geometry.map(toGeoJsonCoordinate);
    if (coordinates.length < 2 || coordinates.some(coordinate => coordinate === null)) return null;
    const distinct = new Set(coordinates.map(coordinate => `${coordinate[0]},${coordinate[1]}`));
    return distinct.size >= 2 ? coordinates : null;
  }

  function fallbackStreetComponent(name) {
    const slug = name.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .toLocaleLowerCase("de-DE")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "strasse";
    return `street-${slug}-${stableHash(name)}`;
  }

  function createUniqueStreetId(cityId, name, geometryApi, usedIds) {
    const component = typeof geometryApi.createStreetId === "function"
      ? geometryApi.createStreetId(name)
      : fallbackStreetComponent(name);
    const baseId = `${cityId}:${component}`;
    if (!usedIds.has(baseId)) {
      usedIds.add(baseId);
      return baseId;
    }

    const collisionBase = `${baseId}-${stableHash(name)}`;
    let candidate = collisionBase;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${collisionBase}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
  }

  function ensureGeometryApi(geometryApi) {
    if (!geometryApi
      || typeof geometryApi.mergeStreetFeatures !== "function"
      || typeof geometryApi.isValidStreetGeometry !== "function") {
      throw new Error("StreetGeometry API is required to process Overpass street geometries.");
    }
  }

  function processStreetElements(elements, cityId, geometryApi, profiler) {
    ensureGeometryApi(geometryApi);
    const allowedHighways = new Set(DEFAULT_STREET_HIGHWAY_TYPES);
    const groups = new Map();
    const seenWayIds = new Set();

    const extractionStartedAt = profiler.start();
    const normalizationStartedAt = profiler.start();
    const normalizedWays = [];
    for (const element of elements) {
      if (!element || element.type !== "way") continue;
      const osmWayId = validOsmId(element.id);
      const tags = element.tags && typeof element.tags === "object" ? element.tags : {};
      const highway = trimmedString(tags.highway);
      const name = trimmedString(tags.name);
      if (osmWayId === null || !allowedHighways.has(highway) || !name) continue;
      if (seenWayIds.has(osmWayId)) continue;
      const coordinates = parseWayLine(element);
      if (!coordinates) continue;
      seenWayIds.add(osmWayId);
      normalizedWays.push({ element, osmWayId, coordinates, name });
    }
    profiler.increment("streetWaysNormalized", normalizedWays.length);
    profiler.end("streetNormalizationMs", normalizationStartedAt);
    const groupingStartedAt = profiler.start();
    for (const way of normalizedWays) {
      const { name } = way;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(way);
    }
    profiler.end("streetGroupingMs", groupingStartedAt);
    profiler.end("streetExtractionMs", extractionStartedAt);

    const streets = [];
    const usedIds = new Set();
    let startedAt = profiler.start();
    const sortedNames = [...groups.keys()].sort(compareNames);
    profiler.end("streetSortingMs", startedAt);
    for (const name of sortedNames) {
      startedAt = profiler.start();
      const ways = groups.get(name).sort((first, second) => first.osmWayId - second.osmWayId);
      const streetId = createUniqueStreetId(cityId, name, geometryApi, usedIds);
      const aliases = [];
      const seenAliases = new Set();
      for (const way of ways) {
        for (const alias of parseAlternativeNames(way.element.tags, name)) {
          if (seenAliases.has(alias)) continue;
          seenAliases.add(alias);
          aliases.push(alias);
        }
      }
      profiler.end("streetIdAndAliasMs", startedAt);

      startedAt = profiler.start();
      const features = ways.map(way => ({
        type: "Feature",
        properties: { osm_type: "way", osm_id: way.osmWayId },
        geometry: { type: "LineString", coordinates: way.coordinates }
      }));
      const merged = geometryApi.mergeStreetFeatures(
        features,
        { id: streetId, displayName: name, aliases },
        null,
        "overpass"
      );
      if (!geometryApi.isValidStreetGeometry(merged, streetId)) continue;

      streets.push({
        id: streetId,
        cityId,
        name,
        aliases,
        geometry: {
          type: "MultiLineString",
          // mergeStreetFeatures() returns the locally-created section arrays unchanged.
          // They have no other owner after this function, so another deep coordinate
          // copy would only double the normalized geometry temporarily.
          coordinates: merged.sections
        },
        osmWayIds: [...new Set(ways.map(way => way.osmWayId))].sort((first, second) => first - second)
      });
      profiler.end("streetGeometryMs", startedAt);
    }
    return streets;
  }

  function getPoiCategory(tags) {
    if (!tags || typeof tags !== "object") return null;
    return POI_CATEGORY_DEFINITIONS.find(definition => tags[definition.key] === definition.value) || null;
  }

  function parseClosedRing(rawGeometry) {
    if (!Array.isArray(rawGeometry)) return null;
    const ring = rawGeometry.map(toGeoJsonCoordinate);
    if (ring.length < 4 || ring.some(coordinate => coordinate === null)) return null;
    if (!coordinatesEqual(ring[0], ring[ring.length - 1])) return null;
    const distinct = new Set(ring.slice(0, -1).map(coordinate => `${coordinate[0]},${coordinate[1]}`));
    return distinct.size >= 3 ? ring : null;
  }

  function collectElementCoordinates(element) {
    const coordinates = [];
    const collect = geometry => {
      if (!Array.isArray(geometry)) return;
      for (const point of geometry) {
        const coordinate = toGeoJsonCoordinate(point);
        if (coordinate) coordinates.push(coordinate);
      }
    };
    collect(element && element.geometry);
    if (element && Array.isArray(element.members)) {
      for (const member of element.members) collect(member && member.geometry);
    }
    return coordinates;
  }

  function derivePosition(element) {
    const directPosition = validLonLat(element);
    if (directPosition) return directPosition;
    const centerPosition = validLonLat(element && element.center);
    if (centerPosition) return centerPosition;

    const coordinates = collectElementCoordinates(element);
    if (coordinates.length > 0) {
      const totals = coordinates.reduce((sum, coordinate) => ({
        lon: sum.lon + coordinate[0],
        lat: sum.lat + coordinate[1]
      }), { lon: 0, lat: 0 });
      return {
        lat: totals.lat / coordinates.length,
        lon: totals.lon / coordinates.length
      };
    }

    const bounds = element && element.bounds;
    const south = finiteNumber(bounds && bounds.minlat);
    const north = finiteNumber(bounds && bounds.maxlat);
    const west = finiteNumber(bounds && bounds.minlon);
    const east = finiteNumber(bounds && bounds.maxlon);
    if ([south, north, west, east].some(value => value === null)) return null;
    return validLonLat({ lat: (south + north) / 2, lon: (west + east) / 2 });
  }

  function buildPoiGeometry(element) {
    if (!element || element.type === "node") return null;
    if (element.type === "way") {
      const ring = parseClosedRing(element.geometry);
      return ring ? { type: "Polygon", coordinates: [ring] } : null;
    }
    if (element.type !== "relation" || !Array.isArray(element.members)) return null;

    const outerRings = element.members
      .filter(member => member && member.type === "way" && (member.role === "outer" || member.role === ""))
      .map(member => parseClosedRing(member.geometry))
      .filter(Boolean);
    if (outerRings.length !== 1) return null;
    const innerRings = element.members
      .filter(member => member && member.type === "way" && member.role === "inner")
      .map(member => parseClosedRing(member.geometry))
      .filter(Boolean);
    return { type: "Polygon", coordinates: [outerRings[0], ...innerRings] };
  }

  function parseBoundaryMemberLine(member) {
    if (!member || member.type !== "way" || !Array.isArray(member.geometry)) return null;
    const coordinates = [];
    for (const rawPoint of member.geometry) {
      const coordinate = toGeoJsonCoordinate(rawPoint);
      if (!coordinate) return null;
      if (!coordinatesEqual(coordinates[coordinates.length - 1], coordinate)) coordinates.push(coordinate);
    }
    return coordinates.length >= 2 ? coordinates : null;
  }

  function closeBoundaryRings(members) {
    const remaining = [];
    for (const member of members) {
      const coordinates = parseBoundaryMemberLine(member);
      if (!coordinates) return null;
      remaining.push(coordinates);
    }

    const rings = [];
    while (remaining.length > 0) {
      let line = remaining.shift().map(coordinate => [...coordinate]);
      while (!coordinatesEqual(line[0], line[line.length - 1])) {
        const start = line[0];
        const end = line[line.length - 1];
        let matchIndex = -1;
        let joined = null;

        for (let index = 0; index < remaining.length; index += 1) {
          const candidate = remaining[index];
          const candidateStart = candidate[0];
          const candidateEnd = candidate[candidate.length - 1];
          if (coordinatesEqual(end, candidateStart)) {
            joined = line.concat(candidate.slice(1));
          } else if (coordinatesEqual(end, candidateEnd)) {
            joined = line.concat([...candidate].reverse().slice(1));
          } else if (coordinatesEqual(start, candidateEnd)) {
            joined = candidate.slice(0, -1).concat(line);
          } else if (coordinatesEqual(start, candidateStart)) {
            joined = [...candidate].reverse().slice(0, -1).concat(line);
          }
          if (joined) {
            matchIndex = index;
            break;
          }
        }

        if (matchIndex < 0) return null;
        remaining.splice(matchIndex, 1);
        line = joined;
      }

      const distinct = new Set(line.slice(0, -1).map(coordinate => `${coordinate[0]},${coordinate[1]}`));
      if (line.length < 4 || distinct.size < 3) return null;
      rings.push(line);
    }
    return rings;
  }

  function pointInRing(point, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const currentPoint = ring[index];
      const previousPoint = ring[previous];
      const crossesLatitude = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]);
      if (!crossesLatitude) continue;
      const crossingLongitude = ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]))
        / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
      if (point[0] < crossingLongitude) inside = !inside;
    }
    return inside;
  }

  function buildMunicipalityBoundary(elements, relationId) {
    const relation = elements.find(element => (
      element && element.type === "relation" && Number(element.id) === relationId
    ));
    if (!relation || !Array.isArray(relation.members)) return null;

    const outerMembers = relation.members.filter(member => (
      member && member.type === "way" && (member.role === "outer" || member.role === "")
    ));
    const innerMembers = relation.members.filter(member => (
      member && member.type === "way" && member.role === "inner"
    ));
    if (outerMembers.length === 0) return null;

    const outerRings = closeBoundaryRings(outerMembers);
    const innerRings = closeBoundaryRings(innerMembers);
    if (!outerRings || !innerRings) return null;

    const polygons = outerRings.map(outerRing => [outerRing]);
    for (const innerRing of innerRings) {
      const polygonIndex = outerRings.findIndex(outerRing => pointInRing(innerRing[0], outerRing));
      if (polygonIndex < 0) return null;
      polygons[polygonIndex].push(innerRing);
    }

    return polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };
  }

  function calculatePolygonBounds(geometry) {
    if (!geometry) return null;
    let south = Infinity;
    let north = -Infinity;
    let west = Infinity;
    let east = -Infinity;
    function visitRing(ring) {
      if (!Array.isArray(ring)) return;
      for (const pt of ring) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        const lon = Number(pt[0]);
        const lat = Number(pt[1]);
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        if (lon < west) west = lon;
        if (lon > east) east = lon;
      }
    }
    const ringsList = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    for (const rings of ringsList) {
      if (Array.isArray(rings)) {
        for (const ring of rings) {
          visitRing(ring);
        }
      }
    }
    if (!Number.isFinite(south) || !Number.isFinite(north) || !Number.isFinite(west) || !Number.isFinite(east)) {
      return null;
    }
    return {
      south: Number(south.toFixed(7)),
      west: Number(west.toFixed(7)),
      north: Number(north.toFixed(7)),
      east: Number(east.toFixed(7))
    };
  }

  function pointInPolygonGeometry(point, geometry) {
    if (!geometry || !geometry.coordinates || !Array.isArray(point)) return false;
    const ringsList = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    for (const polygonRings of ringsList) {
      if (!Array.isArray(polygonRings) || polygonRings.length === 0) continue;
      const outerRing = polygonRings[0];
      if (pointInRing(point, outerRing)) {
        let inHole = false;
        for (let i = 1; i < polygonRings.length; i += 1) {
          if (pointInRing(point, polygonRings[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }

  function parseWayPolygon(element) {
    if (!element || element.type !== "way" || !Array.isArray(element.geometry)) return null;
    const coords = [];
    for (const rawPoint of element.geometry) {
      const coord = toGeoJsonCoordinate(rawPoint);
      if (coord && (!coords.length || !coordinatesEqual(coords[coords.length - 1], coord))) {
        coords.push(coord);
      }
    }
    if (coords.length < 3) return null;
    if (!coordinatesEqual(coords[0], coords[coords.length - 1])) {
      coords.push([...coords[0]]);
    }
    const distinct = new Set(coords.slice(0, -1).map(c => `${c[0]},${c[1]}`));
    if (coords.length < 4 || distinct.size < 3) return null;
    return { type: "Polygon", coordinates: [coords] };
  }

  function boundsArea(b) {
    if (!b) return 0;
    return Math.max(0, b.north - b.south) * Math.max(0, b.east - b.west);
  }

  function boundsIntersectionArea(a, b) {
    if (!a || !b) return 0;
    const south = Math.max(a.south, b.south);
    const north = Math.min(a.north, b.north);
    const west = Math.max(a.west, b.west);
    const east = Math.min(a.east, b.east);
    if (south >= north || west >= east) return 0;
    return (north - south) * (east - west);
  }

  function discoverTrainingAreas(firstArg, secondArg, thirdArg, fourthArg) {
    let elements = [];
    let municipalityInfo = {};
    let boundary = null;
    let options = {};

    if (Array.isArray(firstArg)) {
      elements = firstArg;
      municipalityInfo = secondArg || {};
      boundary = thirdArg || null;
      options = fourthArg || {};
    } else if (firstArg && typeof firstArg === "object") {
      elements = Array.isArray(firstArg.elements) ? firstArg.elements : [];
      municipalityInfo = firstArg.municipalityInfo || firstArg.municipality || {};
      boundary = firstArg.boundary || null;
      options = firstArg.options || {};
    }

    const cityOsmId = Number(municipalityInfo.osmId);
    const cityName = trimmedString(municipalityInfo.name);
    const cityBounds = normalizeMunicipalityBounds(municipalityInfo.bounds);
    const cityId = municipalityInfo.id || (cityOsmId ? `osm-relation-${cityOsmId}` : "city");

    const candidates = [];
    const seenIds = new Set();

    for (const el of elements) {
      if (!el || (el.type !== "relation" && el.type !== "way")) continue;
      const osmId = validOsmId(el.id);
      if (osmId === null) continue;
      if (el.type === "relation" && osmId === cityOsmId) continue;
      const tags = el.tags && typeof el.tags === "object" ? el.tags : {};
      const name = trimmedString(tags.name || tags["name:de"]);
      if (!name) continue;

      const areaId = `osm-${el.type}-${osmId}`;
      if (seenIds.has(areaId)) continue;

      let polygon = null;
      if (el.type === "relation") {
        polygon = buildMunicipalityBoundary([el], osmId);
      } else if (el.type === "way") {
        polygon = parseWayPolygon(el);
      }
      if (!polygon) continue;

      const bounds = calculatePolygonBounds(polygon);
      if (!bounds) continue;

      if (cityBounds) {
        const cArea = boundsArea(cityBounds);
        const aArea = boundsArea(bounds);
        if (cArea > 0 && aArea >= cArea * 0.92 && name.toLowerCase() === cityName.toLowerCase()) {
          continue;
        }
        if (boundsIntersectionArea(bounds, cityBounds) === 0) {
          continue;
        }
      }

      const center = {
        lat: Number(((bounds.south + bounds.north) / 2).toFixed(7)),
        lon: Number(((bounds.west + bounds.east) / 2).toFixed(7))
      };

      const adminLevel = tags.admin_level && Number.isInteger(Number(tags.admin_level))
        ? Number(tags.admin_level)
        : null;
      const placeType = tags.place ? String(tags.place).trim() : null;
      const boundaryType = tags.boundary ? String(tags.boundary).trim() : null;

      seenIds.add(areaId);
      candidates.push({
        id: areaId,
        cityId,
        name,
        adminLevel,
        placeType,
        boundary: boundaryType,
        parentId: null,
        childIds: [],
        bounds,
        center,
        polygon,
        streetCount: 0,
        isDefault: false
      });
    }

    if (candidates.length === 0) return [];

    const tierMap = new Map();
    for (const candidate of candidates) {
      let key = null;
      if (candidate.adminLevel !== null) {
        key = `admin:${candidate.adminLevel}`;
      } else if (candidate.placeType) {
        key = `place:${candidate.placeType}`;
      } else {
        key = "other";
      }
      if (!tierMap.has(key)) tierMap.set(key, []);
      tierMap.get(key).push(candidate);
    }

    let bestTierKey = null;
    let bestTierScore = -Infinity;

    for (const [key, tierCandidates] of tierMap.entries()) {
      const count = tierCandidates.length;
      if (count === 0) continue;

      let score = 0;
      if (count === 1) {
        score -= 200;
      } else if (count >= 4 && count <= 25) {
        score += 80;
      } else if (count >= 2 && count <= 3) {
        score += 40;
      } else if (count > 25 && count <= 40) {
        score += 25;
      } else if (count > 40) {
        score -= (count - 40) * 3;
      }

      if (key === "admin:9") {
        score += 50;
      } else if (key === "place:borough") {
        score += 45;
      } else if (key === "admin:10") {
        score += 30;
      } else if (key === "place:suburb") {
        score += 25;
      } else if (key === "admin:8") {
        score -= 50;
      }

      if (cityBounds) {
        const cityArea = boundsArea(cityBounds);
        if (cityArea > 0) {
          const totalArea = tierCandidates.reduce((sum, c) => sum + boundsArea(c.bounds), 0);
          const ratio = totalArea / cityArea;
          if (ratio >= 0.7 && ratio <= 1.4) {
            score += 40;
          } else if (ratio >= 0.4) {
            score += 20;
          }
        }
      }

      let overlapCount = 0;
      for (let i = 0; i < tierCandidates.length; i += 1) {
        for (let j = i + 1; j < tierCandidates.length; j += 1) {
          const inter = boundsIntersectionArea(tierCandidates[i].bounds, tierCandidates[j].bounds);
          const minA = Math.min(boundsArea(tierCandidates[i].bounds), boundsArea(tierCandidates[j].bounds));
          if (minA > 0 && inter / minA > 0.4) {
            overlapCount += 1;
          }
        }
      }
      if (overlapCount > 0) {
        score -= overlapCount * 10;
      }

      if (score > bestTierScore) {
        bestTierScore = score;
        bestTierKey = key;
      }
    }

    if (!bestTierKey || bestTierScore <= 0) return [];

    const primaryCandidates = tierMap.get(bestTierKey) || [];
    if (primaryCandidates.length < 2) return [];

    const resultAreas = [...primaryCandidates];
    const childCandidates = [];

    for (const [key, tierCandidates] of tierMap.entries()) {
      if (key === bestTierKey) continue;
      const isFiner = tierCandidates.every(c => (
        (c.adminLevel !== null && primaryCandidates[0].adminLevel !== null && c.adminLevel > primaryCandidates[0].adminLevel)
        || boundsArea(c.bounds) < boundsArea(primaryCandidates[0].bounds)
      ));
      if (isFiner && tierCandidates.length <= 120) {
        childCandidates.push(...tierCandidates);
      }
    }

    for (const child of childCandidates) {
      const childCenterPt = [child.center.lon, child.center.lat];
      let bestParent = null;
      let minParentArea = Infinity;

      for (const parent of primaryCandidates) {
        if (pointInPolygonGeometry(childCenterPt, parent.polygon)) {
          const pArea = boundsArea(parent.bounds);
          if (pArea < minParentArea) {
            minParentArea = pArea;
            bestParent = parent;
          }
        }
      }

      if (bestParent) {
        child.parentId = bestParent.id;
        bestParent.childIds.push(child.id);
        resultAreas.push(child);
      }
    }

    for (const area of resultAreas) {
      if (area.parentId === area.id) area.parentId = null;
    }

    return resultAreas.sort((a, b) => compareNames(a.name, b.name));
  }

  function processPoiElements(elements, cityId, profiler) {
    const seenOsmObjects = new Set();
    const pois = [];
    const extractionStartedAt = profiler.start();
    const normalizationStartedAt = profiler.start();
    for (const element of elements) {
      if (!element || !VALID_OSM_TYPES.has(element.type)) continue;
      const osmId = validOsmId(element.id);
      const tags = element.tags && typeof element.tags === "object" ? element.tags : {};
      const category = getPoiCategory(tags);
      const name = trimmedString(tags.name);
      if (osmId === null || !category || !name) continue;

      const osmKey = `${element.type}:${osmId}`;
      if (seenOsmObjects.has(osmKey)) continue;
      const position = derivePosition(element);
      if (!position) continue;
      seenOsmObjects.add(osmKey);

      pois.push({
        id: `${cityId}:poi:${element.type}-${osmId}`,
        cityId,
        name,
        category: category.category,
        categoryLabel: category.categoryLabel,
        aliases: parseAlternativeNames(tags, name),
        position,
        geometry: buildPoiGeometry(element),
        osmType: element.type,
        osmId,
        tags: copyOsmTags(tags)
      });
    }
    profiler.increment("poisNormalized", pois.length);
    profiler.end("poiNormalizationMs", normalizationStartedAt);
    profiler.end("poiExtractionMs", extractionStartedAt);

    const sortingStartedAt = profiler.start();
    const sorted = pois.sort((first, second) => (
      compareNames(first.name, second.name)
      || first.osmType.localeCompare(second.osmType)
      || first.osmId - second.osmId
    ));
    profiler.end("poiSortingMs", sortingStartedAt);
    return sorted;
  }

  function normalizeMunicipalityBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;
    const south = finiteNumber(bounds.south);
    const north = finiteNumber(bounds.north);
    const west = finiteNumber(bounds.west);
    const east = finiteNumber(bounds.east);
    if ([south, north, west, east].some(value => value === null)) return null;
    if (south < -90 || north > 90 || west < -180 || east > 180 || south > north || west > east) return null;
    return { south, west, north, east };
  }

  function downloadChunkSize(bounds) {
    const normalized = normalizeMunicipalityBounds(bounds);
    if (!normalized) return null;
    const latitudeKilometers = (normalized.north - normalized.south) * 111.32;
    const centerLatitudeRadians = ((normalized.south + normalized.north) / 2) * Math.PI / 180;
    const longitudeKilometers = (normalized.east - normalized.west)
      * 111.32 * Math.max(0.01, Math.cos(centerLatitudeRadians));
    return {
      latitudeKilometers,
      longitudeKilometers,
      areaSquareKilometers: latitudeKilometers * longitudeKilometers
    };
  }

  function createRootDownloadChunk(bounds) {
    const normalized = normalizeMunicipalityBounds(bounds);
    if (!normalized) throw new TypeError("Municipality bounds are required to create a download plan.");
    return Object.freeze({ id: "root", ...normalized, depth: 0 });
  }

  function splitDownloadChunk(chunk) {
    const normalized = normalizeMunicipalityBounds(chunk);
    if (!normalized || !Number.isInteger(chunk.depth) || chunk.depth < 0) {
      throw new TypeError("A valid DownloadChunk is required for splitting.");
    }
    const middleLatitude = (normalized.south + normalized.north) / 2;
    const middleLongitude = (normalized.west + normalized.east) / 2;
    const depth = chunk.depth + 1;
    return [
      Object.freeze({ id: `${chunk.id}-sw`, south: normalized.south, west: normalized.west,
        north: middleLatitude, east: middleLongitude, depth }),
      Object.freeze({ id: `${chunk.id}-se`, south: normalized.south, west: middleLongitude,
        north: middleLatitude, east: normalized.east, depth }),
      Object.freeze({ id: `${chunk.id}-nw`, south: middleLatitude, west: normalized.west,
        north: normalized.north, east: middleLongitude, depth }),
      Object.freeze({ id: `${chunk.id}-ne`, south: middleLatitude, west: middleLongitude,
        north: normalized.north, east: normalized.east, depth })
    ];
  }

  function createDownloadPlan(municipality, options = {}) {
    if (!municipality || typeof municipality !== "object" || Array.isArray(municipality)) {
      throw new TypeError("Municipality is required to create a download plan.");
    }
    const areaThreshold = numericOption(
      options.areaThresholdSquareKilometers,
      DOWNLOAD_CHUNK_AREA_THRESHOLD_KM2,
      1
    );
    const maxSpan = numericOption(options.maxSpanKilometers, DOWNLOAD_CHUNK_MAX_SPAN_KM, 1);
    const maxInitialDepth = Math.floor(numericOption(
      options.maxInitialDepth,
      MAX_INITIAL_CHUNK_DEPTH,
      0
    ));
    const rootChunk = createRootDownloadChunk(municipality.bounds);
    const chunks = [];
    const pending = [rootChunk];

    while (pending.length > 0) {
      const chunk = pending.shift();
      const size = downloadChunkSize(chunk);
      const tooLarge = size.areaSquareKilometers > areaThreshold
        || size.latitudeKilometers > maxSpan
        || size.longitudeKilometers > maxSpan;
      if (tooLarge && chunk.depth < maxInitialDepth) pending.unshift(...splitDownloadChunk(chunk));
      else chunks.push(chunk);
    }

    return Object.freeze({
      mode: chunks.length === 1 ? "single" : "chunked",
      chunks: Object.freeze(chunks),
      boundsSize: Object.freeze(downloadChunkSize(rootChunk))
    });
  }

  function osmElementKey(element) {
    if (!element || !VALID_OSM_TYPES.has(element.type)) return null;
    const id = validOsmId(element.id);
    return id === null ? null : `${element.type}:${id}`;
  }

  function countGeometryPoints(value) {
    if (!value || typeof value !== "object") return 0;
    if (Array.isArray(value)) return value.reduce((total, child) => total + countGeometryPoints(child), 0);
    const ownPoint = validLonLat(value) ? 1 : 0;
    return ownPoint + Object.entries(value).reduce((total, [key, child]) => (
      key === "lat" || key === "lon" ? total : total + countGeometryPoints(child)
    ), 0);
  }

  function osmElementRichness(element) {
    const geometryPoints = countGeometryPoints(element.geometry)
      + countGeometryPoints(element.members);
    const tagCount = element.tags && typeof element.tags === "object"
      ? Object.keys(element.tags).length
      : 0;
    const hasDirectPosition = validLonLat(element) ? 1 : 0;
    const hasCenter = validLonLat(element && element.center) ? 1 : 0;
    return geometryPoints * 1000 + tagCount * 10 + hasDirectPosition + hasCenter;
  }

  function stableSerialize(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(",")}}`;
  }

  function preferredOsmElement(first, second) {
    const richnessDifference = osmElementRichness(second) - osmElementRichness(first);
    if (richnessDifference > 0) return second;
    if (richnessDifference < 0) return first;
    return stableSerialize(second) < stableSerialize(first) ? second : first;
  }

  function deduplicateOsmElements(elements, profiler = createProfiler(null)) {
    const startedAt = profiler.start();
    const byIdentity = new Map();
    for (const element of Array.isArray(elements) ? elements : []) {
      const key = osmElementKey(element);
      if (!key) continue;
      const existing = byIdentity.get(key);
      byIdentity.set(key, existing ? preferredOsmElement(existing, element) : element);
    }
    const typeOrder = { node: 0, way: 1, relation: 2 };
    const result = [...byIdentity.values()].sort((first, second) => (
      typeOrder[first.type] - typeOrder[second.type]
      || Number(first.id) - Number(second.id)
    ));
    profiler.increment("osmObjectsDeduplicated", (Array.isArray(elements) ? elements.length : 0) - result.length);
    profiler.end("osmDedupeMs", startedAt);
    return result;
  }

  function createCityMetadata(municipality, cityId, streets, pois, timestamp) {
    const name = trimmedString(municipality.name);
    const displayName = trimmedString(municipality.displayName) || name;
    const postalCodes = Array.isArray(municipality.postalCodes)
      ? [...new Set(municipality.postalCodes.map(trimmedString).filter(Boolean))]
      : [];
    return {
      id: cityId,
      name,
      displayName,
      district: trimmedString(municipality.district) || null,
      state: trimmedString(municipality.state) || null,
      country: trimmedString(municipality.country) || null,
      postalCodes,
      osmType: "relation",
      osmId: Number(municipality.osmId),
      bounds: normalizeMunicipalityBounds(municipality.bounds),
      center: validLonLat(municipality.center),
      defaultZoom: Number.isFinite(municipality.defaultZoom) ? municipality.defaultZoom : DEFAULT_CITY_ZOOM,
      streetCount: streets.length,
      poiCount: pois.length,
      source: "openstreetmap",
      dataVersion: CITY_DATA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function emitProgress(callback, stage, message, progress, details = {}) {
    // These percentages describe stable workflow phases, not downloaded bytes:
    // Overpass does not expose byte-level progress for this single request.
    if (callback) callback({ stage, message, progress, ...details });
  }

  function createAbortError(serviceName = "Nominatim") {
    const error = new Error(`${serviceName} request was aborted.`);
    error.name = "AbortError";
    error.code = "ABORTED";
    return error;
  }

  function createTimeoutError(serviceName = "Nominatim") {
    const error = new Error(`${serviceName} request timed out.`);
    error.name = "TimeoutError";
    error.code = "TIMEOUT";
    return error;
  }

  function throwIfAborted(signal, serviceName = "Nominatim") {
    if (signal && signal.aborted) throw createAbortError(serviceName);
  }

  function defaultDelay(milliseconds, signal) {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      throwIfAborted(signal);
      let timerId = null;
      const onAbort = () => {
        clearTimeout(timerId);
        reject(createAbortError());
      };
      timerId = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function raceWithAbort(promise, signal, serviceName = "Nominatim") {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(createAbortError(serviceName));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject)(createAbortError(serviceName));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(finish(resolve), finish(reject));
    });
  }

  function isPointInsideBounds(point, bounds) {
    return point.lat >= bounds.south && point.lat <= bounds.north
      && point.lon >= bounds.west && point.lon <= bounds.east;
  }

  function representSameMunicipality(first, second) {
    if (first.osmType === second.osmType) return false;
    const relation = first.osmType === "relation" ? first : (second.osmType === "relation" ? second : null);
    const place = relation === first ? second : first;
    if (!relation) return false;
    if (normalizedText(first.name) !== normalizedText(second.name)) return false;
    if (!first.district || !second.district || normalizedText(first.district) !== normalizedText(second.district)) return false;
    if (!first.state || !second.state || normalizedText(first.state) !== normalizedText(second.state)) return false;
    const bothHavePostalCodes = first.postalCodes.length > 0 && second.postalCodes.length > 0;
    if (bothHavePostalCodes && !first.postalCodes.some(code => second.postalCodes.includes(code))) return false;
    return isPointInsideBounds(place.center, relation.bounds);
  }

  function deduplicateMunicipalities(candidates) {
    const byOsmObject = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.municipality.osmType}:${candidate.municipality.osmId}`;
      const existing = byOsmObject.get(key);
      if (!existing || candidate.importance > existing.importance) byOsmObject.set(key, candidate);
    }

    const deduplicated = [];
    for (const candidate of byOsmObject.values()) {
      const duplicateIndex = deduplicated.findIndex(existing => (
        representSameMunicipality(existing.municipality, candidate.municipality)
      ));
      if (duplicateIndex < 0) {
        deduplicated.push(candidate);
        continue;
      }
      const existing = deduplicated[duplicateIndex];
      if (candidate.municipality.osmType === "relation" && existing.municipality.osmType !== "relation") {
        deduplicated[duplicateIndex] = candidate;
      }
    }
    return deduplicated;
  }

  function municipalitySortScore(candidate, query) {
    const exactNameMatch = normalizedText(candidate.municipality.name) === normalizedText(query) ? 1000 : 0;
    const relationBonus = candidate.municipality.osmType === "relation" ? 100 : 0;
    const administrativeBonus = candidate.municipality.placeType === "administrative" ? 20 : 0;
    return exactNameMatch + relationBonus + administrativeBonus + candidate.importance;
  }

  function normalizeSearchResults(rawResults, query, resultLimit) {
    const candidates = rawResults.map((raw, sourceIndex) => ({
      municipality: normalizeMunicipality(raw),
      importance: Math.max(0, finiteNumber(raw && raw.importance) || 0),
      sourceIndex
    })).filter(candidate => candidate.municipality);

    return deduplicateMunicipalities(candidates)
      .sort((first, second) => {
        const scoreDifference = municipalitySortScore(second, query) - municipalitySortScore(first, query);
        return scoreDifference || first.sourceIndex - second.sourceIndex;
      })
      .slice(0, resultLimit)
      .map(candidate => candidate.municipality);
  }

  function numericOption(value, fallback, minimum) {
    return Number.isFinite(value) && value >= minimum ? value : fallback;
  }

  function validateMunicipalityForDownload(municipality) {
    if (!municipality || typeof municipality !== "object" || Array.isArray(municipality)) {
      throw new TypeError("Municipality must be an object returned by searchMunicipalities().");
    }
    const name = trimmedString(municipality.name);
    const osmType = normalizedText(municipality.osmType);
    const osmId = validOsmId(municipality.osmId);
    const placeType = normalizedText(municipality.placeType);
    if (!name) throw new TypeError("Municipality name is required.");
    if (osmType !== "relation" || osmId === null || (placeType && placeType !== "administrative")) {
      const error = new Error("An administrative OSM relation is required to download municipality data.");
      error.name = "InvalidMunicipalityError";
      error.code = "INVALID_MUNICIPALITY";
      throw error;
    }
    return { name, osmId };
  }

  function createOsmService(options = {}) {
    const fetchImpl = options.fetch
      || (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null);
    const AbortControllerImpl = options.AbortController
      || (typeof globalThis !== "undefined" ? globalThis.AbortController : null);
    const endpoint = options.endpoint || NOMINATIM_SEARCH_URL;
    const overpassEndpoint = options.overpassEndpoint || OVERPASS_API_URL;
    const timeoutMs = numericOption(options.timeoutMs, NOMINATIM_TIMEOUT_MS, 1);
    const overpassTimeoutMs = numericOption(options.overpassTimeoutMs, OVERPASS_TIMEOUT_MS, 1);
    const overpassQueryTimeoutSeconds = numericOption(
      options.overpassQueryTimeoutSeconds,
      OVERPASS_QUERY_TIMEOUT_SECONDS,
      1
    );
    const requestIntervalMs = numericOption(options.requestIntervalMs, NOMINATIM_REQUEST_INTERVAL_MS, 0);
    const rawResultLimit = numericOption(options.rawResultLimit, NOMINATIM_RAW_RESULT_LIMIT, 1);
    const resultLimit = numericOption(options.resultLimit, MUNICIPALITY_RESULT_LIMIT, 1);
    const overpassRetryDelayMs = numericOption(
      options.overpassRetryDelayMs,
      OVERPASS_RETRY_DELAY_MS,
      0
    );
    const maxChunkDepth = Math.floor(numericOption(options.maxChunkDepth, MAX_CHUNK_DEPTH, 0));
    const maxChunkRequests = Math.floor(numericOption(
      options.maxChunkRequests,
      MAX_CHUNK_REQUESTS,
      1
    ));
    const downloadPlanFactory = typeof options.downloadPlanFactory === "function"
      ? options.downloadPlanFactory
      : municipality => createDownloadPlan(municipality, {
        areaThresholdSquareKilometers: options.chunkAreaThresholdSquareKilometers,
        maxSpanKilometers: options.chunkMaxSpanKilometers,
        maxInitialDepth: options.maxInitialChunkDepth
      });
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const delay = typeof options.delay === "function" ? options.delay : defaultDelay;
    const scheduleTimeout = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
    const cancelTimeout = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
    const geometryApi = options.geometryApi || defaultGeometryApi;
    const validatorApi = options.validatorApi || defaultValidatorApi;

    let queueTail = Promise.resolve();
    let lastRequestStartedAt = null;

    async function rateLimit(signal) {
      throwIfAborted(signal);
      if (lastRequestStartedAt !== null) {
        let remaining = lastRequestStartedAt + requestIntervalMs - now();
        while (remaining > 0) {
          await delay(remaining, signal);
          throwIfAborted(signal);
          remaining = lastRequestStartedAt + requestIntervalMs - now();
        }
      }
      throwIfAborted(signal);
      lastRequestStartedAt = now();
    }

    async function fetchJsonWithTimeout(url, requestOptions) {
      const {
        signal,
        timeout,
        serviceName,
        method = "GET",
        headers = { Accept: "application/json" },
        body,
        profiler = createProfiler(null)
      } = requestOptions;
      if (!fetchImpl) throw new Error("Fetch API is not available in this environment.");
      if (typeof AbortControllerImpl !== "function") {
        throw new Error("AbortController is not available in this environment.");
      }
      throwIfAborted(signal, serviceName);

      const controller = new AbortControllerImpl();
      let timeoutTriggered = false;
      let externalAbortTriggered = false;
      const onExternalAbort = () => {
        externalAbortTriggered = true;
        controller.abort();
      };
      if (signal) signal.addEventListener("abort", onExternalAbort, { once: true });

      let timeoutId = null;
      const abortPromise = new Promise((resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(timeoutTriggered ? createTimeoutError(serviceName) : createAbortError(serviceName));
        }, { once: true });
        timeoutId = scheduleTimeout(() => {
          timeoutTriggered = true;
          controller.abort();
        }, timeout);
      });

      try {
        const fetchPromise = Promise.resolve().then(async () => {
          const response = await fetchImpl(url, { method, headers, body, signal: controller.signal });
          if (!response || typeof response.ok !== "boolean") {
            const error = new Error(`Invalid response received from ${serviceName}.`);
            error.name = "InvalidResponseError";
            error.code = "INVALID_RESPONSE";
            throw error;
          }
          if (!response.ok) {
            const status = Number(response.status) || 0;
            const suffixes = {
              429: " (Too Many Requests)",
              504: " (Gateway Timeout)"
            };
            const error = new Error(`${serviceName} returned HTTP ${status}${suffixes[status] || ""}.`);
            error.name = "HttpError";
            error.code = "HTTP_ERROR";
            error.status = status;
            throw error;
          }
          try {
            const jsonStartedAt = profiler.start();
            const parsed = await response.json();
            profiler.end(`${serviceName.toLocaleLowerCase("en-US")}ResponseJsonMs`, jsonStartedAt);
            return parsed;
          } catch (cause) {
            const error = new Error(`Invalid JSON response received from ${serviceName}.`);
            error.name = "InvalidResponseError";
            error.code = "INVALID_JSON";
            error.cause = cause;
            throw error;
          }
        });
        return await Promise.race([fetchPromise, abortPromise]);
      } catch (error) {
        if (timeoutTriggered) throw createTimeoutError(serviceName);
        if (externalAbortTriggered || (signal && signal.aborted) || (error && error.name === "AbortError")) {
          throw createAbortError(serviceName);
        }
        if (error && error.code) throw error;
        const networkError = new Error(`${serviceName} request failed due to a network error.`);
        networkError.name = "NetworkError";
        networkError.code = "NETWORK_ERROR";
        networkError.cause = error;
        throw networkError;
      } finally {
        if (timeoutId !== null) cancelTimeout(timeoutId);
        if (signal) signal.removeEventListener("abort", onExternalAbort);
      }
    }

    async function performSearch(query, signal) {
      await rateLimit(signal);
      const url = buildNominatimSearchUrl(query, endpoint, rawResultLimit);
      const rawResults = await fetchJsonWithTimeout(url, {
        signal,
        timeout: timeoutMs,
        serviceName: "Nominatim"
      });
      if (!Array.isArray(rawResults)) {
        const error = new Error("Invalid response received from Nominatim.");
        error.name = "InvalidResponseError";
        error.code = "INVALID_RESPONSE";
        throw error;
      }
      return normalizeSearchResults(rawResults, query, resultLimit);
    }

    function isRetryableOverpassError(error) {
      if (!error || error.code === "ABORTED") return false;
      if (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT") return true;
      return error.code === "HTTP_ERROR" && [429, 500, 502, 503, 504].includes(Number(error.status));
    }

    function createChunkRequestLimitError() {
      const error = new Error(`Overpass chunk request limit of ${maxChunkRequests} was reached.`);
      error.name = "DownloadLimitError";
      error.code = "CHUNK_REQUEST_LIMIT";
      return error;
    }

    function validateOverpassData(rawData) {
      if (!rawData || typeof rawData !== "object" || Array.isArray(rawData) || !Array.isArray(rawData.elements)) {
        const error = new Error("Invalid response received from Overpass.");
        error.name = "InvalidResponseError";
        error.code = "INVALID_RESPONSE";
        throw error;
      }
      return rawData.elements;
    }

    function formatOverpassErrorDiagnostics(error) {
      if (!error) return "";
      const lines = [
        "OVERPASS REQUEST FAILED",
        `stage: ${error.stage || "UNKNOWN"}`,
        `method: ${error.method || "POST"}`,
        `endpoint: ${error.endpoint || "UNKNOWN"}`,
        `navigatorOnline: ${error.navigatorOnline !== undefined ? error.navigatorOnline : "unknown"}`,
        `attempt: ${error.attempt || 1}/${error.maxAttempts || 2}`,
        `aborted: ${Boolean(error.aborted)}`,
        "",
        `error.name: ${error.name || "Error"}`,
        `error.code: ${error.code || "UNKNOWN"}`,
        `error.status: ${error.status !== undefined ? error.status : "null"}`,
        `error.message: ${error.message || ""}`
      ];
      if (error.cause) {
        lines.push(`error.cause: ${error.cause?.message || error.cause}`);
      }
      return lines.join("\n");
    }

    async function fetchOverpassElements(query, requestOptions) {
      const { signal, diagnostics, requestKind, onProgress, profiler } = requestOptions;
      const body = new URLSearchParams({ data: query }).toString();
      for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt += 1) {
        throwIfAborted(signal, "Overpass");
        if (requestKind === "chunk" && diagnostics.chunkRequests >= maxChunkRequests) {
          throw createChunkRequestLimitError();
        }
        diagnostics.requests += 1;
        if (requestKind === "chunk") diagnostics.chunkRequests += 1;
        else if (requestKind === "areas") diagnostics.areaRequests = (diagnostics.areaRequests || 0) + 1;
        else diagnostics.boundaryRequests += 1;
        try {
          const rawData = await fetchJsonWithTimeout(overpassEndpoint, {
            signal,
            timeout: overpassTimeoutMs,
            serviceName: "Overpass",
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body,
            profiler
          });
          return validateOverpassData(rawData);
        } catch (error) {
          const isOnline = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
            ? navigator.onLine
            : true;
          error.stage = error.stage || (
            requestKind === "boundary" ? "BOUNDARY"
            : requestKind === "areas" ? "AREA_DISCOVERY"
            : (diagnostics.strategy === "chunked" ? "DATA_CHUNK" : "DATA_SINGLE")
          );
          error.requestKind = requestKind;
          error.endpoint = overpassEndpoint;
          error.method = "POST";
          error.attempt = attempt + 1;
          error.maxAttempts = MAX_DOWNLOAD_RETRIES + 1;
          error.navigatorOnline = isOnline;
          error.aborted = Boolean(signal && signal.aborted);
          error.diagnostics = formatOverpassErrorDiagnostics(error);

          if (!isRetryableOverpassError(error) || attempt >= MAX_DOWNLOAD_RETRIES) {
            if (isRetryableOverpassError(error)) {
              try { error.retryExhausted = true; } catch (_) {}
            }
            throw error;
          }
          diagnostics.retries += 1;
          emitProgress(
            onProgress,
            "waiting-for-retry",
            requestKind === "boundary"
              ? "Die Gemeindegrenze wird gleich erneut angefragt …"
              : requestKind === "areas"
              ? "Die Trainingsgebiete werden gleich erneut angefragt …"
              : "Ein Stadtbereich wird gleich erneut angefragt …",
            15
          );
          await delay(overpassRetryDelayMs, signal);
        }
      }
      throw new Error("Unreachable Overpass retry state.");
    }

    async function fetchCityData(municipality, downloadOptions = {}) {
      const totalStartedAt = monotonicNow();
      const municipalityInfo = validateMunicipalityForDownload(municipality);
      if (!downloadOptions || typeof downloadOptions !== "object" || Array.isArray(downloadOptions)) {
        throw new TypeError("Download options must be an object.");
      }
      const signal = downloadOptions.signal;
      const onProgress = downloadOptions.onProgress;
      const profiler = createProfiler(downloadOptions.diagnostics);
      if (signal !== undefined && (!signal || typeof signal.addEventListener !== "function")) {
        throw new TypeError("options.signal must be an AbortSignal.");
      }
      if (onProgress !== undefined && typeof onProgress !== "function") {
        throw new TypeError("options.onProgress must be a function.");
      }

      throwIfAborted(signal, "Overpass");
      const cityId = `osm-relation-${municipalityInfo.osmId}`;
      const diagnostics = {
        strategy: "pending",
        initialChunks: 0,
        requests: 0,
        boundaryRequests: 0,
        chunkRequests: 0,
        retries: 0,
        splits: 0,
        successfulChunks: 0,
        rawObjectsBeforeDeduplication: 0,
        rawObjectsAfterDeduplication: 0,
        finalStreets: 0,
        finalPois: 0
      };
      emitProgress(onProgress, "preparing", "Gemeindedownload wird vorbereitet …", 5);
      emitProgress(onProgress, "requesting-boundary", "Gemeindegrenze wird geladen …", 10);
      const boundaryElements = await fetchOverpassElements(
        buildBoundaryQuery(municipalityInfo.osmId, overpassQueryTimeoutSeconds),
        {
          signal,
          diagnostics,
          requestKind: "boundary",
          onProgress,
          profiler
        }
      );
      throwIfAborted(signal, "Overpass");
      let processingStartedAt = profiler.start();
      const boundary = buildMunicipalityBoundary(boundaryElements, municipalityInfo.osmId);
      profiler.end("boundaryProcessingMs", processingStartedAt);

      // The boundary is deliberately loaded exactly once before the generic,
      // bounds-based DownloadChunk plan is selected. Chunk requests only load
      // streets and POIs; they never repeat the boundary query.
      const plan = downloadPlanFactory(municipality);
      if (!plan || !Array.isArray(plan.chunks) || plan.chunks.length === 0) {
        throw new Error("Download plan did not provide any chunks.");
      }
      diagnostics.strategy = plan.mode === "chunked" ? "chunked" : "single";
      diagnostics.initialChunks = plan.chunks.length;

      const pendingChunks = [...plan.chunks];
      const rawElements = [];
      while (pendingChunks.length > 0) {
        throwIfAborted(signal, "Overpass");
        const chunk = pendingChunks.shift();
        const completedBefore = diagnostics.successfulChunks;
        emitProgress(
          onProgress,
          "requesting-overpass",
          `Stadtdaten werden geladen … ${completedBefore} Bereiche abgeschlossen, ${pendingChunks.length + 1} ausstehend.`,
          20,
          { completedAreas: completedBefore, pendingAreas: pendingChunks.length + 1 }
        );
        try {
          const chunkElements = await fetchOverpassElements(
            buildChunkDataQuery(municipalityInfo.osmId, chunk, overpassQueryTimeoutSeconds),
            {
              signal,
              diagnostics,
              requestKind: "chunk",
              onProgress,
              profiler
            }
          );
          throwIfAborted(signal, "Overpass");
          processingStartedAt = profiler.start();
          rawElements.push(...chunkElements);
          profiler.end("chunkRawCollectionMs", processingStartedAt);
          profiler.increment("chunkRawObjectsCollected", chunkElements.length);
          diagnostics.successfulChunks += 1;
          emitProgress(
            onProgress,
            "chunk-completed",
            `Stadtdaten werden geladen … ${diagnostics.successfulChunks} Bereiche abgeschlossen, ${pendingChunks.length} ausstehend.`,
            20,
            { completedAreas: diagnostics.successfulChunks, pendingAreas: pendingChunks.length }
          );
        } catch (error) {
          if (!isRetryableOverpassError(error) || chunk.depth >= maxChunkDepth) throw error;
          const children = splitDownloadChunk(chunk);
          diagnostics.splits += 1;
          pendingChunks.unshift(...children);
          emitProgress(
            onProgress,
            "splitting-area",
            `Ein großer Stadtbereich wird kleiner aufgeteilt. ${diagnostics.successfulChunks} Bereiche abgeschlossen, ${pendingChunks.length} ausstehend.`,
            20,
            { completedAreas: diagnostics.successfulChunks, pendingAreas: pendingChunks.length }
          );
        }
      }

      throwIfAborted(signal, "Overpass");
      diagnostics.rawObjectsBeforeDeduplication = rawElements.length;
      const deduplicatedElements = deduplicateOsmElements(rawElements, profiler);
      diagnostics.rawObjectsAfterDeduplication = deduplicatedElements.length;
      emitProgress(onProgress, "processing-response", "Overpass-Antworten werden zusammengeführt …", 50);
      emitProgress(onProgress, "processing-streets", "Straßen werden verarbeitet …", 65);
      const streets = processStreetElements(deduplicatedElements, cityId, geometryApi, profiler);
      if (streets.length === 0) {
        const error = new Error(`No playable streets were found for municipality "${municipalityInfo.name}".`);
        error.name = "NoStreetsError";
        error.code = "NO_STREETS";
        throw error;
      }

      throwIfAborted(signal, "Overpass");
      emitProgress(onProgress, "processing-pois", "Einrichtungen werden verarbeitet …", 82);
      const pois = processPoiElements(deduplicatedElements, cityId, profiler);
      diagnostics.finalStreets = streets.length;
      diagnostics.finalPois = pois.length;
      throwIfAborted(signal, "Overpass");
      let areas = [];
      if (downloadOptions.discoverAreas) {
        emitProgress(onProgress, "discovering-areas", "Administrative Trainingsgebiete werden ermittelt …", 88);
        try {
          const areaQuery = buildAreaDiscoveryQuery(municipalityInfo.osmId, overpassQueryTimeoutSeconds);
          const areaElements = await fetchOverpassElements(areaQuery, {
            signal,
            diagnostics,
            requestKind: "areas",
            onProgress,
            profiler
          });
          areas = discoverTrainingAreas({
            elements: areaElements,
            municipalityInfo,
            boundary,
            options: downloadOptions
          });
          if (validatorApi && typeof validatorApi.assignAreasToEntities === "function") {
            const assignment = validatorApi.assignAreasToEntities(areas, streets, pois);
            areas = Array.isArray(assignment) ? assignment : (assignment?.areas || []);
          }
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("Area discovery failed; continuing with whole city:", error);
          }
          areas = [];
        }
      }

      throwIfAborted(signal, "Overpass");
      emitProgress(onProgress, "finalizing", `${streets.length} Straßen und ${pois.length} Einrichtungen gefunden.`, 95);

      const timestamp = new Date(now()).toISOString();
      const city = createCityMetadata(municipality, cityId, streets, pois, timestamp);
      if (areas.length > 0) {
        city.hasAreas = true;
        city.areaCount = areas.length;
      }
      if (profiler.enabled) {
        downloadOptions.diagnostics.timingsMs.totalFetchCityDataMs = monotonicNow() - totalStartedAt;
        profiler.finish();
      }
      const result = { city, streets, pois, areas, boundary, downloadDiagnostics: diagnostics };
      emitProgress(onProgress, "completed", "Download abgeschlossen.", 100);
      return result;
    }

    function searchMunicipalities(query, searchOptions = {}) {
      if (typeof query !== "string") {
        return Promise.reject(new TypeError("Municipality query must be a string."));
      }
      const trimmedQuery = query.trim();
      if (!trimmedQuery) return Promise.resolve([]);
      if (!searchOptions || typeof searchOptions !== "object" || Array.isArray(searchOptions)) {
        return Promise.reject(new TypeError("Search options must be an object."));
      }
      const signal = searchOptions.signal;
      if (signal !== undefined && (!signal || typeof signal.addEventListener !== "function")) {
        return Promise.reject(new TypeError("options.signal must be an AbortSignal."));
      }

      const queued = queueTail.then(() => performSearch(trimmedQuery, signal));
      queueTail = queued.catch(() => {});
      return raceWithAbort(queued, signal);
    }

    return {
      searchMunicipalities,
      fetchCityData,
      discoverTrainingAreas,
      formatOverpassErrorDiagnostics
    };
  }

  const defaultInstance = createOsmService();

  return {
    NOMINATIM_SEARCH_URL,
    NOMINATIM_COUNTRY_CODE,
    NOMINATIM_TIMEOUT_MS,
    NOMINATIM_REQUEST_INTERVAL_MS,
    NOMINATIM_RAW_RESULT_LIMIT,
    MUNICIPALITY_RESULT_LIMIT,
    OVERPASS_API_URL,
    OVERPASS_TIMEOUT_MS,
    OVERPASS_QUERY_TIMEOUT_SECONDS,
    OVERPASS_RETRY_DELAY_MS,
    MAX_DOWNLOAD_RETRIES,
    DOWNLOAD_CHUNK_AREA_THRESHOLD_KM2,
    DOWNLOAD_CHUNK_MAX_SPAN_KM,
    MAX_INITIAL_CHUNK_DEPTH,
    MAX_CHUNK_DEPTH,
    MAX_CHUNK_REQUESTS,
    DEFAULT_STREET_HIGHWAY_TYPES,
    POI_CATEGORY_DEFINITIONS,
    createDownloadPlan,
    splitDownloadChunk,
    deduplicateOsmElements,
    createOsmService,
    buildAreaDiscoveryQuery,
    discoverTrainingAreas,
    formatOverpassErrorDiagnostics: defaultInstance.formatOverpassErrorDiagnostics,
    searchMunicipalities: defaultInstance.searchMunicipalities,
    fetchCityData: defaultInstance.fetchCityData,
    discoverTrainingAreas: defaultInstance.discoverTrainingAreas
  };
});
