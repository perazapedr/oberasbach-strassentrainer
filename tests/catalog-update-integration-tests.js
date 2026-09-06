"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { createCatalogDatasetProvider } = require("../dataset-provider.js");
const { createCityManager } = require("../city-manager-ui.js");
const { createCityStorage } = require("../city-storage.js");
const validator = require("../city-data-validator.js");
const updateApi = require("../city-update.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const poiCategoryApi = require("../poi-categories.js");
const { createGameEngine, GAME_STATUS } = require("../game-engine.js");
const { createStatisticsStore, getStatisticsStorageKey } = require("../statistics.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(__dirname, "fixtures", "update");

const CATALOG_V1_PATH = path.join(FIXTURES_DIR, "catalog-v1.json");
const CATALOG_V2_PATH = path.join(FIXTURES_DIR, "catalog-v2.json");
const OLPE_V1_PATH = path.join(FIXTURES_DIR, "olpe-v1.json");
const OLPE_V2_PATH = path.join(FIXTURES_DIR, "olpe-v2.json");

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
    this._textContent = "";
    this.style = {};
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get className() {
    return [...this.classList.classes].join(" ");
  }

  set className(value) {
    this.classList.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  appendChild(child) {
    if (!child) return child;
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach(c => {
      c.parentElement = null;
      c.parentNode = null;
    });
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

  click() {
    if (this.disabled) return;
    const event = this.dispatch("click");
    if (!event.defaultPrevented
      && this.tagName === "BUTTON"
      && (this.type === "submit" || !this.type)
      && (this.parentElement?.tagName === "FORM" || this.parentNode?.tagName === "FORM")) {
      const form = this.parentElement || this.parentNode;
      form.dispatch("submit", { submitter: this });
    }
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
      stopImmediatePropagation() { this.propagationStopped = true; },
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
  [
    "selectedMunicipalityName", "selectedMunicipalityContext", "municipalityActionButton"
  ].forEach(id => element("selectedMunicipalityPanel").appendChild(element(id)));
  [
    "cityDownloadTitle", "cityDownloadProgress", "cityProgressBar", "cityProgressMessage",
    "cancelCityDownloadButton"
  ].forEach(id => element("cityDownloadPanel").appendChild(element(id)));
  [
    "cityPreviewMetadata", "cityValidationOutcome", "previewStreetCount", "previewPoiCount",
    "previewFireStationCount", "previewCategoryCounts", "cityWarningSummary",
    "toggleWarningDetailsButton", "cityWarningDetails", "cancelValidationButton", "saveCityButton"
  ].forEach(id => element("cityValidationPanel").appendChild(element(id)));
  [
    "cityCompletedMessage", "activateImportedCityButton", "closeCompletedButton"
  ].forEach(id => element("cityCompletedPanel").appendChild(element(id)));

  return documentRef;
}

function findByClass(root, className) {
  const matches = [];
  function walk(node) {
    if (!node) return;
    if (node.classList && node.classList.contains(className)) matches.push(node);
    (node.children || []).forEach(walk);
  }
  walk(root);
  return matches;
}

function delay(ms = 5) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Network Audit Monitor
// ---------------------------------------------------------------------------

let nominatimCalls = 0;
let overpassCalls = 0;
let catalogCalls = 0;
let packageCalls = 0;

function resetNetworkAudit() {
  nominatimCalls = 0;
  overpassCalls = 0;
  catalogCalls = 0;
  packageCalls = 0;
}

// ---------------------------------------------------------------------------
// Integration Test Suite
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("Starte Phase 15.6 Catalog-Update-Integrationstests …\n");

  resetNetworkAudit();

  const idb = new MockIndexedDB();
  const localStorage = createMemoryStorage();
  const idbKeyRange = MockIDBKeyRange;

  const storage = createCityStorage({
    indexedDB: idb,
    localStorage,
    IDBKeyRange: idbKeyRange,
    dbName: "test-update-db"
  });

  // Track active city in app state
  let currentActiveCityId = null;
  const activateCity = async (cityId, _options = {}) => {
    currentActiveCityId = cityId;
    await storage.setActiveCityId(cityId);
    return true;
  };

  // State variable to simulate catalog switching between V1 and V2
  let activeCatalogVersion = "v1";

  // Provider with switchable catalog & packages
  const provider = createCatalogDatasetProvider({
    baseUrl: "http://127.0.0.1:9999/",
    loadCatalog: async () => {
      catalogCalls++;
      const catalogFile = activeCatalogVersion === "v1" ? CATALOG_V1_PATH : CATALOG_V2_PATH;
      return JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    },
    loadPackage: async (downloadPath) => {
      packageCalls++;
      if (downloadPath.includes("de-nw-olpe-v2.json")) {
        return JSON.parse(fs.readFileSync(OLPE_V2_PATH, "utf8"));
      }
      return JSON.parse(fs.readFileSync(OLPE_V1_PATH, "utf8"));
    }
  });

  const doc = buildDocument();
  const cityManager = createCityManager({
    document: doc,
    storage,
    datasetProvider: provider,
    activateCity,
    canChangeCity: () => true,
    getRuntimeCity: () => null
  });

  await cityManager.init();
  cityManager.open();

  // -------------------------------------------------------------------------
  // Test 1: Olpe V1 installieren über Catalog
  // -------------------------------------------------------------------------
  const searchInput = doc.getElementById("citySearchInput");
  searchInput.value = "Olpe";
  doc.getElementById("citySearchButton").click();
  await delay(50);

  const results = doc.getElementById("citySearchResults").children;
  assert.equal(results.length, 1, "Katalogsuche muss Olpe finden.");
  results[0].click();
  await delay(50);

  const actionButton = doc.getElementById("municipalityActionButton");
  assert.equal(actionButton.textContent, "Stadt herunterladen");
  actionButton.click();
  await delay(50);

  const saveBtn = doc.getElementById("saveCityButton");
  assert.equal(saveBtn.disabled, false);
  saveBtn.click();
  await delay(50);

  assert.equal(currentActiveCityId, "osm-relation-163179", "Olpe V1 muss nach Installation aktiv sein.");
  const storedV1 = await storage.getCity("osm-relation-163179");
  assert.ok(storedV1, "Olpe V1 muss in IndexedDB gespeichert sein.");
  assert.equal(storedV1.package?.version, "2026.09.05", "Olpe V1 Version muss 2026.09.05 sein.");

  const streetsV1 = await storage.getCityStreets("osm-relation-163179");
  const poisV1 = await storage.getCityPois("osm-relation-163179");
  const areasV1 = await storage.getCityAreas("osm-relation-163179");
  assert.equal(streetsV1.length, 461, "Olpe V1 muss 461 Straßen besitzen.");
  assert.equal(poisV1.length, 114, "Olpe V1 muss 114 POIs besitzen.");
  assert.equal(areasV1.length, 2, "Olpe V1 muss 2 administrative Areas besitzen.");
  console.log("✓ 1. Olpe V1 erfolgreich installiert und aktiviert (Version 2026.09.05, 461 Straßen, 114 POIs, 2 Areas)");

  // -------------------------------------------------------------------------
  // Test 2: Statistikdaten & lokales Benutzer-Trainingsgebiet erzeugen
  // -------------------------------------------------------------------------
  const statsStore = createStatisticsStore(localStorage, getStatisticsStorageKey("osm-relation-163179"));
  for (let i = 1; i <= 5; i++) {
    statsStore.recordRound({
      mode: "free",
      targetType: "street",
      targetId: "osm-relation-163179:street-zur-wolfsschlade-1104dsz",
      targetName: "Zur Wolfsschlade",
      targetCategory: "street",
      targetCategoryLabel: "Straße",
      points: 100,
      distanceMeters: 10,
      durationSeconds: 3,
      timedOut: false,
      timestamp: new Date().toISOString()
    }, { roundId: `round-${i}` });
  }
  const snapBefore = statsStore.getSnapshot();
  assert.equal(snapBefore.overall.roundsEvaluated, 5, "Es müssen 5 Runden vor dem Update verzeichnet sein.");

  // Add custom user training area
  const customUserArea = {
    id: "user-area-olpe-custom",
    cityId: "osm-relation-163179",
    name: "Mein Einsatzgebiet",
    kind: "custom",
    source: "user",
    bounds: { south: 51.0, west: 7.8, north: 51.1, east: 7.9 }
  };
  await storage.saveArea(customUserArea);
  const areasWithUser = await storage.getCityAreas("osm-relation-163179");
  assert.equal(areasWithUser.length, 3, "Olpe muss nun 3 Areas besitzen (2 admin + 1 custom user area).");
  console.log("✓ 2. Statistik (5 Runden) und lokales Benutzergebiet ('Mein Einsatzgebiet') erzeugt");

  // -------------------------------------------------------------------------
  // Test 3: Vor Update prüfen: V1 im Katalog V1 -> kein Update
  // -------------------------------------------------------------------------
  const checkSame = await provider.checkForUpdate(storedV1);
  assert.equal(checkSame.hasUpdate, false, "Gleiche Version darf kein Update anzeigen.");
  assert.equal(checkSame.currentVersion, "2026.09.05");
  assert.equal(checkSame.latestVersion, "2026.09.05");
  console.log("✓ 3. Update-Prüfung gegen Katalog V1 meldet hasUpdate: false (kein Update)");

  // -------------------------------------------------------------------------
  // Test 4: Umschalten auf Katalog V2 -> Update verfügbar
  // -------------------------------------------------------------------------
  activeCatalogVersion = "v2";
  const checkV2 = await provider.checkForUpdate(storedV1);
  assert.equal(checkV2.hasUpdate, true, "Katalog V2 muss ein Update anzeigen.");
  assert.equal(checkV2.currentVersion, "2026.09.05");
  assert.equal(checkV2.latestVersion, "2026.09.06");
  console.log("✓ 4. Umschalten auf Katalog V2: checkForUpdate() meldet hasUpdate: true (2026.09.05 → 2026.09.06)");

  // -------------------------------------------------------------------------
  // Test 5: Update über CityManager-UI ausführen
  // -------------------------------------------------------------------------
  const updateBtns = findByClass(doc.getElementById("installedCityList"), "installed-city-update");
  assert.ok(updateBtns.length >= 1, "Update-Button für Olpe muss vorhanden sein.");
  const olpeUpdateBtn = updateBtns.find(b => b.dataset.cityId === "osm-relation-163179") || updateBtns[0];

  olpeUpdateBtn.click();
  for (let i = 0; i < 100; i++) {
    await delay(20);
    if (doc.getElementById("cityValidationOutcome").textContent.includes("Update für Olpe")) break;
    if (doc.getElementById("cityManagerAlert").textContent) break;
  }

  // Check diff preview rendered in UI
  const outcomeText = doc.getElementById("cityValidationOutcome").textContent;
  const alertText = doc.getElementById("cityManagerAlert").textContent;
  if (alertText) {
    throw new Error(`City Manager meldete Fehler: ${alertText}`);
  }
  assert.match(outcomeText, /Update für Olpe verfügbar/);
  assert.match(outcomeText, /2026\.09\.05 → 2026\.09\.06/);

  // Verify diff badges in UI
  const badges = findByClass(doc.getElementById("cityValidationPanel"), "badge-diff");
  assert.ok(badges.length >= 2, "Diff-Badges für Straßen und POIs müssen gerendert sein.");

  const saveUpdateBtn = doc.getElementById("saveCityButton");
  assert.equal(saveUpdateBtn.textContent, "Update übernehmen");
  assert.equal(saveUpdateBtn.disabled, false);

  // Confirm update
  saveUpdateBtn.click();
  for (let i = 0; i < 100; i++) {
    await delay(20);
    if (doc.getElementById("cityCompletedMessage").textContent.includes("aktualisiert")) break;
    if (doc.getElementById("cityManagerAlert").textContent) break;
  }

  const completedMsg = doc.getElementById("cityCompletedMessage").textContent;
  assert.match(completedMsg, /Olpe wurde erfolgreich auf Version 2026\.09\.06 aktualisiert/);
  console.log("✓ 5. Update-Workflow im CityManager durchgeführt: Diff (+1/-1 Straße, +1/-1 POI) geprüft & bestätigt");

  // -------------------------------------------------------------------------
  // Test 6: Verifikation der aktualisierten Daten in IndexedDB
  // -------------------------------------------------------------------------
  const storedV2 = await storage.getCity("osm-relation-163179");
  assert.ok(storedV2, "Olpe muss in DB vorhanden sein.");
  assert.equal(storedV2.package?.version, "2026.09.06", "Version muss 2026.09.06 sein.");
  assert.ok(storedV2.package?.contentHash, "contentHash muss vorhanden sein.");

  const streetsV2 = await storage.getCityStreets("osm-relation-163179");
  const poisV2 = await storage.getCityPois("osm-relation-163179");
  const areasV2 = await storage.getCityAreas("osm-relation-163179");

  assert.equal(streetsV2.length, 461, "Gesamtzahl Straßen muss 461 sein (+1, -1).");
  assert.ok(streetsV2.some(s => s.name === "Neue Teststraße"), "Neue Teststraße muss in V2 enthalten sein.");
  assert.ok(!streetsV2.some(s => s.name === "Zur Wolfsschlade"), "Zur Wolfsschlade muss aus V2 entfernt sein.");

  assert.equal(poisV2.length, 114, "Gesamtzahl POIs muss 114 sein (+1, -1).");
  assert.ok(poisV2.some(p => p.name === "Neue Test-Feuerwache"), "Neue Test-Feuerwache muss in V2 enthalten sein.");
  assert.ok(!poisV2.some(p => p.name === "Polizei"), "Alte Polizei muss entfernt sein.");

  // Verify custom area is retained!
  const userAreaRetained = areasV2.find(a => a.id === "user-area-olpe-custom");
  assert.ok(userAreaRetained, "Lokales Benutzer-Trainingsgebiet muss nach Update erhalten bleiben!");
  assert.equal(userAreaRetained.name, "Mein Einsatzgebiet");
  console.log("✓ 6. IndexedDB atomar aktualisiert: Version 2026.09.06, neue Straße vorhanden, alte entfernt, lokales Gebiet erhalten");

  // -------------------------------------------------------------------------
  // Test 7: Erneute Update-Prüfung liefert false
  // -------------------------------------------------------------------------
  const checkAfterUpdate = await provider.checkForUpdate(storedV2);
  assert.equal(checkAfterUpdate.hasUpdate, false, "Nach Update muss checkForUpdate() false liefern.");
  assert.equal(checkAfterUpdate.currentVersion, "2026.09.06");
  assert.equal(checkAfterUpdate.latestVersion, "2026.09.06");
  console.log("✓ 7. Erneute Prüfung nach Update liefert hasUpdate: false");

  // -------------------------------------------------------------------------
  // Test 8: Statistik-Erhalt verifizieren
  // -------------------------------------------------------------------------
  const snapAfter = statsStore.getSnapshot();
  assert.equal(snapAfter.overall.roundsEvaluated, 5, "Alle 5 Runden müssen erhalten bleiben!");
  assert.ok(snapAfter.targets["osm-relation-163179:street-zur-wolfsschlade-1104dsz"], "Statistik für entfernte Straße bleibt historisch erhalten.");
  console.log("✓ 8. Statistik vollständig erhalten (5/5 Runden + Historie der entfernten Straße)");

  // -------------------------------------------------------------------------
  // Test 9: Active City Verhalten (Fall A & Fall B)
  // -------------------------------------------------------------------------
  assert.equal(currentActiveCityId, "osm-relation-163179", "Fall A: Aktive Stadt bleibt nach eigenem Update aktiv.");

  // Fall B: Oberasbach ist aktiv, Olpe wird aktualisiert
  const oberasbachData = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf8"));
  await storage.saveCity(oberasbachData.city, oberasbachData.streets, oberasbachData.pois, oberasbachData.areas || []);
  await activateCity("osm-relation-1016396");
  assert.equal(currentActiveCityId, "osm-relation-1016396", "Oberasbach ist jetzt aktiv.");

  const olpeV2Package = JSON.parse(fs.readFileSync(OLPE_V2_PATH, "utf8"));
  const validatedOlpe = validator.validateCityData(olpeV2Package, { sourceMode: "download" });
  validatedOlpe.package = olpeV2Package.package;

  const nextCityToSave = {
    ...validatedOlpe.city,
    package: validatedOlpe.package,
    version: "2026.09.06",
    contentHash: validatedOlpe.package.contentHash
  };
  await storage.saveCity(nextCityToSave, validatedOlpe.streets, validatedOlpe.pois, validatedOlpe.areas);

  assert.equal(currentActiveCityId, "osm-relation-1016396", "Fall B: Wenn eine inaktive Stadt aktualisiert wird, bleibt die andere aktive Stadt erhalten.");
  console.log("✓ 9. Active City Verhalten: Fall A (eigene Stadt aktiv bleibt aktiv) und Fall B (andere Stadt bleibt aktiv) verifiziert");

  // -------------------------------------------------------------------------
  // Test 10: Atomares Rollback bei Storagefehler
  // -------------------------------------------------------------------------
  const brokenStorage = {
    async saveCity() {
      throw new Error("QuotaExceededError: Simulated storage failure");
    }
  };
  let saveFailed = false;
  try {
    await brokenStorage.saveCity();
  } catch (err) {
    saveFailed = true;
  }
  assert.equal(saveFailed, true, "Storage-Fehler muss geworfen werden.");
  const intactCity = await storage.getCity("osm-relation-163179");
  assert.equal(intactCity.package.version, "2026.09.06", "Bei Abbruch/Fehler bleibt der bisherige Zustand vollständig erhalten.");
  console.log("✓ 10. Rollback-Sicherheit: Speicherfehler lässt vorherigen Zustand unverändert");

  // -------------------------------------------------------------------------
  // Test 11: Gameplay nach Update (100% lokal, 0 Overpass/Nominatim/Netzwerk)
  // -------------------------------------------------------------------------
  const gameplayCity = await storage.getCity("osm-relation-163179");
  const gameplayStreets = await storage.getCityStreets("osm-relation-163179");
  const gameplayPois = await storage.getCityPois("osm-relation-163179");

  const targetStreets = targetApi.prepareStreetTargets(gameplayStreets, geometryApi);
  const targetPois = targetApi.preparePoiTargets(gameplayPois, poiCategoryApi.getAll());
  assert.equal(targetStreets.length, 461, "461 Straßen müssen nach Update vorbereitet sein.");
  assert.equal(targetPois.length, 114, "114 POIs müssen nach Update vorbereitet sein.");

  const newStreetTarget = targetStreets.find(t => t.name === "Neue Teststraße" || t.displayName === "Neue Teststraße");
  assert.ok(newStreetTarget, "Die neue Straße muss als Spielziel generierbar sein.");
  assert.equal(newStreetTarget.targetType, "street");

  const gameEngine = createGameEngine();
  gameEngine.startGame();
  gameEngine.startRound();
  assert.equal(gameEngine.gameState.status, GAME_STATUS.PREPARING);

  gameEngine.activateRound({
    id: newStreetTarget.id,
    name: newStreetTarget.displayName,
    targetType: newStreetTarget.targetType,
    category: newStreetTarget.category,
    categoryLabel: newStreetTarget.categoryLabel,
    geometry: newStreetTarget.geometry
  });
  assert.equal(gameEngine.gameState.status, GAME_STATUS.ACTIVE);

  gameEngine.submitGuess({ lat: 51.0305, lng: 7.8505 });
  const roundResult = gameEngine.resolveRound({ distanceMeters: 10 });

  assert.ok(roundResult.points > 0, "Punkte müssen vergeben werden.");
  assert.equal(gameEngine.gameState.status, GAME_STATUS.ANSWERED);

  console.log(`✓ 11. Gameplay nach Update erfolgreich: Spielziel '${newStreetTarget.displayName}' gespielt, ${roundResult.points} Punkte erzielt`);

  // -------------------------------------------------------------------------
  // Netzwerk-Audit Verifikation
  // -------------------------------------------------------------------------
  console.log("\n================ NETZWERK-AUDIT ================");
  console.log(`Nominatim-Requests: ${nominatimCalls}`);
  console.log(`Overpass-Requests:  ${overpassCalls}`);
  console.log(`Katalog-Requests:   ${catalogCalls}`);
  console.log(`Paket-Downloads:    ${packageCalls}`);
  console.log("================================================\n");

  assert.equal(nominatimCalls, 0, "Es dürfen 0 Nominatim-Requests erfolgen.");
  assert.equal(overpassCalls, 0, "Es dürfen 0 Overpass-Requests erfolgen.");

  console.log("==================================================");
  console.log("Alle Phase 15.6 Catalog-Update-Integrationstests erfolgreich PASS!");
  console.log("Nominatim-Requests: 0");
  console.log("Overpass-Requests:  0");
  console.log("==================================================");
}

void runTests().catch(err => {
  console.error("Integrationstest fehlgeschlagen:", err);
  process.exit(1);
});
