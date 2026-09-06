#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const osmServiceApi = require("../../osm-service.js");

const osmService = osmServiceApi.createOsmService({
  // The public primary currently answers this environment with HTTP 406.
  // Use the same configured legacy failover pool, starting at the next endpoint.
  overpassEndpoints: [osmServiceApi.OVERPASS_ENDPOINTS[2]],
  fetchImpl(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "User-Agent": "Strassentrainer-Dataset-Builder/0.1 (Phase 15.2 one-off comparison)"
      }
    });
  }
});

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

async function main() {
  const municipality = valueAfter("--municipality") || "Olpe";
  const relationId = Number(valueAfter("--relation-id") || 163179);
  const output = valueAfter("--output");
  const metadataPath = valueAfter("--metadata-package") || path.join(__dirname, "../../data/cities/de-nw-olpe.json");
  if (!output) throw new Error("--output is required.");
  process.stderr.write(`Nominatim: searching ${municipality} …\n`);
  let candidate = null;
  let nominatimError = null;
  try {
    const candidates = await osmService.searchMunicipalities(municipality);
    candidate = candidates.find(entry => entry.osmType === "relation" && entry.osmId === relationId) || null;
  } catch (error) {
    nominatimError = { name: error.name, code: error.code || null, message: error.message };
    process.stderr.write(`Nominatim unavailable (${error.message}); using validated package metadata.\n`);
  }
  if (!candidate) {
    const metadataPackage = JSON.parse(fs.readFileSync(path.resolve(metadataPath), "utf8"));
    const city = metadataPackage.city;
    if (!city || city.osmType !== "relation" || city.osmId !== relationId) {
      throw new Error(`Fallback metadata does not describe relation ${relationId}.`);
    }
    candidate = {
      name: city.name,
      displayName: city.displayName || city.name,
      district: city.district,
      state: city.state,
      country: city.country,
      countryCode: "de",
      postalCodes: city.postalCodes || [],
      osmType: city.osmType,
      osmId: city.osmId,
      bounds: city.bounds,
      center: city.center,
      addresstype: "municipality",
      placeType: "administrative",
      adminLevel: city.adminLevel
    };
  }
  const diagnostics = {};
  process.stderr.write(`Overpass: downloading relation ${relationId} through the legacy path …\n`);
  const dataset = await osmService.fetchCityData(candidate, {
    discoverAreas: true,
    diagnostics,
    onProgress(progress) {
      if (progress && progress.message) process.stderr.write(`${progress.message}\n`);
    }
  });
  const snapshot = {
    snapshotKind: "one-off-live-legacy-comparison",
    capturedAt: new Date().toISOString(),
    nominatimError,
    municipality: candidate,
    dataset,
    diagnostics
  };
  const absoluteOutput = path.resolve(output);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`${absoluteOutput}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
