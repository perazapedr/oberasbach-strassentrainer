"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const { createCatalogDatasetProvider } = require("../dataset-provider.js");
const validator = require("../city-data-validator.js");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "data/catalog.json");

function allIssues(result, kind = "errors") {
  return ["package", "municipality", "streets", "pois", "areas"]
    .flatMap(section => Array.isArray(result?.validation?.[section]?.[kind])
      ? result.validation[section][kind]
      : []);
}

(async () => {
  let nominatimCalls = 0;
  let overpassCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input?.url || input);
    if (url.includes("nominatim")) nominatimCalls++;
    if (url.includes("overpass") || url.includes("/api/interpreter")) overpassCalls++;
    throw new Error(`Unerwarteter externer Netzwerkaufruf: ${url}`);
  };

  try {
    // 1. Initialisiere CatalogDatasetProvider mit offiziellem Katalog
    const provider = createCatalogDatasetProvider(CATALOG_PATH);

    // 2. Suche "Olpe" ohne externe APIs
    const olpeCandidates = await provider.searchDatasets("Olpe");
    assert.equal(olpeCandidates.length, 1);
    const olpeCandidate = olpeCandidates[0];
    assert.equal(olpeCandidate.id, "de-nw-olpe");
    assert.equal(olpeCandidate.name, "Olpe");
    assert.equal(olpeCandidate.datasetKind, "municipality");
    assert.equal(olpeCandidate.packageType, "osm");

    // 3. Olpe Paket über Provider herunterladen
    const olpeDownload = await provider.downloadDataset(olpeCandidate.id);
    assert.equal(olpeDownload.datasetId, "de-nw-olpe");
    assert.ok(olpeDownload.dataset);

    // 4. Durch normativen Package Validator prüfen
    const olpeValidation = validator.validateCityPackage(olpeDownload.dataset);
    assert.equal(olpeValidation.valid, true, "Olpe-Paket muss vollständig valide sein");
    const olpeErrors = allIssues(olpeValidation, "errors");
    assert.deepEqual(olpeErrors, [], "Keine Validierungsfehler im Olpe-Paket");

    assert.equal(olpeValidation.streets.length, 461);
    assert.equal(olpeValidation.pois.length, 114);
    assert.equal(olpeValidation.areas.length, 2);
    assert.ok(olpeValidation.boundary);

    // 5. Hash-Integrität prüfen
    const olpeHash = validator.verifyPackageHash(olpeDownload.dataset);
    assert.equal(olpeHash.valid, true);
    assert.equal(olpeDownload.metadata.contentHash, olpeDownload.dataset.package.contentHash);

    // 6. Suche "Oberasbach" (Curated)
    const oberasbachCandidates = await provider.searchDatasets("Oberasbach");
    assert.equal(oberasbachCandidates.length, 1);
    const oberasbachCandidate = oberasbachCandidates[0];
    assert.equal(oberasbachCandidate.id, "de-oberasbach-fire-training");
    assert.equal(oberasbachCandidate.name, "Oberasbach");
    assert.equal(oberasbachCandidate.datasetKind, "municipality");
    assert.equal(oberasbachCandidate.packageType, "curated");

    // 7. Oberasbach Paket herunterladen
    const oberasbachDownload = await provider.downloadDataset(oberasbachCandidate.id);
    assert.equal(oberasbachDownload.datasetId, "de-oberasbach-fire-training");

    // 8. Oberasbach Package Validator
    const oberasbachValidation = validator.validateCityPackage(oberasbachDownload.dataset);
    assert.equal(oberasbachValidation.valid, true, "Oberasbach-Paket muss vollständig valide sein");
    const oberasbachErrors = allIssues(oberasbachValidation, "errors");
    assert.deepEqual(oberasbachErrors, [], "Keine Validierungsfehler im Oberasbach-Paket");

    assert.equal(oberasbachValidation.streets.length, 271);
    assert.equal(oberasbachValidation.pois.length, 60);

    const oberasbachHash = validator.verifyPackageHash(oberasbachDownload.dataset);
    assert.equal(oberasbachHash.valid, true);
    assert.equal(oberasbachDownload.metadata.contentHash, oberasbachDownload.dataset.package.contentHash);

    // 9. Strikte Netzwerkabstinenz verifizieren
    assert.equal(nominatimCalls, 0, "Darf keine Nominatim-Aufrufe tätigen");
    assert.equal(overpassCalls, 0, "Darf keine Overpass-Aufrufe tätigen");

    console.log("✓ catalog.json -> CatalogDatasetProvider -> searchDatasets('Olpe') -> downloadDataset() -> Package Validator PASS");
    console.log("✓ catalog.json -> CatalogDatasetProvider -> searchDatasets('Oberasbach') -> downloadDataset() -> Package Validator PASS");
    console.log(`✓ Nominatim-Aufrufe: ${nominatimCalls}`);
    console.log(`✓ Overpass-Aufrufe: ${overpassCalls}`);
    console.log("\n1/1 Catalog-Integrationstests bestanden.");
  } finally {
    globalThis.fetch = originalFetch;
  }
})().catch(error => {
  console.error("✗ Catalog-Integrationstest fehlgeschlagen");
  console.error(error);
  process.exit(1);
});

