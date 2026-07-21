"use strict";

const assert = require("assert");
const { createStatisticsStore } = require("../statistics.js");
const {
  GAME_STATUS,
  MODE_CONFIGS,
  EXAM_AWARD_CONFIG,
  calculateDefaultScore,
  calculateExamAward,
  calculateGameSummary,
  createGameEngine
} = require("../game-engine.js");

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

let currentTime = Date.parse("2026-07-21T10:00:00.000Z");
const storage = createMemoryStorage();
const statisticsStore = createStatisticsStore(storage, "engine-test-statistics");
let gameIdCounter = 0;
const engine = createGameEngine({
  now: () => currentTime,
  statisticsStore,
  createGameId: () => `test-game-${++gameIdCounter}`
});
const { gameState } = engine;

assert.deepEqual(Object.values(GAME_STATUS), [
  "idle", "preparing", "active", "answered", "finished"
]);
assert.equal(MODE_CONFIGS.free.mode, "free");
assert.equal(MODE_CONFIGS.timed.secondsPerRound, 30);
assert.equal(MODE_CONFIGS.timed.autoAdvanceDelaySeconds, null,
  "Im Zeitmodus darf keine Aufgabe automatisch weitergeschaltet werden");
assert.equal(MODE_CONFIGS.exam.immediateResolution, false);

engine.startGame(MODE_CONFIGS.free);
assert.equal(gameState.status, GAME_STATUS.IDLE);
assert.equal(gameState.config.mode, "free");
assert.equal(gameState.config.totalRounds, null);
assert.equal(gameState.config.secondsPerRound, null);
assert.equal(gameState.config.contentSelection, "streets");
assert.equal(gameState.config.immediateResolution, true);

engine.startRound();
assert.equal(gameState.status, GAME_STATUS.PREPARING);
assert.equal(gameState.currentRound.roundNumber, 1);

engine.activateRound({
  id: "street-test-1",
  name: "Teststraße",
  category: "street",
  geometry: { type: "MultiLineString", sections: [[[10.9, 49.4], [11, 49.5]]] }
});
assert.equal(gameState.status, GAME_STATUS.ACTIVE);

currentTime += 2350;
engine.submitGuess({ lat: 49.42, lng: 10.95 });
const result = engine.resolveRound({ distanceMeters: 125 });
assert.equal(gameState.status, GAME_STATUS.ANSWERED);
assert.equal(gameState.results.length, 1);
assert.equal(gameState.totalScore, calculateDefaultScore(125));
assert.deepEqual(result, {
  mode: "free",
  targetId: "street-test-1",
  targetName: "Teststraße",
  targetType: "street",
  targetCategory: "street",
  targetCategoryLabel: "Straße",
  roundNumber: 1,
  resultId: "test-game-1:round:1",
  distanceMeters: 125,
  points: calculateDefaultScore(125),
  durationSeconds: 2.35,
  timedOut: false,
  guessCoordinates: { lat: 49.42, lng: 10.95 },
  timestamp: "2026-07-21T10:00:02.350Z"
});

engine.startRound();
engine.activateRound({ id: "street-skip", name: "Übersprungene Straße", category: "street" });
engine.startRound();
assert.equal(gameState.status, GAME_STATUS.PREPARING);
assert.equal(gameState.currentRound.roundNumber, 2,
  "Eine übersprungene freie Runde darf den Rundenzähler nicht erhöhen");
engine.cancelRound();
assert.equal(gameState.status, GAME_STATUS.IDLE);
assert.equal(gameState.results.length, 1);

engine.finishGame();
assert.equal(gameState.status, GAME_STATUS.FINISHED);
assert.ok(gameState.finishedAt);
engine.resetGame();
assert.equal(gameState.status, GAME_STATUS.IDLE);
assert.equal(gameState.results.length, 0);
assert.equal(gameState.totalScore, 0);

engine.startGame(MODE_CONFIGS.timed);
engine.startRound();
engine.activateRound({ id: "street-timed", name: "Zeitstraße", category: "street" });
currentTime += 31000;
const timedResult = engine.expireRound();
assert.equal(timedResult.timedOut, true);
assert.equal(timedResult.durationSeconds, 30);
assert.equal(timedResult.points, 0);
assert.equal(timedResult.distanceMeters, null);
assert.equal(timedResult.guessCoordinates, null);
engine.finishGame();
assert.equal(gameState.summary.roundCount, 1);
assert.equal(gameState.summary.timeoutCount, 1);
assert.equal(gameState.summary.totalPoints, 0);
assert.equal(gameState.summary.averageDistanceMeters, null);
assert.equal(gameState.summary.byTargetType.street.roundCount, 1);
assert.equal(gameState.summary.byTargetType.poi.roundCount, 0);

const persistedStatistics = createStatisticsStore(
  storage, "engine-test-statistics"
).getSnapshot();
assert.equal(persistedStatistics.schemaVersion, 2);
assert.equal(persistedStatistics.overall.gamesStarted, 2);
assert.equal(persistedStatistics.overall.gamesCompleted, 2);
assert.equal(persistedStatistics.overall.roundsEvaluated, 2);
assert.equal(persistedStatistics.modes.free.roundsEvaluated, 1);
assert.equal(persistedStatistics.modes.timed.roundsEvaluated, 1);

engine.startGame({ ...MODE_CONFIGS.exam, totalRounds: 2 });
engine.startRound();
engine.activateRound({ id: "street-exam-1", name: "Prüfstraße 1", category: "street" });
currentTime += 5000;
engine.submitGuess({ lat: 49.41, lng: 10.94 }, { timedOut: false });
engine.resolveRound({ distanceMeters: 100, points: 800 });
engine.startRound();
engine.activateRound({ id: "street-exam-2", name: "Prüfstraße 2", category: "street" });
currentTime += 30000;
engine.expireRound();
const statisticsDuringExam = statisticsStore.getSnapshot();
assert.equal(statisticsDuringExam.modes.exam.gamesStarted, 1);
assert.equal(statisticsDuringExam.modes.exam.roundsEvaluated, 0,
  "Prüfungsrunden dürfen vor dem Abschluss nicht dauerhaft gespeichert werden");
engine.finishGame();
assert.equal(gameState.summary.maximumPossiblePoints, 2000);
assert.equal(gameState.summary.percentage, 40);
assert.equal(gameState.summary.unansweredCount, 1);
assert.equal(gameState.summary.averageDistanceMeters, 100);
assert.equal(gameState.summary.award.name, "Anwärter");
assert.equal(gameState.summary.award.percentage, 40);
const statisticsAfterExam = createStatisticsStore(
  storage, "engine-test-statistics"
).getSnapshot();
assert.equal(statisticsAfterExam.overall.gamesStarted, 3);
assert.equal(statisticsAfterExam.overall.gamesCompleted, 3);
assert.equal(statisticsAfterExam.overall.roundsEvaluated, 4);
assert.equal(statisticsAfterExam.modes.exam.roundsEvaluated, 2);
assert.equal(statisticsAfterExam.exam.highestPercentageBasisPoints, 4000);
assert.equal(statisticsAfterExam.exam.highestAward.name, "Anwärter");
engine.finishGame();
assert.equal(statisticsStore.getSnapshot().modes.exam.roundsEvaluated, 2,
  "Mehrfaches Öffnen der fertigen Auswertung darf keine Aufgabe doppelt zählen");

const mixedSummary = calculateGameSummary([
  { targetType: "street", points: 800, distanceMeters: 100, durationSeconds: 5, timedOut: false },
  { targetType: "poi", points: 900, distanceMeters: 50, durationSeconds: 4, timedOut: false },
  { targetType: "poi", points: 0, distanceMeters: null, durationSeconds: 15, timedOut: true }
], 0, 24000);
assert.equal(mixedSummary.byTargetType.street.roundCount, 1);
assert.equal(mixedSummary.byTargetType.poi.roundCount, 2);
assert.equal(mixedSummary.byTargetType.poi.totalPoints, 900);
assert.equal(mixedSummary.byTargetType.poi.timeoutCount, 1);
assert.equal(mixedSummary.hitCount, 2,
  "Straßen und POIs müssen ihre jeweils passenden Treffergrenzen verwenden");

const rankCases = [
  [0, "Anwärter"],
  [6499, "Anwärter"],
  [6500, "Truppmann"],
  [7500, "Truppführer"],
  [8500, "Gruppenführer"],
  [9500, "Einsatzleiter"],
  [9999, "Einsatzleiter"],
  [10000, "Ortskenntnis-Meister"]
];
for (const [points, expectedRank] of rankCases) {
  assert.equal(calculateExamAward(points, 10000).name, expectedRank,
    `${points / 100} % muss den Rang ${expectedRank} ergeben`);
}
assert.equal(calculateExamAward(10000, 10000).perfect, true,
  "100 % müssen über die exakte ganzzahlige Punktgleichheit erkannt werden");
assert.equal(calculateExamAward(9999, 10000).perfect, false);
const medalConfig = { ...EXAM_AWARD_CONFIG, displayMode: "medals" };
assert.equal(calculateExamAward(8500, 10000, medalConfig).name, "Gold");
assert.equal(calculateExamAward(9500, 10000, medalConfig).name, "Diamant");

engine.startGame({ ...MODE_CONFIGS.timed, totalRounds: 10 });
engine.startRound();
engine.activateRound({ id: "street-aborted", name: "Abbruchstraße", category: "street" });
currentTime += 1000;
engine.submitGuess({ lat: 49.4, lng: 10.9 });
engine.resolveRound({ distanceMeters: 80, points: 900 });
engine.finishGame({ aborted: true });
const afterAbort = statisticsStore.getSnapshot();
assert.equal(afterAbort.modes.timed.gamesStarted, 2);
assert.equal(afterAbort.modes.timed.gamesCompleted, 1,
  "Ein vorzeitig abgebrochenes Spiel zählt nicht als abgeschlossen");
assert.equal(afterAbort.modes.timed.roundsEvaluated, 2,
  "Bereits ausgewertete Aufgaben eines abgebrochenen Trainings bleiben gezählt");

console.log("Game-Engine-Tests erfolgreich:");
console.log("- Zustände idle → preparing → active → answered → finished");
console.log("- vollständiges Rundenergebnis des Freien Modus");
console.log("- Überspringen ohne doppelten Rundenzähler");
console.log("- Zeitüberschreitung ohne erfundene Tippkoordinate und Abschlussstatistik");
console.log("- versionierte, dauerhaft gespeicherte Statistik ohne Rundendopplung");
console.log("- Prüfungsdaten erst nach Abschluss und klar behandelter Spielabbruch");
console.log("- getrennte Abschlusswerte und Treffergrenzen für Straßen und POIs");
console.log("- zentrale Ranggrenzen, exakte 100-%-Erkennung und alternative Medaillen");
