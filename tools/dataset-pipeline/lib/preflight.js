"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

class PreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PreflightError";
    this.code = code;
  }
}

function checkOsmium() {
  const result = spawnSync("osmium", ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new PreflightError("OSMIUM_UNAVAILABLE", "osmium-tool ist nicht installiert oder nicht ausführbar.");
  }
  const match = result.stdout.match(/osmium\s+version\s+([0-9.]+)/i);
  return match ? match[1] : result.stdout.trim().split("\n")[0];
}

function checkPbf(pbfPath) {
  const resolved = path.resolve(pbfPath);
  if (!fs.existsSync(resolved)) {
    throw new PreflightError("PBF_NOT_FOUND", `PBF-Datei existiert nicht: ${resolved}`);
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    throw new PreflightError("PBF_NOT_READABLE", `PBF-Datei konnte nicht gelesen werden: ${error.message}`);
  }

  if (!stat.isFile()) {
    throw new PreflightError("PBF_NOT_A_FILE", `PBF-Pfad ist keine Datei: ${resolved}`);
  }

  if (stat.size <= 0) {
    throw new PreflightError("PBF_EMPTY", `PBF-Datei ist leer (0 Bytes): ${resolved}`);
  }

  // Prüfe mit osmium fileinfo
  const infoResult = spawnSync("osmium", ["fileinfo", resolved], { encoding: "utf8" });
  if (infoResult.error || infoResult.status !== 0) {
    throw new PreflightError(
      "PBF_INVALID",
      `PBF-Datei ist ungültig oder beschädigt: ${infoResult.stderr || "osmium fileinfo fehlgeschlagen"}`
    );
  }

  // Extrahiere Timestamp
  let osmTimestamp = null;
  for (const key of ["header.option.osmosis_replication_timestamp", "header.option.timestamp"]) {
    const tsResult = spawnSync("osmium", ["fileinfo", "-g", key, resolved], { encoding: "utf8" });
    if (tsResult.status === 0) {
      const val = tsResult.stdout.trim();
      if (val && Number.isFinite(Date.parse(val))) {
        osmTimestamp = new Date(val).toISOString();
        break;
      }
    }
  }

  if (!osmTimestamp) {
    throw new PreflightError("PBF_MISSING_TIMESTAMP", "PBF-Header enthält keinen lesbaren OSM-Daten-Zeitstempel.");
  }

  return {
    pbfPath: resolved,
    pbfSize: stat.size,
    osmTimestamp
  };
}

function runPreflight(pbfPath, manifest, options = {}) {
  const osmiumVersion = checkOsmium();
  const pbfInfo = checkPbf(pbfPath);

  return {
    status: "PASS",
    pipelineVersion: "1.0.0",
    builderVersion: "0.1.0",
    osmiumVersion,
    pbfPath: pbfInfo.pbfPath,
    pbfSize: pbfInfo.pbfSize,
    osmTimestamp: pbfInfo.osmTimestamp,
    manifestRegion: manifest.regionId,
    targetCount: manifest.datasets.length
  };
}

module.exports = {
  PreflightError,
  checkOsmium,
  checkPbf,
  runPreflight
};

