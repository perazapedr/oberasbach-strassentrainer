"use strict";

const assert = require("node:assert/strict");
const {
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
  createOsmService
} = require("../osm-service.js");

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function responseWith(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function municipalityRaw(overrides = {}) {
  const addressOverrides = overrides.address || {};
  const raw = {
    osm_type: "relation",
    osm_id: 1016396,
    lat: "49.4236043",
    lon: "10.9708709",
    category: "boundary",
    type: "administrative",
    addresstype: "city",
    name: "Oberasbach",
    display_name: "Oberasbach, Landkreis Fürth, Bayern, 90522, Deutschland",
    importance: 0.4425,
    address: {
      city: "Oberasbach",
      county: "Landkreis Fürth",
      state: "Bayern",
      postcode: "90522",
      country: "Deutschland",
      country_code: "de",
      ...addressOverrides
    },
    namedetails: { name: "Oberasbach" },
    extratags: { admin_level: "8" },
    boundingbox: ["49.4017231", "49.4454542", "10.9384173", "10.9987491"]
  };
  const result = { ...raw, ...overrides };
  result.address = { ...raw.address, ...addressOverrides };
  return result;
}

function createMockService(body, options = {}) {
  const calls = [];
  const fetch = options.fetch || (async (url, fetchOptions) => {
    calls.push({ url, options: fetchOptions });
    return responseWith(body);
  });
  return {
    calls,
    service: createOsmService({
      fetch,
      requestIntervalMs: 0,
      timeoutMs: 100,
      ...options
    })
  };
}

function municipality(overrides = {}) {
  return {
    name: "Oberasbach",
    displayName: "Oberasbach",
    district: "Landkreis Fürth",
    state: "Bayern",
    country: "Deutschland",
    postalCodes: ["90522"],
    osmType: "relation",
    osmId: 1016396,
    bounds: { south: 49.4017, west: 10.9384, north: 49.4454, east: 10.9987 },
    center: { lat: 49.4236, lon: 10.9709 },
    ...overrides
  };
}

function streetWay(id, name = "Rothenburger Straße", highway = "residential", overrides = {}) {
  return {
    type: "way",
    id,
    tags: { highway, name },
    geometry: [
      { lat: 49.42 + id / 100000, lon: 10.95 },
      { lat: 49.421 + id / 100000, lon: 10.951 }
    ],
    ...overrides
  };
}

function nodePoi(id, tags = { amenity: "fire_station", name: "Feuerwehr Oberasbach" }, overrides = {}) {
  return {
    type: "node",
    id,
    lat: 49.43,
    lon: 10.96,
    tags,
    ...overrides
  };
}

function wayPoi(id, tags = { amenity: "school", name: "Grundschule Beispielstadt" }, overrides = {}) {
  return {
    type: "way",
    id,
    tags,
    geometry: [
      { lat: 49.42, lon: 10.95 },
      { lat: 49.42, lon: 10.96 },
      { lat: 49.43, lon: 10.96 },
      { lat: 49.42, lon: 10.95 }
    ],
    ...overrides
  };
}

function boundaryRelation(members, id = 1016396) {
  return {
    type: "relation",
    id,
    tags: { type: "boundary", boundary: "administrative", admin_level: "8", name: "Oberasbach" },
    members
  };
}

function createCityService(elements, options = {}) {
  const calls = [];
  const fetch = options.fetch || (async (url, fetchOptions) => {
    calls.push({ url, options: fetchOptions });
    return responseWith({ elements });
  });
  return {
    calls,
    service: createOsmService({
      fetch,
      requestIntervalMs: 0,
      timeoutMs: 100,
      overpassTimeoutMs: 100,
      overpassRetryDelayMs: 0,
      now: () => Date.UTC(2026, 7, 27, 12, 0, 0),
      ...options
    })
  };
}

test("zentrale Nominatim-Konfiguration", async () => {
  assert.equal(NOMINATIM_SEARCH_URL, "https://nominatim.openstreetmap.org/search");
  assert.equal(NOMINATIM_COUNTRY_CODE, "de");
  assert.equal(NOMINATIM_TIMEOUT_MS, 12000);
  assert.equal(NOMINATIM_REQUEST_INTERVAL_MS, 1000);
  assert.equal(NOMINATIM_RAW_RESULT_LIMIT, 20);
  assert.equal(MUNICIPALITY_RESULT_LIMIT, 10);
  assert.equal(OVERPASS_API_URL, "https://overpass-api.de/api/interpreter");
  assert.equal(OVERPASS_TIMEOUT_MS, 120000);
  assert.equal(OVERPASS_QUERY_TIMEOUT_SECONDS, 90);
  assert.equal(OVERPASS_RETRY_DELAY_MS, 1200);
  assert.equal(MAX_DOWNLOAD_RETRIES, 1);
  assert.equal(DOWNLOAD_CHUNK_AREA_THRESHOLD_KM2, 120);
  assert.equal(DOWNLOAD_CHUNK_MAX_SPAN_KM, 30);
  assert.equal(MAX_INITIAL_CHUNK_DEPTH, 2);
  assert.equal(MAX_CHUNK_DEPTH, 3);
  assert.equal(MAX_CHUNK_REQUESTS, 96);
  assert.deepEqual(DEFAULT_STREET_HIGHWAY_TYPES, [
    "residential", "living_street", "unclassified", "tertiary", "secondary", "primary"
  ]);
  assert.deepEqual(POI_CATEGORY_DEFINITIONS.map(definition => definition.category), [
    "fire_station",
    "police",
    "hospital",
    "nursing_care",
    "school",
    "kindergarten",
    "public_building",
    "supermarket",
    "fuel",
    "hotel",
    "restaurant",
    "sports_facility",
    "company"
  ]);
});

test("Browser-Global stellt Suche und Stadt-Download bereit", async () => {
  assert.ok(globalThis.StrassentrainerOsmService);
  assert.equal(typeof globalThis.StrassentrainerOsmService.searchMunicipalities, "function");
  assert.equal(typeof globalThis.StrassentrainerOsmService.fetchCityData, "function");
});

test("leerer Query liefert ohne Fetch ein leeres Array", async () => {
  const { service, calls } = createMockService([municipalityRaw()]);
  assert.deepEqual(await service.searchMunicipalities(""), []);
  assert.equal(calls.length, 0);
});

test("Whitespace-Query liefert ohne Fetch ein leeres Array", async () => {
  const { service, calls } = createMockService([municipalityRaw()]);
  assert.deepEqual(await service.searchMunicipalities("  \n\t "), []);
  assert.equal(calls.length, 0);
});

test("null wird als Nicht-String kontrolliert abgelehnt", async () => {
  const { service } = createMockService([]);
  await assert.rejects(service.searchMunicipalities(null), /must be a string/);
});

test("Zahlen werden als Nicht-String kontrolliert abgelehnt", async () => {
  const { service } = createMockService([]);
  await assert.rejects(service.searchMunicipalities(123), TypeError);
});

test("Oberasbach wird vollständig normalisiert", async () => {
  const { service } = createMockService([municipalityRaw()]);
  const [result] = await service.searchMunicipalities("Oberasbach");
  assert.deepEqual(result, {
    name: "Oberasbach",
    displayName: "Oberasbach",
    district: "Landkreis Fürth",
    state: "Bayern",
    country: "Deutschland",
    countryCode: "de",
    postalCodes: ["90522"],
    osmType: "relation",
    osmId: 1016396,
    bounds: { south: 49.4017231, west: 10.9384173, north: 49.4454542, east: 10.9987491 },
    center: { lat: 49.4236043, lon: 10.9708709 },
    addresstype: "city",
    placeType: "administrative",
    adminLevel: 8
  });
});

test("Koordinaten, Bounds und OSM-ID sind Zahlen", async () => {
  const { service } = createMockService([municipalityRaw()]);
  const [result] = await service.searchMunicipalities("Oberasbach");
  assert.equal(typeof result.osmId, "number");
  assert.equal(typeof result.center.lat, "number");
  assert.equal(typeof result.center.lon, "number");
  Object.values(result.bounds).forEach(value => assert.equal(typeof value, "number"));
});

test("Treffer außerhalb Deutschlands wird verworfen", async () => {
  const foreign = municipalityRaw({ address: { country: "Österreich", country_code: "at" } });
  const { service } = createMockService([foreign]);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("Straße wird nicht als Gemeinde übernommen", async () => {
  const road = municipalityRaw({ category: "highway", type: "residential", addresstype: "road" });
  const { service } = createMockService([road]);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("Gebäude und POI werden nicht als Gemeinde übernommen", async () => {
  const building = municipalityRaw({ category: "building", type: "yes", addresstype: "building" });
  const poi = municipalityRaw({ category: "amenity", type: "townhall", addresstype: "amenity", osm_id: 22 });
  const { service } = createMockService([building, poi]);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("Landkreis wird nicht als Gemeinde übernommen", async () => {
  const county = municipalityRaw({ addresstype: "county", address: { county: "Landkreis Fürth" } });
  const { service } = createMockService([county]);
  assert.deepEqual(await service.searchMunicipalities("Landkreis Fürth"), []);
});

test("Amt auf Verwaltungsebene 7 wird nicht als eigenständige Gemeinde übernommen", async () => {
  const administrativeAssociation = municipalityRaw({
    osm_id: 1302392,
    addresstype: "municipality",
    name: "Neustadt (Dosse)",
    address: { municipality: "Neustadt (Dosse)", city: "", postcode: "16845" },
    extratags: { admin_level: "7" }
  });
  const { service } = createMockService([administrativeAssociation]);
  assert.deepEqual(await service.searchMunicipalities("Neustadt (Dosse)"), []);
});

test("Stadtteiltypen werden verworfen", async () => {
  const types = ["suburb", "neighbourhood", "quarter", "borough", "city_district"];
  const raws = types.map((type, index) => municipalityRaw({
    osm_id: 100 + index,
    category: "place",
    type,
    addresstype: type
  }));
  const { service } = createMockService(raws);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("Ortsteil mit abweichender übergeordneter Stadt wird verworfen", async () => {
  const districtVillage = municipalityRaw({
    osm_type: "node",
    osm_id: 463173329,
    category: "place",
    type: "village",
    addresstype: "village",
    address: { village: "Oberasbach", city: "Gunzenhausen" }
  });
  const { service } = createMockService([districtVillage]);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("zwei gleichnamige Gemeinden mit unterschiedlichen OSM-IDs bleiben erhalten", async () => {
  const first = municipalityRaw({ osm_id: 1, address: { county: "Landkreis A", postcode: "11111" } });
  const second = municipalityRaw({ osm_id: 2, address: { county: "Landkreis B", postcode: "22222" } });
  const { service } = createMockService([first, second]);
  const results = await service.searchMunicipalities("Oberasbach");
  assert.deepEqual(results.map(result => result.osmId), [1, 2]);
});

test("identisches OSM-Objekt wird nur einmal ausgegeben", async () => {
  const duplicate = municipalityRaw({ importance: 0.9 });
  const { service } = createMockService([municipalityRaw(), duplicate]);
  const results = await service.searchMunicipalities("Oberasbach");
  assert.equal(results.length, 1);
  assert.equal(results[0].osmId, 1016396);
});

test("administrative Relation wird gegenüber dem Ortsknoten derselben Gemeinde bevorzugt", async () => {
  const node = municipalityRaw({
    osm_type: "node",
    osm_id: 926081183,
    lat: "49.4303112",
    lon: "10.9675550",
    category: "place",
    type: "town",
    addresstype: "town",
    address: { town: "Oberasbach", city: "Oberasbach" },
    boundingbox: ["49.3903112", "49.4703112", "10.9275550", "11.0075550"],
    importance: 0.99
  });
  const { service } = createMockService([node, municipalityRaw()]);
  const results = await service.searchMunicipalities("Oberasbach");
  assert.equal(results.length, 1);
  assert.equal(results[0].osmType, "relation");
  assert.equal(results[0].osmId, 1016396);
});

test("Nominatim-Bounding-Box wird in der richtigen Reihenfolge zugeordnet", async () => {
  const raw = municipalityRaw({ boundingbox: ["49.4017", "49.4454", "10.9384", "10.9987"] });
  const { service } = createMockService([raw]);
  const [result] = await service.searchMunicipalities("Oberasbach");
  assert.deepEqual(result.bounds, { south: 49.4017, west: 10.9384, north: 49.4454, east: 10.9987 });
});

test("nichtnumerische Bounding Box verwirft den Treffer", async () => {
  const { service } = createMockService([municipalityRaw({ boundingbox: ["abc", "49.4", "10.9", "11.0"] })]);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("verkehrt sortierte oder außerhalb liegende Bounds werden verworfen", async () => {
  const inverted = municipalityRaw({ boundingbox: ["50", "49", "10", "11"] });
  const outside = municipalityRaw({ osm_id: 2, boundingbox: ["49", "50", "181", "182"] });
  const { service } = createMockService([inverted, outside]);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("kaputte Mittelpunktkoordinaten verwerfen den Treffer", async () => {
  const invalidText = municipalityRaw({ lat: "n/a" });
  const invalidRange = municipalityRaw({ osm_id: 2, lon: "181" });
  const { service } = createMockService([invalidText, invalidRange]);
  assert.deepEqual(await service.searchMunicipalities("Oberasbach"), []);
});

test("erfolgreiche leere Nominatim-Antwort ist kein Fehler", async () => {
  const { service } = createMockService([]);
  assert.deepEqual(await service.searchMunicipalities("Nirgendwo"), []);
});

test("HTTP 429 wird kontrolliert gemeldet", async () => {
  const { service } = createMockService([], { fetch: async () => responseWith([], 429) });
  await assert.rejects(service.searchMunicipalities("Oberasbach"), error => (
    error.code === "HTTP_ERROR" && error.status === 429 && /Too Many Requests/.test(error.message)
  ));
});

test("HTTP 500 wird kontrolliert gemeldet", async () => {
  const { service } = createMockService([], { fetch: async () => responseWith([], 500) });
  await assert.rejects(service.searchMunicipalities("Oberasbach"), error => (
    error.code === "HTTP_ERROR" && error.status === 500
  ));
});

test("Netzwerkfehler wird von Serverfehlern unterscheidbar gemeldet", async () => {
  const { service } = createMockService([], {
    fetch: async () => { throw new TypeError("Failed to fetch"); }
  });
  await assert.rejects(service.searchMunicipalities("Oberasbach"), error => (
    error.code === "NETWORK_ERROR" && error.cause instanceof TypeError
  ));
});

test("ungültiges JSON wird verständlich gemeldet", async () => {
  const { service } = createMockService([], {
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() { throw new SyntaxError("Unexpected token"); }
    })
  });
  await assert.rejects(service.searchMunicipalities("Oberasbach"), error => error.code === "INVALID_JSON");
});

test("unerwartete JSON-Antwortstruktur wird verständlich gemeldet", async () => {
  const { service } = createMockService({ results: [] });
  await assert.rejects(service.searchMunicipalities("Oberasbach"), error => error.code === "INVALID_RESPONSE");
});

test("Timeout bricht einen hängenden Request kontrolliert ab", async () => {
  let requestWasAborted = false;
  const fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      requestWasAborted = true;
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const { service } = createMockService([], { fetch, timeoutMs: 10 });
  await assert.rejects(service.searchMunicipalities("Oberasbach"), error => error.code === "TIMEOUT");
  assert.equal(requestWasAborted, true);
});

test("Timeout umfasst auch einen hängenden JSON-Response-Body", async () => {
  const { service } = createMockService([], {
    timeoutMs: 10,
    fetch: async () => ({
      ok: true,
      status: 200,
      json() { return new Promise(() => {}); }
    })
  });
  await assert.rejects(service.searchMunicipalities("Oberasbach"), error => error.code === "TIMEOUT");
});

test("externer Abort beendet einen laufenden Request", async () => {
  let requestWasAborted = false;
  const fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      requestWasAborted = true;
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const { service } = createMockService([], { fetch, timeoutMs: 1000 });
  const controller = new AbortController();
  const promise = service.searchMunicipalities("Oberasbach", { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(promise, error => error.code === "ABORTED");
  assert.equal(requestWasAborted, true);
});

test("bereits abgebrochene Suche führt keinen Fetch aus", async () => {
  const { service, calls } = createMockService([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.searchMunicipalities("Oberasbach", { signal: controller.signal }), error => (
    error.code === "ABORTED"
  ));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test("Rate Limit serialisiert Requests mit mindestens einer Sekunde Startabstand", async () => {
  let fakeNow = 5000;
  const waits = [];
  const starts = [];
  let nextId = 1;
  const fetch = async url => {
    starts.push(fakeNow);
    const query = new URL(url).searchParams.get("q");
    return responseWith([municipalityRaw({ name: query, osm_id: nextId++,
      address: { city: query } })]);
  };
  const service = createOsmService({
    fetch,
    requestIntervalMs: 1000,
    timeoutMs: 100,
    now: () => fakeNow,
    delay: async milliseconds => {
      waits.push(milliseconds);
      fakeNow += milliseconds;
    }
  });
  await Promise.all([
    service.searchMunicipalities("Erste Stadt"),
    service.searchMunicipalities("Zweite Stadt")
  ]);
  assert.deepEqual(starts, [5000, 6000]);
  assert.deepEqual(waits, [1000]);
});

test("URL kodiert Leerzeichen sicher und setzt alle Pflichtparameter", async () => {
  const { service, calls } = createMockService([]);
  await service.searchMunicipalities("  Bad Neustadt an der Saale  ");
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, NOMINATIM_SEARCH_URL);
  assert.equal(url.searchParams.get("q"), "Bad Neustadt an der Saale");
  assert.equal(url.searchParams.get("format"), "jsonv2");
  assert.equal(url.searchParams.get("addressdetails"), "1");
  assert.equal(url.searchParams.get("extratags"), "1");
  assert.equal(url.searchParams.get("countrycodes"), "de");
  assert.equal(url.searchParams.get("limit"), "20");
});

test("deutsche Sonderzeichen bleiben in der Query erhalten", async () => {
  const { service, calls } = createMockService([]);
  await service.searchMunicipalities("Fürth München Würzburg");
  assert.equal(new URL(calls[0].url).searchParams.get("q"), "Fürth München Würzburg");
});

test("Gemeindesuche greift nicht auf CityStorage zu", async () => {
  const previousStorage = globalThis.StrassentrainerCityStorage;
  let saveCalls = 0;
  globalThis.StrassentrainerCityStorage = { saveCity() { saveCalls += 1; } };
  try {
    const { service } = createMockService([municipalityRaw()]);
    await service.searchMunicipalities("Oberasbach");
    assert.equal(saveCalls, 0);
  } finally {
    globalThis.StrassentrainerCityStorage = previousStorage;
  }
});

test("exakter Namensmatch wird vor weniger exaktem Treffer sortiert", async () => {
  const approximate = municipalityRaw({ name: "Oberasbach-Süd", osm_id: 2,
    importance: 0.99, address: { city: "Oberasbach-Süd", county: "Landkreis X" } });
  const exact = municipalityRaw({ osm_id: 1, importance: 0.1 });
  const { service } = createMockService([approximate, exact]);
  const results = await service.searchMunicipalities("Oberasbach");
  assert.equal(results[0].name, "Oberasbach");
});

test("öffentliche Ergebniszahl ist begrenzt", async () => {
  const raws = Array.from({ length: 5 }, (_, index) => municipalityRaw({
    osm_id: index + 1,
    name: `Teststadt ${index + 1}`,
    address: { city: `Teststadt ${index + 1}`, county: `Landkreis ${index + 1}` }
  }));
  const { service } = createMockService(raws, { resultLimit: 2 });
  assert.equal((await service.searchMunicipalities("Teststadt")).length, 2);
});

test("Postleitzahlen werden dedupliziert und district dient als Landkreis-Fallback", async () => {
  const raw = municipalityRaw({
    postcode: "90522, 90522; 90523",
    address: { county: "", district: "Bezirk Test", postcode: "90522; 90523" }
  });
  const { service } = createMockService([raw]);
  const [result] = await service.searchMunicipalities("Oberasbach");
  assert.deepEqual(result.postalCodes, ["90522", "90523"]);
  assert.equal(result.district, "Bezirk Test");
});

test("legitime eigenständige Gemeinde kann als Ortsknoten zurückgegeben werden", async () => {
  const village = municipalityRaw({
    osm_type: "node",
    osm_id: 77,
    category: undefined,
    class: "place",
    type: "village",
    addresstype: "village",
    name: "Testdorf",
    address: { city: "", village: "Testdorf", county: "Landkreis Test", postcode: "12345" }
  });
  const { service } = createMockService([village]);
  const [result] = await service.searchMunicipalities("Testdorf");
  assert.equal(result.name, "Testdorf");
  assert.equal(result.osmType, "node");
});

test("fetchCityData verlangt eine administrative OSM-Relation", async () => {
  const { service } = createCityService([streetWay(1)]);
  await assert.rejects(service.fetchCityData(null), TypeError);
  await assert.rejects(service.fetchCityData(municipality({ name: "" })), TypeError);
  await assert.rejects(service.fetchCityData(municipality({ osmType: "node" })), error => (
    error.code === "INVALID_MUNICIPALITY"
  ));
  await assert.rejects(service.fetchCityData(municipality({ osmId: "kaputt" })), error => (
    error.code === "INVALID_MUNICIPALITY"
  ));
  await assert.rejects(service.fetchCityData(municipality({ placeType: "route" })), error => (
    error.code === "INVALID_MUNICIPALITY"
  ));
});

test("fetchCityData validiert Progress-Callback und AbortSignal", async () => {
  const { service, calls } = createCityService([streetWay(1)]);
  await assert.rejects(service.fetchCityData(municipality(), null), /options must be an object/i);
  await assert.rejects(service.fetchCityData(municipality(), { onProgress: "nein" }), /must be a function/);
  await assert.rejects(service.fetchCityData(municipality(), { signal: {} }), /must be an AbortSignal/);
  assert.equal(calls.length, 0);
});

test("Boundary und Daten werden getrennt geladen; Datenquery kombiniert Area und Chunk-Bounds", async () => {
  const { service, calls } = createCityService([streetWay(1)], { overpassQueryTimeoutSeconds: 77 });
  await service.fetchCityData(municipality());
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === OVERPASS_API_URL && call.options.method === "POST"));
  const boundaryQuery = new URLSearchParams(calls[0].options.body).get("data");
  const dataQuery = new URLSearchParams(calls[1].options.body).get("data");
  assert.match(boundaryQuery, /\[out:json\]\[timeout:77\]/);
  assert.match(boundaryQuery, /relation\(1016396\)/);
  assert.match(boundaryQuery, /out body geom/);
  assert.doesNotMatch(boundaryQuery, /map_to_area|highway|amenity/);
  assert.match(dataQuery, /relation\(1016396\)->\.boundary/);
  assert.match(dataQuery, /\.boundary map_to_area -> \.searchArea/);
  assert.match(dataQuery, /way\(area\.searchArea\)\(49\.4017000,10\.9384000,49\.4454000,10\.9987000\)/);
  assert.match(dataQuery, /nwr\(area\.searchArea\)/);
  assert.match(dataQuery, /out tags geom/);
});

test("geteilte Relations-Ways werden zur echten Gemeindegrenze zusammengesetzt", async () => {
  const outerMembers = [
    [{ lat: 49.4, lon: 10.9 }, { lat: 49.4, lon: 10.92 }],
    [{ lat: 49.42, lon: 10.92 }, { lat: 49.4, lon: 10.92 }],
    [{ lat: 49.42, lon: 10.92 }, { lat: 49.42, lon: 10.9 }],
    [{ lat: 49.4, lon: 10.9 }, { lat: 49.42, lon: 10.9 }]
  ].map((geometry, index) => ({ type: "way", ref: index + 1, role: "outer", geometry }));
  const inner = {
    type: "way",
    ref: 5,
    role: "inner",
    geometry: [
      { lat: 49.405, lon: 10.905 }, { lat: 49.405, lon: 10.91 },
      { lat: 49.41, lon: 10.91 }, { lat: 49.405, lon: 10.905 }
    ]
  };
  const { service } = createCityService([
    boundaryRelation([...outerMembers, inner]),
    streetWay(1)
  ]);
  const result = await service.fetchCityData(municipality());
  assert.equal(result.boundary.type, "Polygon");
  assert.equal(result.boundary.coordinates.length, 2);
  assert.deepEqual(result.boundary.coordinates[0][0], result.boundary.coordinates[0].at(-1));
});

test("mehrteilige Gemeindegrenze bleibt ein MultiPolygon", async () => {
  const ringA = [
    { lat: 49.4, lon: 10.9 }, { lat: 49.4, lon: 10.91 },
    { lat: 49.41, lon: 10.91 }, { lat: 49.4, lon: 10.9 }
  ];
  const ringB = [
    { lat: 49.42, lon: 10.92 }, { lat: 49.42, lon: 10.93 },
    { lat: 49.43, lon: 10.93 }, { lat: 49.42, lon: 10.92 }
  ];
  const { service } = createCityService([
    boundaryRelation([
      { type: "way", ref: 1, role: "outer", geometry: ringA },
      { type: "way", ref: 2, role: "outer", geometry: ringB }
    ]),
    streetWay(1)
  ]);
  const result = await service.fetchCityData(municipality());
  assert.equal(result.boundary.type, "MultiPolygon");
  assert.equal(result.boundary.coordinates.length, 2);
});

test("fehlende oder offene Relation wird nicht durch die Bounding Box ersetzt", async () => {
  const openBoundary = boundaryRelation([{
    type: "way",
    ref: 1,
    role: "outer",
    geometry: [{ lat: 49.4, lon: 10.9 }, { lat: 49.4, lon: 10.92 }]
  }]);
  const { service } = createCityService([openBoundary, streetWay(1)]);
  const result = await service.fetchCityData(municipality());
  assert.equal(result.boundary, null);
  assert.ok(result.city.bounds);
});

test("alle sechs freigegebenen Straßentypen werden verarbeitet", async () => {
  const elements = DEFAULT_STREET_HIGHWAY_TYPES.map((highway, index) => (
    streetWay(index + 1, `Straße ${index + 1}`, highway)
  ));
  const { service } = createCityService(elements);
  const result = await service.fetchCityData(municipality());
  assert.equal(result.streets.length, DEFAULT_STREET_HIGHWAY_TYPES.length);
  assert.deepEqual(result.streets.map(street => street.name), [
    "Straße 1", "Straße 2", "Straße 3", "Straße 4", "Straße 5", "Straße 6"
  ]);
});

test("track, motorway und service werden nicht als spielbare Straßen übernommen", async () => {
  const { service } = createCityService([
    streetWay(1, "Gültige Straße", "residential"),
    streetWay(2, "Feldweg", "track"),
    streetWay(3, "Autobahn", "motorway"),
    streetWay(4, "Zufahrt", "service")
  ]);
  const result = await service.fetchCityData(municipality());
  assert.deepEqual(result.streets.map(street => street.name), ["Gültige Straße"]);
});

test("namenlose Straßen werden verworfen", async () => {
  const nameless = streetWay(2, "Platzhalter", "residential", { tags: { highway: "residential" } });
  const { service } = createCityService([streetWay(1), nameless]);
  const result = await service.fetchCityData(municipality());
  assert.equal(result.streets.length, 1);
  assert.equal(result.streets[0].name, "Rothenburger Straße");
});

test("Straßenname und tatsächliche OSM-Aliase bleiben erhalten", async () => {
  const way = streetWay(1, "Rothenburger Straße", "residential", {
    tags: {
      highway: "residential",
      name: "Rothenburger Straße",
      official_name: "Rothenburger Straße",
      alt_name: "Rothenburger Str.; Alte Straße; ",
      short_name: "Rothenburger Str.",
      loc_name: "Rothenburger Weg"
    }
  });
  const { service } = createCityService([way]);
  const [street] = (await service.fetchCityData(municipality())).streets;
  assert.equal(street.name, "Rothenburger Straße");
  assert.deepEqual(street.aliases, ["Rothenburger Str.", "Alte Straße", "Rothenburger Weg"]);
});

test("mehrere Ways gleichen Namens werden zu einem MultiLineString zusammengeführt", async () => {
  const { service } = createCityService([
    streetWay(30, "Hauptstraße"),
    streetWay(10, "Hauptstraße"),
    streetWay(20, "Hauptstraße")
  ]);
  const [street] = (await service.fetchCityData(municipality())).streets;
  assert.equal(street.geometry.type, "MultiLineString");
  assert.equal(street.geometry.coordinates.length, 3);
  assert.deepEqual(street.osmWayIds, [10, 20, 30]);
  assert.equal(street.geometry.coordinates[0][0][0], 10.95);
  assert.ok(Math.abs(street.geometry.coordinates[0][0][1] - 49.4201) < 1e-12);
});

test("Hauptstraße und Hauptstr. bleiben getrennt und erhalten kollisionsfreie stabile IDs", async () => {
  const elements = [streetWay(1, "Hauptstraße"), streetWay(2, "Hauptstr.")];
  const { service } = createCityService(elements);
  const first = await service.fetchCityData(municipality());
  const second = await service.fetchCityData(municipality());
  assert.equal(first.streets.length, 2);
  assert.equal(new Set(first.streets.map(street => street.id)).size, 2);
  assert.deepEqual(first.streets.map(street => street.id), second.streets.map(street => street.id));
});

test("technisch kaputte Straßengeometrien werden verworfen", async () => {
  const empty = streetWay(2, "Leere Straße", "residential", { geometry: [] });
  const onePoint = streetWay(3, "Punktstraße", "residential", { geometry: [{ lat: 49.4, lon: 10.9 }] });
  const invalid = streetWay(4, "Kaputte Straße", "residential", {
    geometry: [{ lat: 49.4, lon: 10.9 }, { lat: "x", lon: 10.91 }]
  });
  const { service } = createCityService([streetWay(1), empty, onePoint, invalid]);
  assert.deepEqual((await service.fetchCityData(municipality())).streets.map(street => street.name), [
    "Rothenburger Straße"
  ]);
});

test("doppelte OSM-Way-ID wird technisch nur einmal verarbeitet", async () => {
  const duplicate = streetWay(1, "Rothenburger Straße", "residential", {
    geometry: [{ lat: 49.5, lon: 10.9 }, { lat: 49.51, lon: 10.91 }]
  });
  const { service } = createCityService([streetWay(1), duplicate]);
  const [street] = (await service.fetchCityData(municipality())).streets;
  assert.deepEqual(street.osmWayIds, [1]);
  assert.equal(street.geometry.coordinates.length, 1);
});

test("Feuerwehr-Node wird mit Position und ohne erfundene Fläche normalisiert", async () => {
  const { service } = createCityService([streetWay(1), nodePoi(100)]);
  const fireStation = (await service.fetchCityData(municipality())).pois[0];
  assert.equal(fireStation.category, "fire_station");
  assert.equal(fireStation.categoryLabel, "Feuerwehr");
  assert.deepEqual(fireStation.position, { lat: 49.43, lon: 10.96 });
  assert.equal(fireStation.geometry, null);
  assert.equal(fireStation.osmType, "node");
  assert.equal(fireStation.osmId, 100);
});

test("Schul-Way wird als Polygon in GeoJSON-Reihenfolge normalisiert", async () => {
  const { service } = createCityService([streetWay(1), wayPoi(200)]);
  const school = (await service.fetchCityData(municipality())).pois[0];
  assert.equal(school.category, "school");
  assert.equal(school.geometry.type, "Polygon");
  assert.deepEqual(school.geometry.coordinates[0][0], [10.95, 49.42]);
  assert.equal(typeof school.position.lat, "number");
  assert.equal(typeof school.position.lon, "number");
});

test("Kindergarten und Supermarkt werden unterstützt", async () => {
  const kindergarten = nodePoi(101, { amenity: "kindergarten", name: "Kita Sonnenschein" });
  const supermarket = nodePoi(102, { shop: "supermarket", name: "Markt Beispiel" });
  const { service } = createCityService([streetWay(1), kindergarten, supermarket]);
  const categories = (await service.fetchCityData(municipality())).pois.map(poi => poi.category).sort();
  assert.deepEqual(categories, ["kindergarten", "supermarket"]);
});

test("irrelevante und namenlose POIs werden verworfen", async () => {
  const bench = nodePoi(101, { amenity: "bench", name: "Sitzbank" });
  const namelessSchool = nodePoi(102, { amenity: "school" });
  const { service } = createCityService([streetWay(1), bench, namelessSchool]);
  assert.deepEqual((await service.fetchCityData(municipality())).pois, []);
});

test("POI-Aliase und relevante OSM-Tags werden kopiert", async () => {
  const poi = nodePoi(101, {
    amenity: "school",
    name: "Grundschule Test",
    official_name: "Grundschule Test",
    alt_name: "GS Test; Schule Alt",
    short_name: "GS Test",
    wheelchair: "yes"
  });
  const { service } = createCityService([streetWay(1), poi]);
  const [result] = (await service.fetchCityData(municipality())).pois;
  assert.deepEqual(result.aliases, ["GS Test", "Schule Alt"]);
  assert.equal(result.tags.amenity, "school");
  assert.equal(result.tags.wheelchair, "yes");
  assert.notEqual(result.tags, poi.tags);
});

test("einfache Relationsfläche mit Außen- und Innenring wird als Polygon erhalten", async () => {
  const outer = [
    { lat: 49.4, lon: 10.9 }, { lat: 49.4, lon: 10.92 },
    { lat: 49.42, lon: 10.92 }, { lat: 49.4, lon: 10.9 }
  ];
  const inner = [
    { lat: 49.405, lon: 10.905 }, { lat: 49.405, lon: 10.91 },
    { lat: 49.41, lon: 10.91 }, { lat: 49.405, lon: 10.905 }
  ];
  const relation = {
    type: "relation",
    id: 300,
    tags: { amenity: "school", name: "Relationsschule" },
    members: [
      { type: "way", role: "outer", geometry: outer },
      { type: "way", role: "inner", geometry: inner }
    ]
  };
  const { service } = createCityService([streetWay(1), relation]);
  const [school] = (await service.fetchCityData(municipality())).pois;
  assert.equal(school.osmType, "relation");
  assert.equal(school.geometry.type, "Polygon");
  assert.equal(school.geometry.coordinates.length, 2);
  assert.ok(school.position);
});

test("komplexe Relationsfläche bleibt ohne erfundene Geometrie als Positions-POI nutzbar", async () => {
  const ringA = [
    { lat: 49.4, lon: 10.9 }, { lat: 49.4, lon: 10.91 },
    { lat: 49.41, lon: 10.91 }, { lat: 49.4, lon: 10.9 }
  ];
  const ringB = [
    { lat: 49.42, lon: 10.92 }, { lat: 49.42, lon: 10.93 },
    { lat: 49.43, lon: 10.93 }, { lat: 49.42, lon: 10.92 }
  ];
  const relation = {
    type: "relation",
    id: 301,
    tags: { amenity: "kindergarten", name: "Mehrteilige Kita" },
    members: [
      { type: "way", role: "outer", geometry: ringA },
      { type: "way", role: "outer", geometry: ringB }
    ]
  };
  const { service } = createCityService([streetWay(1), relation]);
  const [poi] = (await service.fetchCityData(municipality())).pois;
  assert.equal(poi.geometry, null);
  assert.ok(poi.position);
});

test("POI-IDs unterscheiden Node, Way und Relation deterministisch", async () => {
  const relation = {
    type: "relation",
    id: 5,
    center: { lat: 49.4, lon: 10.9 },
    tags: { amenity: "school", name: "Relation Schule" },
    members: []
  };
  const { service } = createCityService([
    streetWay(1),
    nodePoi(5, { amenity: "school", name: "Node Schule" }),
    wayPoi(5, { amenity: "school", name: "Way Schule" }),
    relation
  ]);
  const ids = (await service.fetchCityData(municipality())).pois.map(poi => poi.id);
  assert.deepEqual(ids.sort(), [
    "osm-relation-1016396:poi:node-5",
    "osm-relation-1016396:poi:relation-5",
    "osm-relation-1016396:poi:way-5"
  ]);
});

test("identisches POI-OSM-Objekt wird nur einmal ausgegeben", async () => {
  const poi = nodePoi(101, { amenity: "school", name: "Doppelte Schule" });
  const { service } = createCityService([streetWay(1), poi, { ...poi }]);
  assert.equal((await service.fetchCityData(municipality())).pois.length, 1);
});

test("Node und Way gleichen Namens werden in Phase 3 nicht fachlich dedupliziert", async () => {
  const name = "Grundschule Beispielstadt";
  const { service } = createCityService([
    streetWay(1),
    nodePoi(101, { amenity: "school", name }),
    wayPoi(102, { amenity: "school", name })
  ]);
  const pois = (await service.fetchCityData(municipality())).pois;
  assert.equal(pois.length, 2);
  assert.deepEqual(pois.map(poi => poi.osmType).sort(), ["node", "way"]);
});

test("City-Metadaten sind Phase-1-kompatibel und enthalten technische Zähler", async () => {
  const { service } = createCityService([streetWay(1), nodePoi(101)]);
  const result = await service.fetchCityData(municipality());
  assert.deepEqual(result.city, {
    id: "osm-relation-1016396",
    name: "Oberasbach",
    displayName: "Oberasbach",
    district: "Landkreis Fürth",
    state: "Bayern",
    country: "Deutschland",
    postalCodes: ["90522"],
    osmType: "relation",
    osmId: 1016396,
    bounds: { south: 49.4017, west: 10.9384, north: 49.4454, east: 10.9987 },
    center: { lat: 49.4236, lon: 10.9709 },
    defaultZoom: 13,
    streetCount: 1,
    poiCount: 1,
    source: "openstreetmap",
    dataVersion: 1,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z"
  });
  assert.ok(result.streets.every(street => street.cityId === result.city.id));
  assert.ok(result.pois.every(poi => poi.cityId === result.city.id));
});

test("technisch erfolgreiche Antwort ohne Straßen wird kontrolliert abgelehnt", async () => {
  const { service } = createCityService([nodePoi(101)]);
  await assert.rejects(service.fetchCityData(municipality()), error => error.code === "NO_STREETS");
});

test("Gemeinde mit Straßen und null POIs ist zulässig", async () => {
  const { service } = createCityService([streetWay(1)]);
  const result = await service.fetchCityData(municipality());
  assert.equal(result.streets.length, 1);
  assert.deepEqual(result.pois, []);
  assert.equal(result.city.poiCount, 0);
});

for (const status of [429, 500, 502, 503, 504]) {
  test(`Overpass HTTP ${status} wird kontrolliert gemeldet`, async () => {
    const { service } = createCityService([], { fetch: async () => responseWith({}, status) });
    await assert.rejects(service.fetchCityData(municipality()), error => (
      error.code === "HTTP_ERROR" && error.status === status && /Overpass/.test(error.message)
    ));
  });
}

test("Overpass-Netzwerkfehler wird kontrolliert gemeldet", async () => {
  const { service } = createCityService([], {
    fetch: async () => { throw new TypeError("Failed to fetch"); }
  });
  await assert.rejects(service.fetchCityData(municipality()), error => (
    error.code === "NETWORK_ERROR" && /Overpass/.test(error.message)
  ));
});

test("Overpass-Timeout bricht einen hängenden Request ab", async () => {
  let aborted = false;
  const fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      aborted = true;
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const { service } = createCityService([], { fetch, overpassTimeoutMs: 10 });
  await assert.rejects(service.fetchCityData(municipality()), error => (
    error.code === "TIMEOUT" && /Overpass/.test(error.message)
  ));
  assert.equal(aborted, true);
});

test("externer Abort beendet den Overpass-Download", async () => {
  let aborted = false;
  const fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      aborted = true;
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const { service } = createCityService([], { fetch, overpassTimeoutMs: 1000 });
  const controller = new AbortController();
  const promise = service.fetchCityData(municipality(), { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(promise, error => error.code === "ABORTED" && /Overpass/.test(error.message));
  assert.equal(aborted, true);
});

test("ungültiges Overpass-JSON wird verständlich gemeldet", async () => {
  const { service } = createCityService([], {
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() { throw new SyntaxError("Unexpected token"); }
    })
  });
  await assert.rejects(service.fetchCityData(municipality()), error => (
    error.code === "INVALID_JSON" && /Overpass/.test(error.message)
  ));
});

test("ungültige Overpass-Response-Struktur wird abgelehnt", async () => {
  const { service } = createCityService([], { fetch: async () => responseWith({}) });
  await assert.rejects(service.fetchCityData(municipality()), error => error.code === "INVALID_RESPONSE");
});

test("Progress-Callback erhält stabile grobe Phasen einschließlich completed", async () => {
  const progressEvents = [];
  const { service } = createCityService([streetWay(1), nodePoi(101)]);
  await service.fetchCityData(municipality(), { onProgress: event => progressEvents.push(event) });
  assert.deepEqual(progressEvents.map(event => event.stage), [
    "preparing",
    "requesting-boundary",
    "requesting-overpass",
    "chunk-completed",
    "processing-response",
    "processing-streets",
    "processing-pois",
    "finalizing",
    "completed"
  ]);
  assert.deepEqual(progressEvents.map(event => event.progress), [5, 10, 20, 20, 50, 65, 82, 95, 100]);
  assert.ok(progressEvents.every(event => typeof event.message === "string" && event.message.length > 0));
  assert.match(progressEvents[2].message, /Bereiche abgeschlossen.*ausstehend/);
});

test("fetchCityData funktioniert ohne Progress-Callback", async () => {
  const { service } = createCityService([streetWay(1)]);
  assert.equal((await service.fetchCityData(municipality())).city.name, "Oberasbach");
});

test("fetchCityData speichert nicht automatisch in CityStorage", async () => {
  const previousStorage = globalThis.StrassentrainerCityStorage;
  let saveCalls = 0;
  globalThis.StrassentrainerCityStorage = { saveCity() { saveCalls += 1; } };
  try {
    const { service } = createCityService([streetWay(1), nodePoi(101)]);
    await service.fetchCityData(municipality());
    assert.equal(saveCalls, 0);
  } finally {
    globalThis.StrassentrainerCityStorage = previousStorage;
  }
});

test("Overpass-Rohobjekte werden bei der Verarbeitung nicht mutiert", async () => {
  const elements = [
    streetWay(1, "Rothenburger Straße", "residential", {
      tags: { highway: "residential", name: "Rothenburger Straße", alt_name: "Rothenburger Str." }
    }),
    wayPoi(2)
  ];
  const snapshot = structuredClone(elements);
  const { service } = createCityService(elements);
  await service.fetchCityData(municipality());
  assert.deepEqual(elements, snapshot);
});

test("Overpass-Fehler enthält diagnostische Details (stage, endpoint, method, attempt)", async () => {
  const { service } = createCityService([], {
    fetch: async () => { throw new TypeError("Failed to fetch"); },
    overpassRetryDelayMs: 5
  });
  await assert.rejects(service.fetchCityData(municipality()), error => {
    assert.equal(error.stage, "BOUNDARY");
    assert.equal(error.method, "POST");
    assert.equal(error.attempt, 2);
    assert.equal(error.maxAttempts, 2);
    assert.ok(typeof error.diagnostics === "string");
    assert.match(error.diagnostics, /OVERPASS REQUEST FAILED/);
    assert.match(error.diagnostics, /stage: BOUNDARY/);
    assert.match(error.diagnostics, /method: POST/);
    return true;
  });
});

test("Overpass-Retry führt bei vorübergehendem Fehler zweiten Versuch durch und gelingt", async () => {
  let callCount = 0;
  const { service } = createCityService([streetWay(1)], {
    overpassRetryDelayMs: 5,
    fetch: async () => {
      callCount += 1;
      if (callCount === 1) throw new TypeError("Temporary network hiccup");
      return responseWith({ elements: [streetWay(1)] });
    }
  });
  const result = await service.fetchCityData(municipality());
  assert.equal(callCount, 3);
  assert.equal(result.downloadDiagnostics.retries, 1);
  assert.equal(result.streets.length, 1);
});

test("Area-Discovery-Fehler bricht den Stadtdownload nicht ab und fällt auf areas = [] zurück", async () => {
  const { service } = createCityService([streetWay(1)], {
    fetch: async (url, options) => {
      const body = String(options?.body || "");
      if (body.includes("administrative") || body.includes("borough")) {
        throw new TypeError("Area discovery network error");
      }
      return responseWith({ elements: [streetWay(1)] });
    }
  });
  const result = await service.fetchCityData(municipality(), { discoverAreas: true });
  assert.equal(result.streets.length, 1);
  assert.deepEqual(result.areas, []);
});

test("Boundary-Fehler bricht den Stadtdownload sauber ab", async () => {
  const { service } = createCityService([], {
    fetch: async () => {
      throw new TypeError("Boundary fetch failed");
    },
    overpassRetryDelayMs: 5
  });
  await assert.rejects(service.fetchCityData(municipality()), error => {
    assert.equal(error.stage, "BOUNDARY");
    assert.equal(error.code, "NETWORK_ERROR");
    return true;
  });
});

(async () => {
  let passed = 0;
  for (const currentTest of tests) {
    try {
      await currentTest.run();
      passed += 1;
    } catch (error) {
      console.error(`FAIL: ${currentTest.name}`);
      throw error;
    }
  }
  console.log(`OSM-Service-Tests erfolgreich: ${passed}/${tests.length}`);
  console.log("- Queryvalidierung, sichere URL und deutsche Sonderzeichen");
  console.log("- Gemeinde-, Deutschland-, Landkreis-, Ortsteil-, Straßen- und POI-Filter");
  console.log("- Normalisierung, Koordinaten, Bounds, Postleitzahlen und Ergebnislimit");
  console.log("- konservative Deduplizierung, Relation-Priorisierung und Sortierung");
  console.log("- HTTP-, Netzwerk-, JSON-, Timeout- und Abort-Fehler");
  console.log("- serviceinternes Rate Limit ohne IndexedDB-Seiteneffekt");
  console.log("- relation-basierte Overpass-Query mit map_to_area und vollständigen Geometrien");
  console.log("- Straßenfilter, Aliase, Way-Gruppierung, stabile IDs und MultiLineStrings");
  console.log("- Feuerwehr, Schulen, Kindergärten und Supermärkte als Node, Way oder Relation");
  console.log("- Phase-1-kompatible Stadtmetadaten, Progress-Stages und Overpass-Fehlerfälle");
})().catch(error => {
  console.error("Testfehler in osm-service-tests:", error);
  process.exitCode = 1;
});
