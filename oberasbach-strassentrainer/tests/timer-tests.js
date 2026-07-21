"use strict";

const assert = require("assert");
const { createDeadlineTimer } = require("../timer.js");

let currentTime = 100000;
let nextIntervalId = 1;
const intervals = new Map();
const ticks = [];
let expirationCount = 0;
const timer = createDeadlineTimer({
  now: () => currentTime,
  setInterval: callback => {
    const id = nextIntervalId;
    nextIntervalId += 1;
    intervals.set(id, callback);
    return id;
  },
  clearInterval: id => intervals.delete(id),
  onTick: snapshot => ticks.push(snapshot),
  onExpire: () => { expirationCount += 1; }
});

timer.start(15);
assert.equal(timer.isRunning(), true);
assert.equal(intervals.size, 1);
assert.equal(ticks.at(-1).remainingSeconds, 15);
assert.equal(ticks.at(-1).urgent, false);

currentTime += 1000;
timer.checkNow();
assert.equal(ticks.at(-1).remainingSeconds, 14, "Tipp in der ersten Sekunde bleibt möglich");

currentTime = 110001;
timer.checkNow();
assert.equal(ticks.at(-1).remainingSeconds, 5);
assert.equal(ticks.at(-1).urgent, true, "Letzte fünf Sekunden müssen markiert sein");

currentTime = 114999;
timer.checkNow();
assert.equal(ticks.at(-1).remainingSeconds, 1, "Kurz vor Ablauf bleibt eine Sekunde sichtbar");
assert.equal(expirationCount, 0);

currentTime = 130000;
timer.checkNow();
assert.equal(expirationCount, 1, "Zeitsprung im Hintergrund muss sofort ablaufen");
assert.equal(timer.isRunning(), false);
assert.equal(intervals.size, 0);
timer.checkNow();
assert.equal(expirationCount, 1, "Timeout darf nur einmal ausgelöst werden");

currentTime = 200000;
timer.start(30);
const firstDeadline = timer.getDeadline();
timer.start(45);
assert.notEqual(timer.getDeadline(), firstDeadline);
assert.equal(intervals.size, 1, "Es darf nie mehr als ein Countdown-Intervall laufen");
timer.stop();
assert.equal(timer.isRunning(), false);
assert.equal(intervals.size, 0);

console.log("Timer-Tests erfolgreich:");
console.log("- erste Sekunde und Tipp kurz vor Ablauf");
console.log("- deutliche letzte fünf Sekunden");
console.log("- deadline-basierter Ablauf nach Hintergrund-Zeitsprung");
console.log("- genau ein Timer und einmaliger Timeout");
console.log("- explizites Stoppen bei Abbruch/Moduswechsel");
