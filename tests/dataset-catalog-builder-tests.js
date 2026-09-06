"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SCHEMA_VERSION,
  CatalogBuilderError,
  assertSafeRelativePath,
  extractCatalogEntry,
  processPackageFile,
  buildCatalog
} = require("../tools/catalog-builder/index.js");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "data/catalog.json");
const OBERASBACH_PATH = path.join(ROOT, "data/cities/oberasbach.json");
const OLPE_PATH = path.join(ROOT, "data/cities/de-nw-olpe.json");
const CATALOG_SCHEMA_PATH = path.join(ROOT, "schemas/strassentrainer-catalog.schema.json");

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("Catalog Schema und Spezifikationsdokumentation existieren", () => {
  assert.ok(fs.existsSync(CATALOG_SCHEMA_PATH), "Catalog JSON Schema muss existieren");
  const schema = JSON.parse(fs.readFileSync(CATALOG_SCHEMA_PATH, "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.title, "Straßentrainer Dataset Catalog Schema");
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.ok(schema.$defs.catalogDatasetEntry.required.includes("downloadPath"));
  assert.ok(schema.$defs.catalogDatasetEntry.required.includes("fileSize"));
  assert.ok(schema.$defs.catalogDatasetEntry.required.includes("contentHash"));

  const docPath = path.join(ROOT, "docs/dataset-catalog-contract.md");
  assert.ok(fs.existsSync(docPath), "docs/dataset-catalog-contract.md muss existieren");
});

test("Pfadsicherheitsprüfung weist unsichere Pfade hart ab", () => {
  // Erlaubt
  assert.equal(assertSafeRelativePath("cities/de-nw-olpe.json"), "cities/de-nw-olpe.json");
  assert.equal(assertSafeRelativePath("oberasbach.json"), "oberasbach.json");

  // Verboten
  assert.throws(() => assertSafeRelativePath("../cities/olpe.json"), err => err.code === "UNSAFE_DOWNLOAD_PATH");
  assert.throws(() => assertSafeRelativePath("cities/../../olpe.json"), err => err.code === "UNSAFE_DOWNLOAD_PATH");
  assert.throws(() => assertSafeRelativePath("/etc/passwd.json"), err => err.code === "UNSAFE_DOWNLOAD_PATH");
  assert.throws(() => assertSafeRelativePath("C:\\windows\\win.json"), err => err.code === "UNSAFE_DOWNLOAD_PATH");
  assert.throws(() => assertSafeRelativePath("cities\\olpe.json"), err => err.code === "UNSAFE_DOWNLOAD_PATH");
  assert.throws(() => assertSafeRelativePath("cities/olpe.txt"), err => err.code === "UNSAFE_DOWNLOAD_PATH");
  assert.throws(() => assertSafeRelativePath(""), err => err.code === "UNSAFE_DOWNLOAD_PATH");
});

test("Catalog Builder erzeugt gültigen Katalog mit Oberasbach und Olpe", () => {
  const result = buildCatalog({
    inputs: [OBERASBACH_PATH, OLPE_PATH],
    output: CATALOG_PATH,
    generatedAt: "2026-09-06T12:00:00.000Z"
  });

  assert.equal(result.count, 2);
  const catalog = result.catalog;
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.generatedAt, "2026-09-06T12:00:00.000Z");
  assert.equal(catalog.datasets.length, 2);

  // 1. Oberasbach (Bayern vor Nordrhein-Westfalen)
  const oberasbach = catalog.datasets.find(d => d.id === "de-oberasbach-fire-training");
  assert.ok(oberasbach, "Oberasbach muss im Katalog sein");
  assert.equal(oberasbach.name, "Oberasbach");
  assert.equal(oberasbach.displayName, "Oberasbach");
  assert.equal(oberasbach.datasetKind, "municipality");
  assert.equal(oberasbach.state, "Bayern");
  assert.equal(oberasbach.district, "Landkreis Fürth");
  assert.equal(oberasbach.country, "Deutschland");
  assert.equal(oberasbach.cityId, "osm-relation-1016396");
  assert.equal(oberasbach.osmRelationId, 1016396);
  assert.equal(oberasbach.packageType, "curated");
  assert.equal(oberasbach.version, "1.0.0");
  assert.equal(oberasbach.streetCount, 271);
  assert.equal(oberasbach.poiCount, 60);
  assert.equal(oberasbach.areaCount, 0);
  assert.equal(oberasbach.contentHash, "sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95");
  assert.equal(oberasbach.downloadPath, "cities/oberasbach.json");
  assert.equal(oberasbach.fileSize, fs.statSync(OBERASBACH_PATH).size);

  // 2. Olpe
  const olpe = catalog.datasets.find(d => d.id === "de-nw-olpe");
  assert.ok(olpe, "Olpe muss im Katalog sein");
  assert.equal(olpe.name, "Olpe");
  assert.equal(olpe.displayName, "Olpe");
  assert.equal(olpe.datasetKind, "municipality");
  assert.equal(olpe.state, "Nordrhein-Westfalen");
  assert.equal(olpe.district, null);
  assert.equal(olpe.country, "Deutschland");
  assert.equal(olpe.cityId, "osm-relation-163179");
  assert.equal(olpe.osmRelationId, 163179);
  assert.equal(olpe.packageType, "osm");
  assert.equal(olpe.version, "2026.09.05");
  assert.equal(olpe.streetCount, 461);
  assert.equal(olpe.poiCount, 114);
  assert.equal(olpe.areaCount, 2);
  assert.equal(olpe.contentHash, "sha256:6c89d676e575f2d69301715c3be5e8e66b5a798afc21b73495671fa33d996269");
  assert.equal(olpe.downloadPath, "cities/de-nw-olpe.json");
  assert.equal(olpe.fileSize, fs.statSync(OLPE_PATH).size);
});

test("Catalog Builder liefert strikt deterministische Sortierung", () => {
  // Input-Reihenfolge umgekehrt: Olpe zuerst, dann Oberasbach
  const result = buildCatalog({
    inputs: [OLPE_PATH, OBERASBACH_PATH],
    output: CATALOG_PATH,
    generatedAt: "2026-09-06T12:00:00.000Z",
    dryRun: true
  });

  // Sortierung muss trotzdem: Deutschland -> Bayern (Oberasbach) vor NRW (Olpe) sein
  assert.equal(result.catalog.datasets[0].id, "de-oberasbach-fire-training");
  assert.equal(result.catalog.datasets[1].id, "de-nw-olpe");
});

test("Catalog Builder bricht bei ungültigem JSON ab", () => {
  const tmpDir = path.join(ROOT, "tests/scratch-test-pkg");
  fs.mkdirSync(tmpDir, { recursive: true });
  const badJsonFile = path.join(tmpDir, "broken.json");
  fs.writeFileSync(badJsonFile, "{ invalid json", "utf8");

  try {
    assert.throws(
      () => buildCatalog({ inputs: [badJsonFile], dryRun: true }),
      err => err.code === "INVALID_JSON"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Catalog Builder bricht bei Schema-Verletzung des Pakets ab", () => {
  const tmpDir = path.join(ROOT, "tests/scratch-test-pkg-schema");
  fs.mkdirSync(tmpDir, { recursive: true });
  const badSchemaFile = path.join(tmpDir, "invalid-schema.json");
  fs.writeFileSync(badSchemaFile, JSON.stringify({ schemaVersion: 1 }), "utf8");

  try {
    assert.throws(
      () => buildCatalog({ inputs: [badSchemaFile], dryRun: true }),
      err => err.code === "PACKAGE_VALIDATION_FAILED"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Catalog Builder bricht bei contentHash-Mismatch ab", () => {
  const tmpDir = path.join(ROOT, "tests/scratch-test-pkg-hash");
  fs.mkdirSync(tmpDir, { recursive: true });
  const badHashFile = path.join(tmpDir, "hash-mismatch.json");
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));
  olpeData.package.contentHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  fs.writeFileSync(badHashFile, JSON.stringify(olpeData), "utf8");

  try {
    assert.throws(
      () => buildCatalog({ inputs: [badHashFile], dryRun: true }),
      err => err.code === "PACKAGE_HASH_MISMATCH"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Catalog Builder bricht bei doppelter Dataset-ID ab", () => {
  assert.throws(
    () => buildCatalog({ inputs: [OBERASBACH_PATH, OBERASBACH_PATH], dryRun: true }),
    err => err.code === "DUPLICATE_DATASET_ID"
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
  console.log(`\n${passed}/${tests.length} Catalog-Builder-Tests bestanden.`);
})();

