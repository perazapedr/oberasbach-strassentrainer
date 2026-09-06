"use strict";

const assert = require("node:assert/strict");
const {
  REQUIRED_METHODS,
  DatasetProviderError,
  assertDatasetProvider,
  createLegacyOsmDatasetProvider,
  createStaticDatasetProvider
} = require("../dataset-provider.js");

const tests = [];
function test(name, run) { tests.push({ name, run }); }

function metadata(overrides = {}) {
  return {
    id: "static-teststadt",
    name: "Teststadt",
    displayName: "Teststadt",
    datasetKind: "municipality",
    state: "Bayern",
    country: "Deutschland",
    ...overrides
  };
}

function dataset() {
  return { city: { id: "static-teststadt", name: "Teststadt" }, streets: [], pois: [] };
}

test("öffentlicher Contract enthält die vier Phase-15.1-Methoden", () => {
  assert.deepEqual(REQUIRED_METHODS, [
    "searchDatasets", "getDatasetMetadata", "downloadDataset", "checkForUpdate"
  ]);
  const provider = createStaticDatasetProvider([{ metadata: metadata(), dataset: dataset() }]);
  assert.equal(assertDatasetProvider(provider), provider);
  REQUIRED_METHODS.forEach(method => assert.equal(typeof provider[method], "function"));
});

test("Static Provider sucht normalisierte, quellneutrale Kandidaten", async () => {
  const provider = createStaticDatasetProvider([{ metadata: metadata(), dataset: dataset() }]);
  const [result] = await provider.searchDatasets(" test ");
  assert.deepEqual(result, metadata({ provider: "static" }));
  assert.equal(provider.requiresNetwork("search"), false);
});

test("Static Provider liefert Metadaten und eine neutrale Dataset-Hülle", async () => {
  const source = dataset();
  const provider = createStaticDatasetProvider([{ metadata: metadata(), dataset: source }]);
  const result = await provider.downloadDataset("static-teststadt");
  assert.equal(result.datasetId, "static-teststadt");
  assert.equal(result.metadata.provider, "static");
  assert.deepEqual(result.dataset, source);
  assert.notEqual(result.dataset, source);
});

test("Static Provider meldet unbekannte Datasets kontrolliert", async () => {
  const provider = createStaticDatasetProvider([]);
  await assert.rejects(
    provider.downloadDataset("fehlt"),
    error => error instanceof DatasetProviderError && error.code === "DATASET_NOT_FOUND"
  );
});

test("Static Provider respektiert ein bereits abgebrochenes Signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = createStaticDatasetProvider([{ metadata: metadata(), dataset: dataset() }]);
  await assert.rejects(
    provider.downloadDataset("static-teststadt", { signal: controller.signal }),
    error => error.code === "ABORTED"
  );
});

test("Legacy Provider delegiert Suche, normalisiert Kandidaten und reicht Abort weiter", async () => {
  const calls = [];
  const controller = new AbortController();
  const service = {
    async searchMunicipalities(query, options) {
      calls.push({ query, options });
      return [{ name: "Oberasbach", osmType: "relation", osmId: 1016396, state: "Bayern" }];
    },
    async fetchCityData() { throw new Error("nicht aufrufen"); }
  };
  const provider = createLegacyOsmDatasetProvider(service);
  const [result] = await provider.searchDatasets("Oberasbach", { signal: controller.signal });
  assert.equal(result.id, "osm-relation-1016396");
  assert.equal(result.provider, "legacy-osm");
  assert.equal(result.datasetKind, "municipality");
  assert.equal(calls[0].options.signal, controller.signal);
});

test("Legacy Provider delegiert Download und Progress ohne Overpass-Code zu kopieren", async () => {
  let receivedCandidate;
  let receivedOptions;
  const rawDataset = dataset();
  const provider = createLegacyOsmDatasetProvider({
    async searchMunicipalities() {
      return [{ name: "Oberasbach", osmType: "relation", osmId: 1016396 }];
    },
    async fetchCityData(candidate, options) {
      receivedCandidate = candidate;
      receivedOptions = options;
      return rawDataset;
    }
  });
  const [candidate] = await provider.searchDatasets("Oberasbach");
  const onProgress = () => {};
  const controller = new AbortController();
  const result = await provider.downloadDataset(candidate.id, { signal: controller.signal, onProgress });
  assert.equal(receivedCandidate, candidate);
  assert.equal(receivedOptions.signal, controller.signal);
  assert.equal(receivedOptions.onProgress, onProgress);
  assert.equal(result.dataset, rawDataset);
});

test("Legacy Provider kapselt Update-Download über checkForUpdate", async () => {
  let received;
  const provider = createLegacyOsmDatasetProvider({
    async fetchCityData(candidate) { received = candidate; return dataset(); }
  });
  const result = await provider.checkForUpdate({
    id: "osm-relation-7", name: "Update-Stadt", osmType: "relation", osmId: 7
  });
  assert.equal(received.id, "osm-relation-7");
  assert.equal(result.datasetId, "osm-relation-7");
});

test("Legacy Provider normalisiert unbekannte Servicefehler, erhält bestehende Codes aber", async () => {
  const unknownProvider = createLegacyOsmDatasetProvider({
    async searchMunicipalities() { throw new Error("kaputt"); }
  });
  await assert.rejects(unknownProvider.searchDatasets("X"), error => error.code === "SEARCH_FAILED");

  const codedProvider = createLegacyOsmDatasetProvider({
    async searchMunicipalities() { const error = new Error("timeout"); error.code = "TIMEOUT"; throw error; }
  });
  await assert.rejects(codedProvider.searchDatasets("X"), error => error.code === "TIMEOUT");
});

(async () => {
  let passed = 0;
  for (const entry of tests) {
    try {
      await entry.run();
      passed += 1;
      console.log(`✓ ${entry.name}`);
    } catch (error) {
      console.error(`✗ ${entry.name}`);
      console.error(error);
    }
  }
  console.log(`\n${passed}/${tests.length} Dataset-Provider-Tests bestanden.`);
  if (passed !== tests.length) process.exitCode = 1;
})();
