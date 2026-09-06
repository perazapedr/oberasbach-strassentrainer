"use strict";

const assert = require("node:assert/strict");
const { createStaticDatasetProvider } = require("../dataset-provider.js");
const validator = require("../city-data-validator.js");
const { createCityStorage } = require("../city-storage.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");

const CITY_ID = "osm-relation-999999";

function staticDataset() {
  const streets = Array.from({ length: 5 }, (_, index) => ({
    id: `${CITY_ID}:street:${index + 1}`,
    cityId: CITY_ID,
    name: `Teststraße ${index + 1}`,
    aliases: [],
    geometry: {
      type: "MultiLineString",
      coordinates: [[
        [10.002 + index * 0.003, 49.002],
        [10.003 + index * 0.003, 49.004]
      ]]
    },
    osmWayIds: [index + 1]
  }));
  return {
    city: {
      id: CITY_ID,
      name: "Static Teststadt",
      displayName: "Static Teststadt",
      bounds: { south: 49, west: 10, north: 49.02, east: 10.02 },
      center: { lat: 49.01, lon: 10.01 },
      osmType: "relation",
      osmId: 999999,
      source: "static-test",
      dataVersion: 1
    },
    boundary: {
      type: "Polygon",
      coordinates: [[[10, 49], [10.02, 49], [10.02, 49.02], [10, 49.02], [10, 49]]]
    },
    streets,
    pois: [{
      id: `${CITY_ID}:poi:fire-station`,
      cityId: CITY_ID,
      name: "Feuerwehr Static Teststadt",
      category: "fire_station",
      aliases: [],
      position: { lat: 49.01, lon: 10.01 },
      geometry: null,
      osmType: "node",
      osmId: 9001,
      tags: { amenity: "fire_station" }
    }]
  };
}

(async () => {
  let nominatimCalls = 0;
  let overpassCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input && input.url ? input.url : input);
    if (url.includes("nominatim")) nominatimCalls += 1;
    if (url.includes("overpass") || url.includes("/api/interpreter")) overpassCalls += 1;
    throw new Error(`Unerwarteter Netzwerkaufruf: ${url}`);
  };
  const source = staticDataset();
  const provider = createStaticDatasetProvider([{
    metadata: {
      id: CITY_ID,
      name: source.city.name,
      displayName: source.city.displayName,
      datasetKind: "municipality",
      state: "Bayern",
      country: "Deutschland"
    },
    dataset: source
  }], { providerId: "phase-15.1-test" });

  const candidates = await provider.searchDatasets("Static");
  assert.equal(candidates.length, 1);
  const downloaded = await provider.downloadDataset(candidates[0].id);

  const validated = validator.validateCityData(downloaded.dataset, { sourceMode: "download" });
  assert.equal(validated.valid, true);
  assert.equal(validated.streets.length, 5);
  assert.equal(validated.pois.length, 1);

  const storage = createCityStorage({
    dbName: "phase-15-1-provider-integration",
    indexedDB: new MockIndexedDB(),
    IDBKeyRange: MockIDBKeyRange,
    localStorage: createMemoryStorage(),
    activeCityStorageKey: "phase-15-1-active-city"
  });
  const city = validated.boundary && !validated.city.boundary
    ? { ...validated.city, boundary: validated.boundary }
    : validated.city;
  await storage.saveCity(city, validated.streets, validated.pois, validated.areas || []);
  assert.deepEqual((await storage.getAllCities()).map(entry => entry.id), [CITY_ID]);
  await storage.setActiveCityId(city.id);

  const active = await storage.getActiveCityData();
  assert.equal(active.city.id, CITY_ID);
  assert.equal(active.streets.length, 5);
  assert.equal(active.pois.length, 1);

  const cityContext = {
    metadata: active.city,
    streetTargets: targetApi.prepareStreetTargets(active.streets, geometryApi),
    poiTargets: targetApi.preparePoiTargets(active.pois, [{ id: "fire_station", label: "Feuerwehr" }])
  };
  assert.equal(cityContext.metadata.id, CITY_ID);
  assert.equal(cityContext.streetTargets.length, 5);
  assert.equal(cityContext.poiTargets.length, 1);
  assert.equal(nominatimCalls, 0);
  assert.equal(overpassCalls, 0);
  globalThis.fetch = originalFetch;

  console.log("✓ Static Dataset -> DatasetProvider -> Validator -> IndexedDB -> aktiver CityContext");
  console.log(`✓ Nominatim-Aufrufe: ${nominatimCalls}`);
  console.log(`✓ Overpass-Aufrufe: ${overpassCalls}`);
  console.log("\n1/1 Dataset-Provider-Integrationstests bestanden.");
})().catch(error => {
  console.error("✗ Dataset-Provider-Integrationstest fehlgeschlagen");
  console.error(error);
  process.exitCode = 1;
});
