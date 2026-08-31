"use strict";

const assert = require("assert");
const {
  STATISTICS_SCHEMA_VERSION,
  STATISTICS_EXPORT_SCHEMA_VERSION,
  HIT_THRESHOLDS_METERS,
  createStatisticsStore,
  getStatisticsStorageKey,
  createCitySlug,
  getStatisticsExportFilename,
  parseStatisticsJson
} = require("../statistics.js");

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    values
  };
}

function result(overrides) {
  return {
    mode: "free",
    targetId: "street-a",
    targetName: "A-Straße",
    targetType: "street",
    targetCategory: "street",
    targetCategoryLabel: "Straße",
    points: 800,
    distanceMeters: 80,
    durationSeconds: 5,
    timedOut: false,
    timestamp: "2026-07-21T10:00:05.000Z",
    ...overrides
  };
}

assert.equal(STATISTICS_SCHEMA_VERSION, 2);
assert.equal(STATISTICS_EXPORT_SCHEMA_VERSION, 1);
assert.deepEqual(HIT_THRESHOLDS_METERS, { street: 100, poi: 100 });
assert.equal(
  getStatisticsStorageKey("osm-relation-12345"),
  "strassentrainer-statistik-osm-relation-12345-v2"
);
assert.notEqual(getStatisticsStorageKey("same-name-a"), getStatisticsStorageKey("same-name-b"));
assert.throws(() => getStatisticsStorageKey("  "), /Stadt-ID/);
assert.equal(createCitySlug("München-Süd / Weiß"), "muenchen-sued-weiss");
assert.equal(
  getStatisticsExportFilename("München-Süd / Weiß", "2026-08-28T12:00:00.000Z"),
  "strassentrainer-statistik-muenchen-sued-weiss-2026-08-28.json"
);

const storage = createMemoryStorage();
const store = createStatisticsStore(storage, "statistics-test");
let snapshot = store.getSnapshot();
assert.equal(snapshot.schemaVersion, 2);
assert.equal(snapshot.overall.gamesStarted, 0);
assert.equal(snapshot.overall.roundsEvaluated, 0);
assert.equal(store.getView().statistics.averagePoints, 0);
assert.equal(store.getView().statistics.averageDistanceMeters, null,
  "Ein leerer Speicher darf keine Division durch null erzeugen");

store.recordGameStarted("free", {
  gameId: "free-game-1",
  contentSelection: "mixed",
  timestamp: "2026-07-21T10:00:00.000Z"
});
store.recordRound(result({ resultId: "free-1", points: 800, distanceMeters: 80 }), {
  roundId: "free-1"
});
store.recordRound(result({ resultId: "free-2", points: 600, distanceMeters: 120,
  durationSeconds: 7, timestamp: "2026-07-21T10:00:12.000Z" }), { roundId: "free-2" });
store.recordRound(result({ resultId: "free-3", targetId: "poi-b", targetName: "B-Einrichtung",
  targetType: "poi", targetCategory: "school", targetCategoryLabel: "Schule",
  points: 900, distanceMeters: 100, durationSeconds: 5,
  timestamp: "2026-07-21T10:00:17.000Z" }), { roundId: "free-3" });
store.recordRound(result({ resultId: "free-3", targetId: "poi-b", targetType: "poi",
  points: 900, distanceMeters: 100 }), { roundId: "free-3" });
store.recordGameFinished("free", {
  gameId: "free-game-1",
  contentSelection: "mixed",
  timestamp: "2026-07-21T10:00:20.000Z"
});

let view = store.getView();
assert.equal(view.statistics.gamesStarted, 1);
assert.equal(view.statistics.gamesCompleted, 1);
assert.equal(view.statistics.roundsEvaluated, 3,
  "Dieselbe Rundendatensatz-ID darf nur einmal gezählt werden");
assert.equal(view.statistics.totalPoints, 2300);
assert.equal(view.statistics.averagePoints, 2300 / 3,
  "Durchschnitte werden aus ungerundeten Summen berechnet");
assert.equal(view.statistics.bestPoints, 900);
assert.equal(view.statistics.averageDistanceMeters, 100);
assert.equal(view.statistics.bestDistanceMeters, 80);
assert.equal(view.statistics.worstDistanceMeters, 120);
assert.equal(view.statistics.averageDurationSeconds, 17 / 3);
assert.equal(view.statistics.hitCount, 2);
assert.equal(view.statistics.hitRatePercent, 2 / 3 * 100);
assert.equal(view.targets.best.id, "poi-b");
assert.equal(view.targets.worst.id, "street-a");
assert.equal(view.targets.mostPlayed.id, "street-a");

view = store.getView({ mode: "free", targetType: "poi" });
assert.equal(view.statistics.roundsEvaluated, 1);
assert.equal(view.statistics.gamesStarted, 1);
assert.equal(view.statistics.gamesCompleted, 1);
assert.equal(view.targets.best.name, "B-Einrichtung");

store.recordGameStarted("timed", {
  gameId: "timed-aborted",
  contentSelection: "streets",
  timestamp: "2026-07-21T11:00:00.000Z"
});
store.recordRound(result({ mode: "timed", resultId: "timed-1", targetId: "street-timeout",
  targetName: "Timeoutstraße", points: 0, distanceMeters: null,
  durationSeconds: 30, timedOut: true, timestamp: "2026-07-21T11:00:30.000Z" }), {
  roundId: "timed-1"
});
view = store.getView({ mode: "timed" });
assert.equal(view.statistics.gamesStarted, 1);
assert.equal(view.statistics.gamesCompleted, 0,
  "Ein abgebrochenes Spiel bleibt gestartet, aber nicht abgeschlossen");
assert.equal(view.statistics.roundsEvaluated, 1);
assert.equal(view.statistics.timeoutCount, 1);
assert.equal(view.statistics.distanceCount, 0,
  "Ein Timeout ohne Tipp darf keine erfundene Entfernung erzeugen");

const examResults = [
  result({ mode: "exam", resultId: "exam-1", targetId: "street-exam",
    targetName: "Prüfstraße", points: 950, distanceMeters: 40,
    timestamp: "2026-07-21T12:00:10.000Z" }),
  result({ mode: "exam", resultId: "exam-2", targetId: "poi-exam",
    targetName: "Prüfort", targetType: "poi", points: 950, distanceMeters: 40,
    timestamp: "2026-07-21T12:00:20.000Z" })
];
const examAward = {
  scheme: "ranks",
  key: "incident-leader",
  name: "Einsatzleiter",
  symbol: "🏆",
  description: "Test",
  percentage: 95,
  percentageBasisPoints: 9500,
  perfect: false
};
store.recordGameStarted("exam", {
  gameId: "exam-game-1",
  contentSelection: "mixed",
  timestamp: "2026-07-21T12:00:00.000Z"
});
assert.equal(store.getView({ mode: "exam" }).statistics.roundsEvaluated, 0,
  "Eine laufende Prüfung schreibt noch keine Aufgaben in die Gesamtstatistik");
store.recordGameFinished("exam", {
  gameId: "exam-game-1",
  contentSelection: "mixed",
  timestamp: "2026-07-21T12:00:25.000Z",
  results: examResults,
  summary: { award: examAward }
});
store.recordGameFinished("exam", {
  gameId: "exam-game-1",
  contentSelection: "mixed",
  results: examResults,
  summary: { award: examAward }
});
view = store.getView({ mode: "exam" });
assert.equal(view.statistics.gamesCompleted, 1);
assert.equal(view.statistics.roundsEvaluated, 2,
  "Mehrfaches Anzeigen derselben Prüfung darf nicht doppelt zählen");
assert.equal(view.highestExam.highestPercentageBasisPoints, 9500);
assert.equal(view.highestExam.highestAward.name, "Einsatzleiter");

const exported = store.exportJson();
const exportedObject = JSON.parse(exported);
assert.equal(exportedObject.schemaVersion, 2);
assert.ok(Object.keys(exportedObject.targets).length <= 5000);
const beforeResetRounds = exportedObject.overall.roundsEvaluated;
store.reset();
assert.equal(store.getSnapshot().overall.roundsEvaluated, 0);
store.importJson(exported, "replace");
assert.equal(store.getSnapshot().overall.roundsEvaluated, beforeResetRounds,
  "Export, Löschen und Ersetzen-Import müssen die Werte wiederherstellen");
assert.throws(() => store.importJson(exported, "merge"), /überschneidet/,
  "Dieselben Rundendaten dürfen auch durch einen Merge nicht doppelt gezählt werden");
const secondStorage = createMemoryStorage();
const secondStore = createStatisticsStore(secondStorage, "second-statistics");
secondStore.recordGameStarted("free", {
  gameId: "other-game",
  contentSelection: "streets",
  timestamp: "2026-07-22T10:00:00.000Z"
});
secondStore.recordRound(result({ resultId: "other-round", targetId: "street-other",
  targetName: "Andere Straße", timestamp: "2026-07-22T10:00:05.000Z" }), {
  roundId: "other-round"
});
secondStore.recordGameFinished("free", {
  gameId: "other-game",
  contentSelection: "streets",
  timestamp: "2026-07-22T10:00:10.000Z"
});
store.importJson(secondStore.exportJson(), "merge");
assert.equal(store.getSnapshot().overall.roundsEvaluated, beforeResetRounds + 1,
  "Nicht überlappende Statistiken werden beim Zusammenführen addiert");

assert.throws(() => store.importJson("kein json", "replace"), /gültiges JSON/);
assert.throws(() => store.importJson(JSON.stringify({ schemaVersion: 999 }), "replace"),
  /schemaVersion/);
assert.throws(() => parseStatisticsJson(JSON.stringify({
  ...exportedObject,
  overall: { ...exportedObject.overall, totalPoints: -1 }
})), /overall\.totalPoints/);

const reloadedStore = createStatisticsStore(storage, "statistics-test");
assert.equal(reloadedStore.getSnapshot().overall.roundsEvaluated, beforeResetRounds + 1,
  "Ein Neuladen muss die localStorage-Statistik wiederherstellen");

const damagedStorage = createMemoryStorage({ broken: "{nicht-json" });
const recoveredStore = createStatisticsStore(damagedStorage, "broken");
assert.equal(recoveredStore.getSnapshot().overall.roundsEvaluated, 0);
assert.match(recoveredStore.getLoadWarning(), /konnte nicht geladen werden/);

const legacyStorage = createMemoryStorage({ legacy: JSON.stringify({
  version: 1,
  gamesStarted: 2,
  gamesFinished: 1,
  roundsAnswered: 4,
  totalPoints: 2500,
  bestPoints: 900,
  bestDistanceMeters: 20,
  lastPlayedAt: "2026-01-01T10:00:00.000Z",
  modes: {},
  targetTypes: {}
}) });
const migratedStore = createStatisticsStore(legacyStorage, "legacy");
assert.equal(migratedStore.getSnapshot().schemaVersion, 2);
assert.equal(migratedStore.getSnapshot().overall.gamesStarted, 2);
assert.equal(migratedStore.getSnapshot().overall.gamesCompleted, 1);
assert.equal(migratedStore.getSnapshot().overall.roundsEvaluated, 4);

const cityStorage = createMemoryStorage();
const alphaStore = createStatisticsStore(
  cityStorage,
  getStatisticsStorageKey("osm-relation-alpha"),
  { cityId: "osm-relation-alpha", cityName: "Gleiche Stadt" }
);
const betaStore = createStatisticsStore(
  cityStorage,
  getStatisticsStorageKey("osm-relation-beta"),
  { cityId: "osm-relation-beta", cityName: "Gleiche Stadt" }
);
alphaStore.recordRound(result({ resultId: "alpha-main", targetId: "main-street",
  targetName: "Hauptstraße" }), { roundId: "alpha-main" });
betaStore.recordRound(result({ resultId: "beta-main", targetId: "main-street",
  targetName: "Hauptstraße", points: 250 }), { roundId: "beta-main" });
assert.equal(alphaStore.getSnapshot().overall.totalPoints, 800);
assert.equal(betaStore.getSnapshot().overall.totalPoints, 250,
  "Gleiche Stadt- und Straßennamen dürfen verschiedene cityId-Stores nicht vermischen");

const alphaBeforeExport = alphaStore.getSnapshot();
const alphaExport = JSON.parse(alphaStore.exportJson());
assert.deepEqual(alphaStore.getSnapshot(), alphaBeforeExport,
  "Ein Export darf die Statistik nicht verändern");
assert.equal(alphaExport.schemaVersion, 1);
assert.equal(alphaExport.cityId, "osm-relation-alpha");
assert.equal(alphaExport.cityName, "Gleiche Stadt");
assert.ok(Number.isFinite(Date.parse(alphaExport.exportedAt)));
assert.equal(alphaExport.statistics.overall.roundsEvaluated, 1);
const betaBeforeRejectedImport = betaStore.getSnapshot();
assert.throws(
  () => betaStore.importJson(JSON.stringify(alphaExport), "replace"),
  /Diese Statistik gehört zu Gleiche Stadt \(osm-relation-alpha\)\. Aktuelle Stadt: Gleiche Stadt \(osm-relation-beta\)\./
);
assert.deepEqual(betaStore.getSnapshot(), betaBeforeRejectedImport,
  "Ein Stadt-Mismatch darf den aktiven Store nicht teilweise verändern");
assert.throws(
  () => betaStore.importJson(JSON.stringify({ ...alphaExport, schemaVersion: 99 }), "replace"),
  /Version des Statistikexports/
);
assert.throws(
  () => betaStore.importJson(JSON.stringify(alphaExport.statistics), "replace"),
  /keine Stadtzuordnung/
);

const legacyOberasbachStore = createStatisticsStore(
  createMemoryStorage(),
  "oberasbach-strassentrainer-statistik-v1",
  { cityId: "legacy-oberasbach", cityName: "Oberasbach", allowLegacyImport: true }
);
legacyOberasbachStore.importJson(JSON.stringify(alphaExport.statistics), "replace");
assert.equal(legacyOberasbachStore.getSnapshot().overall.roundsEvaluated, 1,
  "Nur der Legacy-Oberasbach-Store akzeptiert alte Exporte ohne cityId");

console.log("Statistiktests erfolgreich:");
console.log("- leerer Speicher, mehrere freie Runden und exakte Summen/Durchschnitte");
console.log("- Filter für Modus und Zieltyp sowie deterministische Zielrangfolge");
console.log("- Timeout, Abbruch und erst nach Abschluss aggregierte Prüfung");
console.log("- Deduplizierung von Runden und fertigen Prüfungen");
console.log("- Export, Reset, Ersetzen, Zusammenführen und Neuladen");
console.log("- verständliche Ablehnung beschädigter Daten und Migration von Schema 1");
console.log("- cityId-basierte Keys, sichere Dateinamen und getrennte gleichnamige Ziele");
console.log("- stadtbezogener Export, atomare Importprüfung und Legacy-Oberasbach-Kompatibilität");
