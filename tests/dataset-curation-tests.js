"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const curation = require("../tools/dataset-curation/index.js");
const validator = require("../city-data-validator.js");
const publisher = require("../tools/dataset-publisher/index.js");

const base = require("../data/cities/de-nw-kreis-olpe.json");
const overlay = require("./fixtures/curation/kreis-olpe-synthetic-overlay.json");

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function compose(customOverlay = overlay, customBase = base) {
  return curation.composeCuratedPackage(customBase, customOverlay);
}

test("18.1 overlay contract is declarative and fully base-pinned", () => {
  assert.deepEqual(curation.validateOverlay(copy(overlay)), overlay);
  for (const field of ["datasetId", "baseDatasetId", "baseVersion", "baseContentHash", "curatedVersion", "changes"]) {
    const invalid = copy(overlay);
    delete invalid[field];
    assert.throws(() => curation.validateOverlay(invalid), { code: "CURATION_SCHEMA_INVALID" });
  }
});

test("18.2 exact base ID, version and hash mismatch block composition", () => {
  for (const [field, value, code] of [
    ["baseDatasetId", "other", "CURATION_BASE_ID_MISMATCH"],
    ["baseVersion", "2026.09.08", "CURATION_BASE_VERSION_MISMATCH"],
    ["baseContentHash", `sha256:${"0".repeat(64)}`, "CURATION_BASE_HASH_MISMATCH"]
  ]) {
    const invalid = copy(overlay);
    invalid[field] = value;
    assert.throws(() => compose(invalid), { code });
  }
});

test("18.3 street rename, alias and disable use stable IDs", () => {
  const result = compose().packageData;
  const [rename, alias, disable] = overlay.changes;
  assert.equal(result.streets.find(item => item.id === rename.streetId).name, rename.name);
  assert.ok(result.streets.find(item => item.id === alias.streetId).aliases.includes(alias.alias));
  assert.equal(result.streets.find(item => item.id === disable.streetId).active, false);
  assert.equal(result.streets.find(item => item.id === disable.streetId).quizEligible, false);
  assert.equal(Object.hasOwn(rename, "index"), false);
});

test("18.4 POI add, edit, remove and category correction are applied", () => {
  const result = compose().packageData;
  assert.equal(result.pois.find(item => item.id === "curated-synthetic-poi-added").name, "SYNTHETIC Added POI");
  assert.equal(result.pois.find(item => item.id === "osm-relation-1891506:poi:node-262442795").name, "SYNTHETIC Edited Hotel");
  assert.equal(result.pois.some(item => item.id === "osm-relation-1891506:poi:node-269751037"), false);
  assert.equal(result.pois.find(item => item.id === "osm-relation-1891506:poi:node-269751040").category, "public_building");
});

test("18.5 curated response area reuses Phase 17 model, validator and membership", () => {
  const result = compose().packageData;
  const area = result.areas.find(item => item.id === "curated-response-synthetic-olpe");
  assert.equal(area.kind, "response_area");
  assert.equal(area.source, "curated");
  assert.equal(area.datasetId, result.city.id);
  assert.ok(area.streetCount > 5);
  assert.ok(result.streets.some(street => street.areaIds?.includes(area.id)));
  assert.ok(result.pois.some(poi => poi.areaIds?.includes(area.id)));
});

test("18.6 missing targets and conflicting changes are hard failures", () => {
  const missing = copy(overlay);
  missing.changes = [{ op: "street.rename", streetId: "missing-street", name: "Lost correction" }];
  assert.throws(() => compose(missing), { code: "CURATION_TARGET_MISSING" });
  const conflict = copy(overlay);
  const streetId = overlay.changes[0].streetId;
  conflict.changes = [
    { op: "street.rename", streetId, name: "First" },
    { op: "street.rename", streetId, name: "Second" }
  ];
  assert.throws(() => compose(conflict), { code: "CURATION_CONFLICT" });
});

test("18.7 composition is deterministic and never mutates the generated base", () => {
  const before = JSON.stringify(base);
  const first = compose().packageData;
  const second = compose().packageData;
  assert.deepEqual(first, second);
  assert.equal(first.package.contentHash, second.package.contentHash);
  assert.equal(JSON.stringify(base), before);
  assert.equal(base.streets[0].name, "Abt-Luke-Straße");
});

test("18.8 final package is curated while geographic datasetKind remains district", () => {
  const result = compose().packageData;
  assert.equal(result.package.type, "curated");
  assert.equal(result.package.datasetKind, "district");
  assert.equal(result.package.version, overlay.curatedVersion);
  assert.deepEqual(result.provenance.baseDataset, {
    id: base.package.id,
    version: base.package.version,
    contentHash: base.package.contentHash
  });
  assert.equal(result.provenance.curation.composerVersion, curation.COMPOSER_VERSION);
  assert.match(result.package.verification.note, /keine kryptografische/);
});

test("18.9 composed package passes package, city, area and hash validation", () => {
  const result = compose().packageData;
  assert.equal(validator.validateCityPackage(result).valid, true);
  assert.equal(validator.validateCityData(result).valid, true);
  assert.equal(validator.verifyPackageHash(result).valid, true);
});

test("18.10 rebase reports unchanged, upstream changed and missing targets for review", () => {
  const next = copy(base);
  next.package.version = "2026.09.08";
  next.streets.find(item => item.id === overlay.changes[0].streetId).name = "Upstream changed";
  next.streets = next.streets.filter(item => item.id !== overlay.changes[1].streetId);
  next.package.contentHash = validator.computePackageHash(next);
  const result = curation.rebaseOverlay(copy(overlay), base, next);
  assert.ok(result.report.upstreamChanged.some(item => item.targetId === overlay.changes[0].streetId));
  assert.ok(result.report.targetMissing.some(item => item.targetId === overlay.changes[1].streetId));
  assert.ok(result.report.unchanged.length > 0);
  assert.ok(result.report.reviewRequired.length >= 2);
  assert.equal(result.overlay.baseVersion, next.package.version);
  assert.equal(result.overlay.baseContentHash, next.package.contentHash);
});

test("18.11 publisher emits immutable history URL and curated catalog metadata", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "strassentrainer-curation-"));
  const source = path.join(root, "source");
  const output = path.join(root, "repository");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "curated.json"), `${JSON.stringify(compose().packageData, null, 2)}\n`);
  try {
    const published = await publisher.publishRepository({ sourceDir: source, outputDir: output, precompress: false });
    assert.equal(published.datasetCount, 1);
    const catalog = JSON.parse(fs.readFileSync(path.join(output, "catalog.json"), "utf8"));
    assert.equal(catalog.datasets[0].packageType, "curated");
    assert.equal(catalog.datasets[0].datasetKind, "district");
    assert.match(catalog.datasets[0].downloadPath, /^datasets\/de-nw-kreis-olpe\/1\.0\.0\/[0-9a-f]{64}\/package\.json$/);
    assert.equal(fs.existsSync(path.join(output, catalog.datasets[0].downloadPath)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("18.12 curated semantic changes affect hash, including street disable", () => {
  const withoutDisable = copy(overlay);
  withoutDisable.changes = withoutDisable.changes.filter(change => change.op !== "street.disable");
  assert.notEqual(compose().packageData.package.contentHash, compose(withoutDisable).packageData.package.contentHash);
});
