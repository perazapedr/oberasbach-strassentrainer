"use strict";

const assert = require("node:assert/strict");
const {
  OVERPASS_API_URL,
  MAX_DOWNLOAD_RETRIES,
  MAX_CHUNK_DEPTH,
  MAX_CHUNK_REQUESTS,
  createDownloadPlan,
  splitDownloadChunk,
  deduplicateOsmElements,
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

function municipality(overrides = {}) {
  return {
    name: "Testmetropole",
    displayName: "Testmetropole",
    district: "Testkreis",
    state: "Testland",
    country: "Deutschland",
    postalCodes: ["50000"],
    osmType: "relation",
    osmId: 9001,
    placeType: "administrative",
    bounds: { south: 50.85, west: 6.85, north: 51.05, east: 7.10 },
    center: { lat: 50.95, lon: 6.975 },
    ...overrides
  };
}

function boundaryRelation(id = 9001) {
  return {
    type: "relation",
    id,
    tags: { type: "boundary", boundary: "administrative", admin_level: "8" },
    members: [{
      type: "way",
      ref: 1,
      role: "outer",
      geometry: [
        { lat: 50.83, lon: 6.77 },
        { lat: 50.83, lon: 7.16 },
        { lat: 51.10, lon: 7.16 },
        { lat: 51.10, lon: 6.77 },
        { lat: 50.83, lon: 6.77 }
      ]
    }]
  };
}

function streetWay(id, name, points = 2) {
  return {
    type: "way",
    id,
    tags: { highway: "residential", name },
    geometry: Array.from({ length: points }, (_, index) => ({
      lat: 50.9 + index * 0.002,
      lon: 6.9 + id * 0.00001 + index * 0.002
    }))
  };
}

function poiNode(id, name = `POI ${id}`) {
  return {
    type: "node",
    id,
    lat: 50.95,
    lon: 6.95,
    tags: { amenity: "school", name }
  };
}

function poiWay(id, name = `Flächen-POI ${id}`) {
  return {
    type: "way",
    id,
    tags: { amenity: "school", name },
    geometry: [
      { lat: 50.94, lon: 6.94 },
      { lat: 50.94, lon: 6.95 },
      { lat: 50.95, lon: 6.95 },
      { lat: 50.94, lon: 6.94 }
    ]
  };
}

function poiRelation(id, name = `Relations-POI ${id}`) {
  return {
    type: "relation",
    id,
    center: { lat: 50.96, lon: 6.96 },
    tags: { amenity: "kindergarten", name },
    members: []
  };
}

function queryFromOptions(options) {
  return new URLSearchParams(options.body).get("data");
}

function isBoundaryQuery(options) {
  return !queryFromOptions(options).includes("map_to_area");
}

function singlePlan(city = municipality()) {
  return createDownloadPlan(city, {
    areaThresholdSquareKilometers: 1e9,
    maxSpanKilometers: 1e9,
    maxInitialDepth: 0
  });
}

function chunkedPlan(city = municipality()) {
  const root = singlePlan(city).chunks[0];
  return { mode: "chunked", chunks: splitDownloadChunk(root) };
}

function createService(fetch, options = {}) {
  const serviceOptions = {
    fetch,
    requestIntervalMs: 0,
    overpassRetryDelayMs: 0,
    overpassTimeoutMs: 1000,
    now: () => Date.UTC(2026, 7, 30, 12, 0, 0),
    ...options
  };
  if (!("overpassEndpoint" in options) && !("overpassEndpoints" in options)) {
    serviceOptions.overpassEndpoints = [OVERPASS_API_URL];
  }
  return createOsmService(serviceOptions);
}

function successfulFetch(dataProvider, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    const elements = typeof dataProvider === "function" ? dataProvider(options, calls) : dataProvider;
    return responseWith({ elements });
  };
}

function comparableResult(result) {
  return {
    city: result.city,
    streets: result.streets,
    pois: result.pois,
    boundary: result.boundary
  };
}

test("kleine Gemeinde bleibt im Single-Mode, große Gemeinde wird proaktiv in vier Chunks geteilt", () => {
  const small = municipality({
    name: "Kleinstadt",
    bounds: { south: 49.40, west: 10.93, north: 49.45, east: 11.00 }
  });
  const smallPlan = createDownloadPlan(small);
  const largePlan = createDownloadPlan(municipality());
  assert.equal(smallPlan.mode, "single");
  assert.equal(smallPlan.chunks.length, 1);
  assert.equal(largePlan.mode, "chunked");
  assert.equal(largePlan.chunks.length, 4);
  assert.ok(largePlan.chunks.every(chunk => chunk.depth === 1));
});

test("DownloadChunk besitzt nur technische Bounds, ID und Tiefe", () => {
  const chunk = createDownloadPlan(municipality()).chunks[0];
  assert.deepEqual(Object.keys(chunk).sort(), ["depth", "east", "id", "north", "south", "west"]);
  assert.equal(Object.isFrozen(chunk), true);
  assert.equal("areaId" in chunk, false);
  assert.equal("trainingArea" in chunk, false);
});

test("Root-Erfolg benötigt einen Boundary- und einen Datenrequest ohne Split", async () => {
  const calls = [];
  const service = createService(successfulFetch([streetWay(1, "Hauptstraße")], calls), {
    downloadPlanFactory: singlePlan
  });
  const result = await service.fetchCityData(municipality());
  assert.equal(calls.length, 2);
  assert.deepEqual(result.downloadDiagnostics, {
    strategy: "single",
    endpoint: OVERPASS_API_URL,
    endpointIndex: 0,
    endpointsUsed: [OVERPASS_API_URL],
    failoverUsed: false,
    failovers: 0,
    initialChunks: 1,
    requests: 2,
    boundaryRequests: 1,
    chunkRequests: 1,
    retries: 0,
    splits: 0,
    successfulChunks: 1,
    rawObjectsBeforeDeduplication: 1,
    rawObjectsAfterDeduplication: 1,
    finalStreets: 1,
    finalPois: 0
  });
});

test("Chunked-Mode lädt die vollständige Gemeindegrenze genau einmal", async () => {
  const calls = [];
  const service = createService(successfulFetch([streetWay(1, "Hauptstraße")], calls), {
    downloadPlanFactory: chunkedPlan
  });
  const result = await service.fetchCityData(municipality());
  const boundaryCalls = calls.filter(call => isBoundaryQuery(call.options));
  const dataCalls = calls.filter(call => !isBoundaryQuery(call.options));
  assert.equal(boundaryCalls.length, 1);
  assert.equal(dataCalls.length, 4);
  assert.equal(result.downloadDiagnostics.boundaryRequests, 1);
  assert.equal(result.boundary.type, "Polygon");
  assert.deepEqual(result.boundary.coordinates[0], [
    [6.77, 50.83], [7.16, 50.83], [7.16, 51.1], [6.77, 51.1], [6.77, 50.83]
  ]);
});

test("Single- und Chunked-Mode erzeugen aus denselben Rohdaten dasselbe Stadtpaket", async () => {
  const data = [
    streetWay(101, "Ringstraße", 3),
    streetWay(102, "Ringstraße", 2),
    streetWay(103, "Nebenstraße", 2),
    poiNode(201, "Grundschule"),
    poiWay(202, "Flächenschule"),
    poiRelation(203, "Kindergarten")
  ];
  const single = createService(successfulFetch(data), { downloadPlanFactory: singlePlan });
  const chunked = createService(successfulFetch(data), { downloadPlanFactory: chunkedPlan });
  const [singleResult, chunkedResult] = await Promise.all([
    single.fetchCityData(municipality()),
    chunked.fetchCityData(municipality())
  ]);
  assert.deepEqual(comparableResult(chunkedResult), comparableResult(singleResult));
  assert.equal(chunkedResult.downloadDiagnostics.rawObjectsBeforeDeduplication, data.length * 4);
  assert.equal(chunkedResult.downloadDiagnostics.rawObjectsAfterDeduplication, data.length);
});

test("umgekehrte Chunkreihenfolge ändert Straßen, POIs, IDs und Geometrien nicht", async () => {
  const data = [streetWay(11, "Querstraße", 3), streetWay(12, "Querstraße"), poiNode(31)];
  const normalPlan = chunkedPlan();
  const reversePlan = { mode: "chunked", chunks: [...normalPlan.chunks].reverse() };
  const normal = createService(successfulFetch(data), { downloadPlanFactory: () => normalPlan });
  const reverse = createService(successfulFetch(data), { downloadPlanFactory: () => reversePlan });
  const normalResult = await normal.fetchCityData(municipality());
  const reverseResult = await reverse.fetchCityData(municipality());
  assert.deepEqual(comparableResult(reverseResult), comparableResult(normalResult));
});

test("Straße über drei Chunkgrenzen bleibt ein Ziel mit vollständigen Way-IDs", async () => {
  let dataRequest = 0;
  const variants = [
    [streetWay(101, "Durchgehende Straße", 2), streetWay(102, "Durchgehende Straße", 2)],
    [streetWay(101, "Durchgehende Straße", 4), streetWay(103, "Durchgehende Straße", 2)],
    [streetWay(102, "Durchgehende Straße", 2), streetWay(103, "Durchgehende Straße", 2)],
    [poiNode(400)]
  ];
  const fetch = successfulFetch(() => variants[dataRequest++]);
  const service = createService(fetch, { downloadPlanFactory: chunkedPlan });
  const result = await service.fetchCityData(municipality());
  assert.equal(result.streets.length, 1);
  assert.deepEqual(result.streets[0].osmWayIds, [101, 102, 103]);
  assert.equal(result.streets[0].geometry.type, "MultiLineString");
  assert.ok(result.streets[0].geometry.coordinates.flat().length >= 8);
});

test("vollständigere Repräsentation eines doppelten Ways gewinnt deterministisch", () => {
  const short = streetWay(12345, "Grenzstraße", 2);
  const full = streetWay(12345, "Grenzstraße", 5);
  const forward = deduplicateOsmElements([short, full]);
  const reverse = deduplicateOsmElements([full, short]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 1);
  assert.equal(forward[0].geometry.length, 5);
});

test("node, way und relation mit gleicher numerischer ID bleiben getrennt", () => {
  const result = deduplicateOsmElements([poiNode(123), poiWay(123), poiRelation(123)]);
  assert.deepEqual(result.map(element => `${element.type}:${element.id}`), [
    "node:123", "way:123", "relation:123"
  ]);
});

test("doppelte Node-, Way- und Relations-POIs erscheinen final jeweils einmal", async () => {
  const data = [
    streetWay(1, "Hauptstraße"),
    poiNode(123), poiNode(123),
    poiWay(124), poiWay(124),
    poiRelation(125), poiRelation(125)
  ];
  const service = createService(successfulFetch(data), { downloadPlanFactory: chunkedPlan });
  const result = await service.fetchCityData(municipality());
  assert.deepEqual(result.pois.map(poi => `${poi.osmType}:${poi.osmId}`), [
    "way:124", "node:123", "relation:125"
  ]);
});

test("Root zweimal 504 wird danach in vier erfolgreiche Kinder gesplittet", async () => {
  let dataRequests = 0;
  const fetch = async (url, options) => {
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    dataRequests += 1;
    if (dataRequests <= 2) return responseWith({}, 504);
    return responseWith({ elements: [streetWay(dataRequests, `Straße ${dataRequests}`)] });
  };
  const service = createService(fetch, { downloadPlanFactory: singlePlan });
  const result = await service.fetchCityData(municipality());
  assert.equal(dataRequests, 6);
  assert.equal(result.downloadDiagnostics.retries, 1);
  assert.equal(result.downloadDiagnostics.splits, 1);
  assert.equal(result.downloadDiagnostics.successfulChunks, 4);
});

test("ein erneut überlastetes Kind wird bis zur nächsten Tiefe gesplittet", async () => {
  let dataRequests = 0;
  const fetch = async (url, options) => {
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    dataRequests += 1;
    if (dataRequests <= 4) return responseWith({}, 504);
    return responseWith({ elements: [streetWay(dataRequests, `Straße ${dataRequests}`)] });
  };
  const service = createService(fetch, { downloadPlanFactory: singlePlan, maxChunkDepth: 2 });
  const result = await service.fetchCityData(municipality());
  assert.equal(dataRequests, 11);
  assert.equal(result.downloadDiagnostics.retries, 2);
  assert.equal(result.downloadDiagnostics.splits, 2);
  assert.equal(result.downloadDiagnostics.successfulChunks, 7);
});

test("MAX_CHUNK_DEPTH liefert nach genau einem Retry den finalen technischen Fehler", async () => {
  let dataRequests = 0;
  const fetch = async (url, options) => {
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    dataRequests += 1;
    return responseWith({}, 504);
  };
  const service = createService(fetch, { downloadPlanFactory: singlePlan, maxChunkDepth: 0 });
  await assert.rejects(service.fetchCityData(municipality()), error => (
    error.code === "HTTP_ERROR" && error.status === 504 && error.retryExhausted === true
  ));
  assert.equal(MAX_DOWNLOAD_RETRIES, 1);
  assert.equal(dataRequests, 2);
});

test("MAX_CHUNK_REQUESTS stoppt eine adaptive Requestexplosion kontrolliert", async () => {
  let dataRequests = 0;
  const fetch = async (url, options) => {
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    dataRequests += 1;
    if (dataRequests <= 2) return responseWith({}, 504);
    return responseWith({ elements: [streetWay(dataRequests, `Straße ${dataRequests}`)] });
  };
  const service = createService(fetch, {
    downloadPlanFactory: singlePlan,
    maxChunkRequests: 3
  });
  await assert.rejects(service.fetchCityData(municipality()), error => error.code === "CHUNK_REQUEST_LIMIT");
  assert.equal(dataRequests, 3);
  assert.ok(MAX_CHUNK_REQUESTS > 3);
  assert.ok(MAX_CHUNK_DEPTH <= 3);
});

test("nicht temporärer Chunkfehler wird weder wiederholt noch gesplittet", async () => {
  let dataRequests = 0;
  const fetch = async (url, options) => {
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    dataRequests += 1;
    return responseWith({ broken: true });
  };
  const service = createService(fetch, { downloadPlanFactory: singlePlan });
  await assert.rejects(service.fetchCityData(municipality()), error => error.code === "INVALID_RESPONSE");
  assert.equal(dataRequests, 1);
});

test("Abort während Retry-Wartezeit verhindert Retry und alle geplanten Chunks", async () => {
  let dataRequests = 0;
  let delayStarted;
  const waiting = new Promise(resolve => { delayStarted = resolve; });
  const controller = new AbortController();
  const abortableDelay = (milliseconds, signal) => new Promise((resolve, reject) => {
    delayStarted();
    signal.addEventListener("abort", () => {
      const error = new Error("aborted delay");
      error.name = "AbortError";
      error.code = "ABORTED";
      reject(error);
    }, { once: true });
  });
  const fetch = async (url, options) => {
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    dataRequests += 1;
    return responseWith({}, 504);
  };
  const service = createService(fetch, {
    downloadPlanFactory: chunkedPlan,
    overpassRetryDelayMs: 10,
    delay: abortableDelay
  });
  const promise = service.fetchCityData(municipality(), { signal: controller.signal });
  await waiting;
  controller.abort();
  await assert.rejects(promise, error => error.code === "ABORTED");
  assert.equal(dataRequests, 1);
});

test("Abort eines laufenden Chunks startet keinen weiteren geplanten Request", async () => {
  let dataRequests = 0;
  let secondRequestStarted;
  const secondStarted = new Promise(resolve => { secondRequestStarted = resolve; });
  const controller = new AbortController();
  const fetch = async (url, options) => {
    if (isBoundaryQuery(options)) return responseWith({ elements: [boundaryRelation()] });
    dataRequests += 1;
    if (dataRequests === 1) return responseWith({ elements: [streetWay(1, "Erste Straße")] });
    secondRequestStarted();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted request");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  };
  const service = createService(fetch, { downloadPlanFactory: chunkedPlan });
  const promise = service.fetchCityData(municipality(), { signal: controller.signal });
  await secondStarted;
  controller.abort();
  await assert.rejects(promise, error => error.code === "ABORTED");
  assert.equal(dataRequests, 2);
});

test("Chunkrequests laufen strikt sequenziell mit Concurrency 1", async () => {
  let active = 0;
  let maximumActive = 0;
  let wayId = 0;
  const fetch = async (url, options) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setImmediate(resolve));
    active -= 1;
    return isBoundaryQuery(options)
      ? responseWith({ elements: [boundaryRelation()] })
      : responseWith({ elements: [streetWay(++wayId, "Sequenzstraße")] });
  };
  const service = createService(fetch, { downloadPlanFactory: chunkedPlan });
  await service.fetchCityData(municipality());
  assert.equal(maximumActive, 1);
});

test("Progress meldet diskrete abgeschlossene und ausstehende Bereiche ohne Chunk-ID", async () => {
  const events = [];
  const service = createService(successfulFetch([streetWay(1, "Hauptstraße")]), {
    downloadPlanFactory: chunkedPlan
  });
  await service.fetchCityData(municipality(), { onProgress: event => events.push(event) });
  const chunkEvents = events.filter(event => event.stage === "chunk-completed");
  assert.deepEqual(chunkEvents.map(event => event.completedAreas), [1, 2, 3, 4]);
  assert.deepEqual(chunkEvents.map(event => event.pendingAreas), [3, 2, 1, 0]);
  assert.ok(chunkEvents.every(event => !/root-|-(sw|se|nw|ne)\b/i.test(event.message)));
  assert.ok(chunkEvents.every(event => event.progress === 20));
});

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }
  console.log(`\n${passed}/${tests.length} OSM-Chunk-Tests bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
