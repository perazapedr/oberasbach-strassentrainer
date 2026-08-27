"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCityManager } = require("../city-manager-ui.js");

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.filter(Boolean).forEach(name => this.values.add(name));
  }

  remove(...names) {
    names.forEach(name => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toString() {
    return [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(documentRef, tagName = "div", id = "") {
    this.ownerDocument = documentRef;
    this.tagName = String(tagName).toUpperCase();
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
    this.type = "";
    this._textContent = "";
  }

  get className() {
    return this.classList.toString();
  }

  set className(value) {
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this._textContent = "";
    children.forEach(child => this.appendChild(child));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, overrides = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...overrides
    };
    (this.listeners.get(type) || []).forEach(listener => listener(event));
    return event;
  }

  click() {
    if (!this.disabled) this.dispatch("click");
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some(child => typeof child.contains === "function" && child.contains(candidate));
  }

  querySelectorAll() {
    return descendants(this).filter(element => {
      if (!(element instanceof FakeElement)) return false;
      if (element.disabled || element.classList.contains("hidden")) return false;
      return ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(element.tagName)
        || element.getAttribute("tabindex") !== null;
    });
  }
}

class FakeTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }

  contains(candidate) {
    return candidate === this;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, overrides = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides
    };
    (this.listeners.get(type) || []).forEach(listener => listener(event));
    return event;
  }

  add(id, tagName = "div") {
    const element = new FakeElement(this, tagName, id);
    this.elements.set(id, element);
    return element;
  }
}

function descendants(element) {
  return element.children.flatMap(child => [child, ...(child.children ? descendants(child) : [])]);
}

function findByClass(element, className) {
  return descendants(element).filter(candidate => candidate.classList && candidate.classList.contains(className));
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

function tick() {
  return new Promise(resolve => setImmediate(resolve));
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
    ...overrides
  };
}

function city(overrides = {}) {
  return {
    id: "osm-relation-1016396",
    name: "Oberasbach",
    displayName: "Oberasbach",
    district: "Landkreis Fürth",
    state: "Bayern",
    ...overrides
  };
}

function downloadedPackage(overrides = {}) {
  return {
    city: city(),
    streets: [{ id: "street-1", cityId: "osm-relation-1016396", name: "Hauptstraße" }],
    pois: [{ id: "poi-1", cityId: "osm-relation-1016396", name: "Feuerwehr", category: "fire_station" }],
    boundary: { type: "Polygon", coordinates: [] },
    ...overrides
  };
}

function validationResult(overrides = {}) {
  const downloaded = downloadedPackage();
  return {
    valid: true,
    city: downloaded.city,
    streets: downloaded.streets,
    pois: downloaded.pois,
    boundary: downloaded.boundary,
    validation: {
      valid: true,
      municipality: { valid: true, warnings: [], errors: [] },
      streets: { warnings: [], errors: [] },
      pois: { warnings: [], errors: [] },
      summary: { warningCount: 0, errorCount: 0 }
    },
    ...overrides
  };
}

const ELEMENT_TAGS = {
  citySelectorButton: "button",
  addCityButton: "button",
  closeCityManagerButton: "button",
  citySearchForm: "form",
  citySearchInput: "input",
  citySearchButton: "button",
  municipalityActionButton: "button",
  cancelCityDownloadButton: "button",
  toggleWarningDetailsButton: "button",
  cancelValidationButton: "button",
  saveCityButton: "button",
  closeCompletedButton: "button",
  cancelDeleteCityButton: "button",
  confirmDeleteCityButton: "button"
};

const ELEMENT_IDS = [
  "citySelector", "citySelectorButton", "activeCityName", "cityMenu", "installedCityList",
  "addCityButton", "cityManagerHeaderStatus", "cityManagerModalOverlay", "cityManagerDialog",
  "cityManagerTitle", "closeCityManagerButton", "cityManagerAlert", "citySearchPanel", "citySearchForm",
  "citySearchInput", "citySearchButton", "citySearchStatus", "citySearchResults",
  "selectedMunicipalityPanel", "selectedMunicipalityName", "selectedMunicipalityContext",
  "municipalityActionButton", "cityDownloadPanel", "cityDownloadTitle", "cityDownloadProgress",
  "cityProgressBar", "cityProgressMessage", "cancelCityDownloadButton", "cityValidationPanel",
  "cityValidationOutcome", "previewStreetCount", "previewPoiCount", "previewFireStationCount",
  "previewCategoryCounts", "cityWarningSummary", "toggleWarningDetailsButton", "cityWarningDetails",
  "cancelValidationButton", "saveCityButton", "cityCompletedPanel", "cityCompletedMessage",
  "closeCompletedButton", "cityManagerLiveRegion", "deleteCityModalOverlay", "deleteCityDialog",
  "deleteCityTitle", "deleteCityMessage", "deleteCityStatus", "cancelDeleteCityButton",
  "confirmDeleteCityButton"
];

function buildDocument() {
  const documentRef = new FakeDocument();
  ELEMENT_IDS.forEach(id => documentRef.add(id, ELEMENT_TAGS[id] || "div"));
  const element = id => documentRef.getElementById(id);

  element("citySelector").appendChild(element("citySelectorButton"));
  element("citySelector").appendChild(element("cityMenu"));
  element("cityMenu").appendChild(element("installedCityList"));
  element("cityMenu").appendChild(element("addCityButton"));

  element("cityManagerModalOverlay").appendChild(element("cityManagerDialog"));
  [
    "cityManagerTitle", "closeCityManagerButton", "cityManagerAlert", "citySearchPanel",
    "cityDownloadPanel", "cityValidationPanel", "cityCompletedPanel", "cityManagerLiveRegion"
  ].forEach(id => element("cityManagerDialog").appendChild(element(id)));
  [
    "citySearchForm", "citySearchStatus", "citySearchResults", "selectedMunicipalityPanel"
  ].forEach(id => element("citySearchPanel").appendChild(element(id)));
  element("citySearchForm").appendChild(element("citySearchInput"));
  element("citySearchForm").appendChild(element("citySearchButton"));
  ["selectedMunicipalityName", "selectedMunicipalityContext", "municipalityActionButton"]
    .forEach(id => element("selectedMunicipalityPanel").appendChild(element(id)));
  ["cityDownloadTitle", "cityDownloadProgress", "cityProgressMessage", "cancelCityDownloadButton"]
    .forEach(id => element("cityDownloadPanel").appendChild(element(id)));
  element("cityDownloadProgress").appendChild(element("cityProgressBar"));
  [
    "cityValidationOutcome", "previewStreetCount", "previewPoiCount", "previewFireStationCount",
    "previewCategoryCounts", "cityWarningSummary", "toggleWarningDetailsButton", "cityWarningDetails",
    "cancelValidationButton", "saveCityButton"
  ].forEach(id => element("cityValidationPanel").appendChild(element(id)));
  ["cityCompletedMessage", "closeCompletedButton"]
    .forEach(id => element("cityCompletedPanel").appendChild(element(id)));

  element("deleteCityModalOverlay").appendChild(element("deleteCityDialog"));
  ["deleteCityTitle", "deleteCityMessage", "deleteCityStatus", "cancelDeleteCityButton", "confirmDeleteCityButton"]
    .forEach(id => element("deleteCityDialog").appendChild(element(id)));

  [
    "cityMenu", "cityManagerModalOverlay", "selectedMunicipalityPanel", "cityDownloadPanel",
    "cityValidationPanel", "cityCompletedPanel", "cityManagerAlert", "cityWarningSummary",
    "toggleWarningDetailsButton", "cityWarningDetails", "deleteCityModalOverlay"
  ].forEach(id => element(id).classList.add("hidden"));

  element("cityManagerDialog").setAttribute("role", "dialog");
  element("cityManagerDialog").setAttribute("aria-modal", "true");
  element("cityManagerDialog").setAttribute("aria-labelledby", "cityManagerTitle");
  element("deleteCityDialog").setAttribute("role", "dialog");
  element("deleteCityDialog").setAttribute("aria-modal", "true");
  element("cityDownloadProgress").setAttribute("role", "progressbar");
  element("cityDownloadProgress").setAttribute("aria-valuemin", "0");
  element("cityDownloadProgress").setAttribute("aria-valuemax", "100");
  element("cityManagerLiveRegion").setAttribute("aria-live", "polite");
  element("citySearchStatus").setAttribute("aria-live", "polite");
  element("citySearchInput").setAttribute("aria-labelledby", "citySearchLabel");
  return documentRef;
}

function createStorage(initialCities = [], initialActiveCityId = null, overrides = {}) {
  let cities = [...initialCities];
  let activeCityId = initialActiveCityId;
  const calls = { getAllCities: 0, hasCity: [], saveCity: [], setActiveCityId: [], deleteCity: [] };
  const storage = {
    async getAllCities() {
      calls.getAllCities += 1;
      return [...cities];
    },
    getActiveCityId() {
      return activeCityId;
    },
    async hasCity(cityId) {
      calls.hasCity.push(cityId);
      return cities.some(candidate => candidate.id === cityId);
    },
    async saveCity(cityData, streets, pois) {
      calls.saveCity.push({ city: cityData, streets, pois });
      cities = [...cities.filter(candidate => candidate.id !== cityData.id), cityData];
    },
    async setActiveCityId(cityId) {
      calls.setActiveCityId.push(cityId);
      activeCityId = cityId;
    },
    async deleteCity(cityId) {
      calls.deleteCity.push(cityId);
      cities = cities.filter(candidate => candidate.id !== cityId);
      if (activeCityId === cityId) activeCityId = null;
    },
    ...overrides
  };
  return { storage, calls, getCities: () => [...cities] };
}

async function setup(options = {}) {
  const documentRef = buildDocument();
  const storageFixture = options.storageFixture || createStorage(options.cities, options.activeCityId);
  const serviceCalls = { search: [], download: [] };
  const osmService = options.osmService || {
    async searchMunicipalities(query, searchOptions) {
      serviceCalls.search.push({ query, options: searchOptions });
      return options.searchResults || [municipality()];
    },
    async fetchCityData(selected, downloadOptions) {
      serviceCalls.download.push({ municipality: selected, options: downloadOptions });
      return downloadedPackage();
    }
  };
  const validatorCalls = [];
  const validator = options.validator || {
    validateCityData(downloaded) {
      validatorCalls.push(downloaded);
      return options.validation || validationResult();
    }
  };
  const manager = createCityManager({
    document: documentRef,
    storage: storageFixture.storage,
    osmService,
    validator,
    canChangeCity: options.canChangeCity || (() => true),
    setTimeout: callback => callback()
  });
  await manager.init();
  return {
    document: documentRef,
    element: id => documentRef.getElementById(id),
    manager,
    storageFixture,
    serviceCalls,
    validatorCalls
  };
}

async function openAndSearch(fixture, query = "Oberasbach") {
  fixture.manager.open(fixture.element("addCityButton"));
  fixture.element("citySearchInput").value = query;
  fixture.element("citySearchForm").dispatch("submit");
  await tick();
}

async function openSearchAndSelect(fixture) {
  await openAndSearch(fixture);
  findByClass(fixture.element("citySearchResults"), "city-search-result")[0].click();
  await tick();
}

async function reachValidation(fixture) {
  await openSearchAndSelect(fixture);
  fixture.element("municipalityActionButton").click();
  await tick();
}

test("Browser-Global und öffentliche API sind verfügbar", () => {
  assert.ok(globalThis.StrassentrainerCityManager);
  ["init", "open", "close", "refreshInstalledCities", "getState", "createCityManager"].forEach(method => {
    assert.equal(typeof globalThis.StrassentrainerCityManager[method], "function");
  });
});

test("Initialisierung ohne Städte zeigt einen sicheren Leerzustand", async () => {
  const fixture = await setup();
  assert.equal(fixture.element("activeCityName").textContent, "Keine Stadt ausgewählt");
  assert.match(fixture.element("installedCityList").textContent, /Noch keine Stadt/);
});

test("installierte Städte werden datengetrieben geladen", async () => {
  const fixture = await setup({ cities: [city(), city({ id: "osm-relation-2", name: "Zirndorf", displayName: "Zirndorf" })] });
  assert.match(fixture.element("installedCityList").textContent, /Oberasbach/);
  assert.match(fixture.element("installedCityList").textContent, /Zirndorf/);
});

test("nur die aktive Stadt ist markiert", async () => {
  const zirndorf = city({ id: "osm-relation-2", name: "Zirndorf", displayName: "Zirndorf" });
  const fixture = await setup({ cities: [city(), zirndorf], activeCityId: zirndorf.id });
  const buttons = findByClass(fixture.element("installedCityList"), "installed-city-button");
  assert.deepEqual(buttons.map(button => button.getAttribute("aria-checked")), ["false", "true"]);
  assert.equal(fixture.element("activeCityName").textContent, "Zirndorf");
});

test("Dialog öffnet mit Rolle, Modalattribut und Fokus im Suchfeld", async () => {
  const fixture = await setup();
  fixture.manager.open(fixture.element("addCityButton"));
  assert.equal(fixture.element("cityManagerDialog").getAttribute("role"), "dialog");
  assert.equal(fixture.element("cityManagerDialog").getAttribute("aria-modal"), "true");
  assert.equal(fixture.element("cityManagerModalOverlay").classList.contains("hidden"), false);
  assert.equal(fixture.document.activeElement, fixture.element("citySearchInput"));
});

test("Dialog schließen blendet ihn aus und stellt Fokus wieder her", async () => {
  const fixture = await setup();
  const opener = fixture.element("addCityButton");
  opener.focus();
  fixture.manager.open(opener);
  fixture.manager.close();
  assert.equal(fixture.element("cityManagerModalOverlay").classList.contains("hidden"), true);
  assert.equal(fixture.document.activeElement, opener);
});

test("ESC schließt den Dialog", async () => {
  const fixture = await setup();
  fixture.manager.open(fixture.element("addCityButton"));
  fixture.document.dispatch("keydown", { key: "Escape" });
  assert.equal(fixture.manager.getState().modalOpen, false);
});

test("leere Suche löst keinen Service-Aufruf aus", async () => {
  const fixture = await setup();
  fixture.manager.open();
  fixture.element("citySearchInput").value = "   ";
  fixture.element("citySearchForm").dispatch("submit");
  await tick();
  assert.equal(fixture.serviceCalls.search.length, 0);
  assert.match(fixture.element("citySearchStatus").textContent, /Bitte gib/);
});

test("bewusste Suche ruft Nominatim exakt einmal mit getrimmtem Query auf", async () => {
  const fixture = await setup();
  await openAndSearch(fixture, "  Oberasbach  ");
  assert.equal(fixture.serviceCalls.search.length, 1);
  assert.equal(fixture.serviceCalls.search[0].query, "Oberasbach");
  assert.ok(fixture.serviceCalls.search[0].options.signal);
});

test("Suchstatus und Doppelklickschutz gelten während Pending-Promise", async () => {
  const pending = deferred();
  let calls = 0;
  const fixture = await setup({
    osmService: {
      searchMunicipalities() { calls += 1; return pending.promise; },
      fetchCityData: async () => downloadedPackage()
    }
  });
  fixture.manager.open();
  fixture.element("citySearchInput").value = "Oberasbach";
  fixture.element("citySearchForm").dispatch("submit");
  fixture.element("citySearchForm").dispatch("submit");
  assert.equal(calls, 1);
  assert.equal(fixture.element("citySearchButton").disabled, true);
  assert.match(fixture.element("citySearchStatus").textContent, /gesucht/);
  pending.resolve([]);
  await tick();
});

test("mehrere normalisierte Suchergebnisse werden als Buttons gerendert", async () => {
  const fixture = await setup({
    searchResults: [municipality(), municipality({ name: "Zirndorf", displayName: "Zirndorf", osmId: 2 })]
  });
  await openAndSearch(fixture);
  const results = findByClass(fixture.element("citySearchResults"), "city-search-result");
  assert.equal(results.length, 2);
  assert.ok(results.every(result => result.tagName === "BUTTON"));
});

test("gleichnamige Gemeinden bleiben durch District und Bundesland unterscheidbar", async () => {
  const fixture = await setup({
    searchResults: [
      municipality({ name: "Neustadt", displayName: "Neustadt", district: "Landkreis A", state: "Bayern" }),
      municipality({ name: "Neustadt", displayName: "Neustadt", district: "Landkreis B", state: "Hessen", osmId: 2 })
    ]
  });
  await openAndSearch(fixture, "Neustadt");
  const text = fixture.element("citySearchResults").textContent;
  assert.match(text, /Landkreis A · Bayern/);
  assert.match(text, /Landkreis B · Hessen/);
  assert.doesNotMatch(text, /undefined|null/);
});

test("null Treffer zeigt eine verständliche Meldung", async () => {
  const fixture = await setup({ searchResults: [] });
  await openAndSearch(fixture, "Nichtvorhanden");
  assert.match(fixture.element("citySearchStatus").textContent, /Keine passende Gemeinde/);
});

test("Nominatim-Fehler zeigt keine rohe Exception", async () => {
  const fixture = await setup({
    osmService: {
      searchMunicipalities: async () => { throw new TypeError("Failed to fetch"); },
      fetchCityData: async () => downloadedPackage()
    }
  });
  await openAndSearch(fixture);
  assert.match(fixture.element("cityManagerAlert").textContent, /momentan nicht erreichbar/);
  assert.doesNotMatch(fixture.element("cityManagerAlert").textContent, /TypeError|Failed to fetch/);
});

test("Gemeindeauswahl verwendet die kanonische OSM-Stadt-ID", async () => {
  const fixture = await setup();
  await openSearchAndSelect(fixture);
  assert.deepEqual(fixture.storageFixture.calls.hasCity, ["osm-relation-1016396"]);
  assert.equal(fixture.manager.getState().selectedMunicipality.name, "Oberasbach");
});

test("bereits installierte Stadt bietet Auswahl statt Download", async () => {
  const fixture = await setup({ cities: [city()] });
  await openSearchAndSelect(fixture);
  assert.equal(fixture.element("municipalityActionButton").textContent, "Stadt auswählen");
  fixture.element("municipalityActionButton").click();
  await tick();
  assert.equal(fixture.serviceCalls.download.length, 0);
  assert.deepEqual(fixture.storageFixture.calls.setActiveCityId, ["osm-relation-1016396"]);
});

test("Download erhält exakt die ausgewählte Municipality", async () => {
  const fixture = await setup();
  await openSearchAndSelect(fixture);
  fixture.element("municipalityActionButton").click();
  await tick();
  assert.equal(fixture.serviceCalls.download.length, 1);
  assert.equal(fixture.serviceCalls.download[0].municipality, fixture.manager.getState().selectedMunicipality);
});

test("Service-Progress aktualisiert Progressbar und Status", async () => {
  const downloadPending = deferred();
  let progressCallback;
  const fixture = await setup({
    osmService: {
      searchMunicipalities: async () => [municipality()],
      fetchCityData(selected, options) {
        progressCallback = options.onProgress;
        return downloadPending.promise;
      }
    }
  });
  await openSearchAndSelect(fixture);
  fixture.element("municipalityActionButton").click();
  progressCallback({ stage: "processing-streets", message: "Straßen werden verarbeitet …", progress: 65 });
  assert.equal(fixture.element("cityDownloadProgress").getAttribute("aria-valuenow"), "65");
  assert.equal(fixture.element("cityProgressBar").style.width, "65%");
  assert.match(fixture.element("cityProgressMessage").textContent, /Straßen/);
  downloadPending.resolve(downloadedPackage());
  await tick();
});

test("Abort verhindert Validation und Speicherung", async () => {
  const downloadPending = deferred();
  let signal;
  let validationCalls = 0;
  const fixture = await setup({
    osmService: {
      searchMunicipalities: async () => [municipality()],
      fetchCityData(selected, options) { signal = options.signal; return downloadPending.promise; }
    },
    validator: { validateCityData() { validationCalls += 1; return validationResult(); } }
  });
  await openSearchAndSelect(fixture);
  fixture.element("municipalityActionButton").click();
  fixture.element("cancelCityDownloadButton").click();
  assert.equal(signal.aborted, true);
  downloadPending.resolve(downloadedPackage());
  await tick();
  assert.equal(validationCalls, 0);
  assert.equal(fixture.storageFixture.calls.saveCity.length, 0);
  assert.match(fixture.element("citySearchStatus").textContent, /abgebrochen/);
});

test("Overpass-Timeout wird verständlich angezeigt und UI bleibt nutzbar", async () => {
  const fixture = await setup({
    osmService: {
      searchMunicipalities: async () => [municipality()],
      fetchCityData: async () => { const error = new Error("raw timeout"); error.code = "TIMEOUT"; throw error; }
    }
  });
  await openSearchAndSelect(fixture);
  fixture.element("municipalityActionButton").click();
  await tick();
  assert.match(fixture.element("cityManagerAlert").textContent, /zu lange gedauert/);
  assert.equal(fixture.element("municipalityActionButton").disabled, false);
});

test("Validation wird erst nach erfolgreichem Download aufgerufen", async () => {
  const order = [];
  const fixture = await setup({
    osmService: {
      searchMunicipalities: async () => [municipality()],
      fetchCityData: async () => { order.push("download"); return downloadedPackage(); }
    },
    validator: { validateCityData() { order.push("validation"); return validationResult(); } }
  });
  await reachValidation(fixture);
  assert.deepEqual(order, ["download", "validation"]);
});

test("Validator-Ausnahme wird als Prüfproblem statt als Overpass-Fehler erklärt", async () => {
  const fixture = await setup({
    validator: { validateCityData() { throw new Error("interner Validator-Stack"); } }
  });
  await openSearchAndSelect(fixture);
  fixture.element("municipalityActionButton").click();
  await tick();
  assert.match(fixture.element("cityManagerAlert").textContent, /konnten nicht geprüft werden/);
  assert.doesNotMatch(fixture.element("cityManagerAlert").textContent, /Stack|interner/);
});

test("invalides Paket kann nicht gespeichert werden", async () => {
  const invalid = validationResult({
    valid: false,
    validation: {
      valid: false,
      municipality: { warnings: [], errors: [{ code: "CITY_BOUNDARY_MISSING", message: "Grenze fehlt." }] },
      streets: { warnings: [], errors: [] },
      pois: { warnings: [], errors: [] },
      summary: { warningCount: 0, errorCount: 1 }
    }
  });
  const fixture = await setup({ validation: invalid });
  await reachValidation(fixture);
  assert.equal(fixture.element("saveCityButton").disabled, true);
  assert.equal(fixture.element("cityValidationOutcome").classList.contains("invalid"), true);
  fixture.element("saveCityButton").click();
  await tick();
  assert.equal(fixture.storageFixture.calls.saveCity.length, 0);
  assert.match(fixture.element("cityValidationOutcome").textContent, /nicht als vollständiges/);
});

test("valides Paket zeigt datengetriebene Vorschau und speichert noch nicht automatisch", async () => {
  const valid = validationResult({
    streets: [{}, {}, {}],
    pois: [{ category: "fire_station" }, { category: "school" }]
  });
  const fixture = await setup({ validation: valid });
  await reachValidation(fixture);
  assert.equal(fixture.element("previewStreetCount").textContent, "3");
  assert.equal(fixture.element("previewPoiCount").textContent, "2");
  assert.equal(fixture.element("previewFireStationCount").textContent, "1");
  assert.equal(fixture.storageFixture.calls.saveCity.length, 0);
});

test("Validator-Warnings werden als Hinweise gruppiert und nicht als Fehler markiert", async () => {
  const warning = { code: "STREET_PARTLY_OUTSIDE_BOUNDARY", message: "Straße liegt teilweise außerhalb." };
  const valid = validationResult();
  valid.validation.streets.warnings = [warning, warning];
  valid.validation.summary.warningCount = 2;
  const fixture = await setup({ validation: valid });
  await reachValidation(fixture);
  assert.match(fixture.element("cityWarningSummary").textContent, /2 Hinweise/);
  assert.match(fixture.element("cityWarningSummary").textContent, /verhindern die Speicherung nicht/);
  fixture.element("toggleWarningDetailsButton").click();
  assert.match(fixture.element("cityWarningDetails").textContent, /2 × Straße liegt teilweise außerhalb/);
  assert.doesNotMatch(fixture.element("cityWarningDetails").textContent, /STREET_PARTLY/);
});

test("Speichern erfolgt vor dem Setzen der aktiven Stadt", async () => {
  const order = [];
  const storageFixture = createStorage([], null, {
    async saveCity(cityData) { order.push("save"); storageFixture.getCities().push(cityData); },
    async setActiveCityId(cityId) { order.push(`active:${cityId}`); storageFixture.calls.setActiveCityId.push(cityId); }
  });
  const fixture = await setup({ storageFixture });
  await reachValidation(fixture);
  fixture.element("saveCityButton").click();
  await tick();
  assert.deepEqual(order, ["save", "active:osm-relation-1016396"]);
});

test("Save-Fehler setzt keine Active-City-ID", async () => {
  const storageFixture = createStorage([], null, {
    async saveCity() { throw new Error("QuotaExceededError"); }
  });
  const fixture = await setup({ storageFixture });
  await reachValidation(fixture);
  fixture.element("saveCityButton").click();
  await tick();
  assert.equal(storageFixture.calls.setActiveCityId.length, 0);
  assert.match(fixture.element("cityManagerAlert").textContent, /nicht lokal gespeichert/);
});

test("Doppelklick auf Speichern startet nur einen Save-Vorgang", async () => {
  const savePending = deferred();
  let saveCalls = 0;
  const storageFixture = createStorage([], null, {
    saveCity() { saveCalls += 1; return savePending.promise; }
  });
  const fixture = await setup({ storageFixture });
  await reachValidation(fixture);
  fixture.element("saveCityButton").click();
  fixture.element("saveCityButton").click();
  assert.equal(saveCalls, 1);
  savePending.resolve();
  await tick();
});

test("bestehende Stadt-ID wird ohne Phase-6-Datenumschaltung gewechselt", async () => {
  const fixture = await setup({ cities: [city()] });
  const button = findByClass(fixture.element("installedCityList"), "installed-city-button")[0];
  button.click();
  await tick();
  assert.deepEqual(fixture.storageFixture.calls.setActiveCityId, ["osm-relation-1016396"]);
  assert.match(fixture.element("cityManagerHeaderStatus").textContent, /Phase 6/);
});

test("Stadtwechsel wird während aktiver Runde kontrolliert blockiert", async () => {
  const fixture = await setup({ cities: [city()], canChangeCity: () => false });
  findByClass(fixture.element("installedCityList"), "installed-city-button")[0].click();
  await tick();
  assert.equal(fixture.storageFixture.calls.setActiveCityId.length, 0);
  assert.match(fixture.element("cityManagerHeaderStatus").textContent, /aktiven oder vorbereiteten Runde/);
});

test("Löschen erfordert Bestätigung und ruft Storage exakt einmal auf", async () => {
  const fixture = await setup({ cities: [city()] });
  findByClass(fixture.element("installedCityList"), "installed-city-delete")[0].click();
  assert.equal(fixture.manager.getState().deleteOpen, true);
  fixture.element("confirmDeleteCityButton").click();
  fixture.element("confirmDeleteCityButton").click();
  await tick();
  assert.deepEqual(fixture.storageFixture.calls.deleteCity, ["osm-relation-1016396"]);
});

test("Löschen abbrechen lässt Storage unverändert", async () => {
  const fixture = await setup({ cities: [city()] });
  findByClass(fixture.element("installedCityList"), "installed-city-delete")[0].click();
  fixture.element("cancelDeleteCityButton").click();
  assert.equal(fixture.storageFixture.calls.deleteCity.length, 0);
  assert.equal(fixture.manager.getState().deleteOpen, false);
});

test("Liste wird nach Löschung aktualisiert und andere Stadt bleibt", async () => {
  const zirndorf = city({ id: "osm-relation-2", name: "Zirndorf", displayName: "Zirndorf" });
  const fixture = await setup({ cities: [city(), zirndorf] });
  const deleteButtons = findByClass(fixture.element("installedCityList"), "installed-city-delete");
  deleteButtons.find(button => button.dataset.cityId === "osm-relation-1016396").click();
  fixture.element("confirmDeleteCityButton").click();
  await tick();
  assert.doesNotMatch(fixture.element("installedCityList").textContent, /Oberasbach/);
  assert.match(fixture.element("installedCityList").textContent, /Zirndorf/);
});

test("verspätete Antwort von Suche A überschreibt Suche B nicht", async () => {
  const first = deferred();
  const second = deferred();
  const fixture = await setup({
    osmService: {
      searchMunicipalities(query) { return query === "A" ? first.promise : second.promise; },
      fetchCityData: async () => downloadedPackage()
    }
  });
  fixture.manager.open();
  fixture.element("citySearchInput").value = "A";
  fixture.element("citySearchForm").dispatch("submit");
  fixture.element("citySearchInput").value = "B";
  fixture.element("citySearchForm").dispatch("submit");
  second.resolve([municipality({ name: "Stadt B", displayName: "Stadt B", osmId: 2 })]);
  await tick();
  first.resolve([municipality({ name: "Stadt A", displayName: "Stadt A" })]);
  await tick();
  assert.match(fixture.element("citySearchResults").textContent, /Stadt B/);
  assert.doesNotMatch(fixture.element("citySearchResults").textContent, /Stadt A/);
});

test("veralteter Download nach Dialogschluss validiert und speichert nicht", async () => {
  const pending = deferred();
  let validationCalls = 0;
  const fixture = await setup({
    osmService: {
      searchMunicipalities: async () => [municipality()],
      fetchCityData: () => pending.promise
    },
    validator: { validateCityData() { validationCalls += 1; return validationResult(); } }
  });
  await openSearchAndSelect(fixture);
  fixture.element("municipalityActionButton").click();
  fixture.manager.close();
  pending.resolve(downloadedPackage());
  await tick();
  assert.equal(validationCalls, 0);
  assert.equal(fixture.storageFixture.calls.saveCity.length, 0);
});

test("Accessibility-Markup enthält Label, Live-Region, Dialog und Progressbar", async () => {
  const fixture = await setup();
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /<label for="citySearchInput">Stadt oder Gemeinde<\/label>/);
  assert.equal(fixture.element("cityManagerDialog").getAttribute("role"), "dialog");
  assert.equal(fixture.element("cityManagerLiveRegion").getAttribute("aria-live"), "polite");
  assert.equal(fixture.element("cityDownloadProgress").getAttribute("role"), "progressbar");
});

test("Fokusschleife hält Tab im geöffneten Dialog", async () => {
  const fixture = await setup();
  fixture.manager.open();
  fixture.element("citySearchButton").focus();
  const event = fixture.document.dispatch("keydown", { key: "Tab", shiftKey: false });
  assert.equal(event.defaultPrevented, true);
  assert.equal(fixture.document.activeElement, fixture.element("closeCityManagerButton"));
});

test("UI-Modul enthält weder direkte IndexedDB-Manipulation noch Netzwerk-Downloadlogik", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "city-manager-ui.js"), "utf8");
  assert.doesNotMatch(source, /indexedDB|\.transaction\s*\(|objectStore\s*\(/);
  assert.doesNotMatch(source, /fetch\s*\(|overpass-api|\belements\s*\[/i);
  assert.match(source, /storage\.saveCity/);
  assert.match(source, /osmService\.fetchCityData/);
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

  console.log(`\n${passed}/${tests.length} Tests bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
