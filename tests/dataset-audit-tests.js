"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { auditDatasetPackage } = require("../tools/dataset-audit/audit-core.js");
const { runMatrixAudit } = require("../tools/dataset-audit/index.js");

test("Dataset Audit: Golden Master Oberasbach erfüllt alle Kriterien", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/cities/oberasbach.json"), "utf8"));
  const report = auditDatasetPackage(pkg);
  assert.equal(report.status, "PASS");
  assert.equal(report.errorsCount, 0);
  assert.equal(report.stats.streetsCount, 271);
  assert.equal(report.stats.poisCount, 60);
  assert.equal(report.stats.areasCount, 0);
});

test("Dataset Audit: Kreis Olpe District erfüllt alle Kriterien inklusive 7 Gemeinden", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/cities/de-nw-kreis-olpe.json"), "utf8"));
  const report = auditDatasetPackage(pkg);
  assert.equal(report.status, "PASS");
  assert.equal(report.errorsCount, 0);
  assert.equal(report.stats.streetsCount, 2756);
  assert.equal(report.stats.poisCount, 623);
  assert.equal(report.stats.areasCount, 7);
  assert.equal(report.stats.administrativeAreasCount, 7);
});

test("Dataset Audit: Erkennt fehlerhafte Pakete (Null-Geometrie, falsche Kategorie, korrupte IDs)", () => {
  const badPkg = {
    schemaVersion: 1,
    city: { id: "test-city", name: "Test City", center: { lat: 50, lon: 8 }, bounds: { north: 51, south: 49, west: 7, east: 9 } },
    streets: [
      { id: "st-1", name: "Gute Straße", geometry: { type: "MultiLineString", coordinates: [[[8.0, 50.0], [8.01, 50.01]]] } },
      { id: "st-1", name: "Doppelte ID", geometry: { type: "MultiLineString", coordinates: [[[8.0, 50.0], [8.01, 50.01]]] } },
      { id: "st-2", name: "", geometry: { type: "MultiLineString", coordinates: [[[8.0, 50.0], [8.01, 50.01]]] } },
      { id: "st-3", name: "Null-Geometrie", geometry: null },
      { id: "st-4", name: "Nullsegment", geometry: { type: "MultiLineString", coordinates: [[[0, 0], [0, 0]]] } }
    ],
    pois: [
      { id: "poi-1", name: "Unbekannte Kategorie", category: "alien_base", position: { lat: 50, lon: 8 } },
      { id: "poi-2", name: "Feuerwehr darf nicht quizEligible sein", category: "fire_station", position: { lat: 50, lon: 8 }, quizEligible: true },
      { id: "poi-3", name: "Ungültige Position", category: "school", position: { lat: 999, lon: -999 } }
    ],
    areas: [
      { id: "area-1", name: "Zyklus A", parentId: "area-2", geometry: { type: "Polygon", coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50.1], [8, 50]]] } },
      { id: "area-2", name: "Zyklus B", parentId: "area-1", geometry: { type: "Polygon", coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50.1], [8, 50]]] } }
    ]
  };

  const report = auditDatasetPackage(badPkg);
  assert.equal(report.status, "FAIL");
  assert.ok(report.errorsCount >= 7);

  const errorCodes = new Set(report.errors.map(e => e.code));
  assert.ok(errorCodes.has("STREET_ID_DUPLICATE"));
  assert.ok(errorCodes.has("STREET_NAME_EMPTY"));
  assert.ok(errorCodes.has("STREET_GEOMETRY_NULL"));
  assert.ok(errorCodes.has("STREET_ZERO_SEGMENT"));
  assert.ok(errorCodes.has("POI_CATEGORY_INVALID"));
  assert.ok(errorCodes.has("FIRE_STATION_QUIZ_ELIGIBLE"));
  assert.ok(errorCodes.has("POI_POSITION_OUT_OF_BOUNDS"));
  assert.ok(errorCodes.has("AREA_PARENT_CYCLE"));
});

test("Dataset Audit: Gesamte Referenzmatrix A-H besteht ohne Fehler", () => {
  const result = runMatrixAudit();
  assert.equal(result.allPass, true);
  assert.equal(result.reports.length, 8);
  for (const rep of result.reports) {
    assert.equal(rep.errorsCount, 0, `Datensatz ${rep.matrixName} hat unerwartete Fehler: ${JSON.stringify(rep.errors)}`);
  }
});

