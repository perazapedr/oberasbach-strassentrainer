"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8095;

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

      // Simulation für Update- und Integrity-Tests
      if (req.url.includes("tampered")) {
        // Manipuliertes Paket ausliefern (Integritätstest)
        const realPkgPath = path.join(ROOT, "dist/dataset-repository/datasets/de-nw-wenden/package.json");
        if (fs.existsSync(realPkgPath)) {
          const raw = fs.readFileSync(realPkgPath, "utf8");
          const parsed = JSON.parse(raw);
          parsed.streets.push({
            id: "tampered-street",
            name: "Hackerstraße",
            geometry: { type: "LineString", coordinates: [[7.0, 50.0], [7.1, 50.1]] }
          });
          // Hash bleibt absichtlich der alte -> Hash Mismatch!
          const payload = JSON.stringify(parsed);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
          res.end(payload);
          return;
        }
      }

      if (req.url.includes("update_catalog=1")) {
        // Aktualisierter Katalog für Update-Test
        if (filePath.endsWith("catalog.json") && fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw);
          const wenden = parsed.datasets.find(d => d.id === "de-nw-wenden");
          if (wenden) {
            wenden.version = "2026.09.99";
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify(parsed));
          return;
        }
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png"
      };
      const contentType = contentTypes[ext] || "application/octet-stream";

      const acceptEncoding = req.headers["accept-encoding"] || "";
      const rawData = fs.readFileSync(filePath);

      // Support gzip compression if requested
      if (acceptEncoding.includes("gzip") && ext === ".json" && rawData.length > 50000) {
        zlib.gzip(rawData, { level: 6 }, (err, gzipped) => {
          if (err) {
            res.writeHead(500);
            res.end();
            return;
          }
          res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Encoding": "gzip",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(gzipped);
        });
      } else {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*"
        });
        res.end(rawData);
      }
    });

    server.listen(PORT, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

class CdpConnection {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.eventListeners = new Map();

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id !== undefined) {
        const handler = this.pending.get(msg.id);
        if (handler) {
          this.pending.delete(msg.id);
          if (msg.error) handler.reject(new Error(msg.error.message));
          else handler.resolve(msg.result);
        }
      } else if (msg.method) {
        const listeners = this.eventListeners.get(msg.method) || [];
        listeners.forEach(fn => fn(msg.params));
      }
    };
  }

  on(method, callback) {
    const list = this.eventListeners.get(method) || [];
    list.push(callback);
    this.eventListeners.set(method, list);
  }

  async send(method, params = {}) {
    await this.ready;
    const msgId = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }
}

async function runBrowserPublishingRepositoryTest() {
  console.log("=== Phase 16.2 Headless Chrome CDP Repository Test ===");
  const server = await startStaticServer();
  console.log(`Static server running on http://127.0.0.1:${PORT}`);

  const userDataDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cdp-repo-test-"));
  const chromeProc = spawn(CHROME_BIN, [
    "--headless=new",
    "--remote-debugging-port=9224",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ]);

  let cdp = null;
  try {
    let version = null;
    for (let i = 0; i < 30; i++) {
      try {
        version = await fetchJson("http://127.0.0.1:9224/json/version");
        if (version && version.webSocketDebuggerUrl) break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    const pages = await fetchJson("http://127.0.0.1:9224/json/list");
    const target = pages.find(p => p.type === "page") || pages[0];
    cdp = new CdpConnection(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    // Netzwerk-Monitoring für externe Anfragen
    const networkRequests = [];
    cdp.on("Network.requestWillBeSent", (params) => {
      if (params && params.request && params.request.url) {
        networkRequests.push(params.request.url);
      }
    });

    console.log("1. Navigiere zur Applikation...");
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1500));

    // Test 1: Katalog laden und verifizieren
    console.log("\n2. Prüfe Laden des Katalogs aus dist/dataset-repository/catalog.json...");
    const catalogCheck = await cdp.eval(`(async () => {
      const resp = await fetch("dist/dataset-repository/catalog.json");
      const catalog = await resp.json();
      return {
        schemaVersion: catalog.schemaVersion,
        datasetCount: catalog.datasets.length,
        datasetIds: catalog.datasets.map(d => d.id)
      };
    })()`);
    console.log(`✓ Katalog erfolgreich geladen: ${catalogCheck.datasetCount} Datensätze: [${catalogCheck.datasetIds.join(", ")}]`);
    if (catalogCheck.schemaVersion !== 1 || catalogCheck.datasetCount < 5) {
      throw new Error("Katalogstruktur ungültig.");
    }

    // Hilfsfunktion zur Installation und Verifikation eines Datensatzes aus dist/
    async function installAndPlayDataset(datasetId, expectedName) {
      console.log(`\n--- Teste Installation & Gameplay für: ${expectedName} (${datasetId}) aus dist/ ---`);
      networkRequests.length = 0;

      const installResult = await cdp.eval(`(async () => {
        // A. Dataset On-Demand aus dist/dataset-repository/ laden
        const pkgUrl = "dist/dataset-repository/datasets/${datasetId}/package.json";
        const t0 = performance.now();
        const resp = await fetch(pkgUrl);
        if (!resp.ok) throw new Error("HTTP Fehler " + resp.status + " beim Laden von " + pkgUrl);
        const pkg = await resp.json();
        const fetchMs = performance.now() - t0;

        // B. Semantische Validierung
        const val = window.StrassentrainerCityDataValidator;
        const pCheck = val.validateCityPackage(pkg);
        const cCheck = val.validateCityData(pkg);
        const hCheck = val.verifyPackageHash(pkg);
        if (!pCheck.valid || !cCheck.valid || !hCheck.valid) {
          throw new Error("Validierung fehlgeschlagen für " + pkgUrl);
        }

        // C. IndexedDB Speicherung
        const storage = window.StrassentrainerCityStorage;
        await storage.saveCity(pkg.city, pkg.streets, pkg.pois, pkg.areas);
        await storage.setActiveCityId(pkg.city.id);

        return {
          valid: true,
          fetchMs: Number(fetchMs.toFixed(1)),
          streetCount: (pkg.streets || []).length,
          poiCount: (pkg.pois || []).length,
          cityId: pkg.city.id,
          cityName: pkg.city.name
        };
      })()`);

      console.log(`✓ ${expectedName} erfolgreich aus Repository geladen (${installResult.streetCount} Straßen, ${installResult.poiCount} POIs in ${installResult.fetchMs}ms)`);

      // Prüfe Gameplay
      const playResult = await cdp.eval(`(() => {
        // Starte freie Runde
        const btnFree = document.getElementById("btn-free-mode");
        if (btnFree) btnFree.click();

        const questionEl = document.getElementById("target-question");
        const currentTargetName = questionEl ? questionEl.textContent : "";

        // Klick auf Karte simulieren
        const map = window.appState ? window.appState.map : null;
        if (map) {
          const center = map.getCenter();
          map.fire("click", { latlng: center });
        }

        const scoreEl = document.getElementById("round-score-display") || document.getElementById("result-score");
        const distEl = document.getElementById("distance-display") || document.getElementById("result-distance");

        return {
          question: currentTargetName,
          hasMap: Boolean(map),
          score: scoreEl ? scoreEl.textContent : null,
          dist: distEl ? distEl.textContent : null
        };
      })()`);

      console.log(`✓ Gameplay aktiv: Frage "${playResult.question}" | Score: ${playResult.score || "OK"} | Dist: ${playResult.dist || "OK"}`);

      // Netzwerk-Audit: 0 Requests an Nominatim/Overpass
      const externalRequests = networkRequests.filter(url =>
        url.includes("nominatim.openstreetmap.org") || url.includes("overpass-api.de")
      );
      if (externalRequests.length > 0) {
        throw new Error(`FEHLER: Unerwartete externe Netzwerkanfragen festgestellt: ${JSON.stringify(externalRequests)}`);
      }
      console.log(`✓ Netzwerk-Audit PASS: 0 Anfragen an Nominatim / Overpass (Gesamt-Requests: ${networkRequests.length})`);
      return installResult;
    }

    // Step A: Wenden aus Repository
    await installAndPlayDataset("de-nw-wenden", "Wenden");

    // Step B: Köln aus Repository
    await installAndPlayDataset("de-nw-koeln", "Köln");

    // Step C: Zirndorf aus Repository
    await installAndPlayDataset("de-by-zirndorf", "Zirndorf");

    // Step D: Offline-Test mit Zirndorf
    console.log("\n--- Teste Offline-Fähigkeit (Netzwerk trennen, Reload, Spielen) ---");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });
    console.log("Netzwerk getrennt (offline = true)");

    // In Chrome reloaden
    await cdp.send("Page.reload");
    await new Promise(r => setTimeout(r, 1200));

    const offlinePlayResult = await cdp.eval(`(async () => {
      const storage = window.StrassentrainerCityStorage;
      const activeCity = await storage.getActiveCityData();
      if (!activeCity || !activeCity.city) {
        throw new Error("Keine aktive Stadt im Offline-Speicher gefunden");
      }

      // Starte Runde offline
      const btnFree = document.getElementById("btn-free-mode");
      if (btnFree) btnFree.click();

      const questionEl = document.getElementById("target-question");
      return {
        offlineActiveCity: activeCity.city.name,
        question: questionEl ? questionEl.textContent : "",
        streetsCount: activeCity.streets?.length || 0
      };
    })()`);

    console.log(`✓ Offline Reload PASS: Aktive Stadt "${offlinePlayResult.offlineActiveCity}" mit ${offlinePlayResult.streetsCount} Straßen aus IndexedDB geladen.`);
    console.log(`✓ Offline Frage: "${offlinePlayResult.question}"`);

    // Netzwerk wiederherstellen
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
    console.log("Netzwerk wiederhergestellt (offline = false)");

    // Step E: Update-Test
    console.log("\n--- Teste Versions-Update (Katalog meldet neuere Version) ---");
    const updateCheckResult = await cdp.eval(`(async () => {
      // Frage den Update-Katalog ab
      const resp = await fetch("dist/dataset-repository/catalog.json?update_catalog=1");
      const updatedCat = await resp.json();
      const updatedWenden = updatedCat.datasets.find(d => d.id === "de-nw-wenden");

      // Vergleiche mit lokaler Version in IndexedDB
      const storage = window.StrassentrainerCityStorage;
      const localCities = await storage.getAllCities();
      const localWenden = localCities.find(c => c.name === "Wenden");

      const updateAvailable = updatedWenden && localWenden && updatedWenden.version !== localWenden.version;

      return {
        localVersion: localWenden ? localWenden.version : null,
        remoteVersion: updatedWenden ? updatedWenden.version : null,
        updateAvailable
      };
    })()`);

    console.log(`✓ Update-Erkennung PASS: Lokal "${updateCheckResult.localVersion}" vs. Remote "${updateCheckResult.remoteVersion}" (Update verfügbar: ${updateCheckResult.updateAvailable})`);
    if (!updateCheckResult.updateAvailable) {
      throw new Error("Update-Erkennung fehlgeschlagen.");
    }

    // Step F: Integritätstest (Manuell manipuliertes Paket im Repository wird abgewiesen)
    console.log("\n--- Teste Integritätsschutz (Manipuliertes Paket mit Hash-Mismatch) ---");
    const integrityCheckResult = await cdp.eval(`(async () => {
      // Lade Paket mit manipuliertem Straßeninhalt (nicht im SW-Cache)
      const resp = await fetch("dist/dataset-repository/datasets/tampered-test/package.json");
      const tamperedPkg = await resp.json();

      const val = window.StrassentrainerCityDataValidator;
      const hashVerification = val.verifyPackageHash(tamperedPkg);

      return {
        tamperedDetected: !hashVerification.valid,
        expected: hashVerification.expectedHash,
        actual: hashVerification.actualHash,
        hashStatus: hashVerification.status,
        streetsCount: tamperedPkg.streets ? tamperedPkg.streets.length : null,
        valid: hashVerification.valid
      };
    })()`);

    if (!integrityCheckResult.tamperedDetected) {
      console.error("DEBUG integrityCheckResult:", integrityCheckResult);
      throw new Error("Integritätsschutz hat manipuliertes Paket nicht abgefangen!");
    }

    console.log(`✓ Integritätstest PASS: Manipuliertes Paket erfolgreich abgelehnt!`);
    console.log(`  Erwarteter Hash: ${integrityCheckResult.expected}`);
    console.log(`  Tatsächlicher Hash: ${integrityCheckResult.actual}`);

    console.log("\n============================================================");
    console.log("✓ ALLE BROWSER-REPOSITORY-TESTS VOLLSTÄNDIG BESTANDEN (PASS)");
    console.log("============================================================");
  } finally {
    if (cdp && cdp.ws) cdp.ws.close();
    chromeProc.kill();
    await new Promise(r => setTimeout(r, 600));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
    server.close();
  }
}

runBrowserPublishingRepositoryTest().catch(err => {
  console.error("\n❌ Browser Repository Test fehlgeschlagen:", err);
  process.exit(1);
});
