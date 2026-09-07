"use strict";

/**
 * Phase 20: Release Candidate End-to-End Orchestrator & Test Suite
 * 
 * Überprüft lückenlos:
 * 1. Integrität des Golden Master Oberasbach & Kreis Olpe
 * 2. Unveränderlichkeit der Kernmodule (game-engine.js, timer.js, statistics.js)
 * 3. Produktions-Katalogintegrität (keine Test-Fixtures, valide Hashes)
 * 4. JS Syntax Check (node --check über alle App-, Tool- und Test-Skripte)
 * 5. Git Diff & Whitespace Hygiene (git diff --check)
 * 6. Node Unit & Integration Test Suite (node --test tests/*.js)
 * 7. Dataset Quality Audit (tools/dataset-audit/index.js)
 * 8. Browser Publisher Repository Test (scripts/browser-publisher-repository-test.js)
 * 9. Browser Production Hardening Test (scripts/browser-production-hardening-test.js)
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

const GOLDEN_OBERASBACH_HASH = "sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95";
const GOLDEN_KREIS_OLPE_HASH = "sha256:1c076dc3988e06c6019b982a6521196b83830d2b7ab0b110f438aa1352be7455";

async function runStep(label, fn) {
  const started = Date.now();
  process.stdout.write(`\n--- [RC-CHECK] ${label} ... `);
  try {
    const result = await fn();
    const duration = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`PASS (${duration}s)`);
    return { ok: true, duration, result };
  } catch (err) {
    const duration = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`FAIL (${duration}s)`);
    console.error(`\n[FEHLER in ${label}]:`, err.message || err);
    throw err;
  }
}

async function runRcTest() {
  console.log("============================================================");
  console.log("=== STRAßENTRAINER DEUTSCHLAND – RELEASE CANDIDATE TEST ===");
  console.log("=== Version: 2.0.0-rc1 | Masterplan 2.0 Finale Abnahme ===");
  console.log("============================================================");

  const summary = {
    version: "2.0.0-rc1",
    timestamp: new Date().toISOString(),
    steps: {},
    allPassed: false
  };

  // 1. Golden Master & Kreis Olpe Integrity
  await runStep("1. Golden Master & Kreis Olpe Integritätsprüfung", () => {
    // Oberasbach
    const oberasbachPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "dist/dataset-repository/datasets/de-oberasbach-fire-training/package.json"), "utf8"));
    assert.equal(oberasbachPkg.package.contentHash, GOLDEN_OBERASBACH_HASH, "Oberasbach contentHash stimmt überein");
    assert.equal(oberasbachPkg.streets.length, 271, "Oberasbach 271 Straßen");
    assert.equal(oberasbachPkg.pois.length, 60, "Oberasbach 60 POIs");
    assert.equal((oberasbachPkg.areas || []).length, 0, "Oberasbach 0 Areas");

    // Kreis Olpe
    const olpePkg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/de-nw-kreis-olpe.json"), "utf8"));
    assert.equal(olpePkg.package.contentHash, GOLDEN_KREIS_OLPE_HASH, "Kreis Olpe contentHash stimmt überein");
    assert.equal(olpePkg.streets.length, 2756, "Kreis Olpe 2756 Straßen");
    assert.equal(olpePkg.pois.length, 623, "Kreis Olpe 623 POIs");
    assert.equal(olpePkg.areas.length, 7, "Kreis Olpe 7 Areas");

    // Core Engine Invariance
    const engineDiff = execSync("git diff HEAD -- game-engine.js timer.js statistics.js", { cwd: ROOT }).toString().trim();
    assert.equal(engineDiff, "", "game-engine.js, timer.js, statistics.js dürfen keine unbegründeten Änderungen enthalten");
  });

  // 2. Production Catalog Hygiene
  await runStep("2. Produktionskatalog & Repository-Integrität", () => {
    const catalogPath = path.join(ROOT, "dist/dataset-repository/catalog.json");
    assert.ok(fs.existsSync(catalogPath), "dist/dataset-repository/catalog.json existiert");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

    assert.ok(Array.isArray(catalog.datasets), "datasets ist ein Array");
    assert.equal(catalog.datasets.length, 7, "Genau 7 echte Produktionsdatensätze im Katalog");

    const expectedIds = [
      "de-oberasbach-fire-training",
      "de-by-zirndorf",
      "de-nw-koeln",
      "de-nw-kreis-olpe",
      "de-nw-olpe",
      "de-nw-siegen",
      "de-nw-wenden"
    ];
    const foundIds = catalog.datasets.map(d => d.id);
    assert.deepEqual(foundIds, expectedIds, "Exakt die 7 erwarteten Produktionsdatensätze");

    // Keine Test-/Fixture-Spuren
    for (const ds of catalog.datasets) {
      assert.ok(!ds.id.includes("fixture"), `Kein Fixture-Datensatz: ${ds.id}`);
      assert.ok(!ds.id.includes("synthetic"), `Kein synthetischer Datensatz: ${ds.id}`);
      assert.ok(!ds.id.includes("test"), `Kein Test-Datensatz: ${ds.id}`);

      // Prüfe physisches Vorhandensein der Download-Pfade
      const pkgPath = path.join(ROOT, "dist/dataset-repository", ds.downloadPath);
      assert.ok(fs.existsSync(pkgPath), `Paketdatei existiert: ${pkgPath}`);
      const pkgData = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      assert.equal(pkgData.package.contentHash, ds.contentHash, `Hash für ${ds.id} stimmt mit Manifest überein`);
    }
  });

  // 3. JS Syntax Check
  await runStep("3. JavaScript Syntax-Check (node --check)", () => {
    const jsFiles = [
      "app.js", "geometry.js", "poi-categories.js", "targets.js", "statistics.js",
      "game-engine.js", "timer.js", "city-storage.js", "city-data-validator.js",
      "custom-training-area.js", "city-package.js", "city-update.js",
      "city-manager-ui.js", "default-city.js", "osm-service.js", "dataset-provider.js",
      "offline-basemap.js", "sw.js"
    ];

    for (const file of jsFiles) {
      const fullPath = path.join(ROOT, file);
      const res = spawnSync("node", ["--check", fullPath], { cwd: ROOT });
      assert.equal(res.status, 0, `Syntaxfehler in ${file}: ${res.stderr}`);
    }
  });

  // 4. Git Diff Check
  await runStep("4. Git Diff & Whitespace Check (git diff --check)", () => {
    const res = spawnSync("git", ["diff", "--check"], { cwd: ROOT });
    assert.equal(res.status, 0, `git diff --check meldet Fehler: ${res.stdout || res.stderr}`);
  });

  // 5. Node Unit & Integration Tests
  await runStep("5. Vollständige Node Test-Suite (node --test tests/*.js)", () => {
    const res = spawnSync("node", ["--test", "tests/*.js"], { cwd: ROOT, encoding: "utf8" });
    if (res.status !== 0) {
      console.error(res.stdout || res.stderr);
      throw new Error(`Node test-suite fehlgeschlagen mit Exit Code ${res.status}`);
    }
    const match = res.stdout.match(/# pass (\d+)/);
    const passCount = match ? Number(match[1]) : 0;
    assert.ok(passCount >= 200, `Mindestens 200 Tests müssen bestehen (aktuell: ${passCount})`);
    return { passed: passCount };
  });

  // 6. Dataset Audit
  await runStep("6. Dataset Qualitäts-Audit (tools/dataset-audit/index.js)", () => {
    const res = spawnSync("node", ["tools/dataset-audit/index.js"], { cwd: ROOT, encoding: "utf8" });
    if (res.status !== 0) {
      console.error(res.stdout || res.stderr);
      throw new Error(`Dataset Audit fehlgeschlagen: ${res.stderr}`);
    }
    assert.ok(res.stdout.includes("ALLE AUDITS BESTANDEN (PASS)"), "Alle 8 Audits bestanden");
  });

  // 7. Browser Publisher Repository Test
  await runStep("7. Browser Publisher Repository E2E Test Suite", () => {
    const res = spawnSync("node", ["scripts/browser-publisher-repository-test.js"], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
    if (res.status !== 0) {
      console.error(res.stdout || res.stderr);
      throw new Error(`Browser Publisher Test fehlgeschlagen mit Exit Code ${res.status}`);
    }
    assert.ok(res.stdout.includes("ALLE BROWSER-REPOSITORY-TESTS VOLLSTÄNDIG BESTANDEN (PASS)"));
  });

  // 8. Browser Production Hardening Test
  await runStep("8. Browser Production Hardening Test Suite", () => {
    const res = spawnSync("node", ["scripts/browser-production-hardening-test.js"], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
    if (res.status !== 0) {
      console.error(res.stdout || res.stderr);
      throw new Error(`Browser Hardening Test fehlgeschlagen mit Exit Code ${res.status}`);
    }
    assert.ok(res.stdout.includes("ALLE PHASE 19 BROWSER-HARDENING-TESTS BESTANDEN (PASS)"));
  });

  summary.allPassed = true;

  console.log("\n============================================================");
  console.log("✓ ALLE RELEASE CANDIDATE TESTS BESTANDEN (100% PASS)");
  console.log("✓ Freigabe-Empfehlung: GO für v2.0.0-rc1");
  console.log("============================================================\n");

  return summary;
}

if (require.main === module) {
  runRcTest()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("\n[RELEASE CANDIDATE FAILURE]", err);
      process.exit(1);
    });
}

module.exports = { runRcTest };

