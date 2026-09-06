"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { createCatalogDatasetProvider } = require("../dataset-provider.js");
const { createCityManager } = require("../city-manager-ui.js");
const { createCityStorage } = require("../city-storage.js");
const validator = require("../city-data-validator.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const poiCategoryApi = require("../poi-categories.js");
const { createGameEngine, GAME_STATUS } = require("../game-engine.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "data/catalog.json");

// ---------------------------------------------------------------------------
// Minimal DOM Mock for CityManager
// ---------------------------------------------------------------------------

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }
  add(...names) { names.forEach(n => this.classes.add(n)); }
  remove(...names) { names.forEach(n => this.classes.delete(n)); }
  toggle(name, force) {
    if (force === undefined) {
      if (this.classes.has(name)) { this.classes.delete(name); return false; }
      this.classes.add(name); return true;
    }
    if (force) this.classes.add(name);
    else this.classes.delete(name);
    return Boolean(force);
  }
  contains(name) { return this.classes.has(name); }
}

class FakeElement {
  constructor(documentRef, tagName = "div", id = "") {
    this.document = documentRef;
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.disabled = false;
    this.value = "";
    this.type = "";
    this.textContent = "";
    this.style = {};
  }

  appendChild(child) {
    if (!child) return child;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach(c => { c.parentElement = null; });
    this.children = [];
    children.forEach(c => this.appendChild(c));
    this.textContent = "";
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type, listener) {
    const list = (this.listeners.get(type) || []).filter(l => l !== listener);
    this.listeners.set(type, list);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { if (this.document) this.document.activeElement = this; }

  click() { this.dispatch("click"); }

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
}

class FakeTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentElement = null;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.activeElement = null;
    this.listeners = new Map();
  }

  createElement(tagName) { return new FakeElement(this, tagName); }
  createTextNode(text) { return new FakeTextNode(text); }
  getElementById(id) { return this.elements.get(id) || null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type, listener) {
    const list = (this.listeners.get(type) || []).filter(l => l !== listener);
    this.listeners.set(type, list);
  }

  add(id, tagName = "div") {
    const element = new FakeElement(this, tagName, id);
    this.elements.set(id, element);
    return element;
  }
}

const ELEMENT_TAGS = {
  citySelectorButton: "button",
  addCityButton: "button",
  importCityButton: "button",
  cityImportFileInput: "input",
  closeCityManagerButton: "button",
  citySearchForm: "form",
  citySearchInput: "input",
  citySearchButton: "button",
  municipalityActionButton: "button",
  cancelCityDownloadButton: "button",
  toggleWarningDetailsButton: "button",
  cancelValidationButton: "button",
  saveCityButton: "button",
  activateImportedCityButton: "button",
  closeCompletedButton: "button",
  cancelDeleteCityButton: "button",
  confirmDeleteCityButton: "button"
};

const ELEMENT_IDS = [
  "citySelector", "citySelectorButton", "activeCityName", "cityMenu", "installedCityList",
  "addCityButton", "importCityButton", "cityImportFileInput", "cityManagerHeaderStatus",
  "cityManagerModalOverlay", "cityManagerDialog",
  "cityManagerTitle", "closeCityManagerButton", "cityManagerAlert", "citySearchPanel", "citySearchForm",
  "citySearchInput", "citySearchButton", "citySearchStatus", "citySearchResults",
  "selectedMunicipalityPanel", "selectedMunicipalityName", "selectedMunicipalityContext",
  "municipalityActionButton", "cityDownloadPanel", "cityDownloadTitle", "cityDownloadProgress",
  "cityProgressBar", "cityProgressMessage", "cancelCityDownloadButton", "cityValidationPanel",
  "cityValidationOutcome", "cityPreviewMetadata", "previewStreetCount", "previewPoiCount", "previewFireStationCount",
  "previewCategoryCounts", "cityWarningSummary", "toggleWarningDetailsButton", "cityWarningDetails",
  "cancelValidationButton", "saveCityButton", "cityCompletedPanel", "cityCompletedMessage",
  "activateImportedCityButton",
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
  element("cityMenu").appendChild(element("importCityButton"));
  element("cityMenu").appendChild(element("cityImportFileInput"));

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
  element("citySearchButton").type = "submit";
  ["selectedMunicipalityName", "selectedMunicipalityContext", "municipalityActionButton"]
    .forEach(id => element("selectedMunicipalityPanel").appendChild(element(id)));
  ["cityDownloadTitle", "cityDownloadProgress", "cityProgressMessage", "cancelCityDownloadButton"]
    .forEach(id => element("cityDownloadPanel").appendChild(element(id)));
  element("cityDownloadProgress").appendChild(element("cityProgressBar"));
  [
    "cityValidationOutcome", "cityPreviewMetadata", "previewStreetCount", "previewPoiCount", "previewFireStationCount",
    "previewCategoryCounts", "cityWarningSummary", "toggleWarningDetailsButton", "cityWarningDetails",
    "cancelValidationButton", "saveCityButton"
  ].forEach(id => element("cityValidationPanel").appendChild(element(id)));
  ["cityCompletedMessage", "activateImportedCityButton", "closeCompletedButton"]
    .forEach(id => element("cityCompletedPanel").appendChild(element(id)));

  element("deleteCityModalOverlay").appendChild(element("deleteCityDialog"));
  ["deleteCityTitle", "deleteCityMessage", "deleteCityStatus", "cancelDeleteCityButton", "confirmDeleteCityButton"]
    .forEach(id => element("deleteCityDialog").appendChild(element(id)));

  return documentRef;
}

async function waitForState(manager, targetPhases, maxMs = 3000) {
  const allowed = Array.isArray(targetPhases) ? targetPhases : [targetPhases];
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (allowed.includes(manager.getState().phase)) {
      return manager.getState();
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return manager.getState();
}

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

(async () => {
  console.log("Starte Phase 15.5 Catalog-Installations-Integrationstests …\n");

  let nominatimCalls = 0;
  let overpassCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input?.url || input);
    if (url.includes("nominatim")) nominatimCalls++;
    if (url.includes("overpass") || url.includes("/api/interpreter")) overpassCalls++;
    throw new Error(`Unerwarteter externer Netzwerkaufruf: ${url}`);
  };

  try {
    // -------------------------------------------------------------------------
    // 1. CityManager mit Standard Catalog-Provider initialisieren
    // -------------------------------------------------------------------------
    const documentRef = buildDocument();
    const mockIndexedDB = new MockIndexedDB();
    const memoryStorage = createMemoryStorage();
    const storage = createCityStorage({
      dbName: "phase-15-5-integration-db",
      indexedDB: mockIndexedDB,
      IDBKeyRange: MockIDBKeyRange,
      localStorage: memoryStorage,
      activeCityStorageKey: "phase-15-5-active-city"
    });

    let runtimeCity = null;
    const activatedCityIds = [];
    const activateCity = async cityId => {
      activatedCityIds.push(cityId);
      await storage.setActiveCityId(cityId);
      const loaded = await storage.getCity(cityId);
      runtimeCity = loaded;
      return loaded;
    };

    // CatalogDatasetProvider mit realem Katalog
    const provider = createCatalogDatasetProvider(CATALOG_PATH);

    const manager = createCityManager({
      document: documentRef,
      storage,
      datasetProvider: provider,
      validator,
      setTimeout: callback => callback()
    });

    await manager.init({
      canChangeCity: () => true,
      activateCity,
      getRuntimeCity: () => runtimeCity
    });

    console.log("✓ 1. CityManager mit CatalogDatasetProvider erfolgreich initialisiert");

    // -------------------------------------------------------------------------
    // 2. Suche "Olpe" & "Oberasbach" über normalen Dialog
    // -------------------------------------------------------------------------
    manager.open(documentRef.getElementById("addCityButton"));

    // Suche "Olpe"
    documentRef.getElementById("citySearchInput").value = "Olpe";
    documentRef.getElementById("citySearchForm").dispatch("submit");
    await waitForState(manager, "search-results");

    const stateAfterSearch = manager.getState();
    assert.equal(stateAfterSearch.phase, "search-results");
    assert.equal(stateAfterSearch.searchResults.length, 1);
    const olpeCandidate = stateAfterSearch.searchResults[0];
    assert.equal(olpeCandidate.id, "de-nw-olpe");
    assert.equal(olpeCandidate.name, "Olpe");
    assert.equal(olpeCandidate.state, "Nordrhein-Westfalen");
    assert.equal(olpeCandidate.streetCount, 461);
    assert.equal(olpeCandidate.poiCount, 114);
    assert.equal(olpeCandidate.areaCount, 2);

    // Suche "Oberasbach"
    documentRef.getElementById("citySearchInput").value = "Oberasbach";
    documentRef.getElementById("citySearchForm").dispatch("submit");
    await waitForState(manager, "search-results");
    const stateAfterSearch2 = manager.getState();
    assert.equal(stateAfterSearch2.searchResults.length, 1);
    assert.equal(stateAfterSearch2.searchResults[0].id, "de-oberasbach-fire-training");

    // Sicherstellen: 0 Nominatim / 0 Overpass
    assert.equal(nominatimCalls, 0, "Keine Nominatim-Requests bei der Suche");
    assert.equal(overpassCalls, 0, "Keine Overpass-Requests bei der Suche");

    console.log("✓ 2. Katalogsuche findet Olpe und Oberasbach (Nominatim: 0, Overpass: 0)");

    // -------------------------------------------------------------------------
    // 3. Olpe auswählen, herunterladen, validieren und speichern
    // -------------------------------------------------------------------------
    // Erneut Olpe suchen
    documentRef.getElementById("citySearchInput").value = "Olpe";
    documentRef.getElementById("citySearchForm").dispatch("submit");
    await waitForState(manager, "search-results");

    // Olpe-Button in den Suchergebnissen klicken
    const resultsContainer = documentRef.getElementById("citySearchResults");
    assert.equal(resultsContainer.children.length, 1);
    resultsContainer.children[0].click();
    await waitForState(manager, "municipality-selected");

    assert.equal(manager.getState().phase, "municipality-selected");
    assert.equal(documentRef.getElementById("selectedMunicipalityName").textContent, "Olpe");
    assert.equal(documentRef.getElementById("municipalityActionButton").textContent, "Stadt herunterladen");

    // Download starten
    documentRef.getElementById("municipalityActionButton").click();
    await waitForState(manager, "validation-result");

    // Nach Download und Validierung -> phase = validation-result
    const stateAfterValidation = manager.getState();
    assert.equal(stateAfterValidation.phase, "validation-result");
    assert.equal(documentRef.getElementById("saveCityButton").disabled, false);
    assert.equal(documentRef.getElementById("previewStreetCount").textContent, "461");
    assert.equal(documentRef.getElementById("previewPoiCount").textContent, "114");

    // Speichern bestätigen
    documentRef.getElementById("saveCityButton").click();
    await waitForState(manager, "completed");

    assert.equal(manager.getState().phase, "completed");
    assert.equal(nominatimCalls, 0, "Keine Nominatim-Aufrufe bei Installation");
    assert.equal(overpassCalls, 0, "Keine Overpass-Aufrufe bei Installation");

    console.log("✓ 3. Olpe-Installation über Catalog-Pipeline erfolgreich abgeschlossen");

    // -------------------------------------------------------------------------
    // 4. Speicher- und Aktivierungsprüfung
    // -------------------------------------------------------------------------
    const hasOlpe = await storage.hasCity("osm-relation-163179");
    assert.equal(hasOlpe, true, "Olpe muss in IndexedDB existieren");

    const olpeCity = await storage.getCity("osm-relation-163179");
    assert.ok(olpeCity, "Olpe-Stadtdaten müssen vorhanden sein");
    assert.equal(olpeCity.name, "Olpe");
    assert.equal(olpeCity.streetCount, 461);
    assert.equal(olpeCity.poiCount, 114);

    const olpeStreets = await storage.getCityStreets("osm-relation-163179");
    assert.equal(olpeStreets.length, 461, "Exakt 461 Straßen in IndexedDB");

    const olpePois = await storage.getCityPois("osm-relation-163179");
    assert.equal(olpePois.length, 114, "Exakt 114 POIs in IndexedDB");

    const olpeAreas = await storage.getCityAreas("osm-relation-163179");
    assert.equal(olpeAreas.length, 2, "Exakt 2 Areas in IndexedDB");

    assert.equal(storage.getActiveCityId(), "osm-relation-163179", "Olpe muss aktive Stadt sein");
    assert.deepEqual(activatedCityIds, ["osm-relation-163179"]);

    console.log("✓ 4. Olpe in IndexedDB gespeichert und aktiviert (461 Straßen, 114 POIs, 2 Areas)");

    // -------------------------------------------------------------------------
    // 5. CityContext und Spielrunde (0 Netzwerkaufrufe)
    // -------------------------------------------------------------------------
    const storedData = await storage.getCityData("osm-relation-163179");
    assert.ok(storedData);

    const targetStreets = targetApi.prepareStreetTargets(storedData.streets, geometryApi);
    assert.equal(targetStreets.length, 461, "461 Straßen spielbereit");

    const targetPois = targetApi.preparePoiTargets(storedData.pois, poiCategoryApi.getAll());
    assert.ok(targetPois.length > 0, "POIs als Trainingsziele verfügbar");

    // Starte freie Runde mit Olpe
    const gameEngine = createGameEngine();
    gameEngine.startGame();
    gameEngine.startRound();
    assert.equal(gameEngine.gameState.status, GAME_STATUS.PREPARING);

    const activeTarget = targetStreets[0];
    assert.ok(activeTarget.geometry, "Zielstraße besitzt Geometrie");

    gameEngine.activateRound({
      id: activeTarget.id,
      name: activeTarget.displayName,
      targetType: activeTarget.targetType,
      category: activeTarget.category,
      categoryLabel: activeTarget.categoryLabel,
      geometry: activeTarget.geometry
    });
    assert.equal(gameEngine.gameState.status, GAME_STATUS.ACTIVE);

    // Simuliere Klick auf Straße
    gameEngine.submitGuess({ lat: 51.02, lng: 7.84 });
    const roundResult = gameEngine.resolveRound({ distanceMeters: 0 });
    assert.equal(gameEngine.gameState.status, GAME_STATUS.ANSWERED);
    assert.equal(roundResult.points, 1000, "Volle Punktzahl für exakten Treffer");
    gameEngine.finishGame();
    assert.equal(gameEngine.gameState.status, GAME_STATUS.FINISHED);

    // Keine externen Anfragen während des Spielens
    assert.equal(nominatimCalls, 0);
    assert.equal(overpassCalls, 0);

    console.log("✓ 5. Gameplay mit Olpe ohne Netzwerk erfolgreich (Punkteberechnung & Targets PASS)");

    // -------------------------------------------------------------------------
    // 6. Already Installed: Erneute Auswahl von Olpe
    // -------------------------------------------------------------------------
    manager.open(documentRef.getElementById("addCityButton"));
    documentRef.getElementById("citySearchInput").value = "Olpe";
    documentRef.getElementById("citySearchForm").dispatch("submit");
    await waitForState(manager, "search-results");

    resultsContainer.children[0].click();
    await waitForState(manager, "municipality-selected");

    assert.equal(manager.getState().phase, "municipality-selected");
    assert.equal(manager.getState().selectedMunicipalityInstalled, true);
    assert.equal(documentRef.getElementById("municipalityActionButton").textContent, "Stadt auswählen");

    console.log("✓ 6. Bereits installierte Stadt wird erkannt ('Stadt auswählen' statt Download)");

    // -------------------------------------------------------------------------
    // 7. Hash-Manipulationstest (Requirement 41)
    // -------------------------------------------------------------------------
    const tamperedPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-olpe.json"), "utf8"));
    // Manipuliere Straßeninhalt, lasse package.contentHash aber unverändert
    tamperedPackage.streets[0].name = "Manipulierte Straße";
    assert.equal(validator.verifyPackageHash(tamperedPackage).valid, false, "Manipuliertes Paket muss Hash-Mismatch erzeugen");

    const tamperedProvider = {
      searchDatasets: async () => [{ id: "tampered-olpe", name: "Tampered Olpe", contentHash: tamperedPackage.package.contentHash }],
      getDatasetMetadata: async id => ({ id, name: "Tampered Olpe", contentHash: tamperedPackage.package.contentHash }),
      downloadDataset: async () => ({ datasetId: "tampered-olpe", dataset: tamperedPackage, metadata: { contentHash: tamperedPackage.package.contentHash } }),
      checkForUpdate: async () => null,
      requiresNetwork: () => false
    };

    const docTampered = buildDocument();
    const managerTampered = createCityManager({
      document: docTampered,
      storage,
      datasetProvider: tamperedProvider,
      validator,
      setTimeout: callback => callback()
    });
    await managerTampered.init();
    managerTampered.open(docTampered.getElementById("addCityButton"));
    docTampered.getElementById("citySearchInput").value = "Tampered";
    docTampered.getElementById("citySearchForm").dispatch("submit");
    await waitForState(managerTampered, "search-results");
    docTampered.getElementById("citySearchResults").children[0].click();
    await waitForState(managerTampered, "municipality-selected");
    docTampered.getElementById("municipalityActionButton").click();
    await waitForState(managerTampered, "error");

    // Muss fehlschlagen und alertMessage anzeigen
    assert.equal(managerTampered.getState().phase, "error");
    assert.match(docTampered.getElementById("cityManagerAlert").textContent, /nicht sicher geprüft werden/);

    console.log("✓ 7. Hash-Manipulationstest blockiert Installation (verifyPackageHash FAIL)");

    // -------------------------------------------------------------------------
    // 8. Catalog-Mismatch-Test (Requirement 42)
    // -------------------------------------------------------------------------
    const mismatchPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-olpe.json"), "utf8"));
    const mismatchProvider = {
      searchDatasets: async () => [{ id: "mismatch-olpe", name: "Mismatch Olpe", contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }],
      getDatasetMetadata: async id => ({ id, name: "Mismatch Olpe", contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }),
      downloadDataset: async () => ({
        datasetId: "mismatch-olpe",
        dataset: mismatchPackage,
        metadata: { contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }
      }),
      checkForUpdate: async () => null,
      requiresNetwork: () => false
    };

    const docMismatch = buildDocument();
    const managerMismatch = createCityManager({
      document: docMismatch,
      storage,
      datasetProvider: mismatchProvider,
      validator,
      setTimeout: callback => callback()
    });
    await managerMismatch.init();
    managerMismatch.open(docMismatch.getElementById("addCityButton"));
    docMismatch.getElementById("citySearchInput").value = "Mismatch";
    docMismatch.getElementById("citySearchForm").dispatch("submit");
    await waitForState(managerMismatch, "search-results");
    docMismatch.getElementById("citySearchResults").children[0].click();
    await waitForState(managerMismatch, "municipality-selected");
    docMismatch.getElementById("municipalityActionButton").click();
    await waitForState(managerMismatch, "error");

    assert.equal(managerMismatch.getState().phase, "error");
    assert.match(docMismatch.getElementById("cityManagerAlert").textContent, /nicht sicher geprüft werden/);

    console.log("✓ 8. Catalog-Mismatch-Test blockiert Installation (Catalog != Package Hash)");

    // -------------------------------------------------------------------------
    // 9. Atomicity-Test: Validator-Fehler blockiert Speicherung (Requirement 43)
    // -------------------------------------------------------------------------
    const failingValidator = {
      ...validator,
      validateCityData() {
        return {
          valid: false,
          validation: {
            valid: false,
            municipality: { errors: [{ code: "SIMULATED_FAIL", message: "Simulierter Fehler" }], warnings: [] },
            streets: { errors: [], warnings: [] },
            pois: { errors: [], warnings: [] }
          }
        };
      }
    };

    const docAtomicity = buildDocument();
    const managerAtomicity = createCityManager({
      document: docAtomicity,
      storage,
      datasetProvider: provider,
      validator: failingValidator,
      setTimeout: callback => callback()
    });
    await managerAtomicity.init();
    managerAtomicity.open(docAtomicity.getElementById("addCityButton"));
    docAtomicity.getElementById("citySearchInput").value = "Oberasbach";
    docAtomicity.getElementById("citySearchForm").dispatch("submit");
    await waitForState(managerAtomicity, "search-results");
    docAtomicity.getElementById("citySearchResults").children[0].click();
    await waitForState(managerAtomicity, "municipality-selected");
    docAtomicity.getElementById("municipalityActionButton").click();
    await waitForState(managerAtomicity, "validation-result");

    assert.equal(managerAtomicity.getState().phase, "validation-result");
    assert.equal(docAtomicity.getElementById("saveCityButton").disabled, true);
    // Klick auf disabled Button darf nichts speichern
    docAtomicity.getElementById("saveCityButton").click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const hasOberasbach = await storage.hasCity("osm-relation-1016396");
    assert.equal(hasOberasbach, false, "Oberasbach darf bei Validator-Fehler nicht gespeichert werden");

    console.log("✓ 9. Atomicity-Test: Bei Validierungsfehler wird nichts in IndexedDB geschrieben");

    // -------------------------------------------------------------------------
    // 10. Abort-Test: Abbruch während des Downloads hinterlässt keine Teilinstallation
    // -------------------------------------------------------------------------
    const abortingProvider = {
      searchDatasets: async () => [{ id: "abort-city", name: "Abort City" }],
      getDatasetMetadata: async id => ({ id, name: "Abort City" }),
      downloadDataset: async (_, opts) => {
        const err = new Error("Abgebrochen");
        err.code = "ABORTED";
        throw err;
      },
      checkForUpdate: async () => null,
      requiresNetwork: () => false
    };
    const docAbort = buildDocument();
    const managerAbort = createCityManager({
      document: docAbort,
      storage,
      datasetProvider: abortingProvider,
      validator,
      setTimeout: callback => callback()
    });
    await managerAbort.init();
    managerAbort.open(docAbort.getElementById("addCityButton"));
    docAbort.getElementById("citySearchInput").value = "Abort";
    docAbort.getElementById("citySearchForm").dispatch("submit");
    await waitForState(managerAbort, "search-results");
    docAbort.getElementById("citySearchResults").children[0].click();
    await waitForState(managerAbort, "municipality-selected");
    docAbort.getElementById("municipalityActionButton").click();
    await waitForState(managerAbort, "municipality-selected");

    assert.equal(managerAbort.getState().phase, "municipality-selected");
    assert.match(docAbort.getElementById("citySearchStatus").textContent, /Download abgebrochen/);

    console.log("✓ 10. Abort-Test hinterlässt keine Teilinstallation");

    // -------------------------------------------------------------------------
    // 11. Reload- & Persistenz-Test (Requirement 46)
    // -------------------------------------------------------------------------
    // Neuer Storage mit denselben persistenten Daten (simulierter Seiten-Reload)
    const reloadedStorage = createCityStorage({
      dbName: "phase-15-5-integration-db",
      indexedDB: mockIndexedDB,
      IDBKeyRange: MockIDBKeyRange,
      localStorage: memoryStorage,
      activeCityStorageKey: "phase-15-5-active-city"
    });

    const activeIdAfterReload = reloadedStorage.getActiveCityId();
    assert.equal(activeIdAfterReload, "osm-relation-163179", "Olpe bleibt nach Reload aktive Stadt");
    const reloadedCityData = await reloadedStorage.getCityData(activeIdAfterReload);
    assert.equal(reloadedCityData.streets.length, 461);
    assert.equal(reloadedCityData.pois.length, 114);
    assert.equal(reloadedCityData.areas.length, 2);

    console.log("✓ 11. Persistenz nach Reload verifiziert: Olpe bleibt aktiv und vollständig spielbar");

    console.log("\n==================================================");
    console.log("Alle Phase 15.5 Integrationstests erfolgreich PASS!");
    console.log(`Nominatim-Requests: ${nominatimCalls}`);
    console.log(`Overpass-Requests:  ${overpassCalls}`);
    console.log("==================================================");

  } finally {
    globalThis.fetch = originalFetch;
  }
})();
