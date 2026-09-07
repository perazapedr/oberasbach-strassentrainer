#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const core = require("./lib/core.js");

function usage() {
  return [
    "Usage:",
    "  node tools/dataset-builder/index.js --pbf FILE --municipality NAME --output FILE [options]",
    "",
    "Options:",
    "  --relation-id ID   Select an explicit administrative relation",
    "  --admin-level LEVEL Target admin_level (default: 8)",
    "  --target-type TYPE  municipality (default) or district",
    "  --dataset-id ID    Explicit package / dataset ID",
    "  --report FILE      Write a machine-readable build report",
    "  --state NAME       State metadata (default: Nordrhein-Westfalen)",
    "  --country NAME     Country metadata (default: Deutschland)",
    "  --keep-work        Keep temporary extract/export files",
    "  --verbose          Show osmium commands and their output",
    "  --help             Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const options = { state: "Nordrhein-Westfalen", country: "Deutschland", verbose: false, keepWork: false, adminLevel: 8, targetType: "municipality" };
  const valueOptions = new Map([
    ["--pbf", "pbf"], ["--municipality", "municipality"], ["--output", "output"],
    ["--relation-id", "relationId"], ["--admin-level", "adminLevel"], ["--dataset-id", "datasetId"],
    ["--report", "report"], ["--state", "state"], ["--country", "country"], ["--version", "version"],
    ["--target-type", "targetType"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--keep-work") options.keepWork = true;
    else if (valueOptions.has(arg)) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error(`${arg} requires a value.`);
      options[valueOptions.get(arg)] = argv[++index];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.relationId !== undefined) {
    options.relationId = Number(options.relationId);
    if (!Number.isSafeInteger(options.relationId) || options.relationId <= 0) throw new Error("--relation-id must be positive integer.");
  }
  if (options.adminLevel !== undefined) {
    options.adminLevel = Number(options.adminLevel);
    if (!Number.isSafeInteger(options.adminLevel) || options.adminLevel <= 0) throw new Error("--admin-level must be positive integer.");
  }
  if (options.datasetId !== undefined) {
    options.datasetId = String(options.datasetId).trim();
    if (!options.datasetId) throw new Error("--dataset-id must be non-empty string.");
  }
  if (options.version !== undefined) {
    options.version = String(options.version).trim();
    if (!options.version) throw new Error("--version must be non-empty string.");
  }
  if (!["municipality", "district"].includes(options.targetType)) {
    throw new Error("--target-type must be municipality or district.");
  }
  return options;
}

function ensureInput(options) {
  if (!options.pbf || !options.municipality || !options.output) throw new Error("--pbf, --municipality and --output are required.");
  options.pbf = path.resolve(options.pbf);
  options.output = path.resolve(options.output);
  if (options.report) options.report = path.resolve(options.report);
  if (!fs.existsSync(options.pbf) || !fs.statSync(options.pbf).isFile()) throw new Error(`PBF file is not readable: ${options.pbf}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.verbose) process.stderr.write(`$ ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => {
      stderr.push(chunk);
      if (options.verbose) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", code => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${command} ${args[0] || ""} failed with exit code ${code}: ${err.trim() || out.trim()}`));
    });
  });
}

async function osmiumTimestamp(pbf, verbose) {
  for (const key of ["header.option.osmosis_replication_timestamp", "header.option.timestamp"]) {
    try {
      const result = await run("osmium", ["fileinfo", "-g", key, pbf], { verbose });
      const value = result.stdout.trim();
      if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    } catch (_) {}
  }
  throw new Error("The PBF header does not expose a readable OSM data timestamp.");
}

async function readGeoJsonSequence(filename) {
  const features = [];
  const input = fs.createReadStream(filename, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const rawLine of lines) {
    const line = rawLine.replace(/^\x1e/, "").trim();
    if (!line) continue;
    const feature = JSON.parse(line);
    if (feature && feature.type === "Feature") features.push(feature);
  }
  return features;
}

function selectBoundaryFeature(collection, relationId) {
  const features = collection && Array.isArray(collection.features) ? collection.features : [];
  const matching = features.filter(feature => (
    feature && feature.properties && feature.properties["@type"] === "relation"
    && Number(feature.properties["@id"]) === relationId
    && feature.geometry && ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
  ));
  if (matching.length !== 1) throw new Error(`Expected one valid geometry for municipality relation ${relationId}, found ${matching.length}.`);
  return core.canonicalizeAreaGeometry(matching[0].geometry);
}

function phase(message) {
  process.stderr.write(`${message}\n`);
}

async function build(options) {
  ensureInput(options);
  await run("osmium", ["--version"], { verbose: false });
  const startedAt = process.hrtime.bigint();
  const initialRss = process.memoryUsage().rss;
  let peakRss = initialRss;
  const memorySampler = setInterval(() => {
    try {
      const current = process.memoryUsage().rss;
      if (current > peakRss) peakRss = current;
    } catch (_) {}
  }, 25);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "strassentrainer-pbf-"));
  const boundaryPbf = path.join(workDir, "municipality-boundary.osm.pbf");
  const boundaryGeoJson = path.join(workDir, "municipality-boundary.geojson");
  const extractPbf = path.join(workDir, "municipality-extract.osm.pbf");
  const featuresGeoJsonSeq = path.join(workDir, "municipality-features.geojsonseq");
  try {
    phase("Reading PBF header …");
    const pbfTimestamp = await osmiumTimestamp(options.pbf, options.verbose);
    phase(`Finding ${options.targetType} boundary …`);
    const relationOutput = await run("osmium", [
      "tags-filter", "-R", "-f", "opl", options.pbf, "r/boundary=administrative"
    ], options);
    const relation = core.selectTargetRelation(
      core.parseBoundaryRelationOpl(relationOutput.stdout), options.municipality, options.relationId, options.adminLevel, options.targetType
    );

    phase(`Resolving boundary relation ${relation.id} …`);
    await run("osmium", ["getid", "-r", "-O", "-o", boundaryPbf, options.pbf, `r${relation.id}`], options);
    const boundaryExport = await run("osmium", [
      "export", "-O", "-e", "-a", "type,id", "-f", "geojson", "-o", boundaryGeoJson, boundaryPbf
    ], options);
    const boundaryCollection = JSON.parse(fs.readFileSync(boundaryGeoJson, "utf8"));
    const boundary = selectBoundaryFeature(boundaryCollection, relation.id);
    if (!boundary) throw new Error("Municipality boundary geometry is empty or invalid.");
    fs.writeFileSync(boundaryGeoJson, `${JSON.stringify({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: boundary }]
    })}\n`);

    phase("Extracting exact municipality region …");
    await run("osmium", [
      "extract", "-O", "-s", "smart", "-S", "types=multipolygon,boundary",
      "-p", boundaryGeoJson, "-o", extractPbf, options.pbf
    ], options);
    await run("osmium", ["check-refs", extractPbf], options);

    phase("Collecting streets, POIs and administrative areas …");
    const featureExport = await run("osmium", [
      "export", "-O", "-e", "-a", "type,id", "-f", "geojsonseq", "-o", featuresGeoJsonSeq, extractPbf
    ], options);
    const features = await readGeoJsonSequence(featuresGeoJsonSeq);
    phase("Normalizing, clipping and deduplicating …");
    const assembled = core.assemblePackage({
      relation,
      boundary,
      featureCollections: features,
      municipalityName: options.municipality,
      targetType: options.targetType,
      datasetId: options.datasetId,
      state: options.state,
      country: options.country,
      pbfTimestamp,
      sourcePbf: options.pbf,
      version: options.version
    });

    phase("Validating package and computing contentHash …");
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(assembled.packageData, null, 2)}\n`);
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    clearInterval(memorySampler);
    const endRss = process.memoryUsage().rss;
    if (endRss > peakRss) peakRss = endRss;
    const rusage = typeof process.resourceUsage === "function" ? process.resourceUsage() : null;
    const osMaxRssBytes = rusage && rusage.maxRSS ? rusage.maxRSS * 1024 : peakRss;
    const effectivePeakRss = Math.max(peakRss, osMaxRssBytes);

    const report = {
      status: "PASS",
      builderVersion: core.BUILDER_VERSION,
      sourcePbf: path.basename(options.pbf),
      osmDataTimestamp: pbfTimestamp,
      municipality: assembled.packageData.city.name,
      municipalityRelation: relation.id,
      adminLevel: Number(relation.tags.admin_level),
      municipalityKey: relation.tags["de:amtlicher_gemeindeschluessel"] || null,
      rawRelationName: relation.tags.name || null,
      datasetKind: assembled.packageData.package.datasetKind,
      boundaryType: boundary.type,
      buildSeconds: Number(elapsedSeconds.toFixed(3)),
      processRssDeltaBytes: Math.max(0, process.memoryUsage().rss - initialRss),
      processRssStartBytes: initialRss,
      processRssPeakBytes: effectivePeakRss,
      processRssDeltaBytes: Math.max(0, effectivePeakRss - initialRss),
      processRssEndBytes: endRss,
      processMaxRssBytes: osMaxRssBytes,
      output: options.output,
      packageBytes: fs.statSync(options.output).size,
      contentHash: assembled.packageData.package.contentHash,
      counts: assembled.diagnostics,
      municipalities: assembled.diagnostics.municipalities || [],
      duplicateStreetNamesAcrossMunicipalities: assembled.diagnostics.duplicateStreetNamesAcrossMunicipalities || [],
      areaClassification: assembled.diagnostics.areaClassificationReport || null,
      osmiumWarnings: [boundaryExport.stderr, featureExport.stderr].filter(Boolean).join("\n").trim() || null,
      workDirectory: options.keepWork ? workDir : null
    };
    if (options.report) {
      fs.mkdirSync(path.dirname(options.report), { recursive: true });
      fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
    }
    phase(`Writing package … ${options.output}`);
    phase(`Done. ${report.counts.finalStreets} streets, ${report.counts.finalPois} POIs, ${report.counts.finalAreas} areas.`);
    return report;
  } finally {
    clearInterval(memorySampler);
    if (!options.keepWork) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const report = await build(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Dataset build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, readGeoJsonSequence, selectBoundaryFeature, osmiumTimestamp, build };
