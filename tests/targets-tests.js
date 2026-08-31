"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const geometryApi = require("../geometry.js");
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
const expectedSitePoiIds = new Set([
  "poi-school-grundschule-altenberg",
  "poi-school-pestalozzi-grundschule",
  "poi-school-dbg",
  "poi-school-elisabeth-krauss",
  "poi-childcare-st-stephanus",
  "poi-childcare-st-johannes",
  "poi-childcare-storchennest",
  "poi-leisure-hans-reif",
  "poi-leisure-schuetzengesellschaft"
]);

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((currentY > y) !== (previousY > y)
      && x < (previousX - currentX) * (y - currentY)
        / (previousY - currentY) + currentX) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInArea(point, geometry) {
  const polygons = geometry.type === "MultiPolygon"
    ? geometry.coordinates
    : [geometry.coordinates];
  return polygons.some(polygon => pointInRing(point, polygon[0])
    && polygon.slice(1).every(hole => !pointInRing(point, hole)));
}

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
  assert.ok(["Point", "Polygon", "MultiPolygon"].includes(poi.geometry.type));
  assert.equal(targetApi.isValidTargetGeometry({ ...poi, targetType: "poi" }, {}), true,
    `${poi.id} braucht eine gültige Zielgeometrie`);
  if (poi.geometry.type === "Point") {
    assert.equal(poi.geometryScope, "point");
    assert.deepEqual(Array.from(poi.geometry.coordinates), [poi.longitude, poi.latitude]);
  } else {
    assert.equal(poi.geometryScope, "site");
    assert.equal(poi.geometrySource, "OpenStreetMap");
    assert.match(poi.geometrySourceUrl, /^https:\/\/www\.openstreetmap\.org\/(way|relation)\/\d+$/);
    assert.match(poi.geometryCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(pointInArea([poi.longitude, poi.latitude], poi.geometry), true,
      `${poi.id}: Der repräsentative Punkt muss innerhalb der Geländegeometrie liegen`);
  }
  assert.ok(poi.source);
  assert.ok(poi.checkedAt);
  if (poi.needsReview) assert.ok(poi.reviewNote, `${poi.id} braucht einen Prüfhinweis`);
  if (!poi.active) assert.equal(poi.quizEligible, false,
    `${poi.id}: inaktive Daten dürfen nicht als Aufgabe erscheinen`);
}

assert.deepEqual(
  new Set(rawPois.filter(poi => poi.geometryScope === "site").map(poi => poi.id)),
  expectedSitePoiIds,
  "Der geprüfte Satz lokaler OSM-Gelände darf nicht unbemerkt wieder zu Punkten werden"
);

const correctedPois = new Map(rawPois.map(poi => [poi.id, poi]));
assert.equal(correctedPois.get("poi-senior-willi-buehner").displayName,
  "BRK-Seniorenheim Willy Bühner");
assert.equal(correctedPois.get("poi-fuel-agip").displayName, "Enilive Tankstelle");
assert.ok(correctedPois.get("poi-fuel-agip").aliases.includes("Agip"));
assert.equal(correctedPois.get("poi-market-e-center").address,
  "Rothenburger Straße 28, 90513 Zirndorf");
assert.equal(correctedPois.get("poi-market-e-center").quizEligible, false);
assert.equal(correctedPois.get("poi-market-norma").displayName, "NORMA Zirndorf");
assert.equal(correctedPois.get("poi-market-norma").quizEligible, false);
assert.equal(correctedPois.get("poi-leisure-hans-reif").geometry.type, "Polygon");
assert.ok(correctedPois.get("poi-leisure-hans-reif").aliases.includes("Jahnhalle"));
assert.ok(correctedPois.get("poi-leisure-hans-reif").aliases.includes("Asbachhalle"));
assert.equal(correctedPois.get("poi-hospitality-asbacher-hof").active, false);
assert.equal(correctedPois.get("poi-hospitality-asbacher-hof").quizEligible, false);
assert.equal(correctedPois.get("poi-company-infotrans").displayName,
  "Infotrans-InterNetServices");
assert.equal(correctedPois.get("poi-relevant-st-stephanus").address,
  "St.-Stephanus-Straße 2, 90522 Oberasbach");
assert.equal(correctedPois.get("poi-health-zahnarzt-schneider").displayName,
  "Praxis für Zahnheilkunde Dr. Detlef Schneider");

const fireStations = rawPois.filter(poi => poi.subcategory === "Feuerwehrgerätehaus");
assert.equal(fireStations.length, 3);
assert.ok(fireStations.every(poi => poi.quizEligible === false),
  "Orientierungs-Gerätehäuser dürfen keine Quizaufgabe werden");
assert.ok(rawPois.some(poi => poi.needsReview),
  "Noch manuell zu prüfende Positionen müssen in der Datei erkennbar sein");

const preparedPois = targetApi.preparePoiTargets(rawPois, categories);
assert.equal(preparedPois.length, rawPois.length);
assert.ok(preparedPois.every(target => target.targetType === "poi"));
assert.ok(preparedPois.filter(target => target.geometryScope === "site")
  .every(target => target.geometrySourceUrl && target.geometryCheckedAt),
"Geländequellen müssen durch das gemeinsame Zielmodell weitergereicht werden");

const installedStreetInput = [{
  id: "osm-relation-1001:street-alpha",
  cityId: "osm-relation-1001",
  name: "Alphaallee",
  aliases: ["Alpha-Allee"],
  geometry: {
    type: "MultiLineString",
    coordinates: [
      [[9.1, 48.1], [9.11, 48.11]],
      [[9.12, 48.12], [9.13, 48.13]]
    ]
  },
  osmWayIds: [101, 102]
}];
const installedStreetSnapshot = JSON.parse(JSON.stringify(installedStreetInput));
const installedStreetTargets = targetApi.prepareStreetTargets(installedStreetInput, geometryApi);
assert.equal(installedStreetTargets.length, 1);
assert.equal(installedStreetTargets[0].cityId, "osm-relation-1001");
assert.equal(installedStreetTargets[0].displayName, "Alphaallee");
assert.equal(installedStreetTargets[0].geometry.type, "MultiLineString");
assert.deepEqual(installedStreetTargets[0].geometry.sections, [
  [[9.1, 48.1], [9.11, 48.11]],
  [[9.12, 48.12], [9.13, 48.13]]
], "Persistierte GeoJSON-Koordinaten müssen einmalig in Runtime-Sections überführt werden");
assert.equal(installedStreetTargets[0].geometry.streetId, installedStreetInput[0].id);
assert.deepEqual(installedStreetTargets[0].geometry.featureIds, ["way/101", "way/102"]);
assert.equal(targetApi.isValidTargetGeometry(installedStreetTargets[0], geometryApi), true,
  "Die aus IndexedDB-Geometrie erzeugte Straße muss unmittelbar spielbar sein");
assert.deepEqual(installedStreetInput, installedStreetSnapshot,
  "Die Target-Aufbereitung darf das gespeicherte Straßenobjekt nicht mutieren");

const preparedStreetSnapshot = JSON.parse(JSON.stringify(installedStreetTargets));
const preparedStreetAgain = targetApi.prepareStreetTargets(installedStreetTargets, geometryApi);
assert.deepEqual(preparedStreetAgain[0].geometry, installedStreetTargets[0].geometry,
  "Eine bereits adaptierte Runtime-Geometrie darf nicht ein zweites Mal konvertiert werden");
assert.deepEqual(installedStreetTargets, preparedStreetSnapshot,
  "Auch die idempotente Aufbereitung darf ihren Input nicht mutieren");

const legacyStreetTargets = targetApi.prepareStreetTargets([
  { id: "legacy-street", name: "Legacyweg", aliases: [] }
], geometryApi);
assert.equal(legacyStreetTargets[0].geometry, null,
  "Legacy-Oberasbach-Straßen ohne lokale Geometrie müssen den bisherigen Null-Fallback behalten");

const installedPoiInput = [
  {
    id: "osm-relation-1001:poi:node-1",
    cityId: "osm-relation-1001",
    name: "Feuerwehr Alpha",
    aliases: ["FF Alpha"],
    category: "fire_station",
    categoryLabel: "Feuerwehr",
    position: { lat: 48.101, lon: 9.101 },
    geometry: null
  },
  {
    id: "osm-relation-1001:poi:way-2",
    cityId: "osm-relation-1001",
    name: "Alphaschule",
    aliases: [],
    category: "school",
    categoryLabel: "Schule",
    position: { lat: 48.105, lon: 9.105 },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [9.1, 48.1], [9.11, 48.1], [9.11, 48.11], [9.1, 48.1]
      ]]
    }
  },
  {
    id: "osm-relation-1001:poi:relation-3",
    cityId: "osm-relation-1001",
    name: "Alpha-Marktzentrum",
    aliases: [],
    category: "supermarket",
    categoryLabel: "Supermarkt",
    position: { lat: 48.125, lon: 9.125 },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [[[9.12, 48.12], [9.13, 48.12], [9.13, 48.13], [9.12, 48.12]]],
        [[[9.14, 48.14], [9.15, 48.14], [9.15, 48.15], [9.14, 48.14]]]
      ]
    }
  }
];
const installedPoiSnapshot = JSON.parse(JSON.stringify(installedPoiInput));
const installedPoiTargets = targetApi.preparePoiTargets(installedPoiInput);
const installedPointTarget = installedPoiTargets[0];
assert.equal(installedPointTarget.displayName, "Feuerwehr Alpha");
assert.equal(installedPointTarget.cityId, "osm-relation-1001");
assert.equal(installedPointTarget.latitude, 48.101);
assert.equal(installedPointTarget.longitude, 9.101);
assert.deepEqual(installedPointTarget.geometry, {
  type: "Point",
  coordinates: [9.101, 48.101]
}, "Ein installierter Positions-POI ohne Fläche muss ein lokales Point-Ziel erhalten");
assert.equal(installedPoiTargets[1].displayName, "Alphaschule");
assert.equal(installedPoiTargets[1].geometry.type, "Polygon");
assert.equal(installedPoiTargets[2].displayName, "Alpha-Marktzentrum");
assert.equal(installedPoiTargets[2].geometry.type, "MultiPolygon");
assert.ok(installedPoiTargets.every(target =>
  targetApi.isValidTargetGeometry(target, geometryApi)),
"Point, Polygon und MultiPolygon aus installierten Stadtpaketen müssen spielbar sein");
assert.deepEqual(installedPoiInput, installedPoiSnapshot,
  "Die Target-Aufbereitung darf installierte POI-Datensätze nicht mutieren");

const geometryStub = {
  prepareStreetRecords: streets => streets.map(street => ({
    id: street.id,
    displayName: street.name,
    aliases: []
  })),
  isValidStreetGeometry: geometry => geometry?.type === "MultiLineString",
  extractLineSections: () => [],
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

const pointTarget = preparedPois.find(poi => poi.active && poi.quizEligible
  && poi.geometry.type === "Point");
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
).distanceMeters, 0, "Ein Klick innerhalb des Geländes muss 0 Meter ergeben");
assert.equal(targetApi.evaluateTargetDistance(
  polygonTarget, [10.97, 49.423], polygonTurf, geometryStub
).distanceMeters, 123, "Außerhalb muss der Abstand zum nächstgelegenen Rand zählen");

const polygonWithHoleTarget = {
  ...polygonTarget,
  geometry: {
    type: "Polygon",
    coordinates: [
      [[10.94, 49.41], [10.98, 49.41], [10.98, 49.45], [10.94, 49.45], [10.94, 49.41]],
      [[10.95, 49.42], [10.96, 49.42], [10.96, 49.43], [10.95, 49.43], [10.95, 49.42]]
    ]
  }
};
const multiPolygonTarget = {
  ...polygonTarget,
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [[[10.94, 49.41], [10.95, 49.41], [10.95, 49.42], [10.94, 49.41]]],
      [[[10.97, 49.43], [10.98, 49.43], [10.98, 49.44], [10.97, 49.43]]]
    ]
  }
};
const areaTurf = {
  point: coordinates => ({ coordinates }),
  booleanPointInPolygon: (point, geometry) => pointInArea(point.coordinates, geometry)
};
assert.equal(targetApi.evaluateTargetDistance(
  polygonWithHoleTarget, [10.955, 49.425], areaTurf, geometryStub
).distanceMeters, 123, "Ein Innenloch darf nicht als Trefferfläche zählen");
assert.equal(targetApi.evaluateTargetDistance(
  multiPolygonTarget, [10.977, 49.432], areaTurf, geometryStub
).distanceMeters, 0, "Jede Teilfläche eines MultiPolygons muss als Treffer zählen");

for (const invalidGeometry of [
  { type: "Polygon", coordinates: [[[10.95, 49.42], [10.96, 49.42], [10.96, 49.43]]] },
  { type: "Polygon", coordinates: [[[10.95, 49.42], [10.95, 49.42], [10.95, 49.42], [10.95, 49.42]]] },
  { type: "Polygon", coordinates: [[[10.95, 49.42], [NaN, 49.42], [10.96, 49.43], [10.95, 49.42]]] },
  { type: "MultiPolygon", coordinates: [] }
]) {
  assert.equal(targetApi.isValidTargetGeometry({
    ...polygonTarget,
    geometry: invalidGeometry
  }, geometryStub), false, "Ungültige oder offene Flächenringe müssen abgelehnt werden");
}

console.log("Ziel- und POI-Tests erfolgreich:");
console.log("- eindeutige, kategorisierte lokale POI-Daten mit Prüfkennzeichnung");
console.log("- Gerätehäuser und deaktivierte Daten von der Quiz-Auswahl ausgeschlossen");
console.log("- neun geprüfte OSM-Gelände mit Quellenmetadaten und innenliegenden Referenzpunkten");
console.log("- installierte GeoJSON-Straßen einmalig und ohne Inputmutation in Runtime-Sections adaptiert");
console.log("- Legacy-Straßen ohne Geometrie behalten den isolierten Null-Fallback");
console.log("- installierte Positions-, Polygon- und MultiPolygon-POIs in das gemeinsame Zielmodell überführt");
console.log("- strikte Validierung für Punkte, Polygone, Innenlöcher und MultiPolygone");
console.log("- eigene POI-Entfernung und POI-Punktekurve");
