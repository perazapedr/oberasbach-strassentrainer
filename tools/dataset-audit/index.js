#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { auditDatasetPackage } = require("./audit-core.js");
const curationComposer = require("../dataset-curation/index.js");

const ROOT = path.resolve(__dirname, "../..");

const REFERENCE_DATASETS = [
  { key: "A", name: "Oberasbach (curated small)", file: "data/cities/oberasbach.json" },
  { key: "B", name: "Olpe (generated municipality)", file: "data/cities/de-nw-olpe.json" },
  { key: "C", name: "Wenden (municipality)", file: "data/cities/de-nw-wenden.json" },
  { key: "D", name: "Siegen (medium)", file: "data/cities/de-nw-siegen.json" },
  { key: "E", name: "Köln (large city)", file: "data/cities/de-nw-koeln.json" },
  { key: "F", name: "Zirndorf (second state)", file: "tests/fixtures/de-by-zirndorf.json" },
  { key: "G", name: "Kreis Olpe (district)", file: "data/cities/de-nw-kreis-olpe.json" }
];

function runMatrixAudit() {
  console.log("============================================================");
  console.log("=== Straßentrainer Deutschland – Dataset Audit Matrix ===");
  console.log("============================================================\n");

  const reports = [];
  let allPass = true;

  for (const item of REFERENCE_DATASETS) {
    const fullPath = path.resolve(ROOT, item.file);
    if (!fs.existsSync(fullPath)) {
      console.error(`[FEHLER] Datei nicht gefunden: ${item.file}`);
      allPass = false;
      continue;
    }
    const raw = fs.readFileSync(fullPath, "utf8");
    const pkg = JSON.parse(raw);
    const report = auditDatasetPackage(pkg);
    report.matrixKey = item.key;
    report.matrixName = item.name;
    reports.push(report);
    if (!report.pass) allPass = false;
  }

  // Also audit synthetic curated district fixture
  try {
    const baseDistrict = JSON.parse(fs.readFileSync(path.resolve(ROOT, "data/cities/de-nw-kreis-olpe.json"), "utf8"));
    const overlay = JSON.parse(fs.readFileSync(path.resolve(ROOT, "tests/fixtures/curation/kreis-olpe-synthetic-overlay.json"), "utf8"));
    const composed = curationComposer.composeCuratedPackage(baseDistrict, overlay);
    const reportCurated = auditDatasetPackage(composed.packageData);
    reportCurated.matrixKey = "H";
    reportCurated.matrixName = "Synthetic Curated District (Fixture)";
    reports.push(reportCurated);
    if (!reportCurated.pass) allPass = false;
  } catch (err) {
    console.error("[FEHLER] Synthetic Curated Fixture konnte nicht auditiert werden:", err.message);
    allPass = false;
  }

  // Print Summary Table
  console.log(
    "Key | Dataset                             | Streets | POIs | Areas | Errors | Warnings | Status"
  );
  console.log(
    "----+-------------------------------------+---------+------+-------+--------+----------+-------"
  );

  for (const r of reports) {
    const key = r.matrixKey.padEnd(3);
    const name = r.matrixName.padEnd(35).slice(0, 35);
    const streets = String(r.stats.streetsCount ?? 0).padStart(7);
    const pois = String(r.stats.poisCount ?? 0).padStart(4);
    const areas = String(r.stats.areasCount ?? 0).padStart(5);
    const errors = String(r.errorsCount).padStart(6);
    const warnings = String(r.warningsCount).padStart(8);
    const status = r.status.padEnd(6);
    console.log(`${key} | ${name} | ${streets} | ${pois} | ${areas} | ${errors} | ${warnings} | ${status}`);
    if (r.errors.length > 0) {
      for (const e of r.errors) {
        console.log(`     [ERROR] [${e.section}] ${e.code}: ${e.message}`);
      }
    }
  }

  console.log("----+-------------------------------------+---------+------+-------+--------+----------+-------");
  console.log(`\nErgebnis: ${allPass ? "ALLE AUDITS BESTANDEN (PASS)" : "AUDIT-FEHLER GEFUNDEN (FAIL)"}\n`);

  return { reports, allPass };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileArgIdx = args.indexOf("--file");
  if (fileArgIdx !== -1 && args[fileArgIdx + 1]) {
    const target = path.resolve(process.cwd(), args[fileArgIdx + 1]);
    const pkg = JSON.parse(fs.readFileSync(target, "utf8"));
    const rep = auditDatasetPackage(pkg);
    console.log(JSON.stringify(rep, null, 2));
    process.exit(rep.pass ? 0 : 1);
  } else {
    const res = runMatrixAudit();
    process.exit(res.allPass ? 0 : 1);
  }
}

module.exports = {
  runMatrixAudit,
  REFERENCE_DATASETS
};
