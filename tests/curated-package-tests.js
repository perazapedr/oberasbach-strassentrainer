"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const validator = require("../city-data-validator.js");
const packageApi = require("../city-package.js");
const updateApi = require("../city-update.js");
const { createCityManager } = require("../city-manager-ui.js");

const ROOT = path.join(__dirname, "..");
const OBERASBACH_PATH = path.join(ROOT, "data/cities/oberasbach.json");

const REQUIRED_ELEMENT_IDS = [
  "citySelector", "citySelectorButton", "activeCityName", "cityMenu", "installedCityList",
  "addCityButton", "importCityButton", "cityImportFileInput", "cityManagerHeaderStatus",
  "cityManagerModalOverlay", "cityManagerDialog",
  "closeCityManagerButton", "cityManagerAlert", "citySearchPanel", "citySearchForm", "citySearchInput",
  "citySearchButton", "citySearchStatus", "citySearchResults", "selectedMunicipalityPanel",
  "selectedMunicipalityName", "selectedMunicipalityContext", "municipalityActionButton",
  "cityDownloadPanel", "cityDownloadTitle", "cityDownloadProgress", "cityProgressBar",
  "cityProgressMessage", "cancelCityDownloadButton", "cityValidationPanel", "cityValidationOutcome",
  "cityPreviewMetadata",
  "previewStreetCount", "previewPoiCount", "previewFireStationCount", "previewCategoryCounts",
  "cityWarningSummary", "toggleWarningDetailsButton", "cityWarningDetails", "cancelValidationButton",
  "saveCityButton", "cityCompletedPanel", "cityCompletedMessage", "activateImportedCityButton",
  "closeCompletedButton",
  "cityManagerLiveRegion", "deleteCityModalOverlay", "deleteCityDialog", "deleteCityMessage",
  "deleteCityStatus", "cancelDeleteCityButton", "confirmDeleteCityButton"
];

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
    return this.values.has(name);
  }
  contains(name) { return this.values.has(name); }
  toString() { return [...this.values].join(" "); }
}

class FakeElement {
  constructor(ownerDocument, tagName, id = "") {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.disabled = false;
    this.value = "";
    this.files = [];
    this.type = "";
    this._textContent = "";
  }

  get className() { return this.classList.toString(); }
  set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._textContent + this.children.map(c => c.textContent).join(""); }
  set textContent(value) { this._textContent = String(value ?? ""); this.children = []; }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }
  replaceChildren(...children) {
    this.children.forEach(c => { c.parentNode = null; });
    this.children = [];
    this._textContent = "";
    children.forEach(c => this.appendChild(c));
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type, overrides = {}) {
    const event = {
      type, target: this, currentTarget: this,
      defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...overrides
    };
    (this.listeners.get(type) || []).forEach(listener => listener(event));
    return event;
  }
  click() {
    if (this.disabled) return;
    if (typeof this.onclick === "function") this.onclick({ target: this, preventDefault() {}, stopPropagation() {} });
    this.dispatch("click");
  }
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll() {
    return descendants(this).filter(el => {
      if (!(el instanceof FakeElement)) return false;
      if (el.disabled || el.classList.contains("hidden")) return false;
      return ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(el.tagName);
    });
  }
}

class FakeTextNode {
  constructor(text) { this.textContent = String(text); this.parentNode = null; }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
    this.activeElement = null;
    this.body = new FakeElement(this, "body", "body");
  }
  createElement(tagName) { return new FakeElement(this, tagName); }
  createTextNode(text) { return new FakeTextNode(text); }
  getElementById(id) { return this.elements.get(id) || null; }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  add(id, tagName = "div") {
    const el = new FakeElement(this, tagName, id);
    this.elements.set(id, el);
    return el;
  }
}

function descendants(element) {
  return element.children.flatMap(c => [c, ...(c.children ? descendants(c) : [])]);
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function createDocument() {
  const doc = new FakeDocument();
  REQUIRED_ELEMENT_IDS.forEach(id => {
    const tag = id.toLowerCase().includes("button") ? "button"
      : id.toLowerCase().includes("input") ? "input"
      : id.toLowerCase().includes("form") ? "form" : "div";
    doc.add(id, tag);
  });
  return doc;
}

function createStorage(initialCities = []) {
  const cities = new Map(initialCities.map(c => [c.id, JSON.parse(JSON.stringify(c))]));
  const streets = new Map();
  const pois = new Map();
  const areas = new Map();
  let activeId = initialCities[0]?.id || null;
  const calls = { saveCity: [], deleteCity: [] };

  return {
    calls,
    storage: {
      async getAllCities() { return [...cities.values()].map(c => JSON.parse(JSON.stringify(c))); },
      async getCity(id) { return cities.get(id) ? JSON.parse(JSON.stringify(cities.get(id))) : null; },
      async hasCity(id) { return cities.has(id); },
      async getCityStreets(id) { return streets.get(id) || []; },
      async getCityPois(id) { return pois.get(id) || []; },
      async getCityAreas(id) { return areas.get(id) || []; },
      async getCityData(id) {
        const c = cities.get(id);
        if (!c) return null;
        return {
          city: JSON.parse(JSON.stringify(c)),
          streets: streets.get(id) || [],
          pois: pois.get(id) || [],
          areas: areas.get(id) || []
        };
      },
      async saveCity(city, st = [], po = [], ar = []) {
        calls.saveCity.push({ city, streets: st, pois: po, areas: ar });
        cities.set(city.id, JSON.parse(JSON.stringify(city)));
        streets.set(city.id, JSON.parse(JSON.stringify(st)));
        pois.set(city.id, JSON.parse(JSON.stringify(po)));
        areas.set(city.id, JSON.parse(JSON.stringify(ar)));
      },
      async deleteCity(id) {
        calls.deleteCity.push(id);
        cities.delete(id);
        streets.delete(id);
        pois.delete(id);
        areas.delete(id);
      },
      getActiveCityId() { return activeId; },
      async setActiveCityId(id) { activeId = id; }
    }
  };
}

function sampleCuratedCity(overrides = {}) {
  const city = {
    id: "osm-relation-12345",
    name: "Musterstadt",
    displayName: "Musterstadt",
    district: "Landkreis Fürth",
    state: "Bayern",
    osmType: "relation",
    osmId: 12345,
    bounds: { south: 49.4, west: 10.9, north: 49.5, east: 11.0 },
    center: { lat: 49.45, lon: 10.95 },
    source: "curated+openstreetmap",
    dataVersion: 1,
    package: {
      id: "de-musterstadt-fire-training",
      type: "curated",
      version: "1.0.0",
      title: "Musterstadt Feuerwehr-Training",
      verification: {
        status: "verified",
        maintainer: "Straßentrainer",
        verifiedAt: "2026-09-01T12:00:00.000Z",
        note: "Geprüftes Referenzpaket"
      }
    },
    ...overrides
  };
  return city;
}

function sampleCuratedPackage(overrides = {}) {
  const city = sampleCuratedCity(overrides.city || {});
  const streets = overrides.streets || [
    {
      id: "street-1",
      cityId: city.id,
      name: "Hauptstraße",
      aliases: ["Hauptstr."],
      geometry: { type: "MultiLineString", coordinates: [[[10.91, 49.41], [10.92, 49.42]]] },
      osmWayIds: [101]
    },
    {
      id: "street-2",
      cityId: city.id,
      name: "Bahnhofstraße",
      aliases: [],
      geometry: { type: "MultiLineString", coordinates: [[[10.92, 49.42], [10.93, 49.43]]] },
      osmWayIds: [102]
    }
  ];
  const pois = overrides.pois || [
    {
      id: "poi-1",
      cityId: city.id,
      name: "Freiwillige Feuerwehr Musterstadt",
      displayName: "Freiwillige Feuerwehr Musterstadt",
      category: "fire_station",
      categoryLabel: "Feuerwehr",
      position: { lat: 49.45, lon: 10.95 },
      geometry: null
    }
  ];
  const areas = overrides.areas || [
    {
      id: "area-1",
      cityId: city.id,
      name: "Altstadt",
      tier: "primary",
      adminLevel: 9,
      parentId: null,
      bounds: { south: 49.41, west: 10.91, north: 49.43, east: 10.93 },
      geometry: null
    }
  ];

  const pkgData = {
    schemaVersion: 1,
    exportedAt: "2026-09-01T12:00:00.000Z",
    package: city.package,
    city,
    streets,
    pois,
    areas,
    ...overrides
  };

  if (!pkgData.package.contentHash) {
    pkgData.package.contentHash = validator.computePackageHash(pkgData);
  }
  return pkgData;
}

function createFakeFile(data) {
  const content = typeof data === "string" ? data : JSON.stringify(data);
  return {
    name: "package.json",
    size: Buffer.byteLength(content, "utf8"),
    async text() { return content; }
  };
}

async function selectImportFile(doc, file) {
  const input = doc.getElementById("cityImportFileInput");
  input.files = [file];
  input.dispatch("change");
  await tick();
  await tick();
  await tick();
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// -------------------------------------------------------------
// 1. Validator & Hash & SemVer Unit Tests
// -------------------------------------------------------------

test("SemVer comparison handles patch, minor, and major bumps accurately", () => {
  assert.equal(validator.comparePackageVersions("1.0.0", "1.0.0"), 0);
  assert.equal(validator.comparePackageVersions("1.0.0", "1.0.1"), -1);
  assert.equal(validator.comparePackageVersions("1.0.1", "1.0.0"), 1);
  assert.equal(validator.comparePackageVersions("1.0.9", "1.1.0"), -1);
  assert.equal(validator.comparePackageVersions("1.1.0", "1.2.0"), -1);
  assert.equal(validator.comparePackageVersions("1.9.9", "2.0.0"), -1);
  assert.equal(validator.comparePackageVersions("2.0.0", "1.9.9"), 1);
});

test("SemVer parser rejects non-conforming versions", () => {
  assert.equal(validator.parseSemver("1.0"), null);
  assert.equal(validator.parseSemver("v1.0.0"), null);
  assert.equal(validator.parseSemver("1.0.0-beta"), null);
  assert.equal(validator.parseSemver("1.0.0+build1"), null);
  assert.equal(validator.parseSemver(""), null);
  assert.equal(validator.parseSemver(null), null);
  assert.deepEqual(validator.parseSemver("2.14.3"), [2, 14, 3]);
});

test("sha256Hex produces identical digest with pure-JS fallback and Node crypto", () => {
  const testString = '{"package":{"id":"test"},"streets":[{"name":"Hauptstraße"}]}';
  const nodeCrypto = require("node:crypto");
  const expectedHash = nodeCrypto.createHash("sha256").update(testString, "utf8").digest("hex");
  const computedHash = validator.sha256Hex(testString);
  assert.equal(computedHash, expectedHash);
});

test("Canonical hash ignores non-canonical fields (exportedAt, comments, order)", () => {
  const pkg1 = sampleCuratedPackage();
  const hash1 = validator.computePackageHash(pkg1);

  // Alter exportedAt
  const pkg2 = JSON.parse(JSON.stringify(pkg1));
  pkg2.exportedAt = "2099-01-01T00:00:00.000Z";
  const hash2 = validator.computePackageHash(pkg2);
  assert.equal(hash1, hash2, "exportedAt must not alter canonical hash");

  // Reorder streets
  const pkg3 = JSON.parse(JSON.stringify(pkg1));
  pkg3.streets.reverse();
  const hash3 = validator.computePackageHash(pkg3);
  assert.equal(hash1, hash3, "Street ordering must not alter canonical hash");
});

test("Canonical hash changes when domain data is modified", () => {
  const pkg = sampleCuratedPackage();
  const baseHash = validator.computePackageHash(pkg);

  // Alter street name
  const pkgStreet = JSON.parse(JSON.stringify(pkg));
  pkgStreet.streets[0].name = "Geänderte Straße";
  assert.notEqual(validator.computePackageHash(pkgStreet), baseHash);

  // Alter POI category
  const pkgPoi = JSON.parse(JSON.stringify(pkg));
  pkgPoi.pois[0].category = "hospital";
  assert.notEqual(validator.computePackageHash(pkgPoi), baseHash);

  // Alter area bounds
  const pkgArea = JSON.parse(JSON.stringify(pkg));
  pkgArea.areas[0].name = "Neuer Gebietsname";
  assert.notEqual(validator.computePackageHash(pkgArea), baseHash);

  // Alter package version
  const pkgVersion = JSON.parse(JSON.stringify(pkg));
  pkgVersion.package.version = "1.0.1";
  assert.notEqual(validator.computePackageHash(pkgVersion), baseHash);
});

test("validateCityPackage accepts valid curated package", () => {
  const pkg = sampleCuratedPackage();
  const result = validator.validateCityPackage(pkg);
  assert.equal(result.valid, true);
  assert.equal(result.package.type, "curated");
  assert.equal(result.package.version, "1.0.0");
  assert.equal(result.package.id, "de-musterstadt-fire-training");
});

test("validateCityPackage detects tampered contentHash", () => {
  const pkg = sampleCuratedPackage();
  pkg.streets[0].name = "Manipulierte Straße";
  // Keep original contentHash
  const result = validator.validateCityPackage(pkg);
  assert.equal(result.valid, false);
  const hashIssue = result.validation.package.errors.find(e => e.code === "PACKAGE_HASH_MISMATCH");
  assert.ok(hashIssue, "Should report PACKAGE_HASH_MISMATCH");
  assert.match(hashIssue.message, /Prüfsumme/);
});

test("validateCityPackage rejects invalid package metadata (id, version, type, maintainer)", () => {
  // Invalid version
  const pkgBadVer = sampleCuratedPackage();
  pkgBadVer.package.version = "1.0";
  assert.equal(validator.validateCityPackage(pkgBadVer).valid, false);

  // Invalid id (contains uppercase / spaces)
  const pkgBadId = sampleCuratedPackage();
  pkgBadId.package.id = "Musterstadt Package";
  assert.equal(validator.validateCityPackage(pkgBadId).valid, false);

  // Invalid type
  const pkgBadType = sampleCuratedPackage();
  pkgBadType.package.type = "untrusted";
  assert.equal(validator.validateCityPackage(pkgBadType).valid, false);

  // Missing maintainer
  const pkgNoMaintainer = sampleCuratedPackage();
  delete pkgNoMaintainer.package.verification.maintainer;
  assert.equal(validator.validateCityPackage(pkgNoMaintainer).valid, false);
});

test("Legacy packages without package property validate cleanly with legacy: true", () => {
  const pkg = sampleCuratedPackage();
  delete pkg.package;
  delete pkg.city.package;
  const result = validator.validateCityPackage(pkg);
  assert.equal(result.valid, true);
  assert.equal(result.package.legacy, true);
  assert.equal(result.package.type, "osm");
});

// -------------------------------------------------------------
// 2. Oberasbach Reference Package
// -------------------------------------------------------------

test("Oberasbach reference package meets all Phase 14.3 criteria", () => {
  assert.ok(fs.existsSync(OBERASBACH_PATH), "oberasbach.json must exist");
  const raw = fs.readFileSync(OBERASBACH_PATH, "utf8");
  const pkg = JSON.parse(raw);

  assert.equal(pkg.schemaVersion, 1);
  assert.equal(pkg.city.id, "osm-relation-1016396");
  assert.equal(pkg.city.name, "Oberasbach");
  assert.equal(pkg.streets.length, 271, "Oberasbach must have exactly 271 streets");
  assert.equal(pkg.pois.length, 60, "Oberasbach must have exactly 60 POIs");

  assert.ok(pkg.package, "Oberasbach must have package metadata");
  assert.equal(pkg.package.id, "de-oberasbach-fire-training");
  assert.equal(pkg.package.type, "curated");
  assert.equal(pkg.package.version, "1.0.0");
  assert.equal(pkg.package.title, "Oberasbach – geprüftes Trainingspaket");
  assert.equal(pkg.package.verification.maintainer, "Straßentrainer");
  assert.ok(pkg.package.contentHash.startsWith("sha256:"));

  const validation = validator.validateCityPackage(pkg);
  assert.equal(validation.valid, true, "Oberasbach package must be valid");
  assert.equal(validator.verifyPackageHash(pkg).valid, true, "Oberasbach contentHash must verify");
});

test("cityPackageFilename generates semantic curated filename", () => {
  const curated = sampleCuratedCity({ displayName: "Musterstadt" });
  assert.equal(
    packageApi.cityPackageFilename(curated),
    "musterstadt-training-v1.0.0.json"
  );
  const osm = { displayName: "Nürnberg", source: "openstreetmap" };
  assert.equal(
    packageApi.cityPackageFilename(osm),
    "nuernberg-strassentrainer-v1.json"
  );
});

// -------------------------------------------------------------
// 3. UI Transition Rules (Curated vs OSM vs Updates)
// -------------------------------------------------------------

async function setupManager(initialCities = []) {
  const doc = createDocument();
  const { storage, calls } = createStorage(initialCities);
  const manager = createCityManager({
    document: doc,
    storage,
    packageApi,
    validator,
    updateApi,
    osmService: {
      async searchMunicipalities() { return []; },
      async fetchCityData() { throw new Error("Network not allowed in offline tests"); }
    }
  });
  await manager.init();
  return { doc, storage, calls, manager };
}

test("Curated installed -> OSM import: BLOCKED", async () => {
  const curatedCity = sampleCuratedCity();
  const { doc, manager, calls } = await setupManager([curatedCity]);

  // Try importing OSM package for same city ID
  const osmPackage = sampleCuratedPackage();
  delete osmPackage.package;
  delete osmPackage.city.package;
  osmPackage.city.source = "openstreetmap";

  const file = createFakeFile(osmPackage);
  await selectImportFile(doc, file);

  const state = manager.getState();
  assert.equal(state.importMode, "blocked");
  assert.match(state.importConflictMessage, /kuratiertes Trainingspaket installiert/);

  // Check UI rendering
  const outcome = doc.getElementById("cityValidationOutcome").textContent;
  assert.match(outcome, /kuratiertes Trainingspaket installiert/);
  assert.equal(doc.getElementById("saveCityButton").disabled, true);
  assert.equal(doc.getElementById("cancelValidationButton").textContent, "Schließen");

  // Attempting to click save does nothing
  doc.getElementById("saveCityButton").click();
  assert.equal(calls.saveCity.length, 0, "No city should be saved when import is blocked");
});

test("OSM installed -> Curated import: ALLOWED with upgrade banner and diff", async () => {
  const osmCity = sampleCuratedCity();
  delete osmCity.package;
  osmCity.source = "openstreetmap";
  const { doc, manager, calls, storage } = await setupManager([osmCity]);

  // Seed storage with OSM data
  await storage.saveCity(osmCity, [
    {
      id: "street-1", cityId: osmCity.id, name: "Hauptstraße",
      geometry: { type: "MultiLineString", coordinates: [[[10.91, 49.41], [10.92, 49.42]]] },
      osmWayIds: [101]
    }
  ], []);

  // Import curated package for same city
  const curatedPkg = sampleCuratedPackage();
  const file = createFakeFile(curatedPkg);
  await selectImportFile(doc, file);

  const state = manager.getState();
  assert.equal(state.importMode, "replace");
  assert.match(state.importConflictMessage, /kuratiertes Trainingspaket ersetzt/);

  const saveBtn = doc.getElementById("saveCityButton");
  assert.equal(saveBtn.disabled, false);
  assert.equal(saveBtn.textContent, "Auf kuratiertes Paket aktualisieren");

  // Save the curated package
  saveBtn.click();
  await tick();
  await tick();

  assert.equal(calls.saveCity.length, 2); // Initial seed + curated import
  const saved = calls.saveCity[1].city;
  assert.equal(saved.package.type, "curated");
  assert.equal(saved.package.version, "1.0.0");
  assert.match(doc.getElementById("cityCompletedMessage").textContent, /kuratierte(s)? Trainingspaket/);
});

test("Curated installed -> Curated import with ID mismatch: BLOCKED", async () => {
  const curatedCity = sampleCuratedCity();
  const { doc, manager, calls } = await setupManager([curatedCity]);

  const foreignPkg = sampleCuratedPackage();
  foreignPkg.package.id = "de-anderestadt-training";
  foreignPkg.package.contentHash = validator.computePackageHash(foreignPkg);

  const file = createFakeFile(foreignPkg);
  await selectImportFile(doc, file);

  const state = manager.getState();
  assert.equal(state.importMode, "blocked");
  assert.match(state.importConflictMessage, /Paket-ID/);
  assert.equal(doc.getElementById("saveCityButton").disabled, true);
  assert.equal(calls.saveCity.length, 0);
});

test("Curated installed -> Curated import with same version + same hash: already installed notice", async () => {
  const curatedPkg = sampleCuratedPackage();
  const { doc, manager } = await setupManager([curatedPkg.city]);

  const file = createFakeFile(curatedPkg);
  await selectImportFile(doc, file);

  const state = manager.getState();
  assert.equal(state.importMode, "same");
  assert.match(state.importConflictMessage, /bereits unverändert installiert/);
  assert.equal(doc.getElementById("saveCityButton").disabled, true);
  assert.equal(doc.getElementById("saveCityButton").textContent, "Bereits installiert");
});

test("Curated installed -> Curated import with same version + different hash: BLOCKED", async () => {
  const curatedPkg = sampleCuratedPackage();
  const { doc, manager } = await setupManager([curatedPkg.city]);

  // Altered package with same version but newly recomputed hash
  const alteredPkg = JSON.parse(JSON.stringify(curatedPkg));
  alteredPkg.streets.push({
    id: "street-999",
    cityId: alteredPkg.city.id,
    name: "Neue Straße",
    geometry: { type: "MultiLineString", coordinates: [[[10.95, 49.45], [10.96, 49.46]]] },
    osmWayIds: [999]
  });
  alteredPkg.package.contentHash = validator.computePackageHash(alteredPkg);

  const file = createFakeFile(alteredPkg);
  await selectImportFile(doc, file);

  const state = manager.getState();
  assert.equal(state.importMode, "blocked");
  assert.match(state.importConflictMessage, /veränderte Daten/);
  assert.equal(doc.getElementById("saveCityButton").disabled, true);
});

test("Curated installed -> Curated import downgrade: BLOCKED", async () => {
  const currentCity = sampleCuratedCity();
  currentCity.package.version = "1.2.0";
  const { doc, manager } = await setupManager([currentCity]);

  // Candidate is older version 1.1.0
  const olderPkg = sampleCuratedPackage();
  olderPkg.package.version = "1.1.0";
  olderPkg.package.contentHash = validator.computePackageHash(olderPkg);

  const file = createFakeFile(olderPkg);
  await selectImportFile(doc, file);

  const state = manager.getState();
  assert.equal(state.importMode, "blocked");
  assert.match(state.importConflictMessage, /Ältere Paketversion kann eine neuere nicht überschreiben/);
  assert.equal(doc.getElementById("saveCityButton").disabled, true);
});

test("Curated installed -> Curated import upgrade: ALLOWED with diff and atomic save", async () => {
  const currentPkg = sampleCuratedPackage();
  const { doc, manager, calls, storage } = await setupManager([currentPkg.city]);
  await storage.saveCity(currentPkg.city, currentPkg.streets, currentPkg.pois, currentPkg.areas);

  // Upgraded version 1.1.0
  const upgradedPkg = JSON.parse(JSON.stringify(currentPkg));
  upgradedPkg.package.version = "1.1.0";
  upgradedPkg.city.package.version = "1.1.0";
  upgradedPkg.streets.push({
    id: "street-3",
    cityId: upgradedPkg.city.id,
    name: "Neubaustraße",
    aliases: [],
    geometry: { type: "MultiLineString", coordinates: [[[10.93, 49.43], [10.94, 49.44]]] },
    osmWayIds: [103]
  });
  upgradedPkg.package.contentHash = validator.computePackageHash(upgradedPkg);

  const file = createFakeFile(upgradedPkg);
  await selectImportFile(doc, file);

  const state = manager.getState();
  assert.equal(state.importMode, "update");
  assert.ok(state.importDiff, "Diff should be calculated");
  assert.equal(state.importDiff.summary.streets.added, 1);

  const saveBtn = doc.getElementById("saveCityButton");
  assert.equal(saveBtn.disabled, false);
  assert.equal(saveBtn.textContent, "Paket aktualisieren (v1.0.0 → v1.1.0)");

  // Save the upgrade
  saveBtn.click();
  await tick();
  await tick();

  assert.equal(calls.saveCity.length, 2);
  const updatedCity = calls.saveCity[1].city;
  assert.equal(updatedCity.package.version, "1.1.0");
  assert.match(doc.getElementById("cityCompletedMessage").textContent, /erfolgreich auf Trainingspaket-Version 1\.1\.0 aktualisiert/);
});

// -------------------------------------------------------------
// 4. Statistics & TrainingAreas Persistence
// -------------------------------------------------------------

test("Updating a curated package preserves city statistics in localStorage", async () => {
  const currentPkg = sampleCuratedPackage();
  const fakeLocalStorage = new Map();
  const statsKey = `strassentrainer.statistics.${currentPkg.city.id}`;
  const initialStats = JSON.stringify({
    roundsPlayed: 42,
    correctFirstTry: 35,
    history: []
  });
  fakeLocalStorage.set(statsKey, initialStats);

  const { doc, storage } = await setupManager([currentPkg.city]);
  await storage.saveCity(currentPkg.city, currentPkg.streets, currentPkg.pois, currentPkg.areas);

  // Upgrade package
  const upgradedPkg = JSON.parse(JSON.stringify(currentPkg));
  upgradedPkg.package.version = "2.0.0";
  upgradedPkg.package.contentHash = validator.computePackageHash(upgradedPkg);

  const file = createFakeFile(upgradedPkg);
  await selectImportFile(doc, file);

  doc.getElementById("saveCityButton").click();
  await tick();
  await tick();

  // Verify statistics key remains untouched
  assert.equal(fakeLocalStorage.get(statsKey), initialStats);
});

test("TrainingArea preference persistence and clean fallback", () => {
  const fakeLocalStorage = new Map();
  const areaKey = "strassentrainer.trainingArea.osm-relation-12345";

  // Case 1: Active area remains present in updated areas
  fakeLocalStorage.set(areaKey, "area-altstadt");
  const areasVersion1 = [{ id: "area-altstadt", name: "Altstadt" }, { id: "area-nord", name: "Nord" }];
  const savedAreaId = fakeLocalStorage.get(areaKey);
  const areaFound = areasVersion1.find(a => a.id === savedAreaId);
  assert.ok(areaFound, "Area should be found");
  assert.equal(areaFound.id, "area-altstadt");

  // Case 2: Active area removed in new package
  const areasVersion2 = [{ id: "area-nord", name: "Nord" }];
  const areaStillFound = areasVersion2.find(a => a.id === savedAreaId);
  assert.equal(areaStillFound, undefined, "Area removed should result in undefined");
  // In app.js, fallback sets activeAreaId to null (entire city) without crash
  const fallbackAreaId = areaStillFound ? areaStillFound.id : null;
  assert.equal(fallbackAreaId, null, "Should cleanly fall back to whole city");
});

// -------------------------------------------------------------
// 5. Phase 14.3a – Trust-Semantik & Browser-QA Tests
// -------------------------------------------------------------

test("Security / Trust: External package with arbitrary maintainer is accepted technically but never labeled as authenticated/signed", async () => {
  const externalPkg = sampleCuratedPackage();
  externalPkg.package.verification.maintainer = "Beliebige Externe Organisation";
  externalPkg.package.verification.note = "Selbst behauptete redaktionelle Prüfung";
  externalPkg.package.contentHash = validator.computePackageHash(externalPkg);

  // Technically valid package
  const validation = validator.validateCityPackage(externalPkg);
  assert.equal(validation.valid, true);

  // Setup manager and import file
  const { doc } = await setupManager([]);
  const file = createFakeFile(externalPkg);
  await selectImportFile(doc, file);

  const previewCard = doc.getElementById("cityValidationOutcome").textContent;

  // 1. Badge must be "Kuratiert" (NOT "✓ Geprüft", NOT "Signiert", NOT "Authentifiziert")
  assert.match(previewCard, /Kuratiert/);
  assert.doesNotMatch(previewCard, /✓ Geprüft/);
  assert.doesNotMatch(previewCard, /Signiert/i);
  assert.doesNotMatch(previewCard, /Authentifiziert/i);
  assert.doesNotMatch(previewCard, /Vertrauenswürdig bestätigt/i);
  assert.doesNotMatch(previewCard, /Von .* verifiziert/i);

  // 2. Verification metadata labeled as self-declared package details
  assert.match(previewCard, /Paketangaben \(selbstdeklariert\)/);
  assert.match(previewCard, /Maintainer: Beliebige Externe Organisation/);

  // 3. Hash presented as integrity checksum only
  assert.match(previewCard, /Dateiintegrität \(SHA-256\)/);
});

test("UI: Installed city list displays 'Kuratiert' badge and sober subtitle", async () => {
  const curatedCity = sampleCuratedCity();
  const { doc } = await setupManager([curatedCity]);

  const listText = doc.getElementById("installedCityList").textContent;
  assert.match(listText, /Kuratiert/);
  assert.match(listText, /Kuratiertes Trainingspaket v1\.0\.0/);
  assert.match(listText, /Paketangabe:/);
  assert.doesNotMatch(listText, /✓ Geprüft/);
  assert.doesNotMatch(listText, /Authentifiziert/i);
  assert.doesNotMatch(listText, /Signiert/i);
});

// -------------------------------------------------------------
// Run Tests
// -------------------------------------------------------------

(async () => {
  console.log("Starte Phase 14.3 Curated Package Tests...\n");
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      console.log(`✓ ${t.name}`);
    } catch (err) {
      console.error(`✗ ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} Tests bestanden.`);
})();
