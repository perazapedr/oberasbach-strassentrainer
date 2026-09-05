"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const areasApi = require("../custom-training-area.js");
const packageApi = require("../city-package.js");
const updateApi = require("../city-update.js");
const statisticsApi = require("../statistics.js");

const ROOT = path.join(__dirname, "..");
const CITY_ID = "test-city";
const CITY_BOUNDARY = { type: "Polygon", coordinates: [[[-1, -1], [11, -1], [11, 11], [-1, 11], [-1, -1]]] };

function makeArea(overrides = {}) {
  return areasApi.createArea({
    cityId: CITY_ID,
    name: "Prüfungsgebiet Nord",
    kind: "custom",
    points: [[1, 1], [5, 1], [5, 5], [1, 5]],
    cityBoundary: CITY_BOUNDARY,
    uuidFactory: () => "fixed-uuid",
    now: "2026-09-05T00:00:00.000Z",
    ...overrides
  });
}

function street(id, coordinates) {
  return { id, cityId: CITY_ID, geometry: { type: "MultiLineString", coordinates } };
}

function poi(id, lon, lat) {
  return { id, cityId: CITY_ID, position: { lon, lat }, longitude: lon, latitude: lat };
}

test("1. Legacy-Area ohne kind bleibt administrativ", () => {
  assert.equal(areasApi.areaKind({ id: "legacy" }), "administrative");
  assert.equal(areasApi.areaSource({ id: "legacy" }), "osm");
});

test("2. Custom-Area-Modell verwendet den bestehenden TrainingArea-Vertrag", () => {
  const area = makeArea();
  assert.equal(area.kind, "custom");
  assert.equal(area.source, "user");
  assert.equal(area.cityId, CITY_ID);
  assert.equal(area.boundary.type, "Polygon");
});

test("3. Feuerwehr-Einsatzgebiet unterscheidet sich nur semantisch", () => {
  const area = makeArea({ name: "LG Nord – Einsatzgebiet", kind: "response_area" });
  assert.equal(area.kind, "response_area");
  assert.equal(area.source, "user");
  assert.equal(area.boundary.type, "Polygon");
});

test("4. User-ID ist stabil, namensunabhängig und nicht der Name", () => {
  const area = makeArea();
  assert.equal(area.id, "user-area-fixed-uuid");
  assert.notEqual(area.id, area.name);
  assert.equal({ ...area, name: "Neuer Name" }.id, area.id);
});

test("5. Name darf nicht leer sein", () => assert.equal(areasApi.validateName("  ").code, "NAME_REQUIRED"));
test("6. Name ist auf 80 Zeichen begrenzt", () => assert.equal(areasApi.validateName("x".repeat(81)).code, "NAME_TOO_LONG"));

test("7. Doppelte Namen werden ohne Beachtung der Großschreibung blockiert", () => {
  assert.equal(areasApi.validateName("prüfungsgebiet nord", [makeArea()]).code, "NAME_DUPLICATE");
});

test("8. Polygon benötigt drei unterschiedliche Punkte", () => {
  assert.throws(() => makeArea({ points: [[1, 1], [2, 2], [1, 1]] }), { code: "POLYGON_TOO_SMALL" });
});

test("9. Polygon wird automatisch geschlossen", () => {
  const ring = makeArea().boundary.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("10. Selbstüberschneidendes Polygon wird blockiert", () => {
  assert.throws(() => makeArea({ points: [[1, 1], [5, 5], [1, 5], [5, 1]] }), /nicht selbst überschneiden|ungültig/);
});

test("11. Polygon außerhalb der Stadtgeometrie wird blockiert", () => {
  assert.throws(() => makeArea({ points: [[9, 9], [12, 9], [12, 12], [9, 12]] }), { code: "AREA_OUTSIDE_CITY" });
});

test("12. Containment verwendet Polygon statt nur BoundingBox", () => {
  const concave = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 3], [3, 3], [3, 10], [0, 10], [0, 0]]] };
  const gap = { type: "Polygon", coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] };
  assert.equal(areasApi.isContainedInCity(gap, concave), false);
});

test("13. Street-Membership umfasst innenliegende und kreuzende Straßen", () => {
  const result = areasApi.computeMembership(CITY_ID, makeArea(), [
    street("inside", [[[2, 2], [3, 3]]]),
    street("crossing", [[[0, 2], [2, 2]]]),
    street("outside", [[[8, 8], [9, 9]]])
  ], [], { force: true });
  assert.deepEqual([...result.streetIds].sort(), ["crossing", "inside"]);
});

test("14. MultiLineString wird über alle Abschnitte klassifiziert", () => {
  const result = areasApi.computeMembership(CITY_ID, makeArea(), [street("multi", [[[8, 8], [9, 9]], [[2, 2], [3, 2]]])], [], { force: true });
  assert.equal(result.streetIds.has("multi"), true);
});

test("15. Street wird nicht geteilt oder mutiert", () => {
  const original = street("crossing", [[[0, 2], [2, 2]]]);
  const snapshot = JSON.stringify(original);
  const result = areasApi.computeMembership(CITY_ID, makeArea(), [original], [], { force: true });
  assert.equal(result.streetTargets[0], original);
  assert.equal(JSON.stringify(original), snapshot);
});

test("16. POI-Membership verwendet Point-in-Polygon", () => {
  const result = areasApi.computeMembership(CITY_ID, makeArea(), [], [poi("inside", 2, 2), poi("outside", 8, 8)], { force: true });
  assert.deepEqual([...result.poiIds], ["inside"]);
});

test("17. Eine Straße darf mehreren User-Areas angehören", () => {
  const target = street("shared", [[[3, 3], [4, 4]]]);
  const first = areasApi.computeMembership(CITY_ID, makeArea(), [target], [], { force: true });
  const secondArea = makeArea({ name: "Zweites Gebiet", points: [[3, 3], [7, 3], [7, 7], [3, 7]], uuidFactory: () => "second" });
  const second = areasApi.computeMembership(CITY_ID, secondArea, [target], [], { force: true });
  assert.equal(first.streetIds.has("shared") && second.streetIds.has("shared"), true);
});

test("18. Membership wird für cityId + regionId gecacht", () => {
  areasApi.invalidateMembership();
  const area = makeArea();
  const first = areasApi.computeMembership(CITY_ID, area, [street("s", [[[2, 2], [3, 3]]])], []);
  assert.equal(areasApi.computeMembership(CITY_ID, area, [], []), first);
});

test("19. Cache-Invalidation erzwingt Neuberechnung", () => {
  const area = makeArea();
  const first = areasApi.computeMembership(CITY_ID, area, [], [], { force: true });
  areasApi.invalidateMembership(CITY_ID, area.id);
  assert.notEqual(areasApi.computeMembership(CITY_ID, area, [], []), first);
});

test("20. City-Switch verwendet getrennte Cache-Schlüssel", () => {
  const area = makeArea();
  const first = areasApi.computeMembership("city-a", area, [street("a", [[[2, 2], [3, 3]]])], [], { force: true });
  const second = areasApi.computeMembership("city-b", area, [], [], { force: true });
  assert.equal(first.streetIds.size, 1);
  assert.equal(second.streetIds.size, 0);
});

test("21. Null-Ziel-Gebiet darf gespeichert werden und liefert leere Targets", () => {
  const result = areasApi.computeMembership(CITY_ID, makeArea(), [street("far", [[[8, 8], [9, 9]]])], [poi("far", 8, 8)], { force: true });
  assert.equal(result.streetTargets.length, 0);
  assert.equal(result.poiTargets.length, 0);
});

test("22. Nur user-owned Custom/Response Areas sind löschbar", () => {
  assert.equal(areasApi.isUserArea(makeArea()), true);
  assert.equal(areasApi.isUserArea({ id: "osm", kind: "administrative", source: "osm" }), false);
  assert.equal(areasApi.isUserArea({ id: "curated", kind: "administrative", source: "curated" }), false);
});

test("23. Runtime enthält Guards für laufende Runde sowie ESC-Cancel", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(source, /isTrainingAreaChangeBlocked/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /trainingAreaEditorLayers\.clearLayers/);
});

test("24. Create und Membership verursachen keine Netzwerkabfrage", () => {
  let fetchCalls = 0;
  const previousFetch = global.fetch;
  global.fetch = async () => { fetchCalls += 1; throw new Error("unexpected fetch"); };
  try {
    const area = makeArea();
    areasApi.computeMembership(CITY_ID, area, [street("s", [[[2, 2], [3, 3]]])], [poi("p", 2, 2)], { force: true });
    assert.equal(fetchCalls, 0);
  } finally { global.fetch = previousFetch; }
});

test("25. Statistikschlüssel bleibt stadtbezogen und kennt keine Area", () => {
  const key = statisticsApi.getStatisticsStorageKey(CITY_ID);
  assert.equal(key, statisticsApi.getStatisticsStorageKey(CITY_ID));
  assert.doesNotMatch(key, /user-area|trainingArea/);
});

test("26. Paketexport und Hash schließen User-Areas aus", () => {
  const data = require("../data/cities/oberasbach.json");
  const localArea = makeArea({ cityId: data.city.id });
  const options = { package: data.package, exportedAt: "2026-09-05T00:00:00.000Z" };
  const plain = packageApi.createCityPackage(data.city, data.streets, data.pois, [], options);
  const withLocal = packageApi.createCityPackage(data.city, data.streets, data.pois, [localArea], options);
  assert.equal(withLocal.areas, undefined);
  assert.equal(withLocal.package.contentHash, plain.package.contentHash);
});

test("27. Paket-Diff ignoriert User-Areas", () => {
  const base = { city: { id: CITY_ID }, streets: [], pois: [], areas: [] };
  const current = { ...base, areas: [makeArea()] };
  const diff = updateApi.compareCityVersions(current, base);
  assert.equal(diff.summary.areas.totalCurrent, 0);
  assert.equal(diff.summary.hasChanges, false);
});

test("28. User-Area bleibt nach kompatibler Boundary-Änderung gültig", () => {
  const original = makeArea();
  const [updated] = areasApi.revalidateUserAreas([original], CITY_BOUNDARY);
  assert.equal(updated.invalid, false);
  assert.deepEqual(updated.boundary, original.boundary);
});

test("29. Boundary-Änderung markiert die Area ohne Löschen oder Clipping", () => {
  const original = makeArea();
  const smaller = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
  const result = areasApi.revalidateUserAreas([original], smaller);
  assert.equal(result.length, 1);
  assert.equal(result[0].invalid, true);
  assert.deepEqual(result[0].boundary, original.boundary);
});

test("30. CityStorage erhält User-Areas bei atomarem Stadtupdate", () => {
  const source = fs.readFileSync(path.join(ROOT, "city-storage.js"), "utf8");
  assert.match(source, /preserveUserAreas/);
  assert.match(source, /retainedUserAreas/);
});

test("31. Curated Upgrade revalidiert lokale Areas", () => {
  const source = fs.readFileSync(path.join(ROOT, "city-manager-ui.js"), "utf8");
  assert.match(source, /areasForCityReplacement/);
  assert.match(source, /revalidateUserAreas/);
});

test("32. Reload-Roundtrip erhält Modell und Membership", () => {
  const restored = JSON.parse(JSON.stringify(makeArea()));
  areasApi.invalidateMembership(CITY_ID, restored.id);
  assert.deepEqual([...areasApi.computeMembership(CITY_ID, restored, [street("s", [[[2, 2], [3, 3]]])], []).streetIds], ["s"]);
});

test("33. BBox-Vorfilter reduziert exakte Kandidaten", () => {
  const result = areasApi.computeMembership(CITY_ID, makeArea(), [
    street("near", [[[2, 2], [3, 3]]]),
    street("far-a", [[[20, 20], [21, 21]]]),
    street("far-b", [[[-20, -20], [-21, -21]]])
  ], [poi("near", 2, 2), poi("far", 50, 50)], { force: true });
  assert.equal(result.diagnostics.streetCandidates, 1);
  assert.equal(result.diagnostics.poiCandidates, 1);
});

test("34. Oberasbach bleibt 271 Straßen / 60 POIs mit gültigem Hash", () => {
  const data = require("../data/cities/oberasbach.json");
  assert.equal(data.streets.length, 271);
  assert.equal(data.pois.length, 60);
  const validation = require("../city-data-validator.js").validateCityPackage(data);
  assert.equal(validation.valid, true);
  assert.equal(validation.package.verification.status, "verified");
});

test("35. Aktive Runde zeigt einen Confirm und kann kontrolliert beendet werden", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const start = source.indexOf("function openTrainingAreaEditor()");
  const end = source.indexOf("function startTrainingAreaDrawing()", start);
  const handler = source.slice(start, end);
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /Aktuelle Runde beenden/);
  assert.match(handler, /resetGame\(\)/);
  assert.ok(handler.indexOf("window.confirm") < handler.indexOf("resetGame()"));
});

test("36. Ohne aktive Runde öffnet der Create-Handler den sichtbaren Editor", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const start = source.indexOf("function openTrainingAreaEditor()");
  const end = source.indexOf("function startTrainingAreaDrawing()", start);
  const handler = source.slice(start, end);
  assert.match(handler, /trainingAreaEditor\.classList\.remove\("hidden"\)/);
  assert.match(handler, /trainingAreaNameInput\.focus/);
});

test("37. Trainingsgebiet-Bereich steht zwischen Spielmodus und Inhalt", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const modeIndex = html.indexOf('id="modeSelect"');
  const areaIndex = html.indexOf('id="trainingAreaControls"');
  const contentIndex = html.indexOf('class="content-settings"');
  assert.ok(modeIndex >= 0 && modeIndex < areaIndex && areaIndex < contentIndex);
});

test("38. Selector zeigt Gesamte Stadt auch ohne zusätzliche Areas", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /<option value="">Gesamte Stadt<\/option>/);
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(source, /trainingAreaFieldGroup\.classList\.remove\("hidden"\)/);
});

test("39. Vorhandene Custom Areas werden in denselben Selector eingefügt", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(source, /const userAreas = areas\.filter/);
  assert.match(source, /option\.value = area\.id/);
  assert.match(source, /trainingAreaSelect\.appendChild\(option\)/);
});

test("40. Area-Selector und seine Handler existieren jeweils nur einmal", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.equal((html.match(/id="trainingAreaSelect"/g) || []).length, 1);
  assert.equal((source.match(/addEventListener\("change", handleTrainingAreaChange\)/g) || []).length, 1);
  assert.equal((source.match(/addEventListener\("click", openTrainingAreaEditor\)/g) || []).length, 1);
});

function fakeLeafletMap() {
  const listeners = new Map();
  const originalMaxBounds = { id: "normal-game-bounds" };
  const map = {
    options: { maxBounds: originalMaxBounds },
    center: { x: 0, y: 0 },
    dragging: { enabled: () => true },
    scrollWheelZoom: { enabled: () => true },
    touchZoom: { enabled: () => true },
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return this;
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
      return this;
    },
    fire(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    listenerCount(type) { return listeners.get(type)?.size || 0; },
    setMaxBounds(bounds) {
      this.options.maxBounds = bounds;
      return this;
    },
    panBy([horizontal, vertical]) {
      if (this.options.maxBounds === null) {
        this.center.x += horizontal;
        this.center.y += vertical;
      }
      return this;
    }
  };
  return map;
}

test("41. Zeichnen verwendet ein Floating Panel ohne modalen Backdrop", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  const editorTag = html.match(/<section id="trainingAreaEditor"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(editorTag, /aria-modal|role="dialog"/);
  assert.match(css, /\.training-area-editor\s*\{[\s\S]*position:\s*absolute/);
  assert.doesNotMatch(editorTag, /city-modal-overlay|backdrop/);
});

test("42. Map-Klick setzt einen Punkt; Drag/Zoom bleiben Leaflet überlassen", () => {
  const map = fakeLeafletMap();
  const points = [];
  const controller = areasApi.createMapDrawingController(map, { onPoint: latlng => points.push(latlng) });
  controller.start();
  assert.equal(map.dragging.enabled(), true);
  assert.equal(map.scrollWheelZoom.enabled(), true);
  assert.equal(map.touchZoom.enabled(), true);
  map.fire("click", { latlng: { lat: 49.4, lng: 10.9 } });
  assert.deepEqual(points, [{ lat: 49.4, lng: 10.9 }]);
  map.fire("mousedown");
  map.fire("mousemove");
  map.fire("mouseup");
  map.fire("zoomend");
  assert.equal(points.length, 1, "Drag und Zoom ohne Leaflet-click dürfen keinen Punkt erzeugen");
});

test("42b. Leaflet LatLng wird explizit als GeoJSON longitude/latitude übernommen", () => {
  const actual = areasApi.leafletLatLngToGeoJsonCoordinate({ lat: 49.43, lng: 10.95 });
  assert.deepEqual(actual, [10.95, 49.43]);
  assert.notDeepEqual(actual, [49.43, 10.95]);
});

test("42c. Browsernaher Klickpfad erzeugt ein gültiges inneres GeoJSON-Polygon", () => {
  const cityBoundary = { type: "Polygon", coordinates: [[
    [10.90, 49.40], [11.00, 49.40], [11.00, 49.50], [10.90, 49.50], [10.90, 49.40]
  ]] };
  const map = fakeLeafletMap();
  const points = [];
  const controller = areasApi.createMapDrawingController(map, {
    onPoint: latlng => points.push(areasApi.leafletLatLngToGeoJsonCoordinate(latlng))
  });
  controller.start();
  for (const latlng of [
    { lat: 49.42, lng: 10.93 }, { lat: 49.42, lng: 10.96 },
    { lat: 49.45, lng: 10.96 }, { lat: 49.45, lng: 10.93 }
  ]) map.fire("click", { latlng });
  assert.deepEqual(points[0], [10.93, 49.42]);
  const area = areasApi.createArea({
    cityId: CITY_ID,
    name: "Browsernah innen",
    kind: "custom",
    points,
    cityBoundary,
    uuidFactory: () => "browsernah"
  });
  assert.equal(areasApi.isContainedInCity(area.boundary, cityBoundary), true);
  assert.deepEqual(area.boundary.coordinates[0][0], area.boundary.coordinates[0].at(-1));
});

test("42d. Editor löst maxBounds temporär und ermöglicht horizontales wie vertikales Pan", () => {
  const map = fakeLeafletMap();
  const originalMaxBounds = map.options.maxBounds;
  const controller = areasApi.createMapDrawingController(map);
  controller.start();
  assert.equal(controller.getSavedMaxBounds(), originalMaxBounds);
  assert.equal(map.options.maxBounds, null);
  map.panBy([120, 0]);
  map.panBy([0, 80]);
  assert.deepEqual(map.center, { x: 120, y: 80 });
});

test("43. Cancel und Finish entfernen den temporären Kartenlistener", () => {
  const cancelMap = fakeLeafletMap();
  const cancelBounds = cancelMap.options.maxBounds;
  const cancelController = areasApi.createMapDrawingController(cancelMap);
  cancelController.start();
  assert.equal(cancelMap.listenerCount("click"), 1);
  cancelController.cancel();
  assert.equal(cancelMap.listenerCount("click"), 0);
  assert.equal(cancelMap.options.maxBounds, cancelBounds);

  const finishMap = fakeLeafletMap();
  const finishBounds = finishMap.options.maxBounds;
  const finishController = areasApi.createMapDrawingController(finishMap);
  finishController.start();
  finishController.finish();
  assert.equal(finishMap.listenerCount("click"), 0);
  assert.equal(finishMap.options.maxBounds, finishBounds);
});

test("44. Wiederholter Editorstart erzeugt keinen Listener-Leak", () => {
  const map = fakeLeafletMap();
  const originalMaxBounds = map.options.maxBounds;
  const controller = areasApi.createMapDrawingController(map);
  for (let index = 0; index < 5; index += 1) {
    controller.start();
    controller.start();
    assert.equal(map.listenerCount("click"), 1);
    controller.stop();
    assert.equal(map.listenerCount("click"), 0);
    assert.equal(map.options.maxBounds, originalMaxBounds);
  }
});

test("45. Undo, Finish und Cancel bleiben an die kompakten Controls gebunden", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(source, /function undoTrainingAreaPoint\(\)[\s\S]*points\.pop\(\)/);
  assert.match(source, /finishTrainingAreaButton\.addEventListener\("click", finishTrainingAreaDrawing\)/);
  assert.match(source, /cancelTrainingAreaDrawingButton\.addEventListener\("click", closeTrainingAreaEditor\)/);
  assert.match(source, /function closeTrainingAreaEditor\(\)[\s\S]*trainingAreaDrawingController\?\.stop\(\)/);
});

test("46. Floating Panel besitzt eine begrenzte mobile Breite und kompakte Buttons", () => {
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.match(css, /width:\s*min\(340px, calc\(100vw - 24px\)\)/);
  assert.match(css, /\.training-area-editor \.training-area-editor-actions button\s*\{[\s\S]*min-height:\s*36px/);
});

test("47. Containment unterscheidet innen, teilweise außen, vollständig außen und Rand", () => {
  const city = { type: "Polygon", coordinates: [[
    [10.90, 49.40], [11.00, 49.40], [11.00, 49.50], [10.90, 49.50], [10.90, 49.40]
  ]] };
  const polygon = points => areasApi.normalizePolygon(points);
  assert.equal(areasApi.isContainedInCity(polygon([
    [10.93, 49.42], [10.96, 49.42], [10.96, 49.45], [10.93, 49.45]
  ]), city), true);
  assert.equal(areasApi.isContainedInCity(polygon([
    [10.98, 49.42], [11.01, 49.42], [11.01, 49.45], [10.98, 49.45]
  ]), city), false);
  assert.equal(areasApi.isContainedInCity(polygon([
    [11.10, 49.60], [11.20, 49.60], [11.20, 49.70], [11.10, 49.70]
  ]), city), false);
  assert.equal(areasApi.isContainedInCity(polygon([
    [10.90, 49.42], [10.96, 49.42], [10.96, 49.45], [10.90, 49.45]
  ]), city), true, "Ein Polygon auf der Stadtgrenze bleibt zulässig");
});

test("48. Polygon-Containment berücksichtigt alle Komponenten einer MultiPolygon-Stadt", () => {
  const multiPolygon = { type: "MultiPolygon", coordinates: [
    [[[10.0, 49.0], [10.2, 49.0], [10.2, 49.2], [10.0, 49.2], [10.0, 49.0]]],
    [[[10.9, 49.4], [11.0, 49.4], [11.0, 49.5], [10.9, 49.5], [10.9, 49.4]]]
  ] };
  const insideSecondComponent = areasApi.normalizePolygon([
    [10.93, 49.42], [10.96, 49.42], [10.96, 49.45], [10.93, 49.45]
  ]);
  assert.equal(areasApi.isContainedInCity(insideSecondComponent, multiPolygon), true);
});

test("49. Echtes inneres Oberasbach-Polygon wird nicht fälschlich abgelehnt", () => {
  const cityPackage = require("../data/cities/oberasbach.json");
  const area = makeArea({
    cityId: cityPackage.city.id,
    name: "Oberasbach Mitte",
    points: [[10.9500, 49.4300], [10.9510, 49.4300], [10.9510, 49.4310], [10.9500, 49.4310]],
    cityBoundary: cityPackage.boundary
  });
  assert.equal(areasApi.isContainedInCity(area.boundary, cityPackage.boundary), true);
});

test("50. Fehlende City Boundary wird nicht als fachliches Außerhalb ausgegeben", () => {
  assert.throws(() => makeArea({ cityBoundary: null }), error => (
    error.code === "CITY_BOUNDARY_REQUIRED" && !/außerhalb/.test(error.message)
  ));
});

test("51. Punktänderung und erfolgreicher Abschluss entfernen einen alten Boundary-Fehler", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const addStart = source.indexOf("function addTrainingAreaPoint");
  const undoStart = source.indexOf("function undoTrainingAreaPoint");
  const finishStart = source.indexOf("async function finishTrainingAreaDrawing");
  assert.match(source.slice(addStart, undoStart), /setTrainingAreaEditorMessage\(""\)/);
  assert.match(source.slice(undoStart, finishStart), /setTrainingAreaEditorMessage\(""\)/);
  assert.match(source.slice(finishStart, source.indexOf("async function deleteActiveTrainingArea")), /closeTrainingAreaEditor\(\)/);
});

test("52. Bestehende Oberasbach-Installation erhält die gebündelte Boundary ohne IDB-Mutation", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(source, /cityId === defaultCityApi\.DEFAULT_CITY_ID/);
  assert.match(source, /defaultCityApi\.loadBundledDefaultCity\(\)/);
  assert.match(source, /cityData = \{ \.\.\.cityData, boundary: bundledCity\.boundary \}/);
});
