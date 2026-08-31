#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const validatorApi = require("../city-data-validator.js");
const osmApi = require("../osm-service.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");

function parseArguments(argv) {
  const options = { fixturesDir: "/tmp", runs: 3, output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixtures-dir") options.fixturesDir = argv[++index] || "";
    else if (argv[index] === "--runs") options.runs = Number(argv[++index]);
    else if (argv[index] === "--output") options.output = argv[++index] || "";
    else throw new Error(`Unbekanntes Argument: ${argv[index]}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 3) throw new Error("--runs muss mindestens 3 sein.");
  return options;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function loadCityFixture(fixturesDir, city) {
  const filename = path.join(fixturesDir, `phase11-${city}-package.json`);
  if (!fs.existsSync(filename)) return null;
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function benchmarkValidator(cityPackage, runs) {
  validatorApi.validateCityData(cityPackage, { sourceMode: "download" });
  const samples = [];
  let result;
  let diagnostics;
  for (let index = 0; index < runs; index += 1) {
    diagnostics = {};
    const startedAt = performance.now();
    result = validatorApi.validateCityData(cityPackage, { sourceMode: "download", diagnostics });
    samples.push(performance.now() - startedAt);
  }
  return {
    medianMs: round(median(samples)),
    samplesMs: samples.map(round),
    diagnostics,
    semanticHash: hash({
      valid: result.valid,
      city: result.city,
      streets: result.streets,
      pois: result.pois,
      boundary: result.boundary,
      validation: result.validation
    }),
    summary: {
      valid: result.valid,
      streets: result.streets.length,
      pois: result.pois.length,
      warnings: result.validation.summary.warningCount,
      errors: result.validation.summary.errorCount
    }
  };
}

function benchmarkTargets(cityPackage, runs) {
  const categories = [...new Set(cityPackage.pois.map(poi => poi.category))]
    .map(id => ({ id, label: id }));
  const samples = [];
  let streetTargets;
  let poiTargets;
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    streetTargets = targetApi.prepareStreetTargets(cityPackage.streets, geometryApi);
    poiTargets = targetApi.preparePoiTargets(cityPackage.pois, categories);
    samples.push(performance.now() - startedAt);
  }
  return {
    medianMs: round(median(samples)),
    samplesMs: samples.map(round),
    streets: streetTargets.length,
    pois: poiTargets.length
  };
}

function syntheticBoundary(relationId) {
  return {
    type: "relation",
    id: relationId,
    members: [{
      type: "way",
      role: "outer",
      geometry: [
        { lat: 49, lon: 10 },
        { lat: 49, lon: 11 },
        { lat: 50, lon: 11 },
        { lat: 50, lon: 10 },
        { lat: 49, lon: 10 }
      ]
    }]
  };
}

function syntheticOsmElements() {
  const elements = [];
  let wayId = 1;
  for (let streetIndex = 0; streetIndex < 3000; streetIndex += 1) {
    const row = Math.floor(streetIndex / 100);
    const column = streetIndex % 100;
    for (let segmentIndex = 0; segmentIndex < 3; segmentIndex += 1) {
      const lat = 49.1 + row * 0.02 + segmentIndex * 0.0002;
      const lon = 10.1 + column * 0.008;
      elements.push({
        type: "way",
        id: wayId,
        tags: { highway: "residential", name: `Benchmarkstraße ${streetIndex}` },
        geometry: [
          { lat, lon },
          { lat: lat + 0.00015, lon: lon + 0.00015 }
        ]
      });
      wayId += 1;
    }
  }
  for (let poiIndex = 0; poiIndex < 700; poiIndex += 1) {
    elements.push({
      type: "node",
      id: 100000 + poiIndex,
      lat: 49.2 + (poiIndex % 100) * 0.005,
      lon: 10.2 + Math.floor(poiIndex / 100) * 0.05,
      tags: { amenity: poiIndex % 2 ? "school" : "kindergarten", name: `Benchmark-POI ${poiIndex}` }
    });
  }
  return [...elements, ...elements.slice(0, 500)];
}

async function benchmarkOsmProcessing(runs) {
  const relationId = 999001;
  const boundary = syntheticBoundary(relationId);
  const elements = syntheticOsmElements();
  const municipality = {
    name: "Benchmarkstadt",
    osmType: "relation",
    osmId: relationId,
    placeType: "administrative",
    bounds: { south: 49, west: 10, north: 50, east: 11 },
    center: { lat: 49.5, lon: 10.5 }
  };
  const samples = [];
  let result;
  let diagnostics;
  for (let index = 0; index <= runs; index += 1) {
    diagnostics = {};
    const service = osmApi.createOsmService({
      requestIntervalMs: 0,
      now: () => Date.parse("2026-08-30T00:00:00.000Z"),
      downloadPlanFactory: city => osmApi.createDownloadPlan(city, {
        areaThresholdSquareKilometers: 20000,
        maxSpanKilometers: 200
      }),
      fetch: async (url, requestOptions) => {
        const query = new URLSearchParams(requestOptions.body).get("data") || "";
        return {
          ok: true,
          status: 200,
          async json() {
            return { elements: query.includes("map_to_area") ? elements : [boundary] };
          }
        };
      }
    });
    const startedAt = performance.now();
    result = await service.fetchCityData(municipality, { diagnostics });
    const duration = performance.now() - startedAt;
    if (index > 0) samples.push(duration);
  }
  return {
    medianMs: round(median(samples)),
    samplesMs: samples.map(round),
    diagnostics,
    rawObjects: elements.length,
    semanticHash: hash({ city: result.city, streets: result.streets, pois: result.pois, boundary: result.boundary }),
    summary: { streets: result.streets.length, pois: result.pois.length }
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cities = {};
  for (const city of ["oberasbach", "siegen", "nuernberg"]) {
    const cityPackage = loadCityFixture(options.fixturesDir, city);
    if (!cityPackage) {
      cities[city] = { available: false };
      continue;
    }
    cities[city] = {
      available: true,
      validator: benchmarkValidator(cityPackage, options.runs),
      targets: benchmarkTargets(cityPackage, options.runs)
    };
  }
  const report = {
    measuredAt: new Date().toISOString(),
    runs: options.runs,
    cities,
    syntheticOsmProcessing: await benchmarkOsmProcessing(options.runs)
  };
  if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
