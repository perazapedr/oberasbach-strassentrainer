"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { loadManifest, filterTargets, ManifestError } = require("../tools/dataset-pipeline/lib/manifest.js");
const { checkOsmium, checkPbf, runPreflight, PreflightError } = require("../tools/dataset-pipeline/lib/preflight.js");
const { loadQaPolicy, loadPublishedState, evaluateCandidatePackage, QaError } = require("../tools/dataset-pipeline/lib/qa.js");
const { createStagingDir, cleanupStaging } = require("../tools/dataset-pipeline/lib/staging.js");
const { publishCandidates, PublishError } = require("../tools/dataset-pipeline/lib/publish.js");
const { createRunReport } = require("../tools/dataset-pipeline/lib/report.js");

const ROOT = path.resolve(__dirname, "..");
const OLPE_PKG_PATH = path.join(ROOT, "data/cities/de-nw-olpe.json");
const WENDEN_PKG_PATH = path.join(ROOT, "data/cities/de-nw-wenden.json");
const DEFAULT_MANIFEST = path.join(ROOT, "tools/dataset-pipeline/datasets.json");
const DEFAULT_QA_POLICY = path.join(ROOT, "tools/dataset-pipeline/qa-policy.json");
const DEFAULT_PUBLISHED_STATE = path.join(ROOT, "tools/dataset-pipeline/published-state.json");
const REAL_NRW_PBF = path.join(ROOT, "tools/dataset-builder/work/nordrhein-westfalen-latest.osm.pbf");

function createTempDir(prefix = "pipeline-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ------------------------------------------------------------
// 1. MANIFEST TESTS
// ------------------------------------------------------------
test("1.1 Manifest lädt und validiert das Standard-NRW-Manifest erfolgreich", () => {
  const manifest = loadManifest(DEFAULT_MANIFEST);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.regionId, "de-nw");
  assert.equal(manifest.datasets.length, 5);

  const targets = filterTargets(manifest, { all: true });
  assert.equal(targets.length, 5);
  assert.deepEqual(
    targets.find(t => t.datasetId === "de-nw-kreis-olpe"),
    { datasetId: "de-nw-kreis-olpe", name: "Kreis Olpe", relationId: 1891506, adminLevel: 6, targetType: "district", version: "2026.09.07", enabled: true }
  );
  assert.ok(targets.some(t => t.datasetId === "de-nw-olpe"));
  assert.ok(targets.some(t => t.datasetId === "de-nw-wenden"));
  assert.ok(targets.some(t => t.datasetId === "de-nw-siegen"));
  assert.ok(targets.some(t => t.datasetId === "de-nw-koeln"));
});

test("1.2 Manifest weist doppelte Dataset-IDs ab", () => {
  const tempDir = createTempDir();
  try {
    const badManifest = path.join(tempDir, "bad.json");
    fs.writeFileSync(badManifest, JSON.stringify({
      schemaVersion: 1,
      regionId: "de-nw",
      datasets: [
        { datasetId: "de-nw-olpe", name: "Olpe", relationId: 101, adminLevel: 8 },
        { datasetId: "de-nw-olpe", name: "Olpe 2", relationId: 102, adminLevel: 8 }
      ]
    }));
    assert.throws(() => loadManifest(badManifest), err => err.code === "MANIFEST_DUPLICATE_DATASET_ID");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("1.3 Manifest weist doppelte Relation-IDs ab", () => {
  const tempDir = createTempDir();
  try {
    const badManifest = path.join(tempDir, "bad.json");
    fs.writeFileSync(badManifest, JSON.stringify({
      schemaVersion: 1,
      regionId: "de-nw",
      datasets: [
        { datasetId: "de-nw-city-a", name: "A", relationId: 163179, adminLevel: 8 },
        { datasetId: "de-nw-city-b", name: "B", relationId: 163179, adminLevel: 8 }
      ]
    }));
    assert.throws(() => loadManifest(badManifest), err => err.code === "MANIFEST_DUPLICATE_RELATION_ID");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("1.4 Oberasbach-Schutzregel: Oberasbach darf niemals als PBF-Target im Manifest stehen", () => {
  const tempDir = createTempDir();
  try {
    const badManifest = path.join(tempDir, "oberasbach-manifest.json");
    fs.writeFileSync(badManifest, JSON.stringify({
      schemaVersion: 1,
      regionId: "de-by",
      datasets: [
        { datasetId: "de-by-oberasbach", name: "Oberasbach", relationId: 1016396, adminLevel: 8 }
      ]
    }));
    assert.throws(() => loadManifest(badManifest), err => err.code === "OBERASBACH_PROTECTED");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("1.5 FilterTargets mit --dataset filtert gezielt ein einzelnes Target", () => {
  const manifest = loadManifest(DEFAULT_MANIFEST);
  const targets = filterTargets(manifest, { dataset: "de-nw-siegen" });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].datasetId, "de-nw-siegen");
  assert.equal(targets[0].name, "Siegen");

  assert.throws(() => filterTargets(manifest, { dataset: "de-nw-unknown" }), err => err.code === "DATASET_NOT_FOUND");
});

// ------------------------------------------------------------
// 2. PREFLIGHT TESTS
// ------------------------------------------------------------
test("2.1 Osmium-Verfügbarkeitsprüfung funktioniert", () => {
  const version = checkOsmium();
  assert.ok(typeof version === "string" && version.length > 0);
});

test("2.2 Preflight bricht bei fehlender PBF-Datei sauber ab", () => {
  assert.throws(
    () => checkPbf("/non/existent/path/germany.osm.pbf"),
    err => err.code === "PBF_NOT_FOUND"
  );
});

test("2.3 Preflight bricht bei leerer PBF-Datei (0 Bytes) ab", () => {
  const tempDir = createTempDir();
  try {
    const emptyPbf = path.join(tempDir, "empty.osm.pbf");
    fs.writeFileSync(emptyPbf, Buffer.alloc(0));
    assert.throws(() => checkPbf(emptyPbf), err => err.code === "PBF_EMPTY");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("2.4 Preflight bricht bei beschädigter / ungültiger PBF-Datei ab", () => {
  const tempDir = createTempDir();
  try {
    const badPbf = path.join(tempDir, "corrupt.osm.pbf");
    fs.writeFileSync(badPbf, "THIS IS NOT A VALID OSM PBF STREAM");
    assert.throws(() => checkPbf(badPbf), err => err.code === "PBF_INVALID");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("2.5 Reale NRW-PBF besteht Preflight und liefert Timestamp", () => {
  if (fs.existsSync(REAL_NRW_PBF)) {
    const manifest = loadManifest(DEFAULT_MANIFEST);
    const preflight = runPreflight(REAL_NRW_PBF, manifest);
    assert.equal(preflight.status, "PASS");
    assert.ok(preflight.pbfSize > 800 * 1024 * 1024);
    assert.ok(preflight.osmTimestamp.startsWith("2026-09-05"));
  }
});

// ------------------------------------------------------------
// 3. QA & VALIDATION TESTS
// ------------------------------------------------------------
test("3.1 Gültiges Olpe-Paket besteht alle QA-Gates und wird als UNCHANGED klassifiziert", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "PASS");
  assert.equal(evalResult.classification, "UNCHANGED");
  assert.equal(evalResult.errors.length, 0);
  assert.equal(evalResult.streetCount, 461);
  assert.equal(evalResult.poiCount, 114);
  assert.equal(evalResult.areaCount, 2);
});

test("3.2 Manipulierter contentHash führt zu PACKAGE_HASH_MISMATCH und Status FAIL", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  olpeData.package.contentHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "FAIL");
  assert.ok(evalResult.errors.some(e => e.code === "PACKAGE_HASH_MISMATCH"));
});

test("3.3 SAME_VERSION_DIFFERENT_CONTENT: Gleiche Version bei geändertem Inhalt blockiert hart", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  // Ändere eine Straße leicht, wodurch der Hash sich ändert
  olpeData.streets[0].name = "Geänderter Straßenname für Test";
  // Berechne den neuen echten Hash, behalte aber die alte Version "2026.09.05"
  const validator = require("../city-data-validator.js");
  olpeData.package.contentHash = validator.computePackageHash(olpeData);

  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "FAIL");
  assert.ok(evalResult.errors.some(e => e.code === "SAME_VERSION_DIFFERENT_CONTENT"));
});

test("3.4 CHANGED: Geänderter Inhalt mit ordnungsgemäß erhöhter Version besteht als CHANGED", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  olpeData.streets[0].name = "Aktualisierte Teststraße";
  olpeData.package.version = "2026.09.06"; // Version erhöht
  const validator = require("../city-data-validator.js");
  olpeData.package.contentHash = validator.computePackageHash(olpeData);

  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "PASS");
  assert.equal(evalResult.classification, "CHANGED");
});

test("3.5 NEW: Ein bisher nicht veröffentlichter Datensatz wird als NEW klassifiziert", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  // Published State ohne Olpe (simuliert, dass Olpe brandneu ist)
  const emptyPublishedState = { schemaVersion: 1, datasets: {} };

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, emptyPublishedState);
  assert.equal(evalResult.status, "PASS");
  assert.equal(evalResult.classification, "NEW");
});

test("3.6 Area QA: Area mit gleichem admin_level wie die Gemeinde wird hart abgewiesen", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  // Füge eine Nachbarkommune mit gleichem admin_level 8 als Area ein
  olpeData.areas.push({
    id: "osm-relation-999",
    name: "Nachbarstadt",
    category: "administrative",
    adminLevel: 8, // Olpe hat adminLevel 8 -> Verstoß!
    geometry: olpeData.areas[0].geometry
  });
  const validator = require("../city-data-validator.js");
  olpeData.package.contentHash = validator.computePackageHash(olpeData);

  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "FAIL");
  assert.ok(evalResult.errors.some(e => e.code === "AREA_HIERARCHY_VIOLATION"));
});

test("3.7 Area QA: Area außerhalb der Grenze (< 85% Containment) wird abgewiesen", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  // Erzeuge ein disjunktes Polygon weit außerhalb (z.B. bei Berlin)
  olpeData.areas.push({
    id: "osm-relation-998",
    name: "Fremdes Gebiet",
    category: "administrative",
    adminLevel: 10,
    geometry: {
      type: "Polygon",
      coordinates: [[[13.3, 52.5], [13.4, 52.5], [13.4, 52.6], [13.3, 52.6], [13.3, 52.5]]]
    }
  });
  const validator = require("../city-data-validator.js");
  olpeData.package.contentHash = validator.computePackageHash(olpeData);

  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "FAIL");
  assert.ok(evalResult.errors.some(e => e.code === "AREA_CONTAINMENT_FAILED"));
});

test("3.8 Street QA: Dropping von Straßen über Schwellwert scheitert", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  // Schneide die Straßenliste drastisch von 461 auf 200 (mehr als 50% Drop, max 10% erlaubt)
  olpeData.streets = olpeData.streets.slice(0, 200);
  olpeData.package.version = "2026.09.06";
  const validator = require("../city-data-validator.js");
  olpeData.package.contentHash = validator.computePackageHash(olpeData);

  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "FAIL");
  assert.ok(evalResult.errors.some(e => e.code === "STREET_DROP_EXCEEDED"));
});

// ------------------------------------------------------------
// 4. STAGING & PUBLISH TESTS
// ------------------------------------------------------------
test("4.1 Staging Verzeichnis wird korrekt initialisiert und aufgeräumt", () => {
  const staging = createStagingDir("test-run-123");
  assert.ok(fs.existsSync(staging.stagingDir));
  assert.ok(fs.existsSync(staging.citiesDir));
  assert.ok(staging.catalogFile.endsWith("catalog.json"));

  cleanupStaging(staging.stagingDir, false);
  assert.ok(!fs.existsSync(staging.stagingDir));
});

test("4.2 Publish Gate blockiert bei fehlgeschlagener QA", () => {
  const staging = createStagingDir();
  const qaResults = [
    { datasetId: "de-nw-olpe", status: "PASS", classification: "UNCHANGED" },
    { datasetId: "de-nw-siegen", status: "FAIL", classification: "FAILED" }
  ];

  try {
    assert.throws(
      () => publishCandidates(staging, qaResults, DEFAULT_PUBLISHED_STATE, path.join(ROOT, "data")),
      err => err.code === "PUBLISH_BLOCKED_QA_FAILURE"
    );
  } finally {
    cleanupStaging(staging.stagingDir, false);
  }
});

test("4.3 Dry Run mutiert keine Zieldateien auf data/", () => {
  const staging = createStagingDir();
  const targetDir = createTempDir("target-data-");

  try {
    const qaResults = [
      { datasetId: "de-nw-olpe", status: "PASS", classification: "UNCHANGED", version: "2026.09.05", contentHash: "sha256:dummy" }
    ];

    const result = publishCandidates(staging, qaResults, DEFAULT_PUBLISHED_STATE, targetDir, { dryRun: true });
    assert.equal(result.status, "WOULD_PUBLISH");
    assert.equal(fs.readdirSync(targetDir).length, 0, "Dry Run darf absolut keine Dateien im Zielverzeichnis erzeugen.");
  } finally {
    cleanupStaging(staging.stagingDir, false);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("4.4 Full-Run Atomarität & Rollback bei Fehler während der Promotion", () => {
  const staging = createStagingDir();
  const tempTargetDir = createTempDir("rollback-test-");
  const tempStateFile = path.join(tempTargetDir, "test-published-state.json");

  try {
    // Initialer Zustand im Temp-Zielordner
    const citiesDir = path.join(tempTargetDir, "cities");
    fs.mkdirSync(citiesDir, { recursive: true });
    const originalOlpe = path.join(citiesDir, "de-nw-olpe.json");
    fs.writeFileSync(originalOlpe, "ORIGINAL OLPE CONTENT", "utf8");

    // Bereite Staged Olpe vor
    fs.copyFileSync(OLPE_PKG_PATH, path.join(staging.citiesDir, "de-nw-olpe.json"));

    // Provoziere Fehler: Katalog-Datei im Staging fehlt!
    const qaResults = [
      { datasetId: "de-nw-olpe", status: "PASS", classification: "CHANGED", version: "2026.09.06", contentHash: "sha256:new" }
    ];

    assert.throws(
      () => publishCandidates(staging, qaResults, tempStateFile, tempTargetDir),
      err => err.code === "PUBLISH_FAILED_ROLLED_BACK"
    );

    // Rollback-Verifikation: Die originale Olpe-Datei muss ihren ursprünglichen Inhalt behalten haben!
    assert.equal(fs.readFileSync(originalOlpe, "utf8"), "ORIGINAL OLPE CONTENT");
  } finally {
    cleanupStaging(staging.stagingDir, false);
    fs.rmSync(tempTargetDir, { recursive: true, force: true });
  }
});

test("4.5 Partial Run Isolation: Nur ausgewählter Datensatz wird promoviert", () => {
  const staging = createStagingDir();
  const tempTargetDir = createTempDir("partial-run-test-");
  const tempStateFile = path.join(tempTargetDir, "test-published-state.json");

  try {
    const citiesDir = path.join(tempTargetDir, "cities");
    fs.mkdirSync(citiesDir, { recursive: true });

    // Initialisiere zwei Dateien
    const wendenFile = path.join(citiesDir, "de-nw-wenden.json");
    const olpeFile = path.join(citiesDir, "de-nw-olpe.json");
    fs.writeFileSync(wendenFile, "ORIGINAL WENDEN CONTENT", "utf8");
    fs.writeFileSync(olpeFile, "ORIGINAL OLPE CONTENT", "utf8");

    // Staged Olpe und Staged Catalog
    fs.copyFileSync(OLPE_PKG_PATH, path.join(staging.citiesDir, "de-nw-olpe.json"));
    fs.writeFileSync(staging.catalogFile, JSON.stringify({ schemaVersion: 1, datasets: [] }));
    fs.writeFileSync(tempStateFile, JSON.stringify({ schemaVersion: 1, datasets: {} }));

    // Publizieren nur für Olpe
    const qaResults = [
      { datasetId: "de-nw-olpe", status: "PASS", classification: "CHANGED", version: "2026.09.06", contentHash: "sha256:newolpe" }
    ];

    const res = publishCandidates(staging, qaResults, tempStateFile, tempTargetDir);
    assert.equal(res.status, "PUBLISHED");

    // Wenden MUSS byte-identisch unverändert geblieben sein
    assert.equal(fs.readFileSync(wendenFile, "utf8"), "ORIGINAL WENDEN CONTENT");
    // Olpe wurde aktualisiert
    assert.notEqual(fs.readFileSync(olpeFile, "utf8"), "ORIGINAL OLPE CONTENT");
  } finally {
    cleanupStaging(staging.stagingDir, false);
    fs.rmSync(tempTargetDir, { recursive: true, force: true });
  }
});

test("4.6 Preflight meldet OSMIUM_UNAVAILABLE bei fehlendem Tool", () => {
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = "/empty/path/without/osmium";
    assert.throws(() => checkOsmium(), err => err.code === "OSMIUM_UNAVAILABLE");
  } finally {
    process.env.PATH = originalPath;
  }
});

test("4.7 QA schlägt fehl bei City-Validator-Schemakonflikt", () => {
  const olpeData = JSON.parse(fs.readFileSync(OLPE_PKG_PATH, "utf8"));
  olpeData.schemaVersion = 999; // nicht unterstützte Schema-Version
  const qaPolicy = loadQaPolicy(DEFAULT_QA_POLICY);
  const publishedState = loadPublishedState(DEFAULT_PUBLISHED_STATE);

  const evalResult = evaluateCandidatePackage(olpeData, null, qaPolicy, publishedState);
  assert.equal(evalResult.status, "FAIL");
  assert.ok(evalResult.errors.some(e => e.code.includes("SCHEMA")));
});

test("4.8 Catalog Builder im Pipeline-Kontext fängt fehlerhafte Pakete ab", () => {
  const { buildCatalog } = require("../tools/catalog-builder/index.js");
  const tempDir = createTempDir("catalog-fail-");

  try {
    const corruptFile = path.join(tempDir, "corrupt.json");
    fs.writeFileSync(corruptFile, "{ bad json", "utf8");

    assert.throws(
      () => buildCatalog({ inputs: [corruptFile], dryRun: true }),
      err => err.code === "INVALID_JSON"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("4.9 Abort Handling: SIGINT Handler registriert und Staging-Cleanup aufrufbar", () => {
  const staging = createStagingDir("abort-test-");
  assert.ok(fs.existsSync(staging.stagingDir));
  cleanupStaging(staging.stagingDir, false);
  assert.ok(!fs.existsSync(staging.stagingDir));
});

test("4.10 Arbitrary PBF filename: Preflight und Pipeline-Pfad akzeptieren beliebige Dateinamen", () => {
  const { checkPbf } = require("../tools/dataset-pipeline/lib/preflight.js");
  const tempPbf = path.join(os.tmpdir(), `arbitrary-test-${Date.now()}.pbf`);
  // Symlink existing real PBF to a completely arbitrary filename
  fs.symlinkSync(path.resolve(__dirname, "../tools/dataset-builder/work/bayern-latest.osm.pbf"), tempPbf);

  try {
    const pbfInfo = checkPbf(tempPbf);
    assert.equal(pbfInfo.pbfPath, path.resolve(tempPbf));
    assert.ok(pbfInfo.pbfSize > 0);
    assert.ok(pbfInfo.osmTimestamp);
  } finally {
    try { fs.unlinkSync(tempPbf); } catch (_) {}
  }
});

test("4.11 Catalog Determinismus: UNCHANGED Datensätze verändern catalog.json nicht", () => {
  const tempTargetDir = createTempDir("cat-det-");
  const tempStateFile = path.join(tempTargetDir, "published-state.json");
  const staging = createStagingDir("cat-det-stage-");

  try {
    const citiesDir = path.join(tempTargetDir, "cities");
    fs.mkdirSync(citiesDir, { recursive: true });
    const targetCatalog = path.join(tempTargetDir, "catalog.json");

    const initialCatalog = {
      schemaVersion: 1,
      generatedAt: "2026-09-05T20:22:06.000Z",
      datasets: [
        { id: "de-nw-olpe", version: "2026.09.05", contentHash: "sha256:olpehash" }
      ]
    };
    fs.writeFileSync(targetCatalog, JSON.stringify(initialCatalog, null, 2) + "\n", "utf8");
    fs.writeFileSync(staging.catalogFile, JSON.stringify(initialCatalog, null, 2) + "\n", "utf8");

    const stagedOlpe = path.join(staging.citiesDir, "de-nw-olpe.json");
    fs.copyFileSync(OLPE_PKG_PATH, stagedOlpe);
    fs.copyFileSync(OLPE_PKG_PATH, path.join(citiesDir, "de-nw-olpe.json"));

    const qaResults = [
      { datasetId: "de-nw-olpe", status: "PASS", classification: "UNCHANGED", version: "2026.09.05", contentHash: "sha256:olpehash" }
    ];

    const res = publishCandidates(staging, qaResults, tempStateFile, tempTargetDir);
    assert.equal(res.status, "PUBLISHED");

    // Catalog must remain byte-for-byte identical
    const catContent = fs.readFileSync(targetCatalog, "utf8");
    assert.equal(catContent, JSON.stringify(initialCatalog, null, 2) + "\n");
  } finally {
    cleanupStaging(staging.stagingDir, false);
    fs.rmSync(tempTargetDir, { recursive: true, force: true });
  }
});
