#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const geometryApi = require("../geometry.js");

const ROOT = path.resolve(__dirname, "..");
const CITY_ID = "osm-relation-1016396";
const SOURCE_PATH = path.join(ROOT, "data/cities/oberasbach-geometries.json");
const OUTPUT_PATH = path.join(ROOT, "data/cities/oberasbach.json");
const DATA_TIMESTAMP = "2026-08-28T00:00:00.000Z";

function loadLegacyData() {
  const context = {};
  context.window = context;
  vm.createContext(context);
  for (const relativePath of ["data/oberasbach-streets.js", "data/oberasbach-pois.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), "utf8"), context, {
      filename: relativePath
    });
  }
  return {
    streets: JSON.parse(JSON.stringify(context.OBERASBACH_STREETS)),
    pois: JSON.parse(JSON.stringify(context.OBERASBACH_POIS)),
    categories: JSON.parse(JSON.stringify(context.OBERASBACH_POI_CATEGORIES))
  };
}

function buildStreet(legacyStreet, sourceStreet) {
  const componentId = geometryApi.createStreetId(legacyStreet.name);
  const id = `${CITY_ID}:${componentId}`;
  const coordinates = sourceStreet.geometry.coordinates.map(line =>
    line.map(coordinate => [Number(coordinate[0]), Number(coordinate[1])])
  );
  const geometry = { type: "MultiLineString", coordinates };
  const runtimeGeometry = {
    streetId: id,
    type: "MultiLineString",
    sections: coordinates
  };
  if (!geometryApi.isValidStreetGeometry(runtimeGeometry, id)) {
    throw new Error(`Ungültige Straßengeometrie: ${legacyStreet.name}`);
  }
  return {
    id,
    cityId: CITY_ID,
    name: legacyStreet.name,
    aliases: [...new Set(legacyStreet.aliases || [])],
    geometry,
    osmWayIds: [...new Set(sourceStreet.osmWayIds)].sort((first, second) => first - second),
    geometrySource: "openstreetmap",
    geometryCheckedAt: "2026-08-28"
  };
}

function buildPoi(legacyPoi) {
  const position = {
    lat: Number(legacyPoi.latitude),
    lon: Number(legacyPoi.longitude)
  };
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) {
    throw new Error(`Ungültige POI-Position: ${legacyPoi.id}`);
  }
  return {
    ...legacyPoi,
    id: `${CITY_ID}:${legacyPoi.id}`,
    legacyId: legacyPoi.id,
    cityId: CITY_ID,
    name: legacyPoi.displayName,
    position
  };
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(`${label}-ID ist leer oder doppelt: ${item.id}`);
    ids.add(item.id);
  }
}

function main() {
  const legacy = loadLegacyData();
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  if (source.cityId !== CITY_ID || source.osmRelationId !== 1016396) {
    throw new Error("Die lokale Geometriequelle gehört nicht zur kanonischen Oberasbach-Relation.");
  }
  const geometryByName = new Map(source.streets.map(street => [street.name, street]));
  const missing = legacy.streets.filter(street => !geometryByName.has(street.name));
  if (missing.length > 0) {
    throw new Error(`Lokale Geometrien fehlen für: ${missing.map(street => street.name).join(", ")}`);
  }

  const streets = legacy.streets.map(street => buildStreet(street, geometryByName.get(street.name)));
  const pois = legacy.pois.map(buildPoi);
  assertUniqueIds(streets, "Straßen");
  assertUniqueIds(pois, "POI");

  const city = {
    id: CITY_ID,
    name: "Oberasbach",
    displayName: "Oberasbach",
    district: "Landkreis Fürth",
    state: "Bayern",
    country: "Deutschland",
    postalCodes: ["90522"],
    osmType: "relation",
    osmId: 1016396,
    bounds: {
      south: 49.4017231,
      west: 10.9384173,
      north: 49.4454542,
      east: 10.9987491
    },
    center: { lat: 49.4236043, lon: 10.9708709 },
    defaultZoom: 13,
    streetCount: streets.length,
    poiCount: pois.length,
    source: "curated+openstreetmap",
    dataVersion: 1,
    createdAt: DATA_TIMESTAMP,
    updatedAt: DATA_TIMESTAMP
  };
  const packageMeta = {
    id: "de-oberasbach-fire-training",
    type: "curated",
    version: "1.0.0",
    title: "Oberasbach – geprüftes Trainingspaket",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    source: "curated",
    verification: {
      status: "verified",
      verifiedAt: "2026-09-05T00:00:00.000Z",
      maintainer: "Straßentrainer",
      note: "Straßen und relevante Einrichtungen redaktionell geprüft"
    }
  };
  const tempCandidate = {
    schemaVersion: 1,
    package: packageMeta,
    city,
    streets,
    pois
  };
  const validator = require("../city-data-validator.js");
  packageMeta.contentHash = validator.computePackageHash(tempCandidate);
  city.package = JSON.parse(JSON.stringify(packageMeta));

  const cityPackage = {
    schemaVersion: 1,
    package: packageMeta,
    city,
    streets,
    pois,
    boundary: source.boundary,
    categories: legacy.categories,
    provenance: {
      content: "curated",
      streetGeometry: "openstreetmap",
      osmSnapshotDate: source.capturedAt,
      legacyStreetSource: "data/oberasbach-streets.js",
      legacyPoiSource: "data/oberasbach-pois.js"
    }
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(cityPackage, null, 2)}\n`);
  process.stdout.write(
    `Oberasbach-Paket erstellt: ${streets.length} Straßen, ${pois.length} POIs, ${OUTPUT_PATH}\n`
  );
}

main();
