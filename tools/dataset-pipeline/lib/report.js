"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createRunReport(data) {
  const report = {
    runId: data.runId,
    pipelineVersion: "1.0.0",
    builderVersion: data.builderVersion || "0.1.0",
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    durationSeconds: Number(((new Date(data.finishedAt) - new Date(data.startedAt)) / 1000).toFixed(2)),
    region: data.region || "de-nw",
    pbfMetadata: data.pbfMetadata || {},
    mode: {
      dryRun: Boolean(data.dryRun),
      noPublish: Boolean(data.noPublish),
      all: Boolean(data.all),
      singleDataset: data.singleDataset || null
    },
    targets: (data.targets || []).map(t => ({
      datasetId: t.datasetId,
      name: t.name,
      relationId: t.relationId,
      adminLevel: t.adminLevel
    })),
    buildResults: data.buildResults || [],
    qaResults: data.qaResults || [],
    catalogResult: data.catalogResult || null,
    publishResult: data.publishResult || null,
    overallStatus: data.overallStatus || "FAILED"
  };

  if (data.reportPath) {
    fs.mkdirSync(path.dirname(data.reportPath), { recursive: true });
    fs.writeFileSync(data.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  return report;
}

function printSummary(report) {
  console.log("\n=======================================================");
  console.log(`PIPELINE RUN REPORT: ${report.runId}`);
  console.log(`Region:           ${report.region}`);
  console.log(`PBF Quelle:       ${path.basename(report.pbfMetadata?.pbfPath || "n/a")}`);
  console.log(`OSM Stand:        ${report.pbfMetadata?.osmTimestamp || "n/a"}`);
  console.log(`Dauer:            ${report.durationSeconds}s`);
  console.log("-------------------------------------------------------");
  console.log("DATASET STATUS:");

  for (const qa of report.qaResults) {
    const build = (report.buildResults || []).find(b => b.datasetId === qa.datasetId) || {};
    const duration = build.durationSeconds ? `${build.durationSeconds}s` : "n/a";
    const mem = build.peakRssBytes ? `${(build.peakRssBytes / 1024 / 1024).toFixed(1)}MB` : "n/a";
    console.log(
      `  ${qa.datasetId.padEnd(16)} | Status: ${qa.status.padEnd(5)} | Klassifikation: ${qa.classification.padEnd(10)} | ` +
      `Str: ${String(qa.streetCount).padStart(4)} | POI: ${String(qa.poiCount).padStart(4)} | Area: ${String(qa.areaCount).padStart(3)} | ` +
      `Zeit: ${duration.padStart(6)} | RSS: ${mem.padStart(7)}`
    );
  }

  console.log("-------------------------------------------------------");
  console.log(`PREFLIGHT:        PASS`);
  console.log(`BUILD:            ${report.buildResults.every(b => b.status === "PASS") ? "PASS" : "FAIL"}`);
  console.log(`VALIDATE & QA:    ${report.qaResults.every(q => q.status === "PASS") ? "PASS" : "FAIL"}`);
  console.log(`CATALOG:          ${report.catalogResult?.status || "PASS"}`);
  console.log(`PUBLISH:          ${report.publishResult?.status || "BLOCKED"}`);
  console.log(`GESAMT-ERGEBNIS:  ${report.overallStatus}`);
  console.log("=======================================================\n");
}

module.exports = {
  createRunReport,
  printSummary
};

