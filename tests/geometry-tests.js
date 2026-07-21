"use strict";

const assert = require("assert");
const geometryApi = require("../geometry.js");

function nearestOnSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
  ));
  return [start[0] + ratio * dx, start[1] + ratio * dy];
}

function distanceMeters(first, second) {
  const meanLatitude = (first[1] + second[1]) * Math.PI / 360;
  const dx = (first[0] - second[0]) * 111320 * Math.cos(meanLatitude);
  const dy = (first[1] - second[1]) * 110540;
  return Math.hypot(dx, dy);
}

function nearestOnLine(point, coordinates) {
  let best = null;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const nearest = nearestOnSegment(point, coordinates[index], coordinates[index + 1]);
    const distance = distanceMeters(point, nearest);
    if (!best || distance < best.distance) best = { distance, coordinates: nearest };
  }
  return best;
}

const turfStub = {
  point: coordinates => ({ geometry: { coordinates } }),
  lineString: coordinates => ({ geometry: { coordinates } }),
  pointToLineDistance: (point, line) => nearestOnLine(
    point.geometry.coordinates, line.geometry.coordinates
  ).distance,
  nearestPointOnLine: (line, point) => ({
    geometry: { coordinates: nearestOnLine(
      point.geometry.coordinates, line.geometry.coordinates
    ).coordinates }
  })
};

function roadFeature(id, name, geometry, city = "Oberasbach", postcode = "90522") {
  return {
    type: "Feature",
    properties: {
      osm_type: "way",
      osm_id: id,
      category: "highway",
      name,
      display_name: `${name}, ${city}, ${postcode}, Deutschland`,
      address: { road: name, city, postcode }
    },
    geometry
  };
}

function evaluate(sections, point) {
  return geometryApi.findNearestPointOnSections(sections, point, turfStub);
}

const [umlautStreet] = geometryApi.prepareStreetRecords([{
  name: "Müller-Straße",
  aliases: ["Müller-Str."]
}]);

assert.equal(
  geometryApi.normalizeStreetName("  MÜLLER–Straße "),
  geometryApi.normalizeStreetName("müller-str.")
);
assert.notEqual(
  geometryApi.normalizeStreetName("Am-Weg"),
  geometryApi.normalizeStreetName("Am Weg"),
  "Semantisch unterschiedliche Schreibweisen dürfen nicht blind vereinigt werden"
);
assert.ok(umlautStreet.id.startsWith("street-mueller-strasse-"));
assert.equal(umlautStreet.displayName, "Müller-Straße");

const shortGeometry = geometryApi.mergeStreetFeatures([
  roadFeature(1, "Müller-Straße", {
    type: "LineString",
    coordinates: [[10.95, 49.42], [10.951, 49.42]]
  })
], umlautStreet, [10.9, 49.4, 11.0, 49.5]);
assert.equal(shortGeometry.type, "MultiLineString");
assert.equal(shortGeometry.sections.length, 1, "Kurze Straße mit genau einem Abschnitt");
assert.ok(evaluate(shortGeometry.sections, [10.9505, 49.42]).distanceMeters < 0.01);

const [longStreet] = geometryApi.prepareStreetRecords([{ name: "Lange Straße" }]);
const longFeatures = [
  roadFeature(10, "Lange Straße", { type: "LineString", coordinates: [[10.94, 49.42], [10.95, 49.42]] }),
  roadFeature(11, "Lange Straße", { type: "LineString", coordinates: [[10.95, 49.42], [10.96, 49.42]] }),
  roadFeature(12, "Lange Straße", { type: "LineString", coordinates: [[10.96, 49.42], [10.97, 49.42]] }),
  roadFeature(13, "Andere Straße", { type: "LineString", coordinates: [[10.94, 49.43], [10.97, 49.43]] })
];
const matchingLongFeatures = longFeatures.filter(feature =>
  geometryApi.featureMatchesStreet(feature, longStreet)
  && geometryApi.featureBelongsToMunicipality(feature, "Oberasbach", "90522")
);
const longGeometry = geometryApi.mergeStreetFeatures(
  matchingLongFeatures, longStreet, [10.93, 49.4, 10.98, 49.44]
);
assert.equal(longGeometry.sections.length, 3, "Alle verbundenen OSM-Abschnitte bleiben erhalten");
for (const point of [[10.9401, 49.42], [10.955, 49.42], [10.9699, 49.42]]) {
  assert.ok(evaluate(longGeometry.sections, point).distanceMeters < 0.01,
    "Anfang, Mitte und Ende der langen Straße müssen Treffer sein");
}

const separated = [
  [[10.94, 49.41], [10.945, 49.41]],
  [[10.97, 49.435], [10.975, 49.435]]
];
const separatedResult = evaluate(separated, [10.972, 49.435]);
assert.equal(separatedResult.sectionIndex, 1, "Getrennter zweiter Abschnitt wird ausgewertet");
assert.ok(separatedResult.distanceMeters < 0.01);

const clipped = geometryApi.clipLineToBbox(
  [[-5, 5], [5, 5], [15, 5]],
  [0, 0, 10, 10]
);
assert.deepEqual(clipped, [[[0, 5], [5, 5], [10, 5]]],
  "Straße am Rand wird geometrisch geschnitten statt durch Punktfilter beschädigt");

const pointOnly = geometryApi.mergeStreetFeatures([
  roadFeature(20, "Lange Straße", { type: "Point", coordinates: [10.95, 49.42] })
], longStreet, [10.93, 49.4, 10.98, 49.44]);
assert.equal(pointOnly, null, "Punktantwort darf nicht als vollständige Straße gelten");

const farResult = evaluate(longGeometry.sections, [10.95, 49.44]);
assert.ok(farResult.distanceMeters > 2000, "Weit entfernter Klick bleibt weit entfernt");

global.window = {};
require("../data/oberasbach-streets.js");
const allStreets = geometryApi.prepareStreetRecords(global.window.OBERASBACH_STREETS);
assert.equal(allStreets.length, 271);
assert.equal(new Set(allStreets.map(street => street.id)).size, allStreets.length,
  "Jede lokale Straße besitzt eine eindeutige ID");

console.log("Geometrietests erfolgreich:");
console.log("- kurze Straße mit einem Abschnitt");
console.log("- lange Straße: Anfang, Mitte und Ende über drei Abschnitte");
console.log("- getrennte Abschnitte und Minimumsauswahl");
console.log("- Umlaut, Abkürzung und konservative Bindestrich-Normalisierung");
console.log("- Straße am Rand mit korrektem Clipping");
console.log("- Punktantwort abgelehnt und weit entfernter Klick erkannt");
console.log("- 271 eindeutige Straßen-IDs");
