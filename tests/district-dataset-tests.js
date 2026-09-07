"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const validator = require("../city-data-validator.js");
const geometry = require("../geometry.js");
const targets = require("../targets.js");
const poiCategories = require("../poi-categories.js");
const turf = require("../vendor/turf/turf.min.js");
const { createCatalogDatasetProvider } = require("../dataset-provider.js");
const { createCityStorage } = require("../city-storage.js");
const { createStatisticsStore, getStatisticsStorageKey } = require("../statistics.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const ROOT = path.resolve(__dirname, "..");
const DISTRICT_FILE = path.join(ROOT, "data/cities/de-nw-kreis-olpe.json");
const CATALOG_FILE = path.join(ROOT, "data/catalog.json");
const EXPECTED_MUNICIPALITIES = new Map([
  ["Attendorn", [163178, "05966004"]],
  ["Drolshagen", [163174, "05966008"]],
  ["Finnentrop", [163177, "05966012"]],
  ["Kirchhundem", [163175, "05966016"]],
  ["Lennestadt", [1891508, "05966020"]],
  ["Olpe", [163179, "05966024"]],
  ["Wenden", [160880, "05966028"]]
]);

function readDistrict() {
  return JSON.parse(fs.readFileSync(DISTRICT_FILE, "utf8"));
}

test("17.1 Kreisrelation, Package-Identität, Boundary und Validatoren", () => {
  const pkg = readDistrict();
  assert.equal(pkg.package.id, "de-nw-kreis-olpe");
  assert.equal(pkg.package.datasetKind, "district");
  assert.equal(pkg.city.id, "osm-relation-1891506");
  assert.equal(pkg.city.adminLevel, 6);
  assert.equal(pkg.city.officialMunicipalityKey, "05966");
  assert.equal(pkg.boundary.type, "Polygon");
  assert.equal(pkg.provenance.districtRelation, 1891506);
  assert.equal(pkg.provenance.rawRelationName, "Kreis Olpe");
  assert.equal(validator.verifyPackageHash(pkg).valid, true);
  assert.equal(validator.validateCityPackage(pkg).valid, true);
  assert.equal(validator.validateCityData(pkg, { sourceMode: "download" }).valid, true);
});

test("17.2 Mitgliedskommunen sind vollständig, amtlich identifiziert und ohne Nachbarn", () => {
  const pkg = readDistrict();
  assert.equal(pkg.areas.length, EXPECTED_MUNICIPALITIES.size);
  assert.deepEqual(pkg.areas.map(area => area.name).sort(), [...EXPECTED_MUNICIPALITIES.keys()].sort());
  for (const area of pkg.areas) {
    const expected = EXPECTED_MUNICIPALITIES.get(area.name);
    assert.ok(expected, `Fremde Municipality im District: ${area.name}`);
    assert.equal(area.osmId, expected[0]);
    assert.equal(area.officialMunicipalityKey, expected[1]);
    assert.equal(area.adminLevel, 8);
    assert.equal(area.parentId, pkg.city.id);
    assert.equal(area.kind, "administrative");
    assert.equal(area.source, "osm");
    assert.equal(area.areaType, "municipality");
    assert.equal(area.official, true);
    assert.ok(["Polygon", "MultiPolygon"].includes((area.polygon || area.geometry).type));
    assert.ok(area.streetCount > 0, `${area.name} muss Straßen enthalten`);
    assert.ok(area.poiCount > 0, `${area.name} muss POIs enthalten`);
  }
});

test("17.3 Street Identity und Municipality-Dedupe sind fachlich getrennt", () => {
  const pkg = readDistrict();
  const byName = new Map();
  for (const street of pkg.streets) {
    assert.ok(EXPECTED_MUNICIPALITIES.has(street.municipalityName));
    assert.ok(street.areaIds.includes(street.municipalityId));
    assert.match(street.id, new RegExp(`^${pkg.city.id}:osm-relation-\\d+:street-`));
    const name = geometry.normalizeStreetName(street.name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(street);
  }
  const crossMunicipalityDuplicates = [...byName.values()].filter(group => new Set(group.map(street => street.municipalityId)).size > 1);
  assert.ok(crossMunicipalityDuplicates.length > 0);
  for (const group of crossMunicipalityDuplicates) {
    assert.equal(new Set(group.map(street => street.id)).size, group.length);
    assert.ok(group.every(street => street.displayName === `${street.name} · ${street.municipalityName}`));
  }
  assert.ok(pkg.streets.some(street => street.osmWayIds.length > 1), "Way-Merge innerhalb einer Municipality muss erhalten bleiben");
  const wayMunicipalities = new Map();
  for (const street of pkg.streets) for (const wayId of street.osmWayIds) {
    if (!wayMunicipalities.has(wayId)) wayMunicipalities.set(wayId, new Set());
    wayMunicipalities.get(wayId).add(street.municipalityId);
  }
  assert.ok([...wayMunicipalities.values()].some(ids => ids.size > 1), "Grenz-Way muss deterministisch in Municipality-Segmente geteilt sein");
});

test("17.4 POIs besitzen OSM-Provenienz und Municipality Membership", () => {
  const pkg = readDistrict();
  for (const poi of pkg.pois) {
    assert.ok(["node", "way", "relation"].includes(poi.osmType));
    assert.ok(Number.isSafeInteger(poi.osmId) && poi.osmId > 0);
    assert.ok(EXPECTED_MUNICIPALITIES.has(poi.municipalityName));
    assert.ok(poi.areaIds.includes(poi.municipalityId));
    assert.ok(poiCategories.getById(poi.category));
  }
});

test("17.5 Catalog findet Municipality Olpe und Kreis Olpe typisiert", async () => {
  const provider = createCatalogDatasetProvider(CATALOG_FILE);
  const results = await provider.searchDatasets("Olpe");
  const municipality = results.find(result => result.id === "de-nw-olpe");
  const district = results.find(result => result.id === "de-nw-kreis-olpe");
  assert.ok(municipality);
  assert.ok(district);
  assert.equal(municipality.datasetKind, "municipality");
  assert.equal(district.datasetKind, "district");
});

test("17.6 IndexedDB, Targets und Statistik bleiben zwischen District und Municipality isoliert", async () => {
  const district = readDistrict();
  const olpe = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-olpe.json"), "utf8"));
  const localStorage = createMemoryStorage();
  const storage = createCityStorage({
    indexedDB: new MockIndexedDB(), IDBKeyRange: MockIDBKeyRange, localStorage,
    dbName: "phase-17-district-storage", activeCityStorageKey: "phase-17-active"
  });
  await storage.saveCity(district.city, district.streets, district.pois, district.areas);
  await storage.saveCity(olpe.city, olpe.streets, olpe.pois, olpe.areas || []);
  const districtStored = await storage.getCityData(district.city.id);
  const olpeStored = await storage.getCityData(olpe.city.id);
  assert.equal(districtStored.streets.length, 2756);
  assert.equal(olpeStored.streets.length, 461);
  assert.notEqual(districtStored.city.id, olpeStored.city.id);

  const streetTargets = targets.prepareStreetTargets(districtStored.streets, geometry);
  const poiTargets = targets.preparePoiTargets(districtStored.pois, poiCategories.getAll());
  assert.equal(streetTargets.length, 2756);
  assert.equal(poiTargets.length, 623);
  assert.ok(streetTargets.every(target => targets.isValidTargetGeometry(target, geometry)));
  assert.ok(poiTargets.every(target => targets.isValidTargetGeometry(target, geometry)));

  const districtStats = createStatisticsStore(localStorage, getStatisticsStorageKey(district.city.id), { cityId: district.city.id, cityName: district.city.name });
  const olpeStats = createStatisticsStore(localStorage, getStatisticsStorageKey(olpe.city.id), { cityId: olpe.city.id, cityName: olpe.city.name });
  districtStats.recordRound({ roundId: "district-round", mode: "free", targetType: "street", targetId: streetTargets[0].id, targetName: streetTargets[0].displayName, points: 500, distanceMeters: 100, durationSeconds: 2 });
  assert.equal(districtStats.getSnapshot().overall.roundsEvaluated, 1);
  assert.equal(olpeStats.getSnapshot().overall.roundsEvaluated, 0);
  assert.notEqual(districtStats.getStorageKey(), olpeStats.getStorageKey());
});

test("17.7 Performance-Messpfad: parse, validate, IDB und Target Prep", async t => {
  const raw = fs.readFileSync(DISTRICT_FILE, "utf8");
  const parseStart = performance.now();
  const pkg = JSON.parse(raw);
  const parseMs = performance.now() - parseStart;
  const validateStart = performance.now();
  const validated = validator.validateCityData(pkg, { sourceMode: "download" });
  const validationMs = performance.now() - validateStart;
  const targetStart = performance.now();
  targets.prepareStreetTargets(validated.streets, geometry);
  targets.preparePoiTargets(validated.pois, poiCategories.getAll());
  const targetPrepMs = performance.now() - targetStart;
  const storage = createCityStorage({ indexedDB: new MockIndexedDB(), IDBKeyRange: MockIDBKeyRange, localStorage: createMemoryStorage(), dbName: "phase-17-performance" });
  const saveStart = performance.now();
  await storage.saveCity(validated.city, validated.streets, validated.pois, validated.areas);
  const saveMs = performance.now() - saveStart;
  const loadStart = performance.now();
  await storage.getCityData(validated.city.id);
  const loadMs = performance.now() - loadStart;
  t.diagnostic(JSON.stringify({ rawBytes: Buffer.byteLength(raw), parseMs, validationMs, saveMs, loadMs, targetPrepMs }));
  for (const value of [parseMs, validationMs, saveMs, loadMs, targetPrepMs]) assert.ok(Number.isFinite(value) && value >= 0);
});

test("17.8 Municipality Areas und ihre tatsächlichen Targets liegen geometrisch im Kreis/Area", () => {
  const pkg = readDistrict();
  const districtFeature = turf.feature(pkg.boundary);
  const areasById = new Map(pkg.areas.map(area => [area.id, area]));
  for (const area of pkg.areas) {
    assert.equal(area.id, `osm-relation-${area.osmId}`);
    assert.equal(turf.booleanWithin(turf.feature(area.polygon), districtFeature), true, `${area.name} liegt im District`);
    const areaStreets = pkg.streets.filter(street => street.areaIds.includes(area.id));
    const areaPois = pkg.pois.filter(poi => poi.areaIds.includes(area.id));
    assert.equal(areaStreets.length, area.streetCount);
    assert.equal(areaPois.length, area.poiCount);
  }

  for (const street of pkg.streets) {
    const area = areasById.get(street.municipalityId);
    const areaFeature = turf.feature(area.polygon);
    for (const line of street.geometry.coordinates) {
      const lineFeature = turf.lineString(line);
      const lengthKm = turf.length(lineFeature, { units: "kilometers" });
      assert.ok(lengthKm > 0.000001, `${street.id} enthält kein numerisches Nullsegment`);
      const midpoint = turf.along(lineFeature, lengthKm / 2, { units: "kilometers" });
      assert.equal(turf.booleanPointInPolygon(midpoint, areaFeature, { ignoreBoundary: false }), true, `${street.id} gehört geometrisch zu ${area.name}`);
    }
  }
  for (const poi of pkg.pois) {
    const area = areasById.get(poi.municipalityId);
    const point = turf.point([poi.position.lon, poi.position.lat]);
    assert.equal(turf.booleanPointInPolygon(point, turf.feature(area.polygon), { ignoreBoundary: false }), true, `${poi.id} gehört geometrisch zu ${area.name}`);
  }
});

test("17.9 District-Update ersetzt offizielle Areas und erhält lokale Custom Areas", async () => {
  const pkg = readDistrict();
  const storage = createCityStorage({
    indexedDB: new MockIndexedDB(), IDBKeyRange: MockIDBKeyRange, localStorage: createMemoryStorage(),
    dbName: "phase-17-1-custom-area-update", activeCityStorageKey: "phase-17-1-custom-active"
  });
  const custom = {
    ...pkg.areas.find(area => area.name === "Olpe"),
    id: "custom-response-area-olpe",
    name: "Eigenes Einsatzgebiet",
    kind: "response_area",
    source: "user",
    official: false,
    areaType: "response_area",
    parentId: null,
    osmType: null,
    osmId: null,
    officialMunicipalityKey: null,
    regionalKey: null
  };
  await storage.saveCity(pkg.city, pkg.streets, pkg.pois, [...pkg.areas, custom]);
  const updatedOfficialAreas = pkg.areas.map(area => area.name === "Olpe" ? { ...area, poiCount: area.poiCount + 1 } : area);
  await storage.saveCity(pkg.city, pkg.streets, pkg.pois, updatedOfficialAreas);
  const storedAreas = await storage.getCityAreas(pkg.city.id);
  assert.equal(storedAreas.length, pkg.areas.length + 1);
  assert.ok(storedAreas.some(area => area.id === custom.id && area.source === "user"));
  assert.equal(storedAreas.find(area => area.name === "Olpe" && area.source === "osm").poiCount, 115);
});
