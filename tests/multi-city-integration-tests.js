"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const geometryApi = require("../geometry.js");
const targetApi = require("../targets.js");
const statisticsApi = require("../statistics.js");
const engineApi = require("../game-engine.js");
const defaultCityApi = require("../default-city.js");

const APP_PATH = path.join(__dirname, "..", "app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
}

class ClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach(value => this.values.add(value));
  }

  remove(...values) {
    values.forEach(value => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.contains(value) : Boolean(force);
    if (enabled) this.add(value);
    else this.remove(value);
    return enabled;
  }
}

class Element {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.checked = false;
    this.dataset = {};
    this.classList = new ClassList();
    this.style = {};
    this.value = "";
    this.files = [];
    this.open = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
    this[`on${type}`] = listener;
  }

  dispatch(type, event = {}) {
    const dispatched = {
      target: this,
      currentTarget: this,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...event
    };
    for (const listener of this.listeners.get(type) || []) listener(dispatched);
    return dispatched;
  }

  click() {
    return this.dispatch("click");
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter(candidate => candidate !== child);
    return child;
  }

  closest(selector) {
    if (selector === "[data-poi-category]" && this.dataset.poiCategory) return this;
    if (selector === "[data-exam-round]" && this.dataset.examRound) return this;
    return this;
  }

  scrollIntoView() {}
  focus() {}
}

const ELEMENT_IDS = [
  "targetStreet", "instruction", "mainButton", "resultCard", "resultTitle",
  "distanceValue", "scoreValue", "resultMessage", "roundValue",
  "totalScoreValue", "scorePointsPanel", "statusCard", "statusText", "mapHint",
  "mapPanel", "modeCard", "modeSelect", "trainingAreaFieldGroup", "trainingAreaSelect",
  "timedSettings", "secondsPerRoundSelect",
  "totalRoundsSelect", "contentSelectionSelect", "showTargetCategoryCheckbox",
  "poiCategoryDetails", "poiCategoryOptions", "targetCategoryLabel", "timerPanel",
  "timerValue", "timerProgress", "endGameButton", "summaryCard",
  "summaryTotalPoints", "summaryAveragePoints", "summaryAverageDistance",
  "summaryAverageTime", "summaryTimeouts", "summaryHitRate", "summaryTotalDuration",
  "summaryBestRound", "summaryWorstRound", "summaryTargetBreakdown",
  "repeatTimedButton", "examResultsCard", "examAwardCard", "examAwardSymbol",
  "examAwardName", "examAwardPercentage", "examAwardDescription", "examTotalPoints",
  "examMaximumPoints", "examPercentage", "examAverageDistance", "examAverageTime",
  "examHitRate", "examUnanswered", "examBestRound", "examWorstRound",
  "examTargetBreakdown", "examTaskList", "returnToExamResultsButton", "legendCard",
  "statisticsDetails", "statisticsHeading", "statisticsModeFilter", "statisticsTargetFilter",
  "statisticsOverview", "statisticsBestTarget", "statisticsWorstTarget",
  "statisticsMostPlayedTarget", "statisticsHighestExam", "statisticsHighestRank",
  "statisticsLastPlayed", "statisticsImportStrategy", "statisticsExportButton",
  "statisticsImportButton", "statisticsResetButton", "statisticsImportInput",
  "statisticsMessage"
];

function createDocument() {
  const elements = Object.fromEntries(ELEMENT_IDS.map(id => [id, new Element(id)]));
  const alarmCard = new Element("alarmCard");
  const body = new Element("body");
  const documentListeners = new Map();

  elements.modeSelect.value = "free";
  elements.secondsPerRoundSelect.value = "30";
  elements.totalRoundsSelect.value = "10";
  elements.contentSelectionSelect.value = "streets";
  elements.showTargetCategoryCheckbox.checked = true;
  elements.statisticsModeFilter.value = "all";
  elements.statisticsTargetFilter.value = "all";
  elements.statisticsImportStrategy.value = "merge";
  elements.mainButton.disabled = true;

  const document = {
    body,
    hidden: false,
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      return selector === ".alarm-card" ? alarmCard : null;
    },
    createElement(tagName) {
      const element = new Element(tagName);
      element.tagName = String(tagName).toUpperCase();
      return element;
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    }
  };

  return { document, elements, alarmCard };
}

function makeBounds(first, second) {
  let points;
  if (second !== undefined) points = [first, second];
  else points = Array.isArray(first) ? first : [];
  const validPoints = points.filter(point => Array.isArray(point)
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1])));
  const latitudes = validPoints.map(point => Number(point[0]));
  const longitudes = validPoints.map(point => Number(point[1]));
  const bounds = {
    south: latitudes.length ? Math.min(...latitudes) : null,
    west: longitudes.length ? Math.min(...longitudes) : null,
    north: latitudes.length ? Math.max(...latitudes) : null,
    east: longitudes.length ? Math.max(...longitudes) : null,
    sourceBounds: null,
    padRatio: null,
    isValid() {
      return [this.south, this.west, this.north, this.east].every(Number.isFinite);
    },
    pad(ratio) {
      const padded = makeBounds(
        [this.south, this.west],
        [this.north, this.east]
      );
      padded.sourceBounds = this;
      padded.padRatio = ratio;
      return padded;
    },
    contains() {
      return true;
    }
  };
  return bounds;
}

function createLayer(kind, data, options = {}) {
  return {
    kind,
    data,
    options,
    addTo(target) {
      if (target && Array.isArray(target.layers)) target.layers.push(this);
      return this;
    },
    setStyle() {}
  };
}

function createLayerGroup() {
  return {
    layers: [],
    addTo() { return this; },
    clearLayers() { this.layers = []; },
    eachLayer(callback) { this.layers.forEach(callback); }
  };
}

function createLeafletFixture() {
  const map = {
    handlers: {},
    fitBoundsCalls: [],
    setMaxBoundsCalls: [],
    setViewCalls: [],
    fitBounds(bounds, options) {
      this.fitBoundsCalls.push({ bounds, options });
      return this;
    },
    setMaxBounds(bounds) {
      this.setMaxBoundsCalls.push(bounds);
      return this;
    },
    setView(center, zoom, options) {
      this.setViewCalls.push({ center, zoom, options });
      return this;
    },
    createPane() { return { style: {} }; },
    on(type, listener) {
      this.handlers[type] = listener;
      return this;
    },
    triggerClick(latlng) {
      if (this.handlers.click) this.handlers.click({ latlng });
    }
  };
  const tileLayers = [];
  const L = {
    latLngBounds: makeBounds,
    map: () => map,
    tileLayer: (url, options) => ({
      url,
      options,
      addTo() { tileLayers.push(this); return this; }
    }),
    featureGroup: createLayerGroup,
    divIcon: options => options,
    marker: (position, options) => createLayer("marker", position, options),
    polyline: (positions, options) => createLayer("polyline", positions, options),
    polygon: (positions, options) => createLayer("polygon", positions, options)
  };
  return { L, map, tileLayers };
}

function createTimerApi() {
  return {
    createDeadlineTimer(options) {
      let running = false;
      return {
        start(seconds) {
          running = true;
          options.onTick({
            remainingMs: seconds * 1000,
            remainingSeconds: seconds,
            urgent: false
          });
        },
        stop() { running = false; },
        checkNow() { return null; },
        isRunning() { return running; }
      };
    }
  };
}

function createLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  const calls = { get: [], set: [], remove: [] };
  return {
    calls,
    values,
    getItem(key) {
      calls.get.push(key);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      calls.set.push({ key, value: String(value) });
      values.set(key, String(value));
    },
    removeItem(key) {
      calls.remove.push(key);
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

function makeCityPackage({
  id,
  name,
  south,
  west,
  north,
  east,
  fireStationCount,
  streetCount = 5
}) {
  const centerLat = (south + north) / 2;
  const centerLon = (west + east) / 2;
  const prefix = name.replace(/\s+/g, "-").toLocaleLowerCase("de-DE");
  const streets = Array.from({ length: streetCount }, (_, index) => ({
    id: `${id}:street-${index + 1}`,
    cityId: id,
    name: `${name} Straße ${index + 1}`,
    aliases: [`${prefix}-weg-${index + 1}`],
    geometry: {
      type: "MultiLineString",
      coordinates: [[
        [west + 0.01 + index * 0.001, south + 0.01],
        [west + 0.02 + index * 0.001, south + 0.02]
      ]]
    },
    osmWayIds: [1000 + index]
  }));
  const pois = [
    ...Array.from({ length: fireStationCount }, (_, index) => ({
      id: `${id}:poi-fire-${index + 1}`,
      cityId: id,
      name: `${name} Feuerwehr ${index + 1}`,
      aliases: [],
      category: "fire_station",
      categoryLabel: "Feuerwehr",
      position: {
        lat: south + 0.03 + index * 0.002,
        lon: west + 0.03 + index * 0.002
      },
      geometry: null
    })),
    {
      id: `${id}:poi-school-1`,
      cityId: id,
      name: `${name} Schule`,
      aliases: [],
      category: "school",
      categoryLabel: "Schule",
      position: { lat: centerLat, lon: centerLon },
      geometry: null
    }
  ];
  return {
    city: {
      id,
      name,
      displayName: name,
      district: `Landkreis ${name}`,
      state: "Testland",
      country: "Deutschland",
      postalCodes: [id.endsWith("a") ? "11111" : "22222"],
      bounds: { south, west, north, east },
      center: { lat: centerLat, lon: centerLon },
      defaultZoom: 12
    },
    streets,
    pois
  };
}

function cityA() {
  return makeCityPackage({
    id: "osm-relation-a",
    name: "Stadt Alpha",
    south: 49.1,
    west: 10.1,
    north: 49.2,
    east: 10.2,
    fireStationCount: 2
  });
}

function cityB() {
  return makeCityPackage({
    id: "osm-relation-b",
    name: "Stadt Beta",
    south: 50.1,
    west: 11.1,
    north: 50.25,
    east: 11.3,
    fireStationCount: 1
  });
}

function createStorage(packages, options = {}) {
  let activeCityId = options.activeCityId || null;
  let activeDataFailurePending = Boolean(options.failActiveData);
  const calls = {
    getActiveCityData: 0,
    getCityData: [],
    getCity: [],
    getCityStreets: [],
    getCityPois: [],
    setActiveCityId: [],
    deleteCity: []
  };
  const packageMap = new Map(Object.values(packages).map(cityPackage => [cityPackage.city.id, cityPackage]));

  const storage = {
    calls,
    getActiveCityId() {
      return activeCityId;
    },
    async getActiveCityData() {
      calls.getActiveCityData += 1;
      if (options.activeDataDeferred) return options.activeDataDeferred.promise;
      if (options.failActiveData) throw new Error("IndexedDB startup failure");
      return activeCityId ? packageMap.get(activeCityId) || null : null;
    },
    async getCityData(cityId) {
      calls.getCityData.push(cityId);
      if (options.activeDataDeferred && cityId === activeCityId) return options.activeDataDeferred.promise;
      if (activeDataFailurePending && cityId === activeCityId) {
        activeDataFailurePending = false;
        throw new Error("IndexedDB startup failure");
      }
      const loader = options.cityDataLoaders && options.cityDataLoaders[cityId];
      if (loader) return loader();
      return packageMap.get(cityId) || null;
    },
    async getCity(cityId) {
      calls.getCity.push(cityId);
      return packageMap.get(cityId)?.city || null;
    },
    async getCityStreets(cityId) {
      calls.getCityStreets.push(cityId);
      return packageMap.get(cityId)?.streets || [];
    },
    async getCityPois(cityId) {
      calls.getCityPois.push(cityId);
      return packageMap.get(cityId)?.pois || [];
    },
    async setActiveCityId(cityId) {
      calls.setActiveCityId.push(cityId);
      if (cityId && options.failSetActiveFor?.has(cityId)) {
        throw new Error("localStorage active-city failure");
      }
      activeCityId = cityId || null;
      return activeCityId;
    },
    async deleteCity(cityId) {
      calls.deleteCity.push(cityId);
      if (options.failDeleteFor?.has(cityId)) {
        throw new Error("IndexedDB delete failure");
      }
      packageMap.delete(cityId);
      if (activeCityId === cityId) activeCityId = null;
      return true;
    },
    getAllCities: async () => [...packageMap.values()].map(cityPackage => cityPackage.city),
    hasCity: async cityId => packageMap.has(cityId)
  };
  return storage;
}

function createFixture(options = {}) {
  const packageA = options.packageA || cityA();
  const packageB = options.packageB || cityB();
  const packages = { a: packageA, b: packageB, ...(options.extraPackages || {}) };
  const storage = options.storage || createStorage(packages, {
    activeCityId: options.activeCityId,
    activeDataDeferred: options.activeDataDeferred,
    failActiveData: options.failActiveData,
    cityDataLoaders: options.cityDataLoaders,
    failSetActiveFor: options.failSetActiveFor,
    failDeleteFor: options.failDeleteFor
  });
  const { document, elements, alarmCard } = createDocument();
  const leaflet = createLeafletFixture();
  const localStorage = createLocalStorage(options.localStorageValues);
  const networkCalls = { fetch: 0, nominatim: 0, overpass: 0 };
  const warnings = [];
  const windowListeners = new Map();

  const osmService = {
    async searchMunicipalities() {
      networkCalls.nominatim += 1;
      throw new Error("Nominatim darf im Runtime-Test nicht aufgerufen werden");
    },
    async fetchCityData() {
      networkCalls.overpass += 1;
      throw new Error("Overpass darf im Runtime-Test nicht aufgerufen werden");
    }
  };

  const windowObject = {
    StreetGeometry: geometryApi,
    StrassentrainerTargets: targetApi,
    StrassentrainerStatistics: statisticsApi,
    StrassentrainerDefaultCity: defaultCityApi,
    StrassentrainerEngine: engineApi,
    StrassentrainerTimer: createTimerApi(),
    StrassentrainerCityStorage: storage,
    StrassentrainerOsmService: osmService,
    STRASSENTRAINER_CONFIG: {},
    location: { search: "", href: "https://example.test/strassentrainer/" },
    history: {
      pushState() {},
      back() {}
    },
    confirm: () => true,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    }
  };

  const turf = {
    point: coordinates => ({ type: "Feature", geometry: { type: "Point", coordinates } }),
    lineString: coordinates => ({ type: "Feature", geometry: { type: "LineString", coordinates } }),
    pointToLineDistance: () => 42,
    nearestPointOnLine: line => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: line.geometry.coordinates[0] }
    }),
    booleanPointInPolygon: () => false
  };

  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0;
  const sandboxConsole = {
    log: (...args) => console.log(...args),
    info: (...args) => console.info(...args),
    error: (...args) => console.error(...args),
    warn: (...args) => warnings.push(args)
  };
  const context = {
    console: sandboxConsole,
    document,
    localStorage,
    L: leaflet.L,
    turf,
    window: windowObject,
    URL,
    URLSearchParams,
    AbortController,
    Blob,
    FileReader: class FileReader {},
    fetch: async () => {
      networkCalls.fetch += 1;
      throw new Error("Netzwerkzugriff während der installierten Spielrunde");
    },
    Math: deterministicMath,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  context.globalThis = context;

  const testExports = `
globalThis.__multiCityInternals = Object.freeze({
  getCityContext: () => cityContext,
  getRepository: () => contentRepository,
  getGameState: () => gameState,
  getRuntimeState: () => runtimeState,
  getNetworkPathCalls: () => ({
    resolveStreetGeometry: typeof resolveStreetGeometry === "function" ? 1 : 0,
    geocodeWithNominatim: typeof geocodeWithNominatim === "function" ? 1 : 0,
    readGeometryCache: typeof readGeometryCache === "function" ? 1 : 0
  }),
  solutionLayers,
  answerLayers,
  fireStationLayers,
  map
});`;

  vm.runInNewContext(`${APP_SOURCE}\n${testExports}`, context, { filename: "app.js" });

  return {
    packageA,
    packageB,
    storage,
    localStorage,
    networkCalls,
    warnings,
    elements,
    alarmCard,
    map: leaflet.map,
    tileLayers: leaflet.tileLayers,
    runtime: windowObject.StrassentrainerRuntime,
    debug: windowObject.STRASSENTRAINER_DEBUG,
    internals: context.__multiCityInternals,
    async ready() {
      await windowObject.StrassentrainerRuntime.ready;
      await settle();
    },
    async startRound() {
      elements.mainButton.click();
      await settle();
    },
    answerRound(latlng = { lat: 49.15, lng: 10.15 }) {
      leaflet.map.triggerClick(latlng);
    }
  };
}

function assertBounds(actual, expected, message) {
  const source = actual?.sourceBounds || actual;
  assert.ok(source, `${message}: Bounds fehlen`);
  assert.equal(source.south, expected.south, `${message}: south`);
  assert.equal(source.west, expected.west, `${message}: west`);
  assert.equal(source.north, expected.north, `${message}: north`);
  assert.equal(source.east, expected.east, `${message}: east`);
}

function assertInstalledRuntime(fixture, cityPackage, expectedFireStations) {
  const context = fixture.internals.getCityContext();
  const repository = fixture.internals.getRepository();
  const metadata = fixture.runtime.getActiveCity();
  assert.equal(fixture.runtime.getStatus().status, "ready");
  assert.equal(context.sourceType, "installed");
  assert.equal("streets" in context, false,
    "Der Runtime-Context darf den vollständigen Raw-Street-Objektgraph nicht zusätzlich halten");
  assert.equal("pois" in context, false,
    "Der Runtime-Context darf den vollständigen Raw-POI-Objektgraph nicht zusätzlich halten");
  assert.equal(metadata.id, cityPackage.city.id);
  assert.equal(metadata.displayName, cityPackage.city.displayName);

  assert.deepEqual(
    Array.from(repository.streetTargets, target => target.id),
    cityPackage.streets.map(street => street.id)
  );
  assert.ok(repository.streetTargets.every(target => target.cityId === cityPackage.city.id));
  assert.ok(repository.streetTargets.every(target => target.geometry?.type === "MultiLineString"
    && Array.isArray(target.geometry.sections)
    && target.geometry.sections.length > 0));
  assert.equal(repository.streetTargets[0].geometry.sections[0], cityPackage.streets[0].geometry.coordinates[0],
    "Target-Geometrien sollen die immutable IndexedDB-Koordinatenlinien referenzieren statt sie zu kopieren");
  assert.deepEqual(
    Array.from(repository.poiTargets, target => target.id),
    cityPackage.pois.map(poi => poi.id)
  );
  assert.ok(repository.poiTargets.every(target => target.cityId === cityPackage.city.id));
  assert.ok(repository.poiTargets.every(target => target.displayName.startsWith(cityPackage.city.displayName)));

  const lastFit = fixture.map.fitBoundsCalls.at(-1);
  assertBounds(lastFit?.bounds, cityPackage.city.bounds, "fitBounds");
  const lastMaxBounds = fixture.map.setMaxBoundsCalls.at(-1);
  assertBounds(lastMaxBounds, cityPackage.city.bounds, "setMaxBounds");
  assert.equal(
    fixture.elements.mapPanel.getAttribute("aria-label"),
    `Unbeschriftete Straßenkarte von ${cityPackage.city.displayName}`
  );

  const markers = fixture.internals.fireStationLayers.layers;
  assert.equal(markers.length, expectedFireStations);
  assert.ok(markers.every(marker => marker.options.alt.startsWith(cityPackage.city.displayName)));
}

test("Async-Startup hält das Spiel gesperrt und lädt die aktive Stadt A", async () => {
  const activeData = deferred();
  const fixture = createFixture({ activeCityId: cityA().city.id, activeDataDeferred: activeData });

  assert.equal(fixture.runtime.getStatus().status, "loading-city");
  assert.equal(fixture.elements.mainButton.disabled, true);
  assert.equal(fixture.elements.mainButton.textContent, "Stadt wird geladen …");

  activeData.resolve(fixture.packageA);
  await fixture.ready();
  assertInstalledRuntime(fixture, fixture.packageA, 2);
  assert.equal(fixture.elements.mainButton.disabled, false);
  assert.equal(fixture.storage.calls.getCityData.includes(fixture.packageA.city.id), true);
});

test("A → B → A ersetzt Targets, Bounds, Marker und alte Ergebnislayer vollständig", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id });
  await fixture.ready();
  assertInstalledRuntime(fixture, fixture.packageA, 2);

  await fixture.startRound();
  assert.equal(fixture.internals.getGameState().status, "active");
  fixture.answerRound();
  assert.equal(fixture.internals.getGameState().status, "answered");
  assert.ok(fixture.internals.solutionLayers.layers.length > 0);
  assert.ok(fixture.internals.answerLayers.layers.length > 0);

  const activationDiagnostics = {};
  await fixture.runtime.activateCity(fixture.packageB.city.id, { diagnostics: activationDiagnostics });
  for (const phase of [
    "targetPreparationMs", "buildCityContextMs", "loadCityContextMs", "statisticsStoreMs",
    "mapBoundsUpdateMs", "fireStationMarkersMs", "applyCityContextMs", "activationTotalMs"
  ]) assert.ok(activationDiagnostics.timingsMs[phase] >= 0, `fehlende Aktivierungsphase ${phase}`);
  assertInstalledRuntime(fixture, fixture.packageB, 1);
  assert.equal(fixture.internals.solutionLayers.layers.length, 0);
  assert.equal(fixture.internals.answerLayers.layers.length, 0);
  assert.equal(fixture.internals.getGameState().status, "idle");
  assert.equal(fixture.internals.getGameState().results.length, 0);
  assert.equal(fixture.internals.getRepository().selectedTargetIds.size, 0);
  assert.ok(fixture.internals.getRepository().streetTargets.every(target => !target.id.includes("relation-a")));
  assert.ok(fixture.internals.getRepository().poiTargets.every(target => !target.id.includes("relation-a")));

  await fixture.runtime.activateCity(fixture.packageA.city.id);
  assertInstalledRuntime(fixture, fixture.packageA, 2);
  assert.ok(fixture.internals.getRepository().streetTargets.every(target => !target.id.includes("relation-b")));
  assert.ok(fixture.internals.getRepository().poiTargets.every(target => !target.id.includes("relation-b")));
});

test("A → B → A → B → A hält Statistiken und Überschrift strikt stadtbezogen", async () => {
  const packageA = cityA();
  const packageB = cityB();
  packageA.streets[0].name = "Hauptstraße";
  packageB.streets[0].name = "Hauptstraße";
  const fixture = createFixture({ packageA, packageB, activeCityId: packageA.city.id });
  await fixture.ready();

  assert.equal(fixture.elements.statisticsHeading.textContent, "Statistik – Stadt Alpha");
  assert.equal(fixture.debug.getStatisticsStorageKey(),
    "strassentrainer-statistik-osm-relation-a-v2");
  await fixture.startRound();
  fixture.answerRound();
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 1);

  await fixture.runtime.activateCity(packageB.city.id);
  assert.equal(fixture.elements.statisticsHeading.textContent, "Statistik – Stadt Beta");
  assert.equal(fixture.debug.getStatisticsStorageKey(),
    "strassentrainer-statistik-osm-relation-b-v2");
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 0);
  await fixture.startRound();
  fixture.answerRound();
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 1);

  await fixture.runtime.activateCity(packageA.city.id);
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 1);
  await fixture.runtime.activateCity(packageB.city.id);
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 1);
  await fixture.runtime.activateCity(packageA.city.id);
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 1);

  assert.ok(fixture.localStorage.values.has(
    "strassentrainer-statistik-osm-relation-a-v2"
  ));
  assert.ok(fixture.localStorage.values.has(
    "strassentrainer-statistik-osm-relation-b-v2"
  ));
  assert.equal(fixture.networkCalls.fetch, 0);
  assert.equal(fixture.networkCalls.nominatim, 0);
  assert.equal(fixture.networkCalls.overpass, 0);
});

test("Reset betrifft nur die aktive Stadt und Reload stellt deren Store wieder her", async () => {
  const packageA = cityA();
  const packageB = cityB();
  const fixture = createFixture({ packageA, packageB, activeCityId: packageA.city.id });
  await fixture.ready();
  await fixture.startRound();
  fixture.answerRound();
  await fixture.runtime.activateCity(packageB.city.id);
  await fixture.startRound();
  fixture.answerRound();
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 1);

  fixture.elements.statisticsResetButton.click();
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 0);
  await fixture.runtime.activateCity(packageA.city.id);
  assert.equal(fixture.debug.getStatistics().overall.roundsEvaluated, 1);

  await fixture.runtime.activateCity(packageB.city.id);
  await fixture.startRound();
  fixture.answerRound();
  const persistedValues = Object.fromEntries(fixture.localStorage.values);
  const reloaded = createFixture({
    packageA,
    packageB,
    activeCityId: packageB.city.id,
    localStorageValues: persistedValues
  });
  await reloaded.ready();
  assert.equal(reloaded.debug.getStatisticsStorageKey(),
    "strassentrainer-statistik-osm-relation-b-v2");
  assert.equal(reloaded.debug.getStatistics().overall.roundsEvaluated, 1);
  assert.equal(reloaded.elements.statisticsHeading.textContent, "Statistik – Stadt Beta");
});

test("Stadtfremder Import wird ohne Store- oder Stadtwechsel abgelehnt", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id });
  await fixture.ready();
  await fixture.startRound();
  fixture.answerRound();
  const alphaExport = fixture.debug.exportStatistics();
  const alphaBefore = fixture.debug.getStatistics();

  await fixture.runtime.activateCity(fixture.packageB.city.id);
  const betaBefore = fixture.debug.getStatistics();
  assert.throws(
    () => fixture.debug.importStatistics(alphaExport, "replace"),
    /Diese Statistik gehört zu Stadt Alpha\. Aktuelle Stadt: Stadt Beta\./
  );
  assert.deepEqual(fixture.debug.getStatistics(), betaBefore);
  assert.equal(fixture.runtime.getActiveCity().id, fixture.packageB.city.id);

  await fixture.runtime.activateCity(fixture.packageA.city.id);
  assert.deepEqual(fixture.debug.getStatistics(), alphaBefore);
});

test("Reload mit aktiver ID B stellt Stadt B vollständig wieder her", async () => {
  const fixture = createFixture({ activeCityId: cityB().city.id });
  await fixture.ready();
  assertInstalledRuntime(fixture, fixture.packageB, 1);
  assert.equal(fixture.storage.getActiveCityId(), fixture.packageB.city.id);
  assert.equal(fixture.storage.calls.getCityData.includes(fixture.packageB.city.id), true);
});

test("Ungültige Active-ID wird bereinigt und aktiviert eine vorhandene installierte Stadt", async () => {
  const fixture = createFixture({ activeCityId: "osm-relation-missing" });
  await fixture.ready();
  assertInstalledRuntime(fixture, fixture.packageA, 2);
  assert.equal(fixture.storage.getActiveCityId(), fixture.packageA.city.id);
  assert.ok(fixture.storage.calls.setActiveCityId.includes(null));
  assert.match(String(fixture.runtime.getStatus().error), /nicht mehr gefunden/i);
});

test("Fehler der aktiven Stadt fällt ohne halben Context auf eine andere installierte Stadt zurück", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id, failActiveData: true });
  await fixture.ready();
  assertInstalledRuntime(fixture, fixture.packageB, 1);
  assert.equal(fixture.storage.getActiveCityId(), fixture.packageB.city.id);
  assert.ok(fixture.warnings.length >= 1);
  assert.match(String(fixture.runtime.getStatus().error), /konnte nicht geladen/i);
});

test("Eine aktive Runde wird beim Stadtwechsel kontrolliert abgebrochen", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id });
  await fixture.ready();
  await fixture.startRound();
  assert.equal(fixture.internals.getGameState().status, "active");
  assert.equal(fixture.runtime.canChangeCity(), true);

  await fixture.runtime.activateCity(fixture.packageB.city.id);

  assertInstalledRuntime(fixture, fixture.packageB, 1);
  assert.equal(fixture.internals.getGameState().status, "idle");
  assert.equal(fixture.internals.getGameState().currentRound, null);
  assert.equal(fixture.internals.getGameState().results.length, 0);
  assert.equal(fixture.storage.getActiveCityId(), fixture.packageB.city.id);
  assert.equal(fixture.storage.calls.getCityData.includes(fixture.packageB.city.id), true);
});

test("Ein beschädigtes Stadtpaket B lässt Stadt A vollständig intakt", async () => {
  const brokenB = cityB();
  brokenB.streets[0].geometry = { type: "MultiLineString", coordinates: [] };
  const fixture = createFixture({ activeCityId: cityA().city.id, packageB: brokenB });
  await fixture.ready();
  const fitCountBefore = fixture.map.fitBoundsCalls.length;

  await assert.rejects(
    fixture.runtime.activateCity(brokenB.city.id),
    /bisherige Stadt bleibt aktiv/i
  );
  assertInstalledRuntime(fixture, fixture.packageA, 2);
  assert.equal(fixture.storage.getActiveCityId(), fixture.packageA.city.id);
  assert.equal(fixture.storage.calls.setActiveCityId.includes(brokenB.city.id), false);
  assert.equal(fixture.map.fitBoundsCalls.length, fitCountBefore);
});

test("Fehler beim Persistieren der Active-ID rollt Runtime B auf Stadt A zurück", async () => {
  const packageB = cityB();
  const fixture = createFixture({
    activeCityId: cityA().city.id,
    packageB,
    failSetActiveFor: new Set([packageB.city.id])
  });
  await fixture.ready();
  await fixture.startRound();
  fixture.answerRound();
  const statisticsBefore = fixture.debug.getStatistics();

  await assert.rejects(
    fixture.runtime.activateCity(packageB.city.id),
    /bisherige Stadt bleibt aktiv/i
  );
  assertInstalledRuntime(fixture, fixture.packageA, 2);
  assert.equal(fixture.storage.getActiveCityId(), fixture.packageA.city.id);
  assert.deepEqual(fixture.debug.getStatistics(), statisticsBefore,
    "Der Rollback muss zusammen mit dem Runtime-Context auch Statistik A wiederherstellen");
  assert.equal(fixture.debug.getStatisticsStorageKey(),
    "strassentrainer-statistik-osm-relation-a-v2");
  assert.ok(fixture.storage.calls.setActiveCityId.includes(packageB.city.id));
  assert.match(String(fixture.runtime.getStatus().error), /bisherige Stadt bleibt aktiv/i);
});

test("Race langsam A / schnell B endet deterministisch mit Stadt B", async () => {
  const slowA = deferred();
  const packageA = cityA();
  const packageB = cityB();
  const fixture = createFixture({
    packageA,
    packageB,
    activeCityId: packageB.city.id,
    cityDataLoaders: {
      [packageA.city.id]: () => slowA.promise,
      [packageB.city.id]: () => Promise.resolve(packageB)
    }
  });
  await fixture.ready();
  assertInstalledRuntime(fixture, packageB, 1);

  const activateA = fixture.runtime.activateCity(packageA.city.id);
  const activateB = fixture.runtime.activateCity(packageB.city.id);
  await activateB;
  slowA.resolve(packageA);
  const staleResult = await activateA;

  assert.equal(staleResult, null);
  assertInstalledRuntime(fixture, packageB, 1);
  assert.equal(fixture.storage.getActiveCityId(), packageB.city.id);
  assert.equal(fixture.storage.calls.setActiveCityId.includes(packageA.city.id), false);
});

test("Erneute Aktivierung derselben Stadt ist ein echter No-op", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id });
  await fixture.ready();
  const cityLoadsBefore = fixture.storage.calls.getCityData.length;
  const activeWritesBefore = fixture.storage.calls.setActiveCityId.length;
  const fitCallsBefore = fixture.map.fitBoundsCalls.length;
  const originalContext = fixture.internals.getCityContext();

  const result = await fixture.runtime.activateCity(fixture.packageA.city.id);
  assert.equal(result, originalContext);
  assert.equal(fixture.storage.calls.getCityData.length, cityLoadsBefore);
  assert.equal(fixture.storage.calls.setActiveCityId.length, activeWritesBefore);
  assert.equal(fixture.map.fitBoundsCalls.length, fitCallsBefore);
  assertInstalledRuntime(fixture, fixture.packageA, 2);
});

test("Mehrere installierte Straßenrunden bleiben vollständig netzwerk- und Legacycache-frei", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id });
  await fixture.ready();

  for (let round = 0; round < 4; round += 1) {
    await fixture.startRound();
    const gameState = fixture.internals.getGameState();
    assert.equal(gameState.status, "active");
    assert.ok(gameState.currentRound.target.name.startsWith(fixture.packageA.city.displayName));
    assert.equal(gameState.currentRound.target.geometry.type, "MultiLineString");
    fixture.answerRound({ lat: 49.15 + round * 0.001, lng: 10.15 + round * 0.001 });
    assert.equal(fixture.internals.getGameState().status, "answered");
  }

  const pathCalls = fixture.internals.getNetworkPathCalls();
  assert.equal(pathCalls.resolveStreetGeometry, 0);
  assert.equal(pathCalls.geocodeWithNominatim, 0);
  assert.equal(pathCalls.readGeometryCache, 0);
  assert.equal(fixture.networkCalls.fetch, 0);
  assert.equal(fixture.networkCalls.nominatim, 0);
  assert.equal(fixture.networkCalls.overpass, 0);
  assert.equal("legacyGeometryResolver" in fixture.internals.getCityContext(), false);
});

test("Installierte POI-Runde bleibt vollständig netzwerkfrei", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id });
  await fixture.ready();
  fixture.elements.contentSelectionSelect.value = "pois";
  fixture.elements.contentSelectionSelect.dispatch("change");
  await fixture.startRound();

  const gameState = fixture.internals.getGameState();
  assert.equal(gameState.status, "active");
  assert.equal(gameState.currentRound.target.targetType, "poi");
  assert.ok(gameState.currentRound.target.name.startsWith(fixture.packageA.city.displayName));
  assert.equal(fixture.networkCalls.fetch, 0);
  assert.equal(fixture.networkCalls.nominatim, 0);
  assert.equal(fixture.networkCalls.overpass, 0);
});

test("Löschen der aktiven installierten Stadt wechselt atomar auf eine andere installierte Stadt", async () => {
  const fixture = createFixture({ activeCityId: cityA().city.id });
  await fixture.ready();
  assertInstalledRuntime(fixture, fixture.packageA, 2);

  await fixture.startRound();
  fixture.answerRound();
  const deletedCityStatisticsKey = "strassentrainer-statistik-osm-relation-a-v2";
  const deletedCityStatistics = fixture.localStorage.values.get(deletedCityStatisticsKey);
  assert.ok(deletedCityStatistics);
  assert.ok(fixture.internals.solutionLayers.layers.length > 0);
  assert.ok(fixture.internals.answerLayers.layers.length > 0);

  const deleted = await fixture.runtime.deleteCity(fixture.packageA.city.id);
  assert.equal(deleted, true);
  assert.equal(await fixture.storage.hasCity(fixture.packageA.city.id), false);
  assert.equal(fixture.storage.getActiveCityId(), fixture.packageB.city.id);
  assert.deepEqual(fixture.storage.calls.deleteCity, [fixture.packageA.city.id]);
  assert.equal(fixture.localStorage.values.get(deletedCityStatisticsKey), deletedCityStatistics,
    "Das Löschen eines Stadtpakets darf dessen Statistik nicht entfernen");
  assertInstalledRuntime(fixture, fixture.packageB, 1);
  assert.equal(fixture.internals.solutionLayers.layers.length, 0);
  assert.equal(fixture.internals.answerLayers.layers.length, 0);
  assert.equal(fixture.internals.getGameState().status, "idle");
  assert.equal(fixture.internals.getGameState().results.length, 0);
  assert.ok(fixture.internals.getRepository().streetTargets.every(target => !target.id.includes("relation-a")));
  assert.ok(fixture.internals.getRepository().poiTargets.every(target => !target.id.includes("relation-a")));
});

test("Fehlgeschlagene Löschung lässt Active-ID, Paket und Runtime von Stadt A intakt", async () => {
  const packageA = cityA();
  const fixture = createFixture({
    packageA,
    activeCityId: packageA.city.id,
    failDeleteFor: new Set([packageA.city.id])
  });
  await fixture.ready();
  const contextBefore = fixture.internals.getCityContext();

  await assert.rejects(
    fixture.runtime.deleteCity(packageA.city.id),
    /delete failure/i
  );
  assert.equal(await fixture.storage.hasCity(packageA.city.id), true);
  assert.equal(fixture.storage.getActiveCityId(), packageA.city.id);
  assert.equal(fixture.internals.getCityContext(), contextBefore);
  assertInstalledRuntime(fixture, packageA, 2);
  assert.match(String(fixture.runtime.getStatus().error), /bleibt aktiv/i);
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

  console.log(`\n${passed}/${tests.length} Multi-City-Integrationstests bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
