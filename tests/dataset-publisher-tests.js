"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const publisher = require("../tools/dataset-publisher/index.js");
const validator = require("../city-data-validator.js");
const datasetProvider = require("../dataset-provider.js");

const ROOT = path.resolve(__dirname, "..");
const GOLDEN_OBERASBACH_HASH = "sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95";

test("1.1 Publisher erzeugt vollständiges statisches Repository-Layout mit manifests und precompression", async () => {
  const tmpSource = path.join(ROOT, "tests/scratch-pub-source");
  const tmpOut = path.join(ROOT, "dist/.tmp-test-publisher-repo");
  try {
    fs.mkdirSync(tmpSource, { recursive: true });
    // Kopiere Oberasbach und Wenden für schnellen, deterministischen Kompressionstest
    fs.copyFileSync(path.join(ROOT, "data/cities/oberasbach.json"), path.join(tmpSource, "oberasbach.json"));
    fs.copyFileSync(path.join(ROOT, "data/cities/de-nw-wenden.json"), path.join(tmpSource, "de-nw-wenden.json"));

    const result = await publisher.publishRepository({
      sourceDir: tmpSource,
      outputDir: tmpOut,
      precompress: true
    });

    assert.equal(result.status, "PUBLISHED");
    assert.ok(fs.existsSync(path.join(tmpOut, "catalog.json")));

    const catalog = JSON.parse(fs.readFileSync(path.join(tmpOut, "catalog.json"), "utf8"));
    assert.equal(catalog.schemaVersion, 1);
    assert.ok(Array.isArray(catalog.datasets));
    assert.equal(catalog.datasets.length, 2);

    // Prüfe Oberasbach an erster Position
    const oberasbachEntry = catalog.datasets[0];
    assert.ok(oberasbachEntry.id === "oberasbach" || oberasbachEntry.id === "de-oberasbach-fire-training");
    assert.equal(oberasbachEntry.streetCount, 271);
    assert.equal(oberasbachEntry.poiCount, 60);
    assert.equal(oberasbachEntry.contentHash, GOLDEN_OBERASBACH_HASH);

    // Prüfe jedes Dataset im Repository
    for (const ds of catalog.datasets) {
      const dsDir = path.join(tmpOut, "datasets", ds.id);
      assert.ok(fs.existsSync(dsDir), `Dataset-Verzeichnis fehlt: ${dsDir}`);
      assert.ok(fs.existsSync(path.join(dsDir, "package.json")));
      assert.ok(fs.existsSync(path.join(dsDir, "manifest.json")));
      assert.ok(fs.existsSync(path.join(dsDir, "package.json.gz")));
      assert.ok(fs.existsSync(path.join(dsDir, "package.json.br")));

      // Manifest validieren
      const manifest = JSON.parse(fs.readFileSync(path.join(dsDir, "manifest.json"), "utf8"));
      assert.equal(manifest.schemaVersion, 1);
      assert.equal(manifest.datasetId, ds.id);
      assert.equal(manifest.contentHash, ds.contentHash);
      assert.ok(manifest.files.package.sizeBytes > 0);
      assert.ok(manifest.files.gzip.sizeBytes > 0);
      assert.ok(manifest.files.brotli.sizeBytes > 0);

      // Decompress & Hash verify
      const gzBuf = fs.readFileSync(path.join(dsDir, "package.json.gz"));
      const decompGz = zlib.gunzipSync(gzBuf);
      const pkgBuf = fs.readFileSync(path.join(dsDir, "package.json"));
      assert.equal(decompGz.toString("utf8"), pkgBuf.toString("utf8"));

      const brBuf = fs.readFileSync(path.join(dsDir, "package.json.br"));
      const decompBr = zlib.brotliDecompressSync(brBuf);
      assert.equal(decompBr.toString("utf8"), pkgBuf.toString("utf8"));
    }
  } finally {
    if (fs.existsSync(tmpSource)) fs.rmSync(tmpSource, { recursive: true, force: true });
    if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test("1.2 Dry-Run validiert alle Pakete ohne Dateisystem-Mutation", async () => {
  const tmpOut = path.join(ROOT, "dist/.tmp-test-dry-run-repo");
  try {
    const res = await publisher.publishRepository({
      outputDir: tmpOut,
      dryRun: true
    });

    assert.equal(res.status, "DRY_RUN_PASS");
    assert.ok(res.datasetCount >= 5);
    assert.ok(!fs.existsSync(tmpOut), "Output-Verzeichnis darf bei dry-run nicht existieren");
  } finally {
    if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test("1.3 Quality Gate: Manipuliertes Paket mit fehlerhaftem Hash bricht Publisher ab", async () => {
  const tmpSource = path.join(ROOT, "tests/scratch-bad-source");
  const tmpOut = path.join(ROOT, "dist/.tmp-test-bad-repo");
  try {
    fs.mkdirSync(tmpSource, { recursive: true });
    // Kopiere ein echtes valides Paket und manipuliere nur den Hash
    const realPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf8"));
    realPkg.package.contentHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    fs.writeFileSync(path.join(tmpSource, "oberasbach.json"), JSON.stringify(realPkg, null, 2));

    await assert.rejects(
      async () => {
        await publisher.publishRepository({
          sourceDir: tmpSource,
          outputDir: tmpOut
        });
      },
      (err) => {
        assert.ok(
          err.code === "PACKAGE_VALIDATION_FAILED" || err.code === "HASH_VERIFICATION_FAILED",
          `Unerwarteter Fehlercode: ${err.code}`
        );
        return true;
      }
    );
  } finally {
    if (fs.existsSync(tmpSource)) fs.rmSync(tmpSource, { recursive: true, force: true });
    if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test("1.4 Path Traversal Schutz: Unzulässige Dataset-IDs werden abgewiesen", () => {
  assert.throws(() => publisher.assertSafeDatasetId("../evil"), { code: "INVALID_DATASET_ID" });
  assert.throws(() => publisher.assertSafeDatasetId("/etc/passwd"), { code: "INVALID_DATASET_ID" });
  assert.throws(() => publisher.assertSafeDatasetId("foo/bar"), { code: "INVALID_DATASET_ID" });
  assert.throws(() => publisher.assertSafeDatasetId(""), { code: "INVALID_DATASET_ID" });
  assert.equal(publisher.assertSafeDatasetId("de-nw-koeln"), "de-nw-koeln");
  assert.equal(publisher.assertSafeDatasetId("oberasbach"), "oberasbach");
});

test("1.5 CatalogDatasetProvider lädt published repository nahtlos und on-demand", async () => {
  const tmpOut = path.join(ROOT, "dist/.tmp-test-provider-repo");
  try {
    await publisher.publishRepository({
      outputDir: tmpOut,
      precompress: false
    });

    const catalogPath = path.join(tmpOut, "catalog.json");
    const provider = datasetProvider.createCatalogDatasetProvider(catalogPath);

    // Suche
    const searchResults = await provider.searchDatasets("Wenden");
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].name, "Wenden");

    // Download On-Demand
    const downloaded = await provider.downloadDataset("de-nw-wenden");
    assert.equal(downloaded.datasetId, "de-nw-wenden");
    assert.ok(downloaded.dataset.streets.length > 400);

    // Validierung des heruntergeladenen Pakets
    const pkgCheck = validator.validateCityPackage(downloaded.dataset);
    const cityCheck = validator.validateCityData(downloaded.dataset);
    assert.ok(pkgCheck.valid && cityCheck.valid);
  } finally {
    if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});
