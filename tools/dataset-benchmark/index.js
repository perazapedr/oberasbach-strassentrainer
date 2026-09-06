"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");

const validator = require("../../city-data-validator.js");
const targetsApi = require("../../targets.js");
const geometryApi = require("../../geometry.js");
const gameEngine = require("../../game-engine.js");
const turf = require("../../vendor/turf/turf.min.js");

const ROOT = path.resolve(__dirname, "../..");

const DATASETS = [
  { id: "oberasbach", name: "Oberasbach", path: "data/cities/oberasbach.json", kind: "curated" },
  { id: "de-nw-olpe", name: "Olpe", path: "data/cities/de-nw-olpe.json", kind: "osm-pbf" },
  { id: "de-nw-wenden", name: "Wenden", path: "data/cities/de-nw-wenden.json", kind: "osm-pbf" },
  { id: "de-nw-siegen", name: "Siegen", path: "data/cities/de-nw-siegen.json", kind: "osm-pbf" },
  { id: "de-nw-koeln", name: "Köln", path: "data/cities/de-nw-koeln.json", kind: "osm-pbf" },
  { id: "de-by-zirndorf", name: "Zirndorf", path: "tests/fixtures/de-by-zirndorf.json", kind: "osm-candidate" }
];

// Haversine distance in meters
function haversineDistanceMeters(coord1, coord2) {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371000; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundTo(num, decimals) {
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

function reduceCoordinates(geometry, decimals) {
  if (!geometry || !geometry.coordinates) return geometry;
  function walk(coords) {
    if (typeof coords[0] === "number") {
      return [roundTo(coords[0], decimals), roundTo(coords[1], decimals)];
    }
    return coords.map(walk);
  }
  return {
    ...geometry,
    coordinates: walk(geometry.coordinates)
  };
}

function createPrecisionCandidate(packageData, decimals) {
  const copy = JSON.parse(JSON.stringify(packageData));
  if (copy.city?.boundary) {
    copy.city.boundary = reduceCoordinates(copy.city.boundary, decimals);
  }
  if (Array.isArray(copy.streets)) {
    copy.streets.forEach(s => {
      if (s.geometry) s.geometry = reduceCoordinates(s.geometry, decimals);
    });
  }
  if (Array.isArray(copy.pois)) {
    copy.pois.forEach(p => {
      if (typeof p.latitude === "number" && typeof p.longitude === "number") {
        p.latitude = roundTo(p.latitude, decimals);
        p.longitude = roundTo(p.longitude, decimals);
      }
      if (p.geometry) p.geometry = reduceCoordinates(p.geometry, decimals);
    });
  }
  if (Array.isArray(copy.areas)) {
    copy.areas.forEach(a => {
      if (a.geometry) a.geometry = reduceCoordinates(a.geometry, decimals);
    });
  }
  return copy;
}

function calculateCoordinateDeviations(origPackage, reducedPackage) {
  let maxDev = 0;
  let sumDev = 0;
  let count = 0;

  function collectCoords(geom, acc) {
    if (!geom || !geom.coordinates) return;
    function walk(c) {
      if (!c) return;
      if (typeof c[0] === "number") acc.push(c);
      else if (Array.isArray(c)) c.forEach(walk);
    }
    walk(geom.coordinates);
  }

  const origCoords = [];
  const redCoords = [];

  if (origPackage.city?.boundary) collectCoords(origPackage.city.boundary, origCoords);
  if (reducedPackage.city?.boundary) collectCoords(reducedPackage.city.boundary, redCoords);

  (origPackage.streets || []).forEach(s => collectCoords(s.geometry, origCoords));
  (reducedPackage.streets || []).forEach(s => collectCoords(s.geometry, redCoords));

  (origPackage.pois || []).forEach(p => {
    if (p.geometry) collectCoords(p.geometry, origCoords);
    else if (p.latitude) origCoords.push([p.longitude, p.latitude]);
  });
  (reducedPackage.pois || []).forEach(p => {
    if (p.geometry) collectCoords(p.geometry, redCoords);
    else if (p.latitude) redCoords.push([p.longitude, p.latitude]);
  });

  (origPackage.areas || []).forEach(a => collectCoords(a.geometry, origCoords));
  (reducedPackage.areas || []).forEach(a => collectCoords(a.geometry, redCoords));

  const total = Math.min(origCoords.length, redCoords.length);
  for (let i = 0; i < total; i++) {
    const dev = haversineDistanceMeters(origCoords[i], redCoords[i]);
    if (dev > maxDev) maxDev = dev;
    sumDev += dev;
    count++;
  }

  return {
    coordinateCount: total,
    maxDeviationMeters: maxDev,
    meanDeviationMeters: count > 0 ? sumDev / count : 0
  };
}

function benchmarkCompression(buffer) {
  // Gzip L6 (default) & L9
  const tGzStart = performance.now();
  const gz6 = zlib.gzipSync(buffer, { level: 6 });
  const tGz6 = performance.now() - tGzStart;

  const tGzDecompStart = performance.now();
  zlib.gunzipSync(gz6);
  const tGzDecomp = performance.now() - tGzDecompStart;

  const gz9 = zlib.gzipSync(buffer, { level: 9 });

  // Brotli Q4 (web dynamic) & Q11 (static publish)
  const tBr4Start = performance.now();
  const br4 = zlib.brotliCompressSync(buffer, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }
  });
  const tBr4 = performance.now() - tBr4Start;

  const tBrDecompStart = performance.now();
  zlib.brotliDecompressSync(br4);
  const tBrDecomp = performance.now() - tBrDecompStart;

  const tBr11Start = performance.now();
  const br11 = zlib.brotliCompressSync(buffer, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  const tBr11 = performance.now() - tBr11Start;

  return {
    rawBytes: buffer.length,
    gzip6Bytes: gz6.length,
    gzip6Ratio: Number((gz6.length / buffer.length * 100).toFixed(1)),
    gzip6CompressTimeMs: Number(tGz6.toFixed(2)),
    gzipDecompressTimeMs: Number(tGzDecomp.toFixed(2)),
    gzip9Bytes: gz9.length,
    gzip9Ratio: Number((gz9.length / buffer.length * 100).toFixed(1)),
    brotli4Bytes: br4.length,
    brotli4Ratio: Number((br4.length / buffer.length * 100).toFixed(1)),
    brotli4CompressTimeMs: Number(tBr4.toFixed(2)),
    brotliDecompressTimeMs: Number(tBrDecomp.toFixed(2)),
    brotli11Bytes: br11.length,
    brotli11Ratio: Number((br11.length / buffer.length * 100).toFixed(1)),
    brotli11CompressTimeMs: Number(tBr11.toFixed(2))
  };
}

function analyzeComposition(parsed) {
  const streetsJson = JSON.stringify(parsed.streets || []);
  const poisJson = JSON.stringify(parsed.pois || []);
  const areasJson = JSON.stringify(parsed.areas || []);
  const boundaryJson = JSON.stringify(parsed.city?.boundary || {});
  const metaJson = JSON.stringify({
    schemaVersion: parsed.schemaVersion,
    package: parsed.package,
    city: { ...parsed.city, boundary: undefined }
  });

  let streetCoords = 0;
  (parsed.streets || []).forEach(s => {
    if (s.geometry?.coordinates) {
      if (s.geometry.type === "LineString") streetCoords += s.geometry.coordinates.length;
      else if (s.geometry.type === "MultiLineString") {
        s.geometry.coordinates.forEach(line => { streetCoords += line.length; });
      }
    }
  });

  let poiCoords = 0;
  (parsed.pois || []).forEach(p => {
    if (p.geometry?.coordinates) {
      if (p.geometry.type === "Point") poiCoords += 1;
      else if (p.geometry.type === "Polygon") {
        p.geometry.coordinates.forEach(ring => { poiCoords += ring.length; });
      }
    } else if (p.latitude) poiCoords += 1;
  });

  let areaCoords = 0;
  (parsed.areas || []).forEach(a => {
    if (a.geometry?.coordinates) {
      function countRings(c) {
        if (typeof c[0] === "number") areaCoords += 1;
        else c.forEach(countRings);
      }
      countRings(a.geometry.coordinates);
    }
  });

  let boundaryCoords = 0;
  if (parsed.city?.boundary?.coordinates) {
    function countB(c) {
      if (typeof c[0] === "number") boundaryCoords += 1;
      else c.forEach(countB);
    }
    countB(parsed.city.boundary.coordinates);
  }

  return {
    streetCount: (parsed.streets || []).length,
    streetBytes: Buffer.byteLength(streetsJson, "utf8"),
    streetCoords,
    poiCount: (parsed.pois || []).length,
    poiBytes: Buffer.byteLength(poisJson, "utf8"),
    poiCoords,
    areaCount: (parsed.areas || []).length,
    areaBytes: Buffer.byteLength(areasJson, "utf8"),
    areaCoords,
    boundaryBytes: Buffer.byteLength(boundaryJson, "utf8"),
    boundaryCoords,
    metadataBytes: Buffer.byteLength(metaJson, "utf8"),
    totalCoords: streetCoords + poiCoords + areaCoords + boundaryCoords
  };
}

function benchmarkJsonParse(rawString, runs = 10) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    JSON.parse(rawString);
    times.push(performance.now() - t0);
  }
  return Number(median(times).toFixed(2));
}

function benchmarkValidation(parsed, runs = 5) {
  const packageContractTimes = [];
  const cityValidationTimes = [];
  const hashTimes = [];

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    validator.validateCityPackage(parsed);
    packageContractTimes.push(performance.now() - t0);

    const t1 = performance.now();
    validator.validateCityData(parsed);
    cityValidationTimes.push(performance.now() - t1);

    const t2 = performance.now();
    validator.verifyPackageHash(parsed);
    hashTimes.push(performance.now() - t2);
  }

  return {
    packageContractMs: Number(median(packageContractTimes).toFixed(2)),
    cityValidationMs: Number(median(cityValidationTimes).toFixed(2)),
    hashCheckMs: Number(median(hashTimes).toFixed(2))
  };
}

function benchmarkTargetPrep(parsed, runs = 50) {
  const streets = targetsApi.prepareStreetTargets(parsed.streets || [], geometryApi);
  const pois = targetsApi.preparePoiTargets(parsed.pois || []);
  const pool = [...streets, ...pois];

  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const randomIndex = Math.floor(Math.random() * pool.length);
    const target = pool[randomIndex];
    if (target && target.geometry) {
      targetsApi.isValidTargetGeometry(target, geometryApi);
    }
    times.push(performance.now() - t0);
  }
  return Number(median(times).toFixed(4));
}

function testGameplayRegression(origPackage, redPackage) {
  const origStreets = targetsApi.prepareStreetTargets(origPackage.streets || [], geometryApi).slice(0, 20);
  const redStreets = targetsApi.prepareStreetTargets(redPackage.streets || [], geometryApi).slice(0, 20);

  let maxScoreDiff = 0;
  let maxDistDiffMeters = 0;

  for (let i = 0; i < origStreets.length; i++) {
    const oTarget = origStreets[i];
    const rTarget = redStreets[i];
    if (!oTarget || !rTarget || !oTarget.geometry || !rTarget.geometry) continue;

    const sampleCoord = oTarget.geometry.sections?.[0]?.[0] || oTarget.geometry.coordinates?.[0];
    if (!sampleCoord || typeof sampleCoord[0] !== "number" || typeof sampleCoord[1] !== "number") continue;

    const testPoint = [sampleCoord[0] + 0.002, sampleCoord[1] + 0.001];

    const evalOrig = targetsApi.evaluateTargetDistance(oTarget, testPoint, turf, geometryApi);
    const evalRed = targetsApi.evaluateTargetDistance(rTarget, testPoint, turf, geometryApi);
    if (!evalOrig || !evalRed) continue;

    const distOrig = evalOrig.distanceMeters;
    const distRed = evalRed.distanceMeters;

    const distDiff = Math.abs(distOrig - distRed);
    if (distDiff > maxDistDiffMeters) maxDistDiffMeters = distDiff;

    const scoreOrig = targetsApi.calculateTargetScore(distOrig, oTarget);
    const scoreRed = targetsApi.calculateTargetScore(distRed, rTarget);
    const scoreDiff = Math.abs(scoreOrig - scoreRed);
    if (scoreDiff > maxScoreDiff) maxScoreDiff = scoreDiff;
  }

  return {
    maxDistDiffMeters: Number(maxDistDiffMeters.toFixed(3)),
    maxScoreDiff
  };
}

function runBenchmarkForDataset(entry) {
  const fullPath = path.join(ROOT, entry.path);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Datensatz-Datei nicht gefunden: ${fullPath}`);
  }

  const rawBuffer = fs.readFileSync(fullPath);
  const rawString = rawBuffer.toString("utf8");
  const parsed = JSON.parse(rawString);

  console.log(`\n===============================================================`);
  console.log(`BENCHMARK: ${entry.name} (${entry.id})`);
  console.log(`===============================================================`);

  const compression = benchmarkCompression(rawBuffer);
  console.log(`Raw: ${(compression.rawBytes / 1024 / 1024).toFixed(2)} MB (${compression.rawBytes.toLocaleString("de-DE")} Bytes)`);
  console.log(`Gzip L6: ${(compression.gzip6Bytes / 1024).toFixed(1)} KB (-${(100 - compression.gzip6Ratio).toFixed(1)}%) in ${compression.gzip6CompressTimeMs}ms`);
  console.log(`Brotli Q4: ${(compression.brotli4Bytes / 1024).toFixed(1)} KB (-${(100 - compression.brotli4Ratio).toFixed(1)}%) in ${compression.brotli4CompressTimeMs}ms`);
  console.log(`Brotli Q11: ${(compression.brotli11Bytes / 1024).toFixed(1)} KB (-${(100 - compression.brotli11Ratio).toFixed(1)}%) in ${compression.brotli11CompressTimeMs}ms`);

  const composition = analyzeComposition(parsed);
  console.log(`Zusammensetzung:`);
  console.log(`  Straßen:  ${composition.streetCount.toLocaleString("de-DE").padStart(5)} | ${(composition.streetBytes / 1024 / 1024).toFixed(2)} MB (${(composition.streetBytes / compression.rawBytes * 100).toFixed(1)}%) | ${composition.streetCoords.toLocaleString("de-DE")} Punkte`);
  console.log(`  POIs:     ${composition.poiCount.toLocaleString("de-DE").padStart(5)} | ${(composition.poiBytes / 1024 / 1024).toFixed(2)} MB (${(composition.poiBytes / compression.rawBytes * 100).toFixed(1)}%) | ${composition.poiCoords.toLocaleString("de-DE")} Punkte`);
  console.log(`  Areas:    ${composition.areaCount.toLocaleString("de-DE").padStart(5)} | ${(composition.areaBytes / 1024 / 1024).toFixed(2)} MB (${(composition.areaBytes / compression.rawBytes * 100).toFixed(1)}%) | ${composition.areaCoords.toLocaleString("de-DE")} Punkte`);
  console.log(`  Boundary:       - | ${(composition.boundaryBytes / 1024).toFixed(1)} KB (${(composition.boundaryBytes / compression.rawBytes * 100).toFixed(1)}%) | ${composition.boundaryCoords.toLocaleString("de-DE")} Punkte`);
  console.log(`  Metadaten:      - | ${(composition.metadataBytes / 1024).toFixed(1)} KB`);

  const parseMs = benchmarkJsonParse(rawString, 10);
  const valTimings = benchmarkValidation(parsed, 5);
  const targetPrepMs = benchmarkTargetPrep(parsed, 50);

  console.log(`Runtime-Performance:`);
  console.log(`  JSON.parse:       ${parseMs} ms`);
  console.log(`  Package Contract: ${valTimings.packageContractMs} ms`);
  console.log(`  City Validator:   ${valTimings.cityValidationMs} ms`);
  console.log(`  SHA-256 Check:    ${valTimings.hashCheckMs} ms`);
  console.log(`  Target-Prep:      ${targetPrepMs} ms`);

  const precisionAnalysis = {};
  for (const decimals of [7, 6, 5]) {
    const cand = createPrecisionCandidate(parsed, decimals);
    const candBuf = Buffer.from(JSON.stringify(cand, null, 2) + "\n", "utf8");
    const candGz = zlib.gzipSync(candBuf, { level: 6 });
    const candBr = zlib.brotliCompressSync(candBuf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
    const devs = calculateCoordinateDeviations(parsed, cand);

    const pkgCheck = validator.validateCityPackage(cand);
    const cityCheck = validator.validateCityData(cand);
    const valid = pkgCheck.valid && cityCheck.valid;

    const gpReg = testGameplayRegression(parsed, cand);

    precisionAnalysis[decimals] = {
      decimals,
      rawBytes: candBuf.length,
      rawDeltaPercent: Number(((candBuf.length - rawBuffer.length) / rawBuffer.length * 100).toFixed(2)),
      gzipBytes: candGz.length,
      brotliBytes: candBr.length,
      maxDeviationMeters: Number(devs.maxDeviationMeters.toFixed(4)),
      meanDeviationMeters: Number(devs.meanDeviationMeters.toFixed(4)),
      validatorPass: valid,
      validatorErrors: (pkgCheck.validation?.package?.errors?.length || 0) + (cityCheck.validation?.package?.errors?.length || 0),
      gameplayMaxDistDiffMeters: gpReg.maxDistDiffMeters,
      gameplayMaxScoreDiff: gpReg.maxScoreDiff
    };

    console.log(`Präzision ${decimals} Nachkommastellen:`);
    console.log(`  Größe: ${(candBuf.length / 1024 / 1024).toFixed(2)} MB (${precisionAnalysis[decimals].rawDeltaPercent}%) | Gzip: ${(candGz.length / 1024).toFixed(1)} KB | Brotli: ${(candBr.length / 1024).toFixed(1)} KB`);
    console.log(`  Abweichung: Max ${devs.maxDeviationMeters.toFixed(4)} m, Schnitt ${devs.meanDeviationMeters.toFixed(4)} m`);
    console.log(`  Validator: ${valid ? "PASS" : "FAIL"} | Gameplay Score-Delta: ${gpReg.maxScoreDiff} Pkt`);
  }

  return {
    datasetId: entry.id,
    name: entry.name,
    kind: entry.kind,
    rawBytes: rawBuffer.length,
    compression,
    composition,
    parseMs,
    valTimings,
    targetPrepMs,
    precisionAnalysis
  };
}

function runAllBenchmarks() {
  console.log("=== Straßentrainer Benchmark Harness (Phase 16.1) ===");
  const results = [];
  for (const ds of DATASETS) {
    try {
      const res = runBenchmarkForDataset(ds);
      results.push(res);
    } catch (err) {
      console.error(`Fehler bei Benchmark für ${ds.name}:`, err.message);
    }
  }

  const outReport = path.join(ROOT, "tools/dataset-benchmark/benchmark-results.json");
  fs.mkdirSync(path.dirname(outReport), { recursive: true });
  fs.writeFileSync(outReport, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`\n✓ Alle Benchmarks abgeschlossen. Ergebnisse gespeichert in: ${outReport}`);
  return results;
}

if (require.main === module) {
  runAllBenchmarks();
}

module.exports = {
  runAllBenchmarks,
  runBenchmarkForDataset,
  benchmarkCompression,
  analyzeComposition,
  createPrecisionCandidate,
  calculateCoordinateDeviations,
  testGameplayRegression
};

