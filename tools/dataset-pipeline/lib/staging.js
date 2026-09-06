"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function createStagingDir(runId = null, baseDir = null) {
  const id = runId || `run-${Date.now()}-${process.pid}`;
  const root = baseDir || path.join(os.tmpdir(), "strassentrainer-pipeline");
  const stagingPath = path.join(root, id);

  const citiesDir = path.join(stagingPath, "cities");
  const reportsDir = path.join(stagingPath, "reports");
  const catalogFile = path.join(stagingPath, "catalog.json");

  fs.mkdirSync(citiesDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  return {
    runId: id,
    stagingDir: stagingPath,
    citiesDir,
    reportsDir,
    catalogFile
  };
}

function cleanupStaging(stagingDir, keepStaging = false) {
  if (keepStaging || !stagingDir) return;
  try {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  } catch (_) {}
}

module.exports = {
  createStagingDir,
  cleanupStaging
};
