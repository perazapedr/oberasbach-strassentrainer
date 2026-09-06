"use strict";

const fs = require("node:fs");
const path = require("node:path");

class PublishError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    this.details = details;
  }
}

function publishCandidates(stagingResult, qaResults, publishedStatePath, targetDataDir, options = {}) {
  const { dryRun = false, noPublish = false } = options;

  // 1. Publish Gate: Prüfe, ob alle Kandidaten bestanden haben
  const failures = qaResults.filter(r => r.status !== "PASS");
  if (failures.length > 0) {
    const failedIds = failures.map(f => f.datasetId).join(", ");
    throw new PublishError(
      "PUBLISH_BLOCKED_QA_FAILURE",
      `Publish blockiert: Folgende Datensätze haben die QA nicht bestanden: ${failedIds}`,
      { failures }
    );
  }

  // 2. Prüfe, ob sich überhaupt etwas geändert hat oder ob alle UNCHANGED sind
  const hasChanges = qaResults.some(r => r.classification === "CHANGED" || r.classification === "NEW");

  if (dryRun || noPublish) {
    return {
      status: "WOULD_PUBLISH",
      hasChanges,
      promotedDatasets: qaResults.map(r => ({
        datasetId: r.datasetId,
        classification: r.classification,
        version: r.version,
        contentHash: r.contentHash
      }))
    };
  }

  // 3. Atomare Promotion mit Rollback-Sicherung
  const backups = new Map(); // targetPath -> originalContent
  const createdFiles = new Set();
  const promoted = [];

  const citiesTargetDir = path.join(targetDataDir, "cities");
  const catalogTargetFile = path.join(targetDataDir, "catalog.json");
  const publishedStateResolved = path.resolve(publishedStatePath);

  try {
    fs.mkdirSync(citiesTargetDir, { recursive: true });

    // A. Promote Dataset Packages
    for (const qa of qaResults) {
      // Bei UNCHANGED muss die Datei nicht überschrieben werden, wenn sie bereits existiert
      const stagedPackageFile = path.join(stagingResult.citiesDir, `${qa.datasetId}.json`);
      const destPackageFile = path.join(citiesTargetDir, `${qa.datasetId}.json`);

      if (!fs.existsSync(stagedPackageFile)) {
        throw new PublishError("STAGED_PACKAGE_MISSING", `Staged-Paketdatei fehlt: ${stagedPackageFile}`);
      }

      // Backup existierende Datei
      if (fs.existsSync(destPackageFile)) {
        backups.set(destPackageFile, fs.readFileSync(destPackageFile));
      } else {
        createdFiles.add(destPackageFile);
      }

      // Atomare Promotion via Temp-Datei im Zielverzeichnis
      const tempDest = path.join(citiesTargetDir, `.tmp-${qa.datasetId}-${process.pid}-${Date.now()}.json`);
      fs.copyFileSync(stagedPackageFile, tempDest);
      fs.renameSync(tempDest, destPackageFile);

      promoted.push({
        datasetId: qa.datasetId,
        file: destPackageFile,
        version: qa.version,
        contentHash: qa.contentHash,
        classification: qa.classification
      });
    }

    // B. Promote Catalog (immer zuletzt, nur bei Änderungen oder abweichendem Inhalt)
    const stagedCatalogFile = stagingResult.catalogFile || path.join(stagingResult.stagingDir, "catalog.json");
    if (!fs.existsSync(stagedCatalogFile)) {
      throw new PublishError("STAGED_CATALOG_MISSING", `Staged-Katalogdatei fehlt: ${stagedCatalogFile}`);
    }

    const catalogContentStaged = fs.readFileSync(stagedCatalogFile, "utf8");
    const catalogExists = fs.existsSync(catalogTargetFile);
    const catalogContentExisting = catalogExists ? fs.readFileSync(catalogTargetFile, "utf8") : null;
    const catalogNeedsUpdate = !catalogExists || catalogContentStaged !== catalogContentExisting;

    if (catalogNeedsUpdate) {
      if (catalogExists) {
        backups.set(catalogTargetFile, catalogContentExisting);
      } else {
        createdFiles.add(catalogTargetFile);
      }
      const tempCatalog = path.join(targetDataDir, `.tmp-catalog-${process.pid}-${Date.now()}.json`);
      fs.copyFileSync(stagedCatalogFile, tempCatalog);
      fs.renameSync(tempCatalog, catalogTargetFile);
    }

    // C. Update published-state.json (nur wenn Änderungen vorliegen)
    if (hasChanges || !fs.existsSync(publishedStateResolved)) {
      if (fs.existsSync(publishedStateResolved)) {
        backups.set(publishedStateResolved, fs.readFileSync(publishedStateResolved));
      } else {
        createdFiles.add(publishedStateResolved);
      }

      let publishedState = { schemaVersion: 1, datasets: {} };
      if (fs.existsSync(publishedStateResolved)) {
        publishedState = JSON.parse(fs.readFileSync(publishedStateResolved, "utf8"));
      }

      for (const p of promoted) {
        publishedState.datasets[p.datasetId] = {
          datasetId: p.datasetId,
          version: p.version,
          contentHash: p.contentHash,
          packageType: "osm",
          protected: false,
          publishedAt: new Date().toISOString(),
          filePath: `data/cities/${p.datasetId}.json`
        };
      }
      publishedState.updatedAt = new Date().toISOString();

      const tempState = path.join(path.dirname(publishedStateResolved), `.tmp-published-state-${process.pid}.json`);
      fs.writeFileSync(tempState, JSON.stringify(publishedState, null, 2) + "\n", "utf8");
      fs.renameSync(tempState, publishedStateResolved);
    }

    return {
      status: "PUBLISHED",
      promotedDatasets: promoted,
      catalogUpdated: hasChanges
    };
  } catch (error) {
    // ROLLBACK: Stelle alle vorherigen Dateien wieder her
    for (const [filePath, content] of backups.entries()) {
      try {
        fs.writeFileSync(filePath, content);
      } catch (_) {}
    }
    for (const newFile of createdFiles) {
      try {
        if (fs.existsSync(newFile)) fs.unlinkSync(newFile);
      } catch (_) {}
    }

    throw new PublishError(
      "PUBLISH_FAILED_ROLLED_BACK",
      `Publish fehlgeschlagen, vorheriger Zustand wurde wiederhergestellt: ${error.message}`,
      { originalError: error }
    );
  }
}

module.exports = {
  PublishError,
  publishCandidates
};
