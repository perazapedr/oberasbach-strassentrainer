#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { loadManifest, loadRegions, filterTargets } = require("./lib/manifest.js");
const { runPreflight } = require("./lib/preflight.js");
const { loadQaPolicy, loadPublishedState, evaluateCandidatePackage } = require("./lib/qa.js");
const { createStagingDir, cleanupStaging } = require("./lib/staging.js");
const { publishCandidates } = require("./lib/publish.js");
const { createRunReport, printSummary } = require("./lib/report.js");
const { buildCatalog } = require("../catalog-builder/index.js");

const ROOT_DIR = path.resolve(__dirname, "../..");
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, "data");
const DEFAULT_REGIONS = path.join(__dirname, "regions.json");
const DEFAULT_MANIFEST = path.join(__dirname, "datasets.json");
const DEFAULT_QA_POLICY = path.join(__dirname, "qa-policy.json");
const DEFAULT_PUBLISHED_STATE = path.join(__dirname, "published-state.json");
const DATASET_BUILDER_SCRIPT = path.join(ROOT_DIR, "tools/dataset-builder/index.js");

function parseArgs(argv) {
  const options = {
    pbf: null,
    region: null,
    regions: DEFAULT_REGIONS,
    all: false,
    dataset: null,
    discover: false,
    dryRun: false,
    noPublish: false,
    keepStaging: false,
    jobs: 1,
    verbose: false,
    manifest: DEFAULT_MANIFEST,
    qaPolicy: DEFAULT_QA_POLICY,
    publishedState: DEFAULT_PUBLISHED_STATE,
    dataDir: DEFAULT_DATA_DIR,
    report: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pbf" && argv[i + 1]) options.pbf = argv[++i];
    else if (arg === "--region" && argv[i + 1]) options.region = argv[++i];
    else if (arg === "--regions" && argv[i + 1]) options.regions = argv[++i];
    else if (arg === "--all") options.all = true;
    else if (arg === "--dataset" && argv[i + 1]) options.dataset = argv[++i];
    else if (arg === "--discover") options.discover = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-publish") options.noPublish = true;
    else if (arg === "--keep-staging") options.keepStaging = true;
    else if (arg === "--jobs" && argv[i + 1]) options.jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--manifest" && argv[i + 1]) options.manifest = argv[++i];
    else if (arg === "--qa-policy" && argv[i + 1]) options.qaPolicy = argv[++i];
    else if (arg === "--published-state" && argv[i + 1]) options.publishedState = argv[++i];
    else if (arg === "--data-dir" && argv[i + 1]) options.dataDir = argv[++i];
    else if (arg === "--report" && argv[i + 1]) options.report = argv[++i];
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unbekannter Parameter: ${arg}`);
    }
  }

  if (!options.pbf) {
    throw new Error("Fehlender Pflichtparameter: --pbf <pfad-zu-osm.pbf>");
  }
  if (!options.discover && !options.all && !options.dataset) {
    throw new Error("Mindestens eine Zielauswahl erforderlich: --all oder --dataset <id> oder --discover");
  }

  return options;
}

function printHelp() {
  console.log(`
Verwendung:
  node tools/dataset-pipeline/index.js --pbf <pfad> [Optionen]

Optionen:
  --pbf <pfad>            Pfad zur OSM-PBF-Datei (Pflicht)
  --region <id>           Region / Bundesland-ID (z.B. de-nw, de-by)
  --regions <pfad>        Pfad zur regions.json Konfiguration
  --discover              Findet administrative Gemeinden im PBF und listet sie auf
  --all                   Alle aktiven Datensätze aus dem Manifest bauen
  --dataset <id>          Nur einen bestimmten Datensatz bauen (z.B. de-nw-siegen)
  --dry-run               Führt Preflight, Build, QA und Catalog aus, publiziert jedoch nicht
  --no-publish            Baut und validiert ins Staging, führt keinen Publish durch
  --keep-staging          Staging-Verzeichnis nach dem Lauf nicht löschen
  --jobs <n>              Parallele Builder-Prozesse (Standard: 1)
  --verbose               Detaillierte Ausgaben anzeigen
  --manifest <pfad>       Pfad zur Manifest-Datei (Standard: datasets.json)
  --qa-policy <pfad>      Pfad zur QA-Policy (Standard: qa-policy.json)
  --published-state <p>   Pfad zur published-state.json
  --report <pfad>         Zielpfad für den maschinenlesbaren JSON-Report
  --help                  Diese Hilfe anzeigen
`);
}

function discoverCandidates(pbfPath, verbose = false) {
  const { spawnSync } = require("node:child_process");
  console.log(`[DISCOVERY] Durchsuche ${pbfPath} nach administrativen Gemeinden …`);
  const result = spawnSync("osmium", ["tags-filter", "-R", "-f", "opl", pbfPath, "r/boundary=administrative"], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(result.stderr || "osmium tags-filter fehlgeschlagen");
  const core = require("../dataset-builder/lib/core.js");
  const candidates = core.parseBoundaryRelationOpl(result.stdout);
  const municipalities = candidates
    .filter(c => c.tags && c.tags.boundary === "administrative" && (c.tags.admin_level === "8" || c.tags.admin_level === "6"))
    .map(c => ({
      relationId: c.id,
      name: c.tags.name || c.tags["name:de"] || "Unbenannt",
      adminLevel: Number(c.tags.admin_level),
      ags: c.tags["de:amtlicher_gemeindeschluessel"] || "ohne AGS"
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  console.log(`Gefundene administrative Gemeinden (${municipalities.length}):`);
  for (const m of municipalities.slice(0, 50)) {
    console.log(`  Relation ${String(m.relationId).padEnd(10)} | Admin-Level ${m.adminLevel} | AGS: ${m.ags.padEnd(10)} | ${m.name}`);
  }
  if (municipalities.length > 50) {
    console.log(`  … und ${municipalities.length - 50} weitere Gemeinden.`);
  }
  return municipalities;
}

// Child-Prozesse zur sauberen Signal-Behandlung
const activeChildProcesses = new Set();
let globalStagingDir = null;
let globalKeepStaging = false;

function setupSignalHandlers() {
  const onSignal = (signal) => {
    console.error(`\n[ABORT] Signal ${signal} empfangen. Beende aktive Builder-Prozesse …`);
    for (const child of activeChildProcesses) {
      try {
        child.kill("SIGTERM");
      } catch (_) {}
    }
    if (globalStagingDir && !globalKeepStaging) {
      try {
        cleanupStaging(globalStagingDir, false);
      } catch (_) {}
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

function runBuilderProcess(target, pbfPath, stagingResult, regionMeta = null, verbose = false) {
  return new Promise((resolve) => {
    const started = Date.now();
    const outputFile = path.join(stagingResult.citiesDir, `${target.datasetId}.json`);
    const reportFile = path.join(stagingResult.reportsDir, `${target.datasetId}-report.json`);

    const args = [
      DATASET_BUILDER_SCRIPT,
      "--pbf", pbfPath,
      "--municipality", target.name,
      "--relation-id", String(target.relationId),
      "--admin-level", String(target.adminLevel),
      "--dataset-id", target.datasetId,
      "--output", outputFile,
      "--report", reportFile
    ];
    if (regionMeta) {
      if (regionMeta.state) args.push("--state", regionMeta.state);
      if (regionMeta.country) args.push("--country", regionMeta.country);
    }
    if (verbose) args.push("--verbose");

    if (verbose) {
      console.log(`[BUILD] Starte Builder für ${target.datasetId} (Relation ${target.relationId}) …`);
    }

    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    activeChildProcesses.add(child);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
      if (verbose) process.stderr.write(chunk);
    });

    child.on("close", (code) => {
      activeChildProcesses.delete(child);
      const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(2));

      let buildReport = null;
      if (fs.existsSync(reportFile)) {
        try {
          buildReport = JSON.parse(fs.readFileSync(reportFile, "utf8"));
        } catch (_) {}
      }

      if (code === 0 && fs.existsSync(outputFile)) {
        resolve({
          status: "PASS",
          datasetId: target.datasetId,
          target,
          durationSeconds,
          outputFile,
          reportFile,
          buildReport,
          peakRssBytes: buildReport?.processRssDeltaBytes || 0,
          peakRssBytes: buildReport?.processRssPeakBytes || buildReport?.processRssDeltaBytes || 0,
          childPeakRssBytes: buildReport?.processRssPeakBytes || 0,
          childRssDeltaBytes: buildReport?.processRssDeltaBytes || 0,
          childRssStartBytes: buildReport?.processRssStartBytes || 0,
          childOsMaxRssBytes: buildReport?.processMaxRssBytes || 0,
          parentRssBytes: process.memoryUsage().rss,
          error: null
        });
      } else {
        resolve({
          status: "FAIL",
          datasetId: target.datasetId,
          target,
          durationSeconds,
          outputFile,
          reportFile,
          buildReport,
          peakRssBytes: 0,
          error: stderr || stdout || `Builder-Prozess beendet mit Exit Code ${code}`
        });
      }
    });

    child.on("error", (err) => {
      activeChildProcesses.delete(child);
      resolve({
        status: "FAIL",
        datasetId: target.datasetId,
        target,
        durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
        outputFile,
        reportFile,
        buildReport: null,
        peakRssBytes: 0,
        error: err.message
      });
    });
  });
}

async function executePipeline(options) {
  setupSignalHandlers();
  const startedAt = new Date().toISOString();

  // Discovery-Modus
  if (options.discover) {
    const found = discoverCandidates(options.pbf, options.verbose);
    return {
      status: "DISCOVER_COMPLETE",
      count: found.length,
      municipalities: found
    };
  }

  console.log("=== Straßentrainer Dataset-Pipeline ===");
  console.log(`Modus: ${options.dryRun ? "DRY RUN" : (options.noPublish ? "NO PUBLISH" : "STANDARD (BUILD + PUBLISH)")}`);

  // 1. Regionen-Konfiguration & Manifest laden
  const regionsConfig = loadRegions(options.regions);
  if (options.region && !regionsConfig.regions[options.region]) {
    throw new Error(`Unbekannte Region: "${options.region}". Unterstützt: ${Object.keys(regionsConfig.regions).join(", ")}`);
  }

  // Automatischer Manifest-Pfad basierend auf Region, falls Standard verwendet wird
  if (options.manifest === DEFAULT_MANIFEST && options.region) {
    const regionManifest = path.join(__dirname, "manifests", `${options.region}.json`);
    if (fs.existsSync(regionManifest)) {
      options.manifest = regionManifest;
    }
  }

  const manifest = loadManifest(options.manifest, regionsConfig);
  const regionId = options.region || manifest.regionId;
  const regionMeta = regionsConfig.regions[regionId] || { state: "Nordrhein-Westfalen", country: "Deutschland" };

  const targets = filterTargets(manifest, { all: options.all, dataset: options.dataset });
  console.log(`Region: ${manifest.regionId} (${regionMeta.state}), Targets (${targets.length}): ${targets.map(t => t.name).join(", ")}`);

  // 2. Preflight
  console.log("Führe Preflight-Prüfung durch …");
  const preflightReport = runPreflight(options.pbf, manifest, options);
  console.log(`✓ Preflight PASS (osmium ${preflightReport.osmiumVersion}, PBF Stand: ${preflightReport.osmTimestamp})`);

  // 3. Staging Verzeichnis erstellen
  const stagingResult = createStagingDir();
  globalStagingDir = stagingResult.stagingDir;
  globalKeepStaging = options.keepStaging;
  if (options.verbose) console.log(`Staging-Verzeichnis: ${stagingResult.stagingDir}`);

  // 4. Build Phase (Bounded Concurrency via options.jobs)
  console.log(`Starte Builds für ${targets.length} Ziel(e) (Parallelität: ${options.jobs}) …`);
  const buildResults = [];

  for (let i = 0; i < targets.length; i += options.jobs) {
    const chunk = targets.slice(i, i + options.jobs);
    const chunkPromises = chunk.map(target =>
      runBuilderProcess(target, preflightReport.pbfPath, stagingResult, regionMeta, options.verbose)
    );
    const chunkResults = await Promise.all(chunkPromises);
    buildResults.push(...chunkResults);
  }

  const allBuildsPassed = buildResults.every(b => b.status === "PASS");
  if (!allBuildsPassed) {
    console.error("✗ Mindestens ein Builder-Lauf ist fehlgeschlagen.");
  } else {
    console.log("✓ Alle Builder-Läufe erfolgreich abgeschlossen.");
  }

  // 5. Validate & QA Phase
  console.log("Führe automatisierte Validierung & QA-Gates durch …");
  const qaPolicy = loadQaPolicy(options.qaPolicy);
  const publishedState = loadPublishedState(options.publishedState);
  const qaResults = [];

  for (const bResult of buildResults) {
    if (bResult.status !== "PASS") {
      qaResults.push({
        status: "FAIL",
        classification: "FAILED",
        datasetId: bResult.datasetId,
        version: "n/a",
        contentHash: "n/a",
        streetCount: 0,
        poiCount: 0,
        areaCount: 0,
        errors: [{ code: "BUILD_FAILED", message: bResult.error }],
        warnings: [],
        metrics: {}
      });
      continue;
    }

    try {
      const packageData = JSON.parse(fs.readFileSync(bResult.outputFile, "utf8"));
      const qaEval = evaluateCandidatePackage(packageData, bResult.buildReport, qaPolicy, publishedState);
      qaResults.push(qaEval);
    } catch (err) {
      qaResults.push({
        status: "FAIL",
        classification: "FAILED",
        datasetId: bResult.datasetId,
        version: "n/a",
        contentHash: "n/a",
        streetCount: 0,
        poiCount: 0,
        areaCount: 0,
        errors: [{ code: "QA_EXECUTION_ERROR", message: err.message }],
        warnings: [],
        metrics: {}
      });
    }
  }

  const allQaPassed = qaResults.every(q => q.status === "PASS");
  if (!allQaPassed) {
    console.error("✗ QA-Gates nicht bestanden.");
  } else {
    console.log("✓ Alle QA-Gates erfolgreich bestanden.");
  }

  // 6. Candidate Catalog Erzeugung & Validierung
  console.log("Erzeuge Candidate Catalog im Staging …");
  let catalogResult = null;
  try {
    // Sammle alle Pakete für den Kandidaten-Katalog:
    // Staged Pakete + unveränderte veröffentlichte Pakete (Oberasbach, nicht ausgewählte Kommunen)
    const candidateInputs = [];
    const builtIds = new Set(buildResults.filter(b => b.status === "PASS").map(b => b.datasetId));

    // Staged Packages
    for (const b of buildResults) {
      if (b.status === "PASS") {
        candidateInputs.push(b.outputFile);
      }
    }

    // Published Packages, die nicht gebaut wurden (insb. Golden Oberasbach)
    const citiesDir = path.join(options.dataDir, "cities");
    if (fs.existsSync(citiesDir)) {
      const existingFiles = fs.readdirSync(citiesDir).filter(f => f.endsWith(".json") && !f.startsWith(".tmp-"));
      for (const file of existingFiles) {
        const fullPath = path.join(citiesDir, file);
        try {
          const pkg = JSON.parse(fs.readFileSync(fullPath, "utf8"));
          const pkgId = pkg?.package?.id;
          if (pkgId && !builtIds.has(pkgId)) {
            const stagedCopy = path.join(stagingResult.citiesDir, file);
            if (!fs.existsSync(stagedCopy)) {
              fs.copyFileSync(fullPath, stagedCopy);
            }
            candidateInputs.push(stagedCopy);
          }
        } catch (_) {}
      }
    }

    const stagedCatalogOutput = stagingResult.catalogFile || path.join(stagingResult.stagingDir, "catalog.json");
    let catalogTimestamp = preflightReport.osmTimestamp;
    const existingCatalogPath = path.join(options.dataDir || DEFAULT_DATA_DIR, "catalog.json");
    if (fs.existsSync(existingCatalogPath)) {
      try {
        const existingCat = JSON.parse(fs.readFileSync(existingCatalogPath, "utf8"));
        const anyChanged = qaResults.some(r => r.classification === "CHANGED" || r.classification === "NEW");
        if (!anyChanged && existingCat && existingCat.generatedAt) {
          catalogTimestamp = existingCat.generatedAt;
        }
      } catch (_) {}
    }
    const catBuild = buildCatalog({
      inputs: candidateInputs,
      output: stagedCatalogOutput,
      generatedAt: preflightReport.osmTimestamp
      generatedAt: catalogTimestamp
    });

    catalogResult = {
      status: "PASS",
      outputFile: catBuild.catalogOutputFile,
      datasetCount: catBuild.count,
      datasets: catBuild.catalog.datasets.map(d => ({ id: d.id, name: d.name, version: d.version, contentHash: d.contentHash }))
    };
    console.log(`✓ Candidate Catalog erfolgreich erzeugt (${catalogResult.datasetCount} Datensätze)`);
  } catch (err) {
    catalogResult = {
      status: "FAIL",
      error: err.message
    };
    console.error(`✗ Fehler bei der Candidate-Catalog-Erstellung: ${err.message}`);
  }

  // 7. Publish Gate & Execution
  let publishResult = null;
  const canPublish = allBuildsPassed && allQaPassed && catalogResult?.status === "PASS";

  if (!canPublish) {
    publishResult = {
      status: "BLOCKED",
      reason: "Mindestens ein Pflicht-Gate (Build, QA oder Catalog) ist fehlgeschlagen."
    };
    console.error("PUBLISH GATE: BLOCKED");
  } else {
    try {
      console.log(`Führe Publish aus (dryRun: ${options.dryRun}, noPublish: ${options.noPublish}) …`);
      publishResult = publishCandidates(
        stagingResult,
        qaResults,
        options.publishedState,
        options.dataDir,
        { dryRun: options.dryRun, noPublish: options.noPublish }
      );
      console.log(`✓ Publish Status: ${publishResult.status}`);
    } catch (err) {
      publishResult = {
        status: "FAILED",
        error: err.message
      };
      console.error(`✗ Publish fehlgeschlagen: ${err.message}`);
    }
  }

  // 8. Abschlussbericht & Reporting
  const finishedAt = new Date().toISOString();
  const overallSuccess = canPublish && (publishResult?.status === "PUBLISHED" || publishResult?.status === "WOULD_PUBLISH");

  const runReport = createRunReport({
    runId: stagingResult.runId,
    startedAt,
    finishedAt,
    builderVersion: preflightReport.builderVersion,
    region: manifest.regionId,
    pbfMetadata: preflightReport,
    dryRun: options.dryRun,
    noPublish: options.noPublish,
    all: options.all,
    singleDataset: options.dataset,
    targets,
    buildResults,
    qaResults,
    catalogResult,
    publishResult,
    overallStatus: overallSuccess ? "PASS" : "FAIL",
    reportPath: options.report
  });

  printSummary(runReport);

  // 9. Staging aufräumen
  cleanupStaging(stagingResult.stagingDir, options.keepStaging);

  process.exitCode = overallSuccess ? 0 : 1;
  return runReport;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    executePipeline(options).catch(err => {
      console.error(`\n[FATAL] Pipeline-Ausführung abgebrochen: ${err.message}`);
      if (globalStagingDir && !globalKeepStaging) {
        cleanupStaging(globalStagingDir, false);
      }
      process.exit(1);
    });
  } catch (err) {
    console.error(`\n[FEHLER] ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  executePipeline
};
