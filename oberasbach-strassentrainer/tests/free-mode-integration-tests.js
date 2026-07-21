"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const geometryApi = require("../geometry.js");
const targetApi = require("../targets.js");
const statisticsApi = require("../statistics.js");
const engineApi = require("../game-engine.js");
let deadlineTimerHarness = null;
const timerApi = {
  createDeadlineTimer(options) {
    let running = false;
    deadlineTimerHarness = {
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
      isRunning() { return running; },
      expire() {
        if (!running) return;
        running = false;
        options.onTick({ remainingMs: 0, remainingSeconds: 0, urgent: false });
        options.onExpire();
      }
    };
    return deadlineTimerHarness;
  }
};

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.contains(value) : force;
    if (enabled) this.add(value); else this.remove(value);
    return enabled;
  }
}

class Element {
  constructor() {
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.checked = false;
    this.dataset = {};
    this.classList = new ClassList();
    this.style = {};
    this.value = "";
  }
  addEventListener(type, listener) { this[`on${type}`] = listener; }
  closest() { return this; }
}

function createLayer(kind, data, options = {}) {
  return {
    kind,
    data,
    options,
    addTo(group) { group.layers.push(this); return this; },
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

async function nextTask() {
  await new Promise(resolve => setImmediate(resolve));
}

const elementIds = [
  "targetStreet", "instruction", "mainButton", "resultCard", "resultTitle",
  "distanceValue", "scoreValue", "resultMessage", "roundValue",
  "totalScoreValue", "statusCard", "statusText", "mapHint", "modeCard",
  "modeSelect", "timedSettings", "secondsPerRoundSelect", "totalRoundsSelect",
  "contentSelectionSelect", "showTargetCategoryCheckbox", "poiCategoryDetails",
  "poiCategoryOptions", "targetCategoryLabel", "timerPanel", "timerValue", "timerProgress",
  "endGameButton", "summaryCard", "summaryTotalPoints", "summaryAveragePoints",
  "summaryAverageDistance", "summaryAverageTime", "summaryTimeouts",
  "summaryHitRate", "summaryTotalDuration", "summaryBestRound",
  "summaryWorstRound", "repeatTimedButton", "scorePointsPanel",
  "summaryTargetBreakdown",
  "examResultsCard", "examAwardCard", "examAwardSymbol", "examAwardName",
  "examAwardPercentage", "examAwardDescription", "examTotalPoints",
  "examMaximumPoints", "examPercentage",
  "examAverageDistance", "examAverageTime", "examHitRate", "examUnanswered",
  "examBestRound", "examWorstRound", "examTaskList",
  "examTargetBreakdown",
  "returnToExamResultsButton", "legendCard", "mapPanel", "statisticsDetails",
  "statisticsModeFilter", "statisticsTargetFilter", "statisticsOverview",
  "statisticsBestTarget", "statisticsWorstTarget", "statisticsMostPlayedTarget",
  "statisticsHighestExam", "statisticsHighestRank", "statisticsLastPlayed",
  "statisticsImportStrategy", "statisticsExportButton", "statisticsImportButton",
  "statisticsResetButton", "statisticsImportInput", "statisticsMessage"
];
const elements = Object.fromEntries(elementIds.map(id => [id, new Element()]));
const alarmCard = new Element();
const document = {
  hidden: false,
  getElementById: id => elements[id],
  querySelector: selector => selector === ".alarm-card" ? alarmCard : null,
  addEventListener() {}
};
elements.modeSelect.value = "free";
elements.secondsPerRoundSelect.value = "30";
elements.totalRoundsSelect.value = "10";
elements.contentSelectionSelect.value = "streets";
elements.statisticsModeFilter.value = "all";
elements.statisticsTargetFilter.value = "all";
elements.statisticsImportStrategy.value = "merge";

const storageValues = new Map();
const localStorage = {
  getItem: key => storageValues.get(key) || null,
  setItem: (key, value) => storageValues.set(key, String(value))
};

const rawStreets = Array.from({ length: 30 }, (_, index) => ({
  name: `Teststraße ${index + 1}`,
  aliases: []
}));
const poiCategories = [
  { id: "school", label: "Schule" },
  { id: "public-facility", label: "Öffentliche Einrichtung" }
];
const rawPois = [
  { id: "poi-school-test-1", displayName: "Testschule 1", category: "school", latitude: 49.425, longitude: 10.955 },
  { id: "poi-school-test-2", displayName: "Testschule 2", category: "school", latitude: 49.426, longitude: 10.956 },
  { id: "poi-public-test", displayName: "Testrathaus", category: "public-facility", latitude: 49.427, longitude: 10.957 }
];
const preparedStreets = geometryApi.prepareStreetRecords(rawStreets);
const geometryCache = {};
preparedStreets.forEach((street, index) => {
  geometryCache[street.id] = {
    savedAt: Date.now(),
    geometry: {
      streetId: street.id,
      displayName: street.displayName,
      type: "MultiLineString",
      sections: [[[10.94 + index * 0.0001, 49.42], [10.945 + index * 0.0001, 49.42]]],
      source: "test",
      featureIds: [`way/${index + 1}`],
      sourceGeometryTypes: ["LineString"]
    }
  };
});
localStorage.setItem(
  "oberasbach-strassentrainer-geometrien-v3-vollstaendig",
  JSON.stringify(geometryCache)
);

const mapObject = {
  handlers: {},
  fitBounds() {},
  createPane() { return { style: {} }; },
  on(type, listener) { this.handlers[type] = listener; }
};
const tileLayers = [];
const L = {
  latLngBounds: () => ({ contains: () => true, pad() { return this; }, isValid: () => true }),
  map: () => mapObject,
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

const turf = {
  point: coordinates => ({ geometry: { coordinates } }),
  lineString: coordinates => ({ geometry: { coordinates } }),
  pointToLineDistance: () => 125,
  nearestPointOnLine: line => ({ geometry: { coordinates: line.geometry.coordinates[0] } })
};

const deterministicMath = Object.create(Math);
deterministicMath.random = () => 0;
const windowHandlers = {};
const confirmResponses = [];
const historyCalls = { pushes: 0, backs: 0 };
const windowObject = {
  StreetGeometry: geometryApi,
  StrassentrainerTargets: targetApi,
  StrassentrainerStatistics: statisticsApi,
  StrassentrainerEngine: engineApi,
  StrassentrainerTimer: timerApi,
  OBERASBACH_STREETS: rawStreets,
  OBERASBACH_POI_CATEGORIES: poiCategories,
  OBERASBACH_POIS: rawPois,
  location: { search: "", href: "https://example.test/strassentrainer/" },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  confirm: () => confirmResponses.length ? confirmResponses.shift() : true,
  history: {
    pushState() { historyCalls.pushes += 1; },
    back() { historyCalls.backs += 1; }
  },
  addEventListener(type, listener) { windowHandlers[type] = listener; }
};
const context = {
  console,
  document,
  localStorage,
  L,
  turf,
  window: windowObject,
  URLSearchParams,
  AbortController,
  fetch: async () => { throw new Error("Cache sollte einen Netzaufruf verhindern"); },
  Math: deterministicMath
};
context.globalThis = context;

const source = `${fs.readFileSync(require.resolve("../app.js"), "utf8")}
globalThis.__appTest = {
  solutionLayers,
  answerLayers,
  fireStationLayers,
  getInternalState: () => gameState
};`;
vm.runInNewContext(source, context, { filename: "app.js" });

(async () => {
  const debug = windowObject.STRASSENTRAINER_DEBUG;
  let state = debug.getGameState();
  assert.equal(state.status, "idle");
  assert.equal(state.config.mode, "free");
  assert.equal(elements.mainButton.textContent, "Ersten Alarm auslösen");
  assert.equal(debug.getStatistics().overall.gamesStarted, 0,
    "Ein bloßer Seitenaufruf darf noch kein gestartetes Spiel zählen");
  assert.equal(tileLayers.length, 2, "Beide vorhandenen beschriftungsfreien Kartenebenen bleiben aktiv");
  assert.equal(context.__appTest.fireStationLayers.layers.length, 3);

  elements.mainButton.onclick();
  await nextTask();
  state = debug.getGameState();
  assert.equal(state.status, "active");
  assert.equal(state.currentRound.roundNumber, 1);
  assert.equal(debug.getStatistics().overall.gamesStarted, 1);
  assert.equal(elements.mainButton.textContent, "Alarm überspringen");

  mapObject.handlers.click({ latlng: { lat: 49.42, lng: 10.942 } });
  state = debug.getGameState();
  assert.equal(state.status, "answered");
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].mode, "free");
  assert.equal(state.results[0].targetCategory, "street");
  assert.equal(state.results[0].distanceMeters, 125);
  assert.deepEqual(state.results[0].guessCoordinates, { lat: 49.42, lng: 10.942 });
  assert.ok(Number.isFinite(state.results[0].durationSeconds));
  assert.equal(typeof state.results[0].timedOut, "boolean");
  assert.ok(state.results[0].timestamp);
  assert.equal(elements.roundValue.textContent, "1");
  assert.equal(elements.scoreValue.textContent, state.results[0].points.toLocaleString("de-DE"));
  assert.equal(context.__appTest.solutionLayers.layers.length, 1);
  assert.equal(context.__appTest.answerLayers.layers.length, 3);

  elements.mainButton.onclick();
  await nextTask();
  assert.equal(debug.getGameState().status, "active");
  assert.equal(debug.getGameState().currentRound.roundNumber, 2);

  elements.mainButton.onclick();
  await nextTask();
  state = debug.getGameState();
  assert.equal(state.status, "active");
  assert.equal(state.currentRound.roundNumber, 2);
  assert.equal(state.results.length, 1, "Überspringen darf keine beantwortete Runde erzeugen");

  const statistics = debug.getStatistics();
  assert.equal(statistics.schemaVersion, 2);
  assert.equal(statistics.overall.roundsEvaluated, 1);
  assert.equal(statistics.modes.free.roundsEvaluated, 1);
  assert.ok(elements.statisticsOverview.innerHTML.includes("Ausgewertete Aufgaben"));
  elements.statisticsModeFilter.value = "free";
  elements.statisticsModeFilter.onchange();
  elements.statisticsTargetFilter.value = "street";
  elements.statisticsTargetFilter.onchange();
  assert.equal(debug.getStatisticsView({ mode: "free", targetType: "street" })
    .statistics.roundsEvaluated, 1);
  elements.statisticsModeFilter.value = "all";
  elements.statisticsTargetFilter.value = "all";

  elements.modeSelect.value = "timed";
  elements.modeSelect.onchange();
  assert.equal(debug.getGameState().status, "idle");
  assert.equal(elements.mainButton.textContent, "Training starten");
  elements.secondsPerRoundSelect.value = "15";
  elements.totalRoundsSelect.value = "10";
  elements.mainButton.onclick();
  assert.equal(deadlineTimerHarness.isRunning(), false,
    "Während der Vorbereitung darf noch kein Countdown laufen");
  await nextTask();
  state = debug.getGameState();
  assert.equal(state.status, "active");
  assert.equal(state.config.mode, "timed");
  assert.equal(state.config.secondsPerRound, 15);
  assert.equal(state.config.totalRounds, 10);
  assert.equal(state.config.autoAdvanceDelaySeconds, null);
  assert.equal(deadlineTimerHarness.isRunning(), true,
    "Der Countdown startet erst nach vollständiger Aktivierung");

  mapObject.handlers.click({ latlng: { lat: 49.42, lng: 10.942 } });
  assert.equal(debug.getGameState().status, "answered");
  assert.equal(deadlineTimerHarness.isRunning(), false);
  assert.equal(elements.mainButton.textContent, "Nächste Aufgabe");
  await nextTask();
  assert.equal(debug.getGameState().status, "answered",
    "Die nächste Zeitaufgabe darf erst nach dem Buttonklick beginnen");

  for (let roundNumber = 2; roundNumber <= 9; roundNumber += 1) {
    elements.mainButton.onclick();
    await nextTask();
    assert.equal(debug.getGameState().status, "active");
    assert.equal(debug.getGameState().currentRound.roundNumber, roundNumber);
    mapObject.handlers.click({ latlng: { lat: 49.42, lng: 10.942 } });
    assert.equal(debug.getGameState().status, "answered");
  }

  elements.mainButton.onclick();
  await nextTask();
  assert.equal(debug.getGameState().currentRound.roundNumber, 10);
  deadlineTimerHarness.expire();
  state = debug.getGameState();
  assert.equal(state.status, "answered");
  assert.equal(state.results.length, 10);
  assert.equal(state.results[9].timedOut, true);
  assert.equal(state.results[9].points, 0);
  assert.equal(state.results[9].distanceMeters, null);
  assert.equal(state.results[9].guessCoordinates, null,
    "Ein Timeout darf keine erfundene Tippkoordinate speichern");

  elements.mainButton.onclick();
  state = debug.getGameState();
  assert.equal(state.status, "finished");
  assert.equal(state.summary.roundCount, 10);
  assert.equal(state.summary.timeoutCount, 1);
  assert.equal(elements.summaryCard.classList.contains("hidden"), false);

  elements.repeatTimedButton.onclick();
  await nextTask();
  state = debug.getGameState();
  assert.equal(state.status, "active");
  assert.equal(state.config.secondsPerRound, 15);
  assert.equal(state.config.totalRounds, 10);
  elements.endGameButton.onclick();
  assert.equal(debug.getGameState().status, "finished");
  assert.equal(deadlineTimerHarness.isRunning(), false,
    "Beim vorzeitigen Abbruch muss der Rundentimer gestoppt werden");

  const statisticsBeforeExam = debug.getStatistics();
  elements.modeSelect.value = "exam";
  elements.modeSelect.onchange();
  assert.equal(elements.mainButton.textContent, "Prüfung starten");
  elements.secondsPerRoundSelect.value = "15";
  elements.totalRoundsSelect.value = "10";
  elements.mainButton.onclick();
  assert.equal(deadlineTimerHarness.isRunning(), false,
    "Auch die Prüfungszeit beginnt nicht während der Vorbereitung");
  await nextTask();
  state = debug.getGameState();
  assert.equal(state.status, "active");
  assert.equal(state.config.mode, "exam");
  assert.equal(deadlineTimerHarness.isRunning(), true);
  assert.equal(state.results.length, 0,
    "Auch die Debugschnittstelle darf laufende Prüfungsergebnisse nicht offenlegen");
  assert.equal(state.totalScore, null);
  assert.equal(elements.scorePointsPanel.classList.contains("hidden"), true,
    "Der Zwischenstand der Gesamtpunkte muss verborgen bleiben");
  assert.equal(debug.getStatistics().modes.exam.gamesStarted,
    statisticsBeforeExam.modes.exam.gamesStarted + 1);
  assert.equal(debug.getStatistics().modes.exam.roundsEvaluated,
    statisticsBeforeExam.modes.exam.roundsEvaluated,
    "Laufende Prüfungsrunden dürfen noch nicht dauerhaft aggregiert werden");

  for (let roundNumber = 1; roundNumber <= 9; roundNumber += 1) {
    mapObject.handlers.click({ latlng: { lat: 49.42, lng: 10.942 } });
    state = context.__appTest.getInternalState();
    assert.equal(state.results.length, roundNumber);
    assert.equal(state.status, "preparing");
    assert.equal(elements.resultCard.classList.contains("hidden"), true);
    assert.equal(context.__appTest.solutionLayers.layers.length, 0,
      "Während der Prüfung darf keine Zielstraße markiert werden");
    assert.equal(context.__appTest.answerLayers.layers.length, 0,
      "Während der Prüfung dürfen Tipp und Verbindung nicht sichtbar sein");
    await nextTask();
    assert.equal(debug.getGameState().status, "active");
  }

  deadlineTimerHarness.expire();
  state = debug.getGameState();
  assert.equal(state.status, "finished");
  assert.equal(state.results.length, 10);
  assert.equal(state.results[9].guessCoordinates, null);
  assert.equal(state.summary.maximumPossiblePoints, 10000);
  assert.equal(state.summary.unansweredCount, 1);
  assert.ok(Number.isFinite(state.summary.percentage));
  assert.ok(state.summary.award, "Das gespeicherte Prüfungsergebnis muss die Auszeichnung enthalten");
  assert.equal(elements.examAwardName.textContent, state.summary.award.name);
  assert.equal(elements.examAwardSymbol.textContent, state.summary.award.symbol);
  assert.ok(elements.examAwardPercentage.textContent.endsWith("%"));
  assert.equal(elements.examAwardDescription.textContent, state.summary.award.description);
  assert.equal(elements.examResultsCard.classList.contains("hidden"), false);
  assert.equal(elements.scorePointsPanel.classList.contains("hidden"), false);
  assert.equal((elements.examTaskList.innerHTML.match(/Auf Karte ansehen/g) || []).length, 10);
  const statisticsAfterCompletedExam = debug.getStatistics();
  assert.equal(statisticsAfterCompletedExam.modes.exam.gamesCompleted,
    statisticsBeforeExam.modes.exam.gamesCompleted + 1);
  assert.equal(statisticsAfterCompletedExam.modes.exam.roundsEvaluated,
    statisticsBeforeExam.modes.exam.roundsEvaluated + 10);
  assert.equal(statisticsAfterCompletedExam.exam.highestAward.name, state.summary.award.name);
  assert.equal(statisticsAfterCompletedExam.exam.highestPercentageBasisPoints,
    state.summary.award.percentageBasisPoints);

  debug.showExamRound(1);
  assert.equal(context.__appTest.solutionLayers.layers.length, 1);
  assert.equal(context.__appTest.answerLayers.layers.length, 3);
  assert.equal(elements.returnToExamResultsButton.classList.contains("hidden"), false);
  elements.returnToExamResultsButton.onclick();
  assert.equal(context.__appTest.solutionLayers.layers.length, 0);
  assert.equal(context.__appTest.answerLayers.layers.length, 0);

  debug.showExamRound(10);
  assert.equal(context.__appTest.solutionLayers.layers.length, 1,
    "Auch eine unbeantwortete Aufgabe zeigt nach Prüfungsende die Zielstraße");
  assert.equal(context.__appTest.answerLayers.layers.length, 0,
    "Ohne Tipp darf nachträglich keine Tippmarkierung erfunden werden");

  elements.mainButton.onclick();
  await nextTask();
  assert.equal(debug.getGameState().status, "active");
  const statisticsAfterSecondExamStart = JSON.stringify(debug.getStatistics());
  const unloadEvent = {
    returnValue: null,
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
  windowHandlers.beforeunload(unloadEvent);
  assert.equal(unloadEvent.prevented, true,
    "Ein Neuladen während der Prüfung muss eine Browserwarnung auslösen");

  confirmResponses.push(false);
  elements.modeSelect.value = "timed";
  elements.modeSelect.onchange();
  assert.equal(debug.getGameState().status, "active");
  assert.equal(elements.modeSelect.value, "exam",
    "Ein abgelehnter Moduswechsel muss in der Prüfung bleiben");

  const pushesBeforeCancelledBack = historyCalls.pushes;
  confirmResponses.push(false);
  windowHandlers.popstate();
  assert.equal(debug.getGameState().status, "active");
  assert.equal(historyCalls.pushes, pushesBeforeCancelledBack + 1,
    "Abgelehnte Zurücknavigation muss den Prüfungswächter wiederherstellen");

  windowHandlers.pagehide();
  assert.equal(context.__appTest.getInternalState().status, "active");
  assert.equal(context.__appTest.getInternalState().results.length, 0,
    "Das Verlassen darf nie selbständig ein Prüfungsergebnis erzeugen");

  confirmResponses.push(false);
  elements.endGameButton.onclick();
  assert.equal(debug.getGameState().status, "active",
    "Abbruch darf nach abgelehnter Sicherheitsabfrage nicht erfolgen");
  confirmResponses.push(true);
  elements.endGameButton.onclick();
  assert.equal(debug.getGameState().status, "idle");
  assert.equal(deadlineTimerHarness.isRunning(), false);
  assert.equal(JSON.stringify(debug.getStatistics()), statisticsAfterSecondExamStart,
    "Der Abbruch speichert keine unvollständigen Prüfungsrunden und keinen Abschluss");

  elements.modeSelect.value = "free";
  elements.modeSelect.onchange();
  elements.contentSelectionSelect.value = "pois";
  elements.contentSelectionSelect.onchange();
  assert.equal(debug.getContentSettings().contentSelection, "pois");
  assert.ok(localStorage.getItem("oberasbach-strassentrainer-inhalt-v1"),
    "Die Inhaltsauswahl muss für den nächsten Besuch gespeichert werden");
  elements.showTargetCategoryCheckbox.checked = false;
  elements.showTargetCategoryCheckbox.onchange();
  elements.mainButton.onclick();
  await nextTask();
  state = debug.getGameState();
  assert.equal(state.currentRound.target.targetType, "poi");
  assert.equal(elements.targetCategoryLabel.classList.contains("hidden"), true,
    "Die POI-Kategorie muss für schwierigere Alarme ausblendbar sein");
  mapObject.handlers.click({ latlng: { lat: 49.4251, lng: 10.9551 } });
  state = debug.getGameState();
  assert.equal(state.results[0].targetType, "poi");
  assert.equal(debug.getStatistics().targetTypes.poi.roundsEvaluated, 1,
    "Die dauerhafte Statistik muss POIs separat aggregieren");
  assert.equal(context.__appTest.solutionLayers.layers[0].kind, "marker");
  assert.equal(context.__appTest.answerLayers.layers.length, 2,
    "POI-Auflösung zeigt Tipp und Verbindung, aber keinen doppelten Zielpunkt");
  const schoolCategoryCheckbox = new Element();
  schoolCategoryCheckbox.dataset.poiCategory = "school";
  schoolCategoryCheckbox.checked = false;
  elements.poiCategoryOptions.onchange({ target: schoolCategoryCheckbox });
  assert.deepEqual(debug.getContentSettings().poiCategories, ["public-facility"],
    "Einzelne POI-Kategorien müssen deaktivierbar und gespeichert sein");

  elements.contentSelectionSelect.value = "mixed";
  elements.contentSelectionSelect.onchange();
  elements.mainButton.onclick();
  await nextTask();
  assert.equal(debug.getGameState().currentRound.target.targetType, "street",
    "Die gemischte Auswahl gleicht nach einem POI zunächst den Straßentyp aus");

  console.log("Integrationstests für Freien Modus, Zeitmodus und Prüfungsmodus erfolgreich:");
  console.log("- Initialisierung, Alarm, Tipp, Auswertung und nächste Runde");
  console.log("- vollständiges Rundenergebnis im zentralen gameState");
  console.log("- Karte, Ergebnislayer, Punktestand und Überspringen unverändert");
  console.log("- dauerhafte Statistik ohne sichtbare Designänderung");
  console.log("- Timerstart nach Vorbereitung, 10 Runden, Timeout und Wiederholung");
  console.log("- vorzeitiger Abbruch stoppt den Timer");
  console.log("- vollständige Prüfung mit 10 Aufgaben ohne Zwischenauflösung");
  console.log("- Abschlussliste, Karten-Nachprüfung und unbeantwortete Aufgabe");
  console.log("- spielerische Auszeichnung aus dem endgültigen Prüfungsergebnis");
  console.log("- getrennte Statistik sowie Warnungen bei Reload, Zurück und Abbruch");
  console.log("- lokale POIs, ausblendbare Kategorie, gespeicherte Auswahl und gemischte Balance");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
