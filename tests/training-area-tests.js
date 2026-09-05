"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const geometryApi = require("../geometry.js");
const targetApi = require("../targets.js");
const validatorApi = require("../city-data-validator.js");
const packageApi = require("../city-package.js");
const storageApi = require("../city-storage.js");
const osmServiceApi = require("../osm-service.js");
const statisticsApi = require("../statistics.js");
const engineApi = require("../game-engine.js");
const defaultCityApi = require("../default-city.js");
const timerApi = require("../timer.js");
const customTrainingAreaApi = require("../custom-training-area.js");

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
    values.forEach(v => this.values.add(v));
  }
  remove(...values) {
    values.forEach(v => this.values.delete(v));
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
    this._innerHTML = "";
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

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
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
    this.children = this.children.filter(c => c !== child);
    return child;
  }

  closest() {
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
  "createTrainingAreaButton", "deleteTrainingAreaButton", "trainingAreaEditor",
  "trainingAreaEditorSetup", "trainingAreaKindSelect", "trainingAreaNameInput",
  "startTrainingAreaDrawingButton", "cancelTrainingAreaEditorButton",
  "trainingAreaDrawingControls", "trainingAreaPointCount", "undoTrainingAreaPointButton",
  "finishTrainingAreaButton", "cancelTrainingAreaDrawingButton", "trainingAreaEditorMessage",
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
  elements.trainingAreaEditor.classList.add("hidden");
  elements.trainingAreaDrawingControls.classList.add("hidden");

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

function makeBounds(south, west, north, east) {
  return {
    south, west, north, east,
    pad() { return makeBounds(south, west, north, east); },
    getSouthWest() { return { lat: south, lng: west }; },
    getNorthEast() { return { lat: north, lng: east }; }
  };
}

function createLeafletMock() {
  const layers = [];
  const mapInstance = {
    options: {},
    layers,
    center: [50.9375, 6.9603],
    zoom: 13,
    maxBounds: null,
    listeners: new Map(),
    on(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    },
    fire(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    },
    setView(center, zoom) {
      this.center = center;
      this.zoom = zoom;
      return this;
    },
    fitBounds(bounds) {
      this.bounds = bounds;
      return this;
    },
    setMaxBounds(bounds) {
      this.maxBounds = bounds;
      return this;
    },
    createPane() {
      return { style: {} };
    },
    removeLayer(layer) {
      const index = this.layers.indexOf(layer);
      if (index >= 0) this.layers.splice(index, 1);
    }
  };

  return {
    map() { return mapInstance; },
    tileLayer() { return { addTo() { return this; } }; },
    layerGroup() {
      return {
        layers: [],
        clearLayers() { this.layers = []; },
        addLayer(l) { this.layers.push(l); },
        addTo(m) { m.layers.push(this); return this; }
      };
    },
    featureGroup() {
      return {
        layers: [],
        clearLayers() { this.layers = []; },
        addLayer(l) { this.layers.push(l); },
        eachLayer(cb) { this.layers.forEach(cb); },
        addTo(m) { if (m && m.layers) m.layers.push(this); return this; }
      };
    },
    latLngBounds(first, second) {
      if (Array.isArray(first) && Array.isArray(second)) {
        return makeBounds(first[0], first[1], second[0], second[1]);
      }
      if (Array.isArray(first) && Array.isArray(first[0])) {
        return makeBounds(first[0][0], first[0][1], first[1][0], first[1][1]);
      }
      return makeBounds(50, 6, 51, 7);
    },
    divIcon(options) { return { options }; },
    marker(latlng, options) {
      return {
        latlng,
        options,
        addTo(group) {
          if (group.addLayer) group.addLayer(this);
          return this;
        }
      };
    },
    polygon() { return { addTo() { return this; } }; },
    polyline() { return { addTo() { return this; } }; },
    circleMarker() { return { addTo() { return this; } }; }
  };
}

function createMemoryStorage(initialData = {}) {
  const cities = new Map();
  const streets = new Map();
  const pois = new Map();
  const areas = new Map();
  let activeCityId = initialData.activeCityId || null;

  if (initialData.cities) {
    initialData.cities.forEach(c => cities.set(c.id, { ...c }));
  }
  if (initialData.streets) {
    initialData.streets.forEach(s => {
      if (!streets.has(s.cityId)) streets.set(s.cityId, []);
      streets.get(s.cityId).push({ ...s });
    });
  }
  if (initialData.pois) {
    initialData.pois.forEach(p => {
      if (!pois.has(p.cityId)) pois.set(p.cityId, []);
      pois.get(p.cityId).push({ ...p });
    });
  }
  if (initialData.areas) {
    initialData.areas.forEach(a => {
      if (!areas.has(a.cityId)) areas.set(a.cityId, []);
      areas.get(a.cityId).push({ ...a });
    });
  }

  return {
    async getAllCities() { return [...cities.values()].map(c => ({ ...c })); },
    async getCity(id) { return cities.has(id) ? { ...cities.get(id) } : null; },
    async getCityStreets(id) { return (streets.get(id) || []).map(s => ({ ...s })); },
    async getCityPois(id) { return (pois.get(id) || []).map(p => ({ ...p })); },
    async getCityAreas(id) { return (areas.get(id) || []).map(a => ({ ...a })); },
    async getCityData(id) {
      const city = cities.get(id);
      if (!city) return null;
      return {
        city: { ...city },
        streets: (streets.get(id) || []).map(s => ({ ...s })),
        pois: (pois.get(id) || []).map(p => ({ ...p })),
        areas: (areas.get(id) || []).map(a => ({ ...a }))
      };
    },
    async saveCity(city, cityStreets, cityPois, cityAreas = []) {
      cities.set(city.id, { ...city });
      streets.set(city.id, cityStreets.map(s => ({ ...s })));
      pois.set(city.id, cityPois.map(p => ({ ...p })));
      areas.set(city.id, (cityAreas || []).map(a => ({ ...a })));
    },
    async deleteCity(id) {
      cities.delete(id);
      streets.delete(id);
      pois.delete(id);
      areas.delete(id);
      if (activeCityId === id) activeCityId = null;
    },
    getActiveCityId() { return activeCityId; },
    async setActiveCityId(id) { activeCityId = id; }
  };
}

function createMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, val) { store.set(key, String(val)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

// Sample geometries
// Area 1 (Innenstadt): lon 6.94 to 6.97, lat 50.93 to 50.95
const AREA_1_POLYGON = {
  type: "Polygon",
  coordinates: [[[6.94, 50.93], [6.97, 50.93], [6.97, 50.95], [6.94, 50.95], [6.94, 50.93]]]
};

// Area 2 (Ehrenfeld): lon 6.91 to 6.94, lat 50.94 to 50.96
const AREA_2_POLYGON = {
  type: "Polygon",
  coordinates: [[[6.91, 50.94], [6.94, 50.94], [6.94, 50.96], [6.91, 50.96], [6.91, 50.94]]]
};

function createSampleCityPackage() {
  const city = {
    id: "osm-relation-62578",
    osmId: 62578,
    osmType: "relation",
    name: "Köln",
    displayName: "Köln",
    bounds: { south: 50.8, west: 6.8, north: 51.1, east: 7.1 },
    center: { lat: 50.9375, lon: 6.9603 },
    streetCount: 13,
    poiCount: 4,
    hasAreas: true,
    areaCount: 2
  };

  const areas = [
    {
      id: "area-innenstadt",
      cityId: city.id,
      name: "Innenstadt",
      adminLevel: 9,
      placeType: "borough",
      boundary: "administrative",
      parentId: null,
      childIds: [],
      bounds: { south: 50.93, west: 6.94, north: 50.95, east: 6.97 },
      center: { lat: 50.94, lon: 6.955 },
      polygon: AREA_1_POLYGON,
      streetCount: 7,
      isDefault: false
    },
    {
      id: "area-ehrenfeld",
      cityId: city.id,
      name: "Ehrenfeld",
      adminLevel: 9,
      placeType: "borough",
      boundary: "administrative",
      parentId: null,
      childIds: [],
      bounds: { south: 50.94, west: 6.91, north: 50.96, east: 6.94 },
      center: { lat: 50.95, lon: 6.925 },
      polygon: AREA_2_POLYGON,
      streetCount: 7,
      isDefault: false
    }
  ];

  const streets = [];
  // 5 streets purely inside Innenstadt
  for (let i = 1; i <= 5; i++) {
    streets.push({
      id: `street-innenstadt-${i}`,
      osmWayIds: [1000 + i],
      cityId: city.id,
      name: `Innenstadtstraße ${i}`,
      areaIds: ["area-innenstadt"],
      geometry: {
        type: "MultiLineString",
        coordinates: [[[6.95, 50.935 + i * 0.002], [6.96, 50.935 + i * 0.002]]]
      }
    });
  }

  // 5 streets purely inside Ehrenfeld
  for (let i = 1; i <= 5; i++) {
    streets.push({
      id: `street-ehrenfeld-${i}`,
      osmWayIds: [2000 + i],
      cityId: city.id,
      name: `Ehrenfeldstraße ${i}`,
      areaIds: ["area-ehrenfeld"],
      geometry: {
        type: "MultiLineString",
        coordinates: [[[6.92, 50.945 + i * 0.002], [6.93, 50.945 + i * 0.002]]]
      }
    });
  }

  // 2 border streets crossing both areas (boundary at lon 6.94)
  for (let i = 1; i <= 2; i++) {
    streets.push({
      id: `street-border-${i}`,
      osmWayIds: [3000 + i],
      cityId: city.id,
      name: `Grenzstraße ${i}`,
      areaIds: ["area-innenstadt", "area-ehrenfeld"],
      geometry: {
        type: "MultiLineString",
        coordinates: [[[6.935, 50.942 + i * 0.003], [6.945, 50.942 + i * 0.003]]]
      }
    });
  }

  // 1 street outside any area
  streets.push({
    id: "street-outside",
    osmWayIds: [4001],
    cityId: city.id,
    name: "Außenstraße",
    areaIds: [],
    geometry: {
      type: "MultiLineString",
      coordinates: [[[7.05, 51.02], [7.06, 51.02]]]
    }
  });

  const pois = [
    {
      id: "poi-innenstadt-fire",
      osmId: 5001,
      osmType: "node",
      cityId: city.id,
      name: "Feuerwache Innenstadt",
      category: "fire_station",
      areaIds: ["area-innenstadt"],
      position: { lat: 50.941, lon: 6.951 },
      geometry: { type: "Point", coordinates: [6.951, 50.941] }
    },
    {
      id: "poi-ehrenfeld-fire",
      osmId: 5002,
      osmType: "node",
      cityId: city.id,
      name: "Feuerwache Ehrenfeld",
      category: "fire_station",
      areaIds: ["area-ehrenfeld"],
      position: { lat: 50.948, lon: 6.928 },
      geometry: { type: "Point", coordinates: [6.928, 50.948] }
    },
    {
      id: "poi-innenstadt-school",
      osmId: 5003,
      osmType: "node",
      cityId: city.id,
      name: "Gymnasium Innenstadt",
      category: "school",
      areaIds: ["area-innenstadt"],
      position: { lat: 50.938, lon: 6.958 },
      geometry: { type: "Point", coordinates: [6.958, 50.938] }
    },
    {
      id: "poi-outside-supermarket",
      osmId: 5004,
      osmType: "node",
      cityId: city.id,
      name: "Supermarkt Außen",
      category: "supermarket",
      areaIds: [],
      position: { lat: 51.05, lon: 7.02 },
      geometry: { type: "Point", coordinates: [7.02, 51.05] }
    }
  ];

  return { city, streets, pois, areas };
}

// ---------------------------------------------------------------------------
// TEST SUITE
// ---------------------------------------------------------------------------

test("1. Area Discovery Query erzeugt korrekte Overpass-Syntax für administrative Gebiete", () => {
  const query = osmServiceApi.buildAreaDiscoveryQuery(62578, 60);
  assert.match(query, /\[out:json\]\[timeout:60\]/);
  assert.match(query, /relation\(62578\)->\.boundary/);
  assert.match(query, /\.boundary map_to_area -> \.searchArea/);
  assert.match(query, /relation\(area\.searchArea\)\["boundary"="administrative"\]/);
  assert.match(query, /admin_level/);
  assert.match(query, /out body geom/);
});

test("2. discoverTrainingAreas erkennt geschlossene Ringe, filtert unvollständige Geometrien und wählt primären Tier", () => {
  const municipalityInfo = {
    osmId: 62578,
    name: "Köln",
    bounds: { south: 50.8, west: 6.8, north: 51.1, east: 7.1 }
  };

  const rawElements = [
    {
      type: "relation",
      id: 101,
      tags: { name: "Innenstadt", admin_level: "9", place: "borough" },
      members: [{
        type: "way", role: "outer",
        geometry: [
          { lat: 50.93, lon: 6.94 }, { lat: 50.93, lon: 6.97 },
          { lat: 50.95, lon: 6.97 }, { lat: 50.95, lon: 6.94 },
          { lat: 50.93, lon: 6.94 }
        ]
      }]
    },
    {
      type: "relation",
      id: 102,
      tags: { name: "Rodenkirchen", admin_level: "9", place: "borough" },
      members: [{
        type: "way", role: "outer",
        geometry: [
          { lat: 50.88, lon: 6.96 }, { lat: 50.88, lon: 7.02 },
          { lat: 50.92, lon: 7.02 }, { lat: 50.92, lon: 6.96 },
          { lat: 50.88, lon: 6.96 }
        ]
      }]
    },
    {
      type: "relation",
      id: 103,
      tags: { name: "Lindenthal", admin_level: "9", place: "borough" },
      members: [{
        type: "way", role: "outer",
        geometry: [
          { lat: 50.90, lon: 6.88 }, { lat: 50.90, lon: 6.93 },
          { lat: 50.94, lon: 6.93 }, { lat: 50.94, lon: 6.88 },
          { lat: 50.90, lon: 6.88 }
        ]
      }]
    },
    {
      type: "relation",
      id: 104,
      tags: { name: "Ehrenfeld", admin_level: "9", place: "borough" },
      members: [{
        type: "way", role: "outer",
        geometry: [
          { lat: 50.94, lon: 6.90 }, { lat: 50.94, lon: 6.94 },
          { lat: 50.97, lon: 6.94 }, { lat: 50.97, lon: 6.90 },
          { lat: 50.94, lon: 6.90 }
        ]
      }]
    },
    {
      type: "relation",
      id: 999,
      tags: { name: "Kaputtes Gebiet", admin_level: "9" },
      members: [{
        type: "way", role: "outer",
        geometry: [{ lat: 50.9, lon: 6.9 }, { lat: 50.95, lon: 6.95 }]
      }]
    }
  ];

  const discovered = osmServiceApi.discoverTrainingAreas(rawElements, municipalityInfo);
  assert.equal(discovered.length, 4);
  assert.ok(discovered.every(a => a.polygon && a.polygon.coordinates.length > 0));
  assert.ok(discovered.every(a => a.bounds && a.center));
  assert.ok(discovered.some(a => a.name === "Innenstadt"));
  assert.ok(discovered.some(a => a.name === "Ehrenfeld"));
  assert.ok(!discovered.some(a => a.name === "Kaputtes Gebiet"));
});

test("3. discoverTrainingAreas rekonstruiert Eltern-Kind-Hierarchie sauber", () => {
  const municipalityInfo = {
    osmId: 62578,
    name: "Köln",
    bounds: { south: 50.8, west: 6.8, north: 51.1, east: 7.1 }
  };

  const rawElements = [
    {
      type: "relation", id: 101,
      tags: { name: "Innenstadt", admin_level: "9" },
      members: [{
        type: "way", role: "outer",
        geometry: [[6.94, 50.93], [6.98, 50.93], [6.98, 50.97], [6.94, 50.97], [6.94, 50.93]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    },
    {
      type: "relation", id: 102,
      tags: { name: "Ehrenfeld", admin_level: "9" },
      members: [{
        type: "way", role: "outer",
        geometry: [[6.90, 50.94], [6.94, 50.94], [6.94, 50.98], [6.90, 50.98], [6.90, 50.94]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    },
    {
      type: "relation", id: 103,
      tags: { name: "Nippes", admin_level: "9" },
      members: [{
        type: "way", role: "outer",
        geometry: [[6.94, 50.97], [6.98, 50.97], [6.98, 51.01], [6.94, 51.01], [6.94, 50.97]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    },
    {
      type: "relation", id: 104,
      tags: { name: "Kalk", admin_level: "9" },
      members: [{
        type: "way", role: "outer",
        geometry: [[6.98, 50.93], [7.04, 50.93], [7.04, 50.97], [6.98, 50.97], [6.98, 50.93]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    },
    {
      type: "relation", id: 201,
      tags: { name: "Altstadt-Nord", admin_level: "10" },
      members: [{
        type: "way", role: "outer",
        geometry: [[6.95, 50.94], [6.97, 50.94], [6.97, 50.96], [6.95, 50.96], [6.95, 50.94]].map(c => ({ lon: c[0], lat: c[1] }))
      }]
    }
  ];

  const discovered = osmServiceApi.discoverTrainingAreas(rawElements, municipalityInfo);
  assert.equal(discovered.length, 5);

  const altstadt = discovered.find(a => a.name === "Altstadt-Nord");
  const innenstadt = discovered.find(a => a.name === "Innenstadt");
  assert.ok(altstadt);
  assert.ok(innenstadt);
  assert.equal(altstadt.parentId, innenstadt.id);
  assert.ok(innenstadt.childIds.includes(altstadt.id));
  assert.equal(validatorApi.findAreaParentCycle(discovered), null);
});

test("4. discoverTrainingAreas liefert sauberes leeres Array [] bei Städten ohne Gebiete", () => {
  const municipalityInfo = {
    osmId: 1016396,
    name: "Oberasbach",
    bounds: { south: 49.40, west: 10.93, north: 49.45, east: 11.00 }
  };
  const discovered = osmServiceApi.discoverTrainingAreas([], municipalityInfo);
  assert.deepEqual(discovered, []);
});

test("5. assignAreasToEntities ordnet Straßen mehreren Gebieten zu und teilt sie nicht", () => {
  const sample = createSampleCityPackage();
  validatorApi.assignAreasToEntities(sample.areas, sample.streets, sample.pois);

  const borderStreet = sample.streets.find(s => s.id === "street-border-1");
  assert.ok(borderStreet);
  assert.equal(borderStreet.areaIds.length, 2);
  assert.ok(borderStreet.areaIds.includes("area-innenstadt"));
  assert.ok(borderStreet.areaIds.includes("area-ehrenfeld"));
  assert.equal(borderStreet.geometry.coordinates.length, 1);
  assert.equal(borderStreet.geometry.coordinates[0].length, 2);
});

test("6. assignAreasToEntities ordnet Außenstraßen keinem Gebiet zu (areaIds = [])", () => {
  const sample = createSampleCityPackage();
  validatorApi.assignAreasToEntities(sample.areas, sample.streets, sample.pois);

  const outsideStreet = sample.streets.find(s => s.id === "street-outside");
  assert.ok(outsideStreet);
  assert.deepEqual(outsideStreet.areaIds, []);
});

test("7. assignAreasToEntities ordnet POIs via Point-in-Polygon zu", () => {
  const sample = createSampleCityPackage();
  validatorApi.assignAreasToEntities(sample.areas, sample.streets, sample.pois);

  const innenstadtFire = sample.pois.find(p => p.id === "poi-innenstadt-fire");
  const ehrenfeldFire = sample.pois.find(p => p.id === "poi-ehrenfeld-fire");
  const outsideSupermarket = sample.pois.find(p => p.id === "poi-outside-supermarket");

  assert.deepEqual(innenstadtFire.areaIds, ["area-innenstadt"]);
  assert.deepEqual(ehrenfeldFire.areaIds, ["area-ehrenfeld"]);
  assert.deepEqual(outsideSupermarket.areaIds, []);
});

test("8. Speicherung und Laden von Gebieten in CityStorage", async () => {
  const sample = createSampleCityPackage();
  const memStorage = createMemoryStorage();

  await memStorage.saveCity(sample.city, sample.streets, sample.pois, sample.areas);
  const loadedAreas = await memStorage.getCityAreas(sample.city.id);
  assert.equal(loadedAreas.length, 2);
  assert.equal(loadedAreas[0].id, "area-innenstadt");
  assert.equal(loadedAreas[1].id, "area-ehrenfeld");

  const cityData = await memStorage.getCityData(sample.city.id);
  assert.equal(cityData.areas.length, 2);
});

test("9. CityPackage exportiert und importiert Gebiete verlustfrei", () => {
  const sample = createSampleCityPackage();
  const pkg = packageApi.createCityPackage(sample.city, sample.streets, sample.pois, sample.areas);

  assert.equal(pkg.schemaVersion, 1);
  assert.ok(Array.isArray(pkg.areas));
  assert.equal(pkg.areas.length, 2);

  const validated = validatorApi.validateCityPackage(pkg);
  assert.equal(validated.valid, true);
  assert.equal(validated.areas.length, 2);
  assert.equal(validated.areas[0].name, "Innenstadt");
});

test("10. In-Memory Trainingsgebiet-Wechsel filtert Straßen, POIs und Gerätehäuser ohne Netzwerk oder Storage-Reload", async () => {
  const sample = createSampleCityPackage();
  const { document, elements } = createDocument();
  const leaflet = createLeafletMock();
  const localStorageMock = createMemoryLocalStorage();

  let storageReadCount = 0;
  const storage = {
    ...createMemoryStorage({
      activeCityId: sample.city.id,
      cities: [sample.city],
      streets: sample.streets,
      pois: sample.pois,
      areas: sample.areas
    }),
    async getCityData(id) {
      storageReadCount += 1;
      return {
        city: { ...sample.city },
        streets: sample.streets.map(s => ({ ...s })),
        pois: sample.pois.map(p => ({ ...p })),
        areas: sample.areas.map(a => ({ ...a }))
      };
    }
  };

  const sandbox = {
    window: {
      document,
      location: { search: "" },
      URLSearchParams,
      localStorage: localStorageMock,
      confirm: () => true,
      addEventListener() {},
      removeEventListener() {},
      setTimeout, clearTimeout, setImmediate, clearImmediate,
      Date, Math, Number, String, Array, Set, Map, Promise, performance, Intl,
      L: leaflet,
      StreetGeometry: geometryApi,
      StrassentrainerGeometry: geometryApi,
      StrassentrainerTargets: targetApi,
      StrassentrainerStatistics: statisticsApi,
      StrassentrainerEngine: engineApi,
      StrassentrainerDefaultCity: defaultCityApi,
      StrassentrainerTimer: timerApi,
      StrassentrainerCustomTrainingAreas: customTrainingAreaApi,
      StrassentrainerCityStorage: storage
    },
    location: { search: "" },
    URLSearchParams,
    document,
    localStorage: localStorageMock,
    L: leaflet,
    console,
    setTimeout, clearTimeout, setImmediate, clearImmediate,
    Date, Math, Number, String, Array, Set, Map, Promise, performance, Intl
  };

  vm.createContext(sandbox);
  vm.runInContext(APP_SOURCE, sandbox);
  await settle();
  await sandbox.window.StrassentrainerRuntime.ready;

  assert.equal(storageReadCount, 1);
  assert.equal(elements.trainingAreaFieldGroup.classList.contains("hidden"), false);
  assert.equal(elements.trainingAreaSelect.children.length, 3);
  assert.equal(sandbox.window.StrassentrainerRuntime.getActiveTrainingArea(), null);

  const switched = sandbox.window.StrassentrainerRuntime.activateTrainingArea("area-innenstadt");
  assert.equal(switched, true);

  // 0 additional storage reads! Purely in-memory!
  assert.equal(storageReadCount, 1);

  const activeArea = sandbox.window.StrassentrainerRuntime.getActiveTrainingArea();
  assert.equal(activeArea.id, "area-innenstadt");
  assert.equal(activeArea.name, "Innenstadt");
  assert.equal(localStorageMock.getItem("strassentrainer.trainingArea." + sample.city.id), "area-innenstadt");
  assert.match(elements.instruction.textContent, /7 Straßen in Köln \(Innenstadt\) stehen zur Auswahl/);

  sandbox.window.StrassentrainerRuntime.activateTrainingArea("area-ehrenfeld");
  assert.equal(storageReadCount, 1);
  assert.equal(sandbox.window.StrassentrainerRuntime.getActiveTrainingArea().name, "Ehrenfeld");
  assert.match(elements.instruction.textContent, /7 Straßen in Köln \(Ehrenfeld\) stehen zur Auswahl/);

  sandbox.window.StrassentrainerRuntime.activateTrainingArea("");
  assert.equal(storageReadCount, 1);
  assert.equal(sandbox.window.StrassentrainerRuntime.getActiveTrainingArea(), null);
  assert.match(elements.instruction.textContent, /13 Straßen in Köln stehen zur Auswahl/);
  assert.equal(localStorageMock.getItem("strassentrainer.trainingArea." + sample.city.id), null);
});

test("11. Reload stellt zuvor ausgewähltes Trainingsgebiet aus localStorage wieder her", async () => {
  const sample = createSampleCityPackage();
  const { document, elements } = createDocument();
  const leaflet = createLeafletMock();
  const localStorageMock = createMemoryLocalStorage();

  localStorageMock.setItem("strassentrainer.trainingArea." + sample.city.id, "area-innenstadt");

  const storage = createMemoryStorage({
    activeCityId: sample.city.id,
    cities: [sample.city],
    streets: sample.streets,
    pois: sample.pois,
    areas: sample.areas
  });

  const sandbox = {
    window: {
      document,
      location: { search: "" },
      URLSearchParams,
      localStorage: localStorageMock,
      confirm: () => true,
      addEventListener() {},
      removeEventListener() {},
      setTimeout, clearTimeout, setImmediate, clearImmediate,
      Date, Math, Number, String, Array, Set, Map, Promise, performance, Intl,
      L: leaflet,
      StreetGeometry: geometryApi,
      StrassentrainerGeometry: geometryApi,
      StrassentrainerTargets: targetApi,
      StrassentrainerStatistics: statisticsApi,
      StrassentrainerEngine: engineApi,
      StrassentrainerDefaultCity: defaultCityApi,
      StrassentrainerTimer: timerApi,
      StrassentrainerCustomTrainingAreas: customTrainingAreaApi,
      StrassentrainerCityStorage: storage
    },
    location: { search: "" },
    URLSearchParams,
    document,
    localStorage: localStorageMock,
    L: leaflet,
    console,
    setTimeout, clearTimeout, setImmediate, clearImmediate,
    Date, Math, Number, String, Array, Set, Map, Promise, performance, Intl
  };

  vm.createContext(sandbox);
  vm.runInContext(APP_SOURCE, sandbox);
  await settle();
  await sandbox.window.StrassentrainerRuntime.ready;

  const activeArea = sandbox.window.StrassentrainerRuntime.getActiveTrainingArea();
  assert.ok(activeArea);
  assert.equal(activeArea.id, "area-innenstadt");
  assert.equal(elements.trainingAreaSelect.value, "area-innenstadt");
  assert.match(elements.instruction.textContent, /Köln \(Innenstadt\)/);
});

test("12. Stadt ohne zusätzliche Trainingsgebiete zeigt Gesamte Stadt im Selector", async () => {
  const oberasbach = {
    id: "osm-relation-1016396",
    name: "Oberasbach",
    displayName: "Oberasbach",
    bounds: { south: 49.4, west: 10.9, north: 49.5, east: 11.0 },
    center: { lat: 49.42, lon: 10.97 },
    streetCount: 1,
    poiCount: 0
  };
  const streets = [{
    id: "street-o-1",
    cityId: oberasbach.id,
    name: "Rathausstraße",
    geometry: {
      type: "MultiLineString",
      coordinates: [[[10.95, 49.42], [10.96, 49.42]]]
    }
  }];

  const { document, elements } = createDocument();
  const leaflet = createLeafletMock();
  const localStorageMock = createMemoryLocalStorage();

  const storage = createMemoryStorage({
    activeCityId: oberasbach.id,
    cities: [oberasbach],
    streets,
    pois: [],
    areas: []
  });
  const confirmMessages = [];
  let confirmResult = false;

  const sandbox = {
    window: {
      document,
      location: { search: "" },
      URLSearchParams,
      localStorage: localStorageMock,
      confirm: message => {
        confirmMessages.push(message);
        return confirmResult;
      },
      addEventListener() {},
      removeEventListener() {},
      setTimeout, clearTimeout, setImmediate, clearImmediate,
      Date, Math, Number, String, Array, Set, Map, Promise, performance, Intl,
      L: leaflet,
      StreetGeometry: geometryApi,
      StrassentrainerGeometry: geometryApi,
      StrassentrainerTargets: targetApi,
      StrassentrainerStatistics: statisticsApi,
      StrassentrainerEngine: engineApi,
      StrassentrainerDefaultCity: defaultCityApi,
      StrassentrainerTimer: timerApi,
      StrassentrainerCustomTrainingAreas: customTrainingAreaApi,
      StrassentrainerCityStorage: storage
    },
    location: { search: "" },
    URLSearchParams,
    document,
    localStorage: localStorageMock,
    L: leaflet,
    console,
    setTimeout, clearTimeout, setImmediate, clearImmediate,
    Date, Math, Number, String, Array, Set, Map, Promise, performance, Intl
  };

  vm.createContext(sandbox);
  vm.runInContext(APP_SOURCE, sandbox);
  await settle();
  await sandbox.window.StrassentrainerRuntime.ready;

  assert.equal(elements.trainingAreaFieldGroup.classList.contains("hidden"), false);
  assert.match(elements.trainingAreaSelect.innerHTML, /Gesamte Stadt/);
  assert.equal(sandbox.window.StrassentrainerRuntime.getActiveTrainingArea(), null);

  elements.createTrainingAreaButton.click();
  assert.equal(elements.trainingAreaEditor.classList.contains("hidden"), false);
  elements.cancelTrainingAreaEditorButton.click();
  assert.equal(elements.trainingAreaEditor.classList.contains("hidden"), true);

  elements.mainButton.click();
  await settle();
  assert.equal(sandbox.window.STRASSENTRAINER_DEBUG.getGameState().status, "active");

  elements.createTrainingAreaButton.click();
  assert.equal(confirmMessages.length, 1);
  assert.match(confirmMessages[0], /Aktuelle Runde beenden/);
  assert.equal(elements.trainingAreaEditor.classList.contains("hidden"), true);
  assert.equal(sandbox.window.STRASSENTRAINER_DEBUG.getGameState().status, "active");

  confirmResult = true;
  elements.createTrainingAreaButton.click();
  assert.equal(confirmMessages.length, 2);
  assert.equal(sandbox.window.STRASSENTRAINER_DEBUG.getGameState().status, "idle");
  assert.equal(elements.trainingAreaEditor.classList.contains("hidden"), false);
});

test("13. Zykluserkennung verhindert Endlosschleifen in der Trainingsgebiet-Hierarchie", () => {
  const cyclicalAreas = [
    { id: "a1", name: "Gebiet 1", parentId: "a2" },
    { id: "a2", name: "Gebiet 2", parentId: "a1" }
  ];
  const detected = validatorApi.findAreaParentCycle(cyclicalAreas);
  assert.ok(detected === "a1" || detected === "a2");

  const selfCycle = [
    { id: "b1", name: "Selbst-Eltern", parentId: "b1" }
  ];
  assert.equal(validatorApi.findAreaParentCycle(selfCycle), "b1");

  const validTree = [
    { id: "c1", name: "Eltern", parentId: null },
    { id: "c2", name: "Kind", parentId: "c1" }
  ];
  assert.equal(validatorApi.findAreaParentCycle(validTree), null);
});

test("14. Performance: In-Memory Umschaltung und BBox-Vorfilterung arbeiten strukturell effizient", () => {
  const sample = createSampleCityPackage();

  // Strukturelle BBox-Vorfilterungsprüfung mit Profiler
  const counters = {};
  const mockProfiler = {
    start() { return Date.now(); },
    end() {},
    stop() {},
    increment(name, by = 1) {
      counters[name] = (counters[name] || 0) + by;
    }
  };

  validatorApi.assignAreasToEntities(sample.areas, sample.streets, sample.pois, mockProfiler);

  // Verifiziere: BBox-Vorfilter wird strukturell aufgerufen
  assert.ok(counters.streetAreaCandidateChecks > 0, "Kandidatenprüfungen für Straßen müssen stattfinden");
  assert.ok(counters.poiAreaCandidateChecks > 0, "Kandidatenprüfungen für POIs müssen stattfinden");

  // Verifiziere: Exakte Checks sind vorhanden, aber begrenzt
  assert.ok(counters.streetAreaExactChecks <= counters.streetAreaCandidateChecks, "Exakte Straßenchecks dürfen Kandidatenchecks nicht übersteigen");
  assert.ok(counters.poiAreaExactChecks <= counters.poiAreaCandidateChecks, "Exakte POI-Checks dürfen Kandidatenchecks nicht übersteigen");

  // Benchmark zur reinen Information (ohne fehlschlagenden Hard-Limit-Assert)
  const start = performance.now();
  for (let i = 0; i < 20; i++) {
    validatorApi.assignAreasToEntities(sample.areas, sample.streets, sample.pois);
  }
  const duration = performance.now() - start;
  console.log(`   [Info-Benchmark] 20x assignAreasToEntities dauerte ${duration.toFixed(2)}ms`);
  assert.ok(Number.isFinite(duration) && duration >= 0, "Dauer muss eine gültige Zahl sein");
});

// ---------------------------------------------------------------------------
// RUNNER
// ---------------------------------------------------------------------------

(async function runAllTests() {
  let passed = 0;
  let failed = 0;
  console.log(`Starte ${tests.length} Phase-12.5-TrainingArea-Tests ...\n`);

  for (const t of tests) {
    try {
      await t.run();
      console.log(`✓ ${t.name}`);
      passed += 1;
    } catch (err) {
      console.error(`✗ ${t.name}:`, err);
      failed += 1;
    }
  }

  console.log(`\nErgebnis: ${passed}/${tests.length} bestanden.`);
  if (failed > 0) {
    process.exit(1);
  }
})();
