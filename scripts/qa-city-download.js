#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const osmApi = require("../osm-service.js");
const validatorApi = require("../city-data-validator.js");

const ROOT = path.resolve(__dirname, "..");
const USER_AGENT = "Oberasbach-Strassentrainer-Phase11-QA/1.0";

function parseArguments(argv) {
  const options = { city: "", output: "", packageOutput: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") options.output = argv[++index] || "";
    else if (value === "--package") options.packageOutput = argv[++index] || "";
    else if (!options.city) options.city = value;
    else throw new Error(`Unbekanntes Argument: ${value}`);
  }
  if (!options.city) {
    throw new Error("Aufruf: node scripts/qa-city-download.js <Stadt> [--output <metrics.json>] [--package <package.json>]");
  }
  return options;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function utf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isBoundaryRequest(requestOptions) {
  if (!requestOptions || requestOptions.method !== "POST") return false;
  const query = new URLSearchParams(requestOptions.body || "").get("data") || "";
  return !query.includes("map_to_area");
}

function createMeasuredFetch(requests) {
  return async (url, options = {}) => {
    const startedAt = performance.now();
    const service = String(url).includes("nominatim") ? "nominatim" : "overpass";
    const kind = service === "nominatim" ? "search" : (isBoundaryRequest(options) ? "boundary" : "data");
    const headers = { ...(options.headers || {}), "User-Agent": USER_AGENT };
    const entry = { service, kind, method: options.method || "GET", status: null, durationMs: null, error: null };
    requests.push(entry);
    try {
      const response = await fetch(url, { ...options, headers });
      entry.status = response.status;
      entry.durationMs = round(performance.now() - startedAt);
      return response;
    } catch (error) {
      entry.durationMs = round(performance.now() - startedAt);
      entry.error = error && (error.code || error.name || error.message) || "UNKNOWN";
      throw error;
    }
  };
}

function selectMunicipality(results, requestedName) {
  const normalized = requestedName.trim().toLocaleLowerCase("de-DE");
  return results.find(result => result.name.toLocaleLowerCase("de-DE") === normalized)
    || results[0]
    || null;
}

function streetMetrics(streets) {
  const segmentCounts = streets.map(street => (
    street.geometry && street.geometry.type === "MultiLineString" && Array.isArray(street.geometry.coordinates)
      ? street.geometry.coordinates.length
      : 0
  ));
  return {
    total: streets.length,
    segments: segmentCounts.reduce((sum, count) => sum + count, 0),
    multiLineStrings: segmentCounts.filter(count => count > 1).length,
    maximumSegments: Math.max(0, ...segmentCounts),
    duplicateIds: streets.length - new Set(streets.map(street => street.id)).size
  };
}

function poiMetrics(pois) {
  const categories = {};
  for (const poi of pois) categories[poi.category] = (categories[poi.category] || 0) + 1;
  return {
    total: pois.length,
    categories,
    duplicateIds: pois.length - new Set(pois.map(poi => poi.id)).size
  };
}

function summarizeRequests(requests) {
  const byKind = kind => requests.filter(request => request.kind === kind);
  const duration = kind => round(byKind(kind).reduce((sum, request) => sum + (request.durationMs || 0), 0));
  return {
    total: requests.length,
    search: byKind("search").length,
    boundary: byKind("boundary").length,
    data: byKind("data").length,
    searchNetworkMs: duration("search"),
    boundaryNetworkMs: duration("boundary"),
    dataNetworkMs: duration("data"),
    httpErrors: requests.filter(request => request.status !== null && request.status >= 400)
      .map(request => ({ kind: request.kind, status: request.status })),
    transportErrors: requests.filter(request => request.error)
      .map(request => ({ kind: request.kind, error: request.error }))
  };
}

function curatedComparison(cityName, validated) {
  if (cityName.toLocaleLowerCase("de-DE") !== "oberasbach") return null;
  const curated = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf8"));
  return validatorApi.compareWithCuratedData(validated, curated).summary;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const requests = [];
  const progress = [];
  const service = osmApi.createOsmService({ fetch: createMeasuredFetch(requests) });

  const totalStartedAt = performance.now();
  const searchStartedAt = performance.now();
  const results = await service.searchMunicipalities(options.city);
  const searchMs = round(performance.now() - searchStartedAt);
  const municipality = selectMunicipality(results, options.city);
  if (!municipality) throw new Error(`Keine deutsche Gemeinde für "${options.city}" gefunden.`);

  const plan = osmApi.createDownloadPlan(municipality);
  const downloadStartedAt = performance.now();
  const processingDiagnostics = {};
  let downloaded;
  try {
    downloaded = await service.fetchCityData(municipality, {
      diagnostics: processingDiagnostics,
      onProgress(event) {
        progress.push({ stage: event.stage, atMs: round(performance.now() - downloadStartedAt) });
        process.stderr.write(`[${event.progress}%] ${event.message}\n`);
      }
    });
  } catch (error) {
    const failureReport = {
      measuredAt: new Date().toISOString(),
      requestedCity: options.city,
      municipality,
      boundsSize: plan.boundsSize,
      strategyFromGenericThresholds: plan.mode,
      initialChunksFromGenericThresholds: plan.chunks.length,
      successful: false,
      failure: {
        name: error && error.name || "Error",
        code: error && error.code || null,
        status: error && error.status || null,
        retryExhausted: Boolean(error && error.retryExhausted),
        message: error && error.message || String(error)
      },
      timingsMs: {
        search: searchMs,
        downloadUntilFailure: round(performance.now() - downloadStartedAt)
      },
      requests: summarizeRequests(requests),
      processingDiagnostics,
      progress
    };
    if (options.output) {
      fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(failureReport, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(failureReport, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const downloadMs = round(performance.now() - downloadStartedAt);
  const lastDataRequest = [...requests].reverse().find(request => request.kind === "data");
  const network = summarizeRequests(requests);
  const processingEstimateMs = lastDataRequest
    ? round(Math.max(0, downloadMs - network.boundaryNetworkMs - network.dataNetworkMs))
    : null;

  const validationStartedAt = performance.now();
  const validationDiagnostics = {};
  const validated = validatorApi.validateCityData(downloaded, {
    sourceMode: "download",
    diagnostics: validationDiagnostics
  });
  const validationMs = round(performance.now() - validationStartedAt);
  const cityBytes = utf8Bytes(validated.city);
  const streetsBytes = utf8Bytes(validated.streets);
  const poisBytes = utf8Bytes(validated.pois);
  const packageBytes = utf8Bytes({
    schemaVersion: 1,
    city: validated.city,
    streets: validated.streets,
    pois: validated.pois,
    boundary: validated.boundary
  });

  const report = {
    measuredAt: new Date().toISOString(),
    requestedCity: options.city,
    municipality,
    boundsSize: plan.boundsSize,
    strategyFromGenericThresholds: plan.mode,
    initialChunksFromGenericThresholds: plan.chunks.length,
    timingsMs: {
      search: searchMs,
      download: downloadMs,
      networkSearch: network.searchNetworkMs,
      networkBoundary: network.boundaryNetworkMs,
      networkData: network.dataNetworkMs,
      mergeAndNormalizationEstimate: processingEstimateMs,
      validation: validationMs,
      totalThroughValidation: round(performance.now() - totalStartedAt)
    },
    requests: network,
    downloadDiagnostics: downloaded.downloadDiagnostics,
    processingDiagnostics,
    streets: streetMetrics(validated.streets),
    pois: poiMetrics(validated.pois),
    validation: validated.validation.summary,
    validationDiagnostics,
    serializedBytes: { city: cityBytes, streets: streetsBytes, pois: poisBytes, package: packageBytes },
    curatedComparison: curatedComparison(municipality.name, validated),
    progress
  };

  if (options.output) {
    fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.packageOutput) {
    const cityPackage = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      city: validated.city,
      streets: validated.streets,
      pois: validated.pois,
      boundary: validated.boundary
    };
    fs.writeFileSync(path.resolve(options.packageOutput), `${JSON.stringify(cityPackage)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!validated.valid) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
