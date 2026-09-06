"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  REQUIRED_METHODS,
  DatasetProviderError,
  assertDatasetProvider,
  createCatalogDatasetProvider
} = require("../dataset-provider.js");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "data/catalog.json");
const catalogData = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("CatalogDatasetProvider erfüllt den öffentlichen Provider Contract", () => {
  const provider = createCatalogDatasetProvider(catalogData);
  assert.equal(assertDatasetProvider(provider), provider);
  REQUIRED_METHODS.forEach(method => assert.equal(typeof provider[method], "function"));
  assert.equal(provider.id, "catalog");
});

test("searchDatasets() findet 'Olpe' und 'Oberasbach' ohne Nominatim/Overpass", async () => {
  let nominatimCalls = 0;
  let overpassCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input?.url || input);
    if (url.includes("nominatim")) nominatimCalls++;
    if (url.includes("overpass") || url.includes("/api/interpreter")) overpassCalls++;
    throw new Error(`Unerwarteter Netzwerkaufruf: ${url}`);
  };

  try {
    const provider = createCatalogDatasetProvider(CATALOG_PATH);

    // 1. Olpe
    const olpeResults = await provider.searchDatasets("Olpe");
    assert.equal(olpeResults.length, 1);
    assert.equal(olpeResults[0].id, "de-nw-olpe");
    assert.equal(olpeResults[0].name, "Olpe");
    assert.equal(olpeResults[0].datasetKind, "municipality");
    assert.equal(olpeResults[0].state, "Nordrhein-Westfalen");
    assert.equal(olpeResults[0].packageType, "osm");
    assert.equal(olpeResults[0].streetCount, 461);
    assert.equal(olpeResults[0].poiCount, 114);
    assert.equal(olpeResults[0].areaCount, 2);

    // 2. Oberasbach
    const oberasbachResults = await provider.searchDatasets("Oberasbach");
    assert.equal(oberasbachResults.length, 1);
    assert.equal(oberasbachResults[0].id, "de-oberasbach-fire-training");
    assert.equal(oberasbachResults[0].name, "Oberasbach");
    assert.equal(oberasbachResults[0].datasetKind, "municipality");
    assert.equal(oberasbachResults[0].state, "Bayern");
    assert.equal(oberasbachResults[0].packageType, "curated");
    assert.equal(oberasbachResults[0].streetCount, 271);
    assert.equal(oberasbachResults[0].poiCount, 60);

    // 3. Case-Insensitive Suche
    const lowerResults = await provider.searchDatasets("olpe");
    assert.equal(lowerResults.length, 1);
    assert.equal(lowerResults[0].id, "de-nw-olpe");

    const upperResults = await provider.searchDatasets("OBERASBACH");
    assert.equal(upperResults.length, 1);
    assert.equal(upperResults[0].id, "de-oberasbach-fire-training");

    // 4. Suche nach Bundesland
    const nrwResults = await provider.searchDatasets("Nordrhein-Westfalen");
    assert.equal(nrwResults.length, 1);
    assert.equal(nrwResults[0].id, "de-nw-olpe");

    // 5. Unbekannte Suche liefert leeres Array
    const unknownResults = await provider.searchDatasets("NichtImKatalogStadt");
    assert.deepEqual(unknownResults, []);

    // 6. Leerer Suchbegriff liefert leeres Array
    const emptyResults = await provider.searchDatasets("   ");
    assert.deepEqual(emptyResults, []);

    // Keine Nominatim-/Overpass-Aufrufe
    assert.equal(nominatimCalls, 0);
    assert.equal(overpassCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getDatasetMetadata() liefert Metadaten per ID und CityID ohne Package-Laden", async () => {
  const provider = createCatalogDatasetProvider(catalogData);

  // Per Package-ID
  const metaOlpe = await provider.getDatasetMetadata("de-nw-olpe");
  assert.equal(metaOlpe.id, "de-nw-olpe");
  assert.equal(metaOlpe.name, "Olpe");
  assert.equal(metaOlpe.cityId, "osm-relation-163179");
  assert.equal(metaOlpe.version, "2026.09.05");

  // Per OSM-City-ID
  const metaOlpeCity = await provider.getDatasetMetadata("osm-relation-163179");
  assert.equal(metaOlpeCity.id, "de-nw-olpe");

  // Unbekanntes Dataset
  await assert.rejects(
    provider.getDatasetMetadata("unbekannt"),
    err => err instanceof DatasetProviderError && err.code === "DATASET_NOT_FOUND"
  );
});

test("downloadDataset() lädt Paket und verifiziert contentHash", async () => {
  const provider = createCatalogDatasetProvider(CATALOG_PATH);
  const progressReports = [];

  const result = await provider.downloadDataset("de-nw-olpe", {
    onProgress: p => progressReports.push(p)
  });

  assert.equal(result.datasetId, "de-nw-olpe");
  assert.equal(result.metadata.name, "Olpe");
  assert.ok(result.dataset);
  assert.equal(result.dataset.schemaVersion, 1);
  assert.equal(result.dataset.city.name, "Olpe");
  assert.equal(result.dataset.streets.length, 461);
  assert.equal(result.dataset.pois.length, 114);
  assert.equal(result.dataset.areas.length, 2);
  assert.equal(result.dataset.package.contentHash, result.metadata.contentHash);

  assert.ok(progressReports.length > 0);
  assert.equal(progressReports[progressReports.length - 1].stage, "dataset-ready");
});

test("downloadDataset() bricht bei contentHash-Mismatch mit HASH_MISMATCH ab", async () => {
  const tamperedCatalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    datasets: [
      {
        ...catalogData.datasets[0],
        contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      }
    ]
  };

  const provider = createCatalogDatasetProvider(tamperedCatalog, {
    basePath: path.join(ROOT, "data")
  });

  await assert.rejects(
    provider.downloadDataset(catalogData.datasets[0].id),
    err => err instanceof DatasetProviderError && err.code === "HASH_MISMATCH"
  );
});

test("downloadDataset() weist unsichere Download-Pfade ab", async () => {
  const unsafeCatalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    datasets: [
      {
        ...catalogData.datasets[0],
        downloadPath: "../unsafe/outside.json"
      }
    ]
  };

  const provider = createCatalogDatasetProvider(unsafeCatalog);
  await assert.rejects(
    provider.downloadDataset(catalogData.datasets[0].id),
    err => err instanceof DatasetProviderError && err.code === "UNSAFE_DOWNLOAD_PATH"
  );
});

test("checkForUpdate() erkennt Updates via SemVer und CalVer korrekt", async () => {
  const provider = createCatalogDatasetProvider(catalogData);

  // 1. CalVer (Olpe): Installiert ist 2026.09.01, Katalog hat 2026.09.05 -> Update vorhanden!
  const updateOlpeOlder = await provider.checkForUpdate({
    id: "de-nw-olpe",
    version: "2026.09.01"
  });
  assert.equal(updateOlpeOlder.hasUpdate, true);
  assert.equal(updateOlpeOlder.currentVersion, "2026.09.01");
  assert.equal(updateOlpeOlder.latestVersion, "2026.09.05");

  // 2. CalVer (Olpe): Installiert ist 2026.09.05, Katalog hat 2026.09.05 -> Kein Update
  const updateOlpeSame = await provider.checkForUpdate({
    package: { id: "de-nw-olpe", version: "2026.09.05" }
  });
  assert.equal(updateOlpeSame.hasUpdate, false);

  // 3. SemVer (Oberasbach): Installiert ist 0.9.0, Katalog hat 1.0.0 -> Update vorhanden!
  const updateOberasbachOlder = await provider.checkForUpdate({
    id: "de-oberasbach-fire-training",
    version: "0.9.0"
  });
  assert.equal(updateOberasbachOlder.hasUpdate, true);
  assert.equal(updateOberasbachOlder.currentVersion, "0.9.0");
  assert.equal(updateOberasbachOlder.latestVersion, "1.0.0");

  // 4. SemVer (Oberasbach): Installiert ist 1.0.0, Katalog hat 1.0.0 -> Kein Update
  const updateOberasbachSame = await provider.checkForUpdate({
    package: { id: "de-oberasbach-fire-training", version: "1.0.0" }
  });
  assert.equal(updateOberasbachSame.hasUpdate, false);
});

test("Provider bricht bei abgebrochenem AbortSignal sauber ab", async () => {
  const provider = createCatalogDatasetProvider(catalogData);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    provider.searchDatasets("Olpe", { signal: controller.signal }),
    err => err instanceof DatasetProviderError && err.code === "ABORTED"
  );

  await assert.rejects(
    provider.getDatasetMetadata("de-nw-olpe", { signal: controller.signal }),
    err => err instanceof DatasetProviderError && err.code === "ABORTED"
  );

  await assert.rejects(
    provider.downloadDataset("de-nw-olpe", { signal: controller.signal }),
    err => err instanceof DatasetProviderError && err.code === "ABORTED"
  );
});

test("Katalog mit doppelter ID wird abgelehnt", async () => {
  const duplicateCatalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    datasets: [
      { ...catalogData.datasets[0] },
      { ...catalogData.datasets[0] }
    ]
  };

  const provider = createCatalogDatasetProvider(duplicateCatalog);
  await assert.rejects(
    provider.searchDatasets("test"),
    err => err instanceof DatasetProviderError && err.code === "INVALID_CATALOG"
  );
});

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`\n${passed}/${tests.length} Catalog-Dataset-Provider-Tests bestanden.`);
})();

