"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const targetApi = require("../targets.js");

const dataContext = {};
dataContext.globalThis = dataContext;
vm.runInNewContext(
  fs.readFileSync(require.resolve("../data/oberasbach-pois.js"), "utf8"),
  dataContext,
  { filename: "data/oberasbach-pois.js" }
);

const categories = Array.from(dataContext.OBERASBACH_POI_CATEGORIES);
const rawPois = Array.from(dataContext.OBERASBACH_POIS);
const categoryIds = new Set(categories.map(category => category.id));
const poiIds = new Set(rawPois.map(poi => poi.id));

assert.equal(categories.length, 11, "Alle vorgegebenen Hauptkategorien müssen vorhanden sein");
assert.ok(rawPois.length >= 50, "Die lokale Datei soll eine brauchbare Oberasbacher Grundauswahl enthalten");
assert.equal(poiIds.size, rawPois.length, "Jede Einrichtung braucht eine eindeutige ID");

for (const poi of rawPois) {
  assert.ok(poi.id.startsWith("poi-"));
  assert.ok(poi.displayName);
  assert.ok(categoryIds.has(poi.category), `Unbekannte Kategorie bei ${poi.id}`);
  assert.equal(typeof poi.active, "boolean");
  assert.equal(typeof poi.quizEligible, "boolean");
  assert.ok(Array.isArray(poi.aliases));
  assert.ok(Number.isFinite(poi.latitude) && Number.isFinite(poi.longitude));
  assert.equal(poi.geometry.type, "Point");
  assert.deepEqual(Array.from(poi.geometry.coordinates), [poi.longitude, poi.latitude]);
  assert.ok(poi.source);
  assert.ok(poi.checkedAt);
  if (poi.needsReview) assert.ok(poi.reviewNote, `${poi.id} braucht einen Prüfhinweis`);
  if (!poi.active) assert.equal(poi.quizEligible, false,
    `${poi.id}: inaktive Daten dürfen nicht als Aufgabe erscheinen`);
}

const fireStations = rawPois.filter(poi => poi.subcategory === "Feuerwehrgerätehaus");
assert.equal(fireStations.length, 3);
assert.ok(fireStations.every(poi => poi.quizEligible === false),
  "Orientierungs-Gerätehäuser dürfen keine Quizaufgabe werden");
assert.ok(rawPois.some(poi => poi.needsReview),
  "Noch manuell zu prüfende Positionen müssen in der Datei erkennbar sein");

const preparedPois = targetApi.preparePoiTargets(rawPois, categories);
assert.equal(preparedPois.length, rawPois.length);
assert.ok(preparedPois.every(target => target.targetType === "poi"));

const geometryStub = {
  prepareStreetRecords: streets => streets.map(street => ({
    id: street.id,
    displayName: street.name,
    aliases: []
  })),
  isValidStreetGeometry: geometry => geometry?.type === "MultiLineString",
  findNearestPointOnSections: () => ({
    distanceMeters: 123,
    nearestCoordinate: [10.95, 49.42],
    sectionIndex: 1
  })
};
const streets = targetApi.prepareStreetTargets([
  { id: "street-test", name: "Teststraße" }
], geometryStub);
streets[0].geometry = {
  streetId: "street-test",
  type: "MultiLineString",
  sections: [[[10.94, 49.42], [10.96, 49.42]]]
};
assert.equal(streets[0].targetType, "street");
assert.equal(targetApi.evaluateTargetDistance(
  streets[0], [10.95, 49.421], {}, geometryStub
).distanceMeters, 123, "Straßen müssen weiterhin über alle Linienabschnitte ausgewertet werden");

const pointTarget = preparedPois.find(poi => poi.active && poi.quizEligible);
const exactPoint = targetApi.evaluateTargetDistance(
  pointTarget,
  [...pointTarget.geometry.coordinates],
  {},
  geometryStub
);
assert.ok(exactPoint.distanceMeters < 0.01);
const offsetPoint = targetApi.evaluateTargetDistance(
  pointTarget,
  [pointTarget.longitude + 0.001, pointTarget.latitude],
  {},
  geometryStub
);
assert.ok(offsetPoint.distanceMeters > 60 && offsetPoint.distanceMeters < 90);
assert.equal(targetApi.calculateTargetScore(15, pointTarget), 1000);
assert.ok(targetApi.calculateTargetScore(250, pointTarget)
  < targetApi.calculateTargetScore(250, streets[0]),
"POIs verwenden wegen ihrer punktförmigen Lage eine strengere Entfernungskurve");

const polygonTarget = {
  ...pointTarget,
  id: "poi-polygon-test",
  geometry: {
    type: "Polygon",
    coordinates: [[
      [10.95, 49.42], [10.96, 49.42], [10.96, 49.43], [10.95, 49.42]
    ]]
  }
};
const polygonTurf = {
  point: coordinates => ({ coordinates }),
  booleanPointInPolygon: point => point.coordinates[0] === 10.955
};
assert.equal(targetApi.evaluateTargetDistance(
  polygonTarget, [10.955, 49.423], polygonTurf, geometryStub
).distanceMeters, 0, "Das Zielmodell ist für spätere Gelände-Polygone vorbereitet");

console.log("Ziel- und POI-Tests erfolgreich:");
console.log("- eindeutige, kategorisierte lokale POI-Daten mit Prüfkennzeichnung");
console.log("- Gerätehäuser und deaktivierte Daten von der Quiz-Auswahl ausgeschlossen");
console.log("- gemeinsames Ziel-Interface für Linien, Punkte und spätere Polygone");
console.log("- eigene POI-Entfernung und POI-Punktekurve");
