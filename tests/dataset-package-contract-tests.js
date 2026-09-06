"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const validator = require("../city-data-validator.js");
const packageApi = require("../city-package.js");
const { createStaticDatasetProvider } = require("../dataset-provider.js");
const { createCityStorage } = require("../city-storage.js");
const targetApi = require("../targets.js");
const geometryApi = require("../geometry.js");
const poiCategories = require("../poi-categories.js");
const gameEngineApi = require("../game-engine.js");
const turf = require("../vendor/turf/turf.min.js");
const { MockIDBKeyRange, MockIndexedDB, createMemoryStorage } = require("./helpers/mock-indexeddb.js");
const builderCore = require("../tools/dataset-builder/lib/core.js");

const ROOT = path.resolve(__dirname, "..");
const OBERASBACH_PATH = path.join(ROOT, "data/cities/oberasbach.json");
const OLPE_PATH = path.join(ROOT, "data/cities/de-nw-olpe.json");
const SCHEMA_PATH = path.join(ROOT, "schemas/strassentrainer-dataset.schema.json");
const CONTRACT_DOC_PATH = path.join(ROOT, "docs/dataset-package-contract.md");

function allIssues(result, kind = "errors") {
  return ["package", "municipality", "streets", "pois", "areas"]
    .flatMap(section => Array.isArray(result?.validation?.[section]?.[kind])
      ? result.validation[section][kind]
      : []);
}

const tests = [
  {
    name: "JSON Schema und Spezifikationsdokumentation existieren und sind vollständig",
    async run() {
      assert.ok(fs.existsSync(SCHEMA_PATH), "JSON Schema file must exist");
      const schemaRaw = fs.readFileSync(SCHEMA_PATH, "utf8");
      const schema = JSON.parse(schemaRaw);
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.ok(schema.properties.schemaVersion);
      assert.ok(schema.properties.package);
      assert.ok(schema.properties.city);
      assert.ok(schema.properties.boundary);
      assert.ok(schema.properties.streets);
      assert.ok(schema.properties.pois);
      assert.ok(schema.properties.areas);
      assert.ok(schema.properties.provenance);
      assert.ok(schema.properties.build);

      assert.ok(fs.existsSync(CONTRACT_DOC_PATH), "Contract documentation markdown must exist");
      const doc = fs.readFileSync(CONTRACT_DOC_PATH, "utf8");
      assert.ok(doc.includes("schemaVersion: 1"));
      assert.ok(doc.includes("datasetKind"));
      assert.ok(doc.includes("CalVer"));
      assert.ok(doc.includes("provenance"));
      assert.ok(doc.includes("sourcePbf"));
      assert.ok(doc.includes("contentHash"));
      assert.ok(doc.includes("canonicalizeAreaGeometry"));
      assert.ok(doc.includes("build.warnings"));
    }
  },
  {
    name: "Golden Dataset Oberasbach bleibt strikt unverändert und erfüllt alle Kriterien",
    async run() {
      assert.ok(fs.existsSync(OBERASBACH_PATH), "Oberasbach dataset must exist");
      const packageData = JSON.parse(fs.readFileSync(OBERASBACH_PATH, "utf8"));

      assert.equal(packageData.schemaVersion, 1);
      assert.equal(packageData.package.id, "de-oberasbach-fire-training");
      assert.equal(packageData.package.type, "curated");
      assert.equal(packageData.package.version, "1.0.0");
      assert.equal(packageData.package.contentHash, "sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95");
      assert.equal(packageData.city.name, "Oberasbach");
      assert.equal(packageData.streets.length, 271);
      assert.equal(packageData.pois.length, 60);

      const validation = validator.validateCityPackage(packageData);
      assert.equal(validation.valid, true);
      assert.equal(allIssues(validation, "errors").length, 0);

      const hashCheck = validator.verifyPackageHash(packageData);
      assert.equal(hashCheck.valid, true);
      assert.equal(hashCheck.expectedHash, packageData.package.contentHash);
    }
  },
  {
    name: "Golden Reference Olpe erfüllt alle Kontraktkriterien für PBF-Datasets",
    async run() {
      assert.ok(fs.existsSync(OLPE_PATH), "Olpe dataset must exist");
      const packageData = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

      assert.equal(packageData.schemaVersion, 1);
      assert.equal(packageData.package.id, "de-nw-olpe");
      assert.equal(packageData.package.type, "osm");
      assert.equal(packageData.package.datasetKind, "municipality");
      assert.equal(packageData.package.version, "2026.09.05");
      assert.equal(packageData.package.contentHash, "sha256:6c89d676e575f2d69301715c3be5e8e66b5a798afc21b73495671fa33d996269");

      assert.equal(packageData.city.id, "osm-relation-163179");
      assert.equal(packageData.city.name, "Olpe");
      assert.equal(packageData.streets.length, 461);
      assert.equal(packageData.pois.length, 114);
      assert.equal(packageData.areas.length, 2);

      assert.equal(packageData.boundary.type, "Polygon");
      assert.ok(Array.isArray(packageData.boundary.coordinates));
      assert.ok(packageData.boundary.coordinates[0].length >= 4);

      assert.ok(packageData.provenance, "provenance object must exist");
      assert.equal(packageData.provenance.source, "OpenStreetMap PBF");
      assert.equal(packageData.provenance.sourcePbf, "nordrhein-westfalen-latest.osm.pbf");
      assert.equal(packageData.provenance.osmDataTimestamp, "2026-09-05T20:22:06.000Z");
      assert.equal(packageData.provenance.builderVersion, "0.1.0");
      assert.equal(packageData.provenance.generatedAt, "2026-09-05T20:22:06.000Z");
      assert.equal(packageData.provenance.municipalityRelation, 163179);
      assert.equal(packageData.provenance.municipalityKey, "05966024");

      assert.ok(packageData.build, "build object must exist");
      assert.ok(Array.isArray(packageData.build.warnings));
      assert.ok(packageData.build.warnings.length > 0);
      assert.ok(packageData.build.warnings.every(w => w.code && w.severity === "warning" && w.message));

      const validation = validator.validateCityPackage(packageData);
      assert.equal(validation.valid, true);
      assert.equal(allIssues(validation, "errors").length, 0);

      const hashCheck = validator.verifyPackageHash(packageData);
      assert.equal(hashCheck.valid, true);
      assert.equal(hashCheck.expectedHash, packageData.package.contentHash);
    }
  },
  {
    name: "Schema-1-Schutz: Höhere oder ungültige schemaVersion wird zuverlässig blockiert",
    async run() {
      const base = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

      const pkgV2 = { ...base, schemaVersion: 2 };
      const v2Res = validator.validateCityPackage(pkgV2);
      assert.equal(v2Res.valid, false);
      assert.ok(allIssues(v2Res, "errors").some(e => e.code === "CITY_PACKAGE_SCHEMA_NEWER"));

      const pkgV0 = { ...base, schemaVersion: 0 };
      const v0Res = validator.validateCityPackage(pkgV0);
      assert.equal(v0Res.valid, false);
      assert.ok(allIssues(v0Res, "errors").some(e => e.code === "CITY_PACKAGE_SCHEMA_UNSUPPORTED"));

      const pkgVStr = { ...base, schemaVersion: "1" };
      const vStrRes = validator.validateCityPackage(pkgVStr);
      assert.equal(vStrRes.valid, false);
      assert.ok(allIssues(vStrRes, "errors").some(e => e.code === "CITY_PACKAGE_SCHEMA_UNSUPPORTED"));
    }
  },
  {
    name: "Pflichtfeldvalidierung: Fehlende oder ungültige Kernfelder werden abgelehnt",
    async run() {
      const base = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

      const withoutCity = { ...base };
      delete withoutCity.city;
      assert.equal(validator.validateCityPackage(withoutCity).valid, false);

      const withoutCityId = JSON.parse(JSON.stringify(base));
      delete withoutCityId.city.id;
      assert.equal(validator.validateCityPackage(withoutCityId).valid, false);

      const withoutCityName = JSON.parse(JSON.stringify(base));
      delete withoutCityName.city.name;
      assert.equal(validator.validateCityPackage(withoutCityName).valid, false);

      const withoutStreets = { ...base };
      delete withoutStreets.streets;
      assert.equal(validator.validateCityPackage(withoutStreets).valid, false);

      const emptyStreets = { ...base, streets: [] };
      const emptyStreetsRes = validator.validateCityPackage(emptyStreets);
      assert.equal(emptyStreetsRes.valid, false);
      assert.ok(allIssues(emptyStreetsRes, "errors").some(e => e.code === "CITY_NO_PLAYABLE_STREETS"));

      const withoutPois = { ...base };
      delete withoutPois.pois;
      assert.equal(validator.validateCityPackage(withoutPois).valid, false);

      const invalidDatasetKind = JSON.parse(JSON.stringify(base));
      invalidDatasetKind.package.datasetKind = "invalid_kind_123";
      const kindRes = validator.validateCityPackage(invalidDatasetKind);
      assert.equal(kindRes.valid, false);
      assert.ok(allIssues(kindRes, "errors").some(e => e.code === "PACKAGE_DATASET_KIND_INVALID"));
    }
  },
  {
    name: "Version-Semantik: parseSemver und comparePackageVersions beherrschen SemVer und CalVer",
    async run() {
      assert.deepEqual(validator.parseSemver("1.0.0"), [1, 0, 0]);
      assert.deepEqual(validator.parseSemver("2.14.3"), [2, 14, 3]);
      assert.deepEqual(validator.parseSemver("2026.09.05"), [2026, 9, 5]);
      assert.deepEqual(validator.parseSemver("2026.09.05.1"), [2026, 9, 5, 1]);

      assert.equal(validator.parseSemver("invalid"), null);
      assert.equal(validator.parseSemver(""), null);
      assert.equal(validator.parseSemver("1.0"), null);
      assert.equal(validator.parseSemver("v1.0.0"), null);
      assert.equal(validator.parseSemver("1.0.0-beta"), null);
      assert.equal(validator.parseSemver("1.0.0+build1"), null);

      assert.ok(validator.comparePackageVersions("1.0.0", "1.0.1") < 0);
      assert.ok(validator.comparePackageVersions("1.0.1", "1.1.0") < 0);
      assert.ok(validator.comparePackageVersions("1.1.0", "2.0.0") < 0);

      assert.ok(validator.comparePackageVersions("2026.01.15", "2026.09.05") < 0);
      assert.ok(validator.comparePackageVersions("2026.09.05", "2026.09.05.1") < 0);
      assert.ok(validator.comparePackageVersions("2026.09.05.1", "2026.09.05.2") < 0);
      assert.ok(validator.comparePackageVersions("2026.09.05.2", "2026.09.06") < 0);

      assert.equal(validator.comparePackageVersions("2026.09.05", "2026.09.05"), 0);
      assert.equal(validator.comparePackageVersions("2026.09.05.1", "2026.09.05.1"), 0);

      assert.equal(builderCore.formatDatasetVersion("2026-09-05T20:22:06.000Z"), "2026.09.05");
      assert.equal(builderCore.formatDatasetVersion(new Date("2026-12-31T23:59:59.000Z")), "2026.12.31");
    }
  },
  {
    name: "Geometrien: Polygon, MultiPolygon und canonicalizeAreaGeometry",
    async run() {
      const singleMulti = {
        type: "MultiPolygon",
        coordinates: [
          [[[7.8, 51.0], [7.9, 51.0], [7.9, 51.1], [7.8, 51.1], [7.8, 51.0]]]
        ]
      };
      const canonical = builderCore.canonicalizeAreaGeometry(singleMulti);
      assert.equal(canonical.type, "Polygon");
      assert.deepEqual(canonical.coordinates, singleMulti.coordinates[0]);

      const trueMulti = {
        type: "MultiPolygon",
        coordinates: [
          [[[7.8, 51.0], [7.9, 51.0], [7.9, 51.1], [7.8, 51.1], [7.8, 51.0]]],
          [[[8.0, 51.2], [8.1, 51.2], [8.1, 51.3], [8.0, 51.3], [8.0, 51.2]]]
        ]
      };
      const canonicalMulti = builderCore.canonicalizeAreaGeometry(trueMulti);
      assert.equal(canonicalMulti.type, "MultiPolygon");
      assert.equal(canonicalMulti.coordinates.length, 2);

      const unclosed = {
        type: "Polygon",
        coordinates: [
          [[7.8, 51.0], [7.9, 51.0], [7.9, 51.1], [7.8, 51.1]]
        ]
      };
      const base = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));
      const invalidGeomPkg = { ...base, boundary: unclosed };
      const res = validator.validateCityPackage(invalidGeomPkg);
      assert.equal(res.valid, false);
      assert.ok(allIssues(res, "errors").some(e => e.code === "CITY_BOUNDARY_INVALID"));
    }
  },
  {
    name: "contentHash Determinismus: Sachdatenänderungen ändern den Hash, Metadaten/Reihenfolge nicht",
    async run() {
      const base = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));
      const originalHash = validator.computePackageHash(base);

      // Sachdatenänderung: Straßenname
      const modStreet = JSON.parse(JSON.stringify(base));
      modStreet.streets[0].name = "Geänderter Straßenname";
      assert.notEqual(validator.computePackageHash(modStreet), originalHash);

      // Sachdatenänderung: Straßengeometrie
      const modGeom = JSON.parse(JSON.stringify(base));
      modGeom.streets[0].geometry.coordinates[0][0] += 0.001;
      assert.notEqual(validator.computePackageHash(modGeom), originalHash);

      // Sachdatenänderung: POI-Name
      const modPoi = JSON.parse(JSON.stringify(base));
      modPoi.pois[0].name = "Geänderter POI-Name";
      assert.notEqual(validator.computePackageHash(modPoi), originalHash);

      // Sachdatenänderung: Area
      const modArea = JSON.parse(JSON.stringify(base));
      modArea.areas[0].name = "Geändertes Trainingsgebiet";
      assert.notEqual(validator.computePackageHash(modArea), originalHash);

      // Metadaten- und volatile Änderungen: dürfen contentHash NICHT verändern!
      const modBoundary = JSON.parse(JSON.stringify(base));
      modBoundary.boundary.coordinates[0][0][0] += 0.001;
      assert.equal(validator.computePackageHash(modBoundary), originalHash);

      // Metadaten-Änderungen: dürfen contentHash NICHT verändern!
      const modExport = JSON.parse(JSON.stringify(base));
      modExport.exportedAt = "2099-01-01T00:00:00.000Z";
      assert.equal(validator.computePackageHash(modExport), originalHash);

      const modProv = JSON.parse(JSON.stringify(base));
      modProv.provenance.builderVersion = "9.9.9";
      modProv.provenance.sourcePbf = "other-dump.osm.pbf";
      assert.equal(validator.computePackageHash(modProv), originalHash);

      const modBuild = JSON.parse(JSON.stringify(base));
      modBuild.build = { warnings: [{ code: "DIAGNOSTIC", severity: "warning", message: "diagnostic only" }] };
      assert.equal(validator.computePackageHash(modBuild), originalHash);
    }
  },
  {
    name: "Provenienz-Sicherheit: Absolute Pfade in sourcePbf werden strikt blockiert",
    async run() {
      const base = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

      const pkgAbsUnix = JSON.parse(JSON.stringify(base));
      pkgAbsUnix.provenance.sourcePbf = "/Users/pedro/secret/nordrhein-westfalen-latest.osm.pbf";
      const unixRes = validator.validateCityPackage(pkgAbsUnix);
      assert.equal(unixRes.valid, false);
      assert.ok(allIssues(unixRes, "errors").some(e => e.code === "PROVENANCE_SOURCE_PBF_ABSOLUTE"));

      const pkgRelSlash = JSON.parse(JSON.stringify(base));
      pkgRelSlash.provenance.sourcePbf = "work/nordrhein-westfalen-latest.osm.pbf";
      const relRes = validator.validateCityPackage(pkgRelSlash);
      assert.equal(relRes.valid, false);
      assert.ok(allIssues(relRes, "errors").some(e => e.code === "PROVENANCE_SOURCE_PBF_ABSOLUTE"));

      const pkgWin = JSON.parse(JSON.stringify(base));
      pkgWin.provenance.sourcePbf = "C:\\data\\nordrhein-westfalen-latest.osm.pbf";
      const winRes = validator.validateCityPackage(pkgWin);
      assert.equal(winRes.valid, false);
      assert.ok(allIssues(winRes, "errors").some(e => e.code === "PROVENANCE_SOURCE_PBF_ABSOLUTE"));

      // Reiner Dateiname ist valide
      const pkgClean = JSON.parse(JSON.stringify(base));
      pkgClean.provenance.sourcePbf = "germany-latest.osm.pbf";
      assert.equal(validator.validateCityPackage(pkgClean).valid, true);
    }
  },
  {
    name: "Vorwärts- und Rückwärtskompatibilität bleibt gewahrt",
    async run() {
      const base = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

      // Rückwärtskompatibilität: Paket ohne provenance und build validiert fehlerfrei
      const legacyPkg = JSON.parse(JSON.stringify(base));
      delete legacyPkg.provenance;
      delete legacyPkg.build;
      assert.equal(validator.validateCityPackage(legacyPkg).valid, true);

      // Rückwärtskompatibilität: Paket ohne top-level boundary erzeugt nur Warnung im Paket-Validator
      const noBoundaryPkg = JSON.parse(JSON.stringify(base));
      delete noBoundaryPkg.boundary;
      delete noBoundaryPkg.city.boundary;
      const noBoundRes = validator.validateCityPackage(noBoundaryPkg);
      assert.equal(noBoundRes.valid, true);
      assert.ok(allIssues(noBoundRes, "warnings").some(w => w.code === "CITY_BOUNDARY_MISSING"));

      // Vorwärtskompatibilität: Unbekannte Eigenschaften auf Root oder in Objekten werden toleriert
      const futurePkg = JSON.parse(JSON.stringify(base));
      futurePkg.customFutureExtension = { version: 1, extraData: [1, 2, 3] };
      futurePkg.city.customFutureCityField = "hello";
      futurePkg.package.customFuturePackageField = "world";
      assert.equal(validator.validateCityPackage(futurePkg).valid, true);
    }
  },
  {
    name: "End-to-End Offline-Gameplay mit kontraktkonformem Olpe-Paket (0 Overpass, 0 Nominatim, 0 PBF)",
    async run() {
      const packageData = JSON.parse(fs.readFileSync(OLPE_PATH, "utf8"));

      let overpassCalls = 0;
      let nominatimCalls = 0;
      let geoApiCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async input => {
        const url = String(input && input.url ? input.url : input);
        if (url.includes("overpass") || url.includes("/api/interpreter")) overpassCalls += 1;
        else if (url.includes("nominatim")) nominatimCalls += 1;
        else geoApiCalls += 1;
        throw new Error(`Forbidden network call: ${url}`);
      };

      try {
        const provider = createStaticDatasetProvider([{
          metadata: {
            id: packageData.city.id,
            name: packageData.city.name,
            displayName: packageData.city.displayName,
            state: packageData.city.state,
            country: packageData.city.country,
            datasetKind: packageData.package.datasetKind
          },
          dataset: packageData
        }]);

        const [meta] = await provider.searchDatasets("Olpe");
        assert.equal(meta.id, packageData.city.id);
        const downloaded = await provider.downloadDataset(meta.id);
        const validated = validator.validateCityData(downloaded.dataset, { sourceMode: "download" });
        assert.equal(validated.valid, true);

        const storage = createCityStorage({
          dbName: "phase-15-3-contract-gameplay",
          indexedDB: new MockIndexedDB(),
          IDBKeyRange: MockIDBKeyRange,
          localStorage: createMemoryStorage(),
          activeCityStorageKey: "phase-15-3-active"
        });

        const city = { ...validated.city, boundary: validated.boundary };
        await storage.saveCity(city, validated.streets, validated.pois, validated.areas);
        await storage.setActiveCityId(city.id);
        const active = await storage.getActiveCityData();

        const streetTargets = targetApi.prepareStreetTargets(active.streets, geometryApi);
        const poiTargets = targetApi.preparePoiTargets(active.pois, poiCategories.getAll());
        assert.equal(streetTargets.length, 461);
        assert.equal(poiTargets.length, 114);

        const target = streetTargets[0];
        const click = target.geometry.sections[0][0];
        const evaluation = targetApi.evaluateTargetDistance(target, click, turf, geometryApi);
        assert.ok(evaluation && Number.isFinite(evaluation.distanceMeters));

        const engine = gameEngineApi.createGameEngine({ now: () => 5000 });
        engine.startGame({ mode: "free", contentSelection: "streets" });
        engine.startRound();
        engine.activateRound({ ...target, name: target.displayName });
        engine.submitGuess({ lat: click[1], lng: click[0] });
        const result = engine.resolveRound(evaluation);

        assert.equal(result.targetId, target.id);
        assert.ok(Number.isFinite(result.points));
        assert.equal(overpassCalls, 0);
        assert.equal(nominatimCalls, 0);
        assert.equal(geoApiCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  }
];

(async () => {
  let passed = 0;
  for (const test of tests) {
    try {
      await test.run();
      console.log(`✓ ${test.name}`);
      passed += 1;
    } catch (err) {
      console.error(`✗ ${test.name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`\n${passed}/${tests.length} Package-Contract-Tests bestanden.`);
})();
