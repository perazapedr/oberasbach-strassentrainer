(function initializeOsmService(root, factory) {
  "use strict";
  const commonJsGeometry = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./geometry.js")
    : null;
  const api = factory((root && root.StreetGeometry) || commonJsGeometry);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerOsmService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOsmServiceApi(defaultGeometryApi) {
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
  const MUNICIPALITY_TYPES = new Set(["city", "town", "village", "municipality"]);
  const EXCLUDED_PLACE_TYPES = new Set([
    "borough", "city_block", "city_district", "croft", "farm", "hamlet",
    "isolated_dwelling", "locality", "neighbourhood", "quarter", "suburb"
  ]);

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
    return first.localeCompare(second, "de", { sensitivity: "base" })
      || first.localeCompare(second, "de")
      || first.localeCompare(second);
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

  function buildOverpassQuery(relationId, queryTimeoutSeconds = OVERPASS_QUERY_TIMEOUT_SECONDS) {
    const id = validOsmId(relationId);
    if (id === null) throw new TypeError("A valid municipality relation ID is required.");
    const timeout = Math.max(1, Math.floor(queryTimeoutSeconds));
    const highwayPattern = DEFAULT_STREET_HIGHWAY_TYPES.join("|");
    const amenityPattern = POI_CATEGORY_DEFINITIONS
      .filter(definition => definition.key === "amenity")
      .map(definition => definition.value)
      .join("|");

    return [
      `[out:json][timeout:${timeout}];`,
      `relation(${id})->.boundary;`,
      ".boundary map_to_area -> .searchArea;",
      ".boundary out body geom;",
      "(",
      `  way(area.searchArea)[\"highway\"~\"^(${highwayPattern})$\"][\"name\"];`,
      `  nwr(area.searchArea)[\"amenity\"~\"^(${amenityPattern})$\"][\"name\"];`,
      "  nwr(area.searchArea)[\"shop\"=\"supermarket\"][\"name\"];",
      ");",
      "out tags geom;"
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

  function processStreetElements(elements, cityId, geometryApi) {
    ensureGeometryApi(geometryApi);
    const allowedHighways = new Set(DEFAULT_STREET_HIGHWAY_TYPES);
    const groups = new Map();
    const seenWayIds = new Set();

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

      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ element, osmWayId, coordinates });
    }

    const streets = [];
    const usedIds = new Set();
    const sortedNames = [...groups.keys()].sort(compareNames);
    for (const name of sortedNames) {
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
          coordinates: merged.sections.map(section => section.map(coordinate => [...coordinate]))
        },
        osmWayIds: [...new Set(ways.map(way => way.osmWayId))].sort((first, second) => first - second)
      });
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

  function processPoiElements(elements, cityId) {
    const seenOsmObjects = new Set();
    const pois = [];
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

    return pois.sort((first, second) => (
      compareNames(first.name, second.name)
      || first.osmType.localeCompare(second.osmType)
      || first.osmId - second.osmId
    ));
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

  function emitProgress(callback, stage, message, progress) {
    if (callback) callback({ stage, message, progress });
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
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const delay = typeof options.delay === "function" ? options.delay : defaultDelay;
    const scheduleTimeout = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
    const cancelTimeout = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
    const geometryApi = options.geometryApi || defaultGeometryApi;

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
        body
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
            return await response.json();
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

    async function fetchCityData(municipality, downloadOptions = {}) {
      const municipalityInfo = validateMunicipalityForDownload(municipality);
      if (!downloadOptions || typeof downloadOptions !== "object" || Array.isArray(downloadOptions)) {
        throw new TypeError("Download options must be an object.");
      }
      const signal = downloadOptions.signal;
      const onProgress = downloadOptions.onProgress;
      if (signal !== undefined && (!signal || typeof signal.addEventListener !== "function")) {
        throw new TypeError("options.signal must be an AbortSignal.");
      }
      if (onProgress !== undefined && typeof onProgress !== "function") {
        throw new TypeError("options.onProgress must be a function.");
      }

      throwIfAborted(signal, "Overpass");
      const cityId = `osm-relation-${municipalityInfo.osmId}`;
      emitProgress(onProgress, "preparing", "Gemeindedownload wird vorbereitet …", 5);
      const query = buildOverpassQuery(municipalityInfo.osmId, overpassQueryTimeoutSeconds);
      const body = new URLSearchParams({ data: query }).toString();

      emitProgress(onProgress, "requesting-overpass", "Straßen und Einrichtungen werden geladen …", 20);
      const rawData = await fetchJsonWithTimeout(overpassEndpoint, {
        signal,
        timeout: overpassTimeoutMs,
        serviceName: "Overpass",
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body
      });
      if (!rawData || typeof rawData !== "object" || Array.isArray(rawData) || !Array.isArray(rawData.elements)) {
        const error = new Error("Invalid response received from Overpass.");
        error.name = "InvalidResponseError";
        error.code = "INVALID_RESPONSE";
        throw error;
      }

      throwIfAborted(signal, "Overpass");
      emitProgress(onProgress, "processing-response", "Overpass-Antwort wird verarbeitet …", 50);
      const boundary = buildMunicipalityBoundary(rawData.elements, municipalityInfo.osmId);
      emitProgress(onProgress, "processing-streets", "Straßen werden verarbeitet …", 65);
      const streets = processStreetElements(rawData.elements, cityId, geometryApi);
      if (streets.length === 0) {
        const error = new Error(`No playable streets were found for municipality "${municipalityInfo.name}".`);
        error.name = "NoStreetsError";
        error.code = "NO_STREETS";
        throw error;
      }

      throwIfAborted(signal, "Overpass");
      emitProgress(onProgress, "processing-pois", "Einrichtungen werden verarbeitet …", 82);
      const pois = processPoiElements(rawData.elements, cityId);
      throwIfAborted(signal, "Overpass");
      emitProgress(onProgress, "finalizing", `${streets.length} Straßen und ${pois.length} Einrichtungen gefunden.`, 95);

      const timestamp = new Date(now()).toISOString();
      const city = createCityMetadata(municipality, cityId, streets, pois, timestamp);
      const result = { city, streets, pois, boundary };
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

    return { searchMunicipalities, fetchCityData };
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
    DEFAULT_STREET_HIGHWAY_TYPES,
    POI_CATEGORY_DEFINITIONS,
    createOsmService,
    searchMunicipalities: defaultInstance.searchMunicipalities,
    fetchCityData: defaultInstance.fetchCityData
  };
});
