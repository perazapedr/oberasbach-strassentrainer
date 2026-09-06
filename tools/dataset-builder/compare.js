#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const validator = require("../../city-data-validator.js");
const geometryApi = require("../../geometry.js");
const turf = require("../../vendor/turf/turf.min.js");

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.resolve(filename), "utf8"));
}

function unwrapLegacy(input) {
  return input && input.dataset ? input.dataset : input;
}

function issues(validation, kind) {
  return ["municipality", "streets", "pois", "areas"]
    .flatMap(section => validation && validation[section] && Array.isArray(validation[section][kind])
      ? validation[section][kind]
      : []);
}

function uniqueNormalizedStreetNames(dataset) {
  return new Map((dataset.streets || []).map(street => [geometryApi.normalizeStreetName(street.name), street.name]));
}

function setDifference(first, second) {
  return [...first.keys()].filter(key => !second.has(key)).sort().map(key => first.get(key));
}

function categoryCounts(pois) {
  const counts = {};
  for (const poi of pois || []) counts[poi.category] = (counts[poi.category] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function coordinateCount(geometry) {
  let count = 0;
  function visit(value) {
    if (Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) count += 1;
    else if (Array.isArray(value)) value.forEach(visit);
  }
  visit(geometry && geometry.coordinates);
  return count;
}

function canonicalRing(ring) {
  const open = ring.slice(0, -1).map(point => [Number(point[0]), Number(point[1])]);
  const candidates = [];
  for (const points of [open, [...open].reverse()]) {
    for (let index = 0; index < points.length; index += 1) {
      const rotated = points.slice(index).concat(points.slice(0, index));
      candidates.push(rotated.concat([[...rotated[0]]]));
    }
  }
  candidates.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return candidates[0];
}

function canonicalBoundary(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map(polygon => polygon.map(canonicalRing)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function streetLengthMeters(street) {
  const coordinates = street && street.geometry && street.geometry.type === "MultiLineString"
    ? street.geometry.coordinates
    : [];
  return coordinates.reduce((sum, line) => sum + turf.length(turf.lineString(line), { units: "kilometers" }) * 1000, 0);
}

function streetsByNormalizedName(dataset) {
  const result = new Map();
  for (const street of dataset.streets || []) {
    const key = geometryApi.normalizeStreetName(street.name);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(street);
  }
  return result;
}

function geometryDifferences(pbf, legacy, sharedNames) {
  const pbfByName = streetsByNormalizedName(pbf);
  const legacyByName = streetsByNormalizedName(legacy);
  const rows = [];
  for (const name of sharedNames) {
    const pbfLength = (pbfByName.get(name) || []).reduce((sum, street) => sum + streetLengthMeters(street), 0);
    const legacyLength = (legacyByName.get(name) || []).reduce((sum, street) => sum + streetLengthMeters(street), 0);
    const maxLength = Math.max(pbfLength, legacyLength, 1);
    const differenceRatio = Math.abs(pbfLength - legacyLength) / maxLength;
    if (differenceRatio >= 0.2 && Math.abs(pbfLength - legacyLength) >= 100) {
      rows.push({
        name: pbfByName.get(name)[0].name,
        pbfMeters: Math.round(pbfLength),
        legacyMeters: Math.round(legacyLength),
        differencePercent: Number((differenceRatio * 100).toFixed(1))
      });
    }
  }
  return rows.sort((a, b) => b.differencePercent - a.differencePercent || a.name.localeCompare(b.name)).slice(0, 30);
}

function poiNameSet(dataset) {
  return new Map((dataset.pois || []).map(poi => [
    `${String(poi.category || "")}\0${String(poi.name || "").normalize("NFKC").toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim()}`,
    `${poi.name} [${poi.category}]`
  ]));
}

function list(values) {
  return values.length ? values.map(value => `- ${value}`).join("\n") : "- keine";
}

function tableRows(keys, first, second) {
  return keys.map(key => `| ${key} | ${first[key] || 0} | ${second[key] || 0} |`).join("\n");
}

function buildReport(pbf, legacyWrapper, pbfBuildReport = {}) {
  const legacy = unwrapLegacy(legacyWrapper);
  const pbfValidation = validator.validateCityData(pbf, { sourceMode: "download" });
  const legacyValidation = validator.validateCityData(legacy, { sourceMode: "download" });
  const pbfComparable = { ...pbf, streets: pbfValidation.streets, pois: pbfValidation.pois, areas: pbfValidation.areas };
  const legacyComparable = { ...legacy, streets: legacyValidation.streets, pois: legacyValidation.pois, areas: legacyValidation.areas };
  const pbfNames = uniqueNormalizedStreetNames(pbfComparable);
  const legacyNames = uniqueNormalizedStreetNames(legacyComparable);
  const sharedNames = [...pbfNames.keys()].filter(key => legacyNames.has(key)).sort();
  const onlyPbf = setDifference(pbfNames, legacyNames);
  const onlyLegacy = setDifference(legacyNames, pbfNames);
  const pbfPoiNames = poiNameSet(pbfComparable);
  const legacyPoiNames = poiNameSet(legacyComparable);
  const poiOnlyPbf = setDifference(pbfPoiNames, legacyPoiNames);
  const poiOnlyLegacy = setDifference(legacyPoiNames, pbfPoiNames);
  const pbfCategories = categoryCounts(pbfComparable.pois);
  const legacyCategories = categoryCounts(legacyComparable.pois);
  const categoryKeys = [...new Set([...Object.keys(pbfCategories), ...Object.keys(legacyCategories)])].sort();
  const geometryRows = geometryDifferences(pbfComparable, legacyComparable, sharedNames);
  const pbfWarnings = issues(pbfValidation.validation, "warnings");
  const legacyWarnings = issues(legacyValidation.validation, "warnings");
  const rejectedPbfCandidates = pbfBuildReport.counts && Array.isArray(pbfBuildReport.counts.validatorErrors)
    ? pbfBuildReport.counts.validatorErrors
    : [];
  const boundarySame = validator.canonicalJsonStringify(canonicalBoundary(pbf.boundary))
    === validator.canonicalJsonStringify(canonicalBoundary(legacy.boundary));
  const pbfAreaNames = (pbfComparable.areas || []).map(area => area.name).sort();
  const legacyAreaNames = (legacyComparable.areas || []).map(area => area.name).sort();
  const pbfTimestamp = pbf.provenance && pbf.provenance.osmDataTimestamp;
  const legacyTimestamp = legacyWrapper.capturedAt || legacy.city && legacy.city.updatedAt || null;
  const lines = [
    "# Olpe: OSM-PBF vs. Legacy Overpass",
    "",
    "Der Vergleich ist ein einmaliger Diagnose-Lauf und kein netzabhängiger Regressionstest. Der PBF-Zeitpunkt stammt aus dem Dateiheader; der Legacy-Zeitpunkt ist der Abrufzeitpunkt, weil Overpass in diesem Pfad keinen äquivalenten Snapshot-Zeitpunkt liefert.",
    "",
    "## Datenstände",
    "",
    `- PBF: \`${pbfTimestamp || "unbekannt"}\``,
    `- Legacy-Abruf: \`${legacyTimestamp || "unbekannt"}\``,
    `- PBF-Relation: \`${pbf.city.osmId}\``,
    `- Legacy-Relation: \`${legacy.city.osmId}\``,
    "",
    "## Übersicht",
    "",
    "| Merkmal | PBF | Legacy |",
    "|---|---:|---:|",
    `| Straßen vor Validator | ${pbfBuildReport.counts && pbfBuildReport.counts.rawStreets || pbf.streets.length} | ${legacy.streets.length} |`,
    `| Straßen nach Validator | ${pbfComparable.streets.length} | ${legacyComparable.streets.length} |`,
    `| normalisierte Straßennamen | ${pbfNames.size} | ${legacyNames.size} |`,
    `| POIs vor Validator | ${pbfBuildReport.counts && pbfBuildReport.counts.rawPois || pbf.pois.length} | ${legacy.pois.length} |`,
    `| POIs nach Validator | ${pbfComparable.pois.length} | ${legacyComparable.pois.length} |`,
    `| Boundary-Typ | ${pbf.boundary && pbf.boundary.type} | ${legacy.boundary && legacy.boundary.type} |`,
    `| Boundary-Koordinaten | ${coordinateCount(pbf.boundary)} | ${coordinateCount(legacy.boundary)} |`,
    `| Areas nach Validator | ${(pbfComparable.areas || []).length} | ${(legacyComparable.areas || []).length} |`,
    `| Duplikate zusammengeführt | ${(pbfBuildReport.counts && (pbfBuildReport.counts.streetDuplicatesMerged + pbfBuildReport.counts.poiDuplicatesMerged)) || 0} | ${legacyValidation.validation.streets.duplicatesMerged + legacyValidation.validation.pois.duplicatesMerged} |`,
    `| Validator-Fehler | ${issues(pbfValidation.validation, "errors").length} | ${issues(legacyValidation.validation, "errors").length} |`,
    `| Validator-Warnungen | ${pbfWarnings.length} | ${legacyWarnings.length} |`,
    `| vor Package-Bildung verworfene Kandidaten | ${rejectedPbfCandidates.length} | 0 |`,
    "",
    `Boundary kanonisch identisch: **${boundarySame ? "JA" : "NEIN"}**`,
    "",
    "## Straßen",
    "",
    `- Gemeinsam: ${sharedNames.length}`,
    `- Nur PBF: ${onlyPbf.length}`,
    `- Nur Legacy: ${onlyLegacy.length}`,
    "",
    "### Nur PBF",
    "",
    list(onlyPbf),
    "",
    "### Nur Legacy",
    "",
    list(onlyLegacy),
    "",
    "### Auffällige Längenabweichungen",
    "",
    geometryRows.length
      ? ["| Straße | PBF m | Legacy m | Abweichung |", "|---|---:|---:|---:|", ...geometryRows.map(row => `| ${row.name} | ${row.pbfMeters} | ${row.legacyMeters} | ${row.differencePercent} % |`)].join("\n")
      : "Keine Abweichung über dem Diagnose-Schwellwert (mindestens 100 m und 20 %).",
    "",
    "## POIs nach Kategorie",
    "",
    "| Kategorie | PBF | Legacy |",
    "|---|---:|---:|",
    tableRows(categoryKeys, pbfCategories, legacyCategories),
    "",
    `- Gemeinsame Kategorie/Name-Kombinationen: ${[...pbfPoiNames.keys()].filter(key => legacyPoiNames.has(key)).length}`,
    `- Nur PBF: ${poiOnlyPbf.length}`,
    `- Nur Legacy: ${poiOnlyLegacy.length}`,
    "",
    "### POIs nur PBF",
    "",
    list(poiOnlyPbf),
    "",
    "### POIs nur Legacy",
    "",
    list(poiOnlyLegacy),
    "",
    "## Administrative Areas",
    "",
    `- PBF: ${pbfAreaNames.join(", ") || "keine"}`,
    `- Legacy: ${legacyAreaNames.join(", ") || "keine"}`,
    "",
    "## Warnungen",
    "",
    "### PBF",
    "",
    list(pbfWarnings.map(warning => `${warning.code}: ${warning.entityId || "-"}`)),
    "",
    "### Legacy",
    "",
    list(legacyWarnings.map(warning => `${warning.code}: ${warning.entityId || "-"}`)),
    "",
    "### Vom PBF-Builder vor dem Package verworfen",
    "",
    list(rejectedPbfCandidates.map(entry => `${entry.code}: ${entry.entityId || "-"}`)),
    "",
    "## Live-Dienstdiagnose",
    "",
    `- Nominatim: ${legacyWrapper.nominatimError ? `FAIL (${legacyWrapper.nominatimError.message}); validierte PBF-Metadaten als Fallback` : "PASS"}`,
    `- Overpass-Endpunkt: ${legacy.downloadDiagnostics && legacy.downloadDiagnostics.endpoint || "unbekannt"}`,
    `- Overpass-Requests/Retry/Splits: ${legacy.downloadDiagnostics && legacy.downloadDiagnostics.requests || 0} / ${legacy.downloadDiagnostics && legacy.downloadDiagnostics.retries || 0} / ${legacy.downloadDiagnostics && legacy.downloadDiagnostics.splits || 0}`,
    "",
    "## Einordnung",
    "",
    "- Zeitbedingt: Unterschiede können durch den nicht atomar identischen Datenstand entstehen; der Legacy-Abrufzeitpunkt ist nur eine Obergrenze für den Live-Datenstand.",
    "- Abfragesemantik: Der PBF-Builder clippt grenzschneidende Straßen an der echten Municipality-Boundary. Der Legacy-Pfad behält vollständige Overpass-Way-Geometrien und meldet teilweise außerhalb liegende Straßen nur als Warnung.",
    "- Normalisierung: Beide Pfade verwenden dieselbe Highway-Liste, POI-Registry, Straßen-Normalisierung und denselben Validator.",
    `- Ungeklärt: ${onlyPbf.length + onlyLegacy.length === 0 && poiOnlyPbf.length + poiOnlyLegacy.length === 0 ? "keine namensbasierten Bestandsunterschiede" : "verbleibende Nur-PBF-/Nur-Legacy-Einträge sind oben einzeln ausgewiesen und wurden nicht automatisch einer Ursache zugeschrieben"}.`,
    "",
    "## Fazit",
    "",
    pbfValidation.valid && legacyValidation.valid
      ? "Beide Datensätze werden vom bestehenden City-Validator akzeptiert. Abweichungen sind anhand der obigen Einzelwerte prüfbar."
      : "Mindestens ein Datensatz scheitert am bestehenden City-Validator; der Vergleich ist nicht freigabefähig.",
    ""
  ];
  return lines.join("\n");
}

function main() {
  const pbfPath = valueAfter("--pbf-package");
  const legacyPath = valueAfter("--legacy-snapshot");
  const buildReportPath = valueAfter("--pbf-build-report");
  const outputPath = valueAfter("--output");
  if (!pbfPath || !legacyPath || !outputPath) {
    throw new Error("--pbf-package, --legacy-snapshot and --output are required.");
  }
  const report = buildReport(readJson(pbfPath), readJson(legacyPath), buildReportPath ? readJson(buildReportPath) : {});
  const absoluteOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, report);
  process.stdout.write(`${absoluteOutput}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildReport, geometryDifferences, categoryCounts };
