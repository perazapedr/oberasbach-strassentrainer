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

      // Die Anwendung verwendet weiterhin ihren normalen CatalogDatasetProvider
      // unter data/catalog.json. Im Repository-E2E wird dort bewusst das echte,
      // gehärtete Publisher-Artefakt ausgeliefert. Dessen relative immutable
      // Package-Pfade werden entsprechend unter /data/datasets/ bereitgestellt.
      if (urlPath === "/data/catalog.json") {
        filePath = path.join(ROOT, "dist", "dataset-repository", "catalog.json");
      } else if (urlPath.startsWith("/data/datasets/")) {
        filePath = path.join(ROOT, "dist", "dataset-repository", urlPath.slice("/data/".length));
      }

      // Simulation für Update- und Integrity-Tests
      if (req.url.includes("tampered")) {
        // Manipuliertes Paket ausliefern (Integritätstest)
        const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "dist/dataset-repository/catalog.json"), "utf8"));
        const wendenEntry = catalog.datasets.find(entry => entry.id === "de-nw-wenden");
        const realPkgPath = wendenEntry && path.join(ROOT, "dist/dataset-repository", wendenEntry.downloadPath);
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
  const phase17Only = process.argv.includes("--phase17-only");
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

    cdp.on("Runtime.exceptionThrown", params => {
      console.error("[BROWSER ERROR]", params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || params);
    });

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
        datasetIds: catalog.datasets.map(d => d.id),
        immutablePaths: catalog.datasets.every(d => /^datasets\\/[^/]+\\/[^/]+\\/[0-9a-f]{64}\\/package\\.json$/.test(d.downloadPath))
      };
    })()`);
    console.log(`✓ Katalog erfolgreich geladen: ${catalogCheck.datasetCount} Datensätze: [${catalogCheck.datasetIds.join(", ")}]`);
    if (catalogCheck.schemaVersion !== 1 || catalogCheck.datasetCount < 5 || !catalogCheck.immutablePaths) {
      throw new Error("Katalogstruktur ungültig.");
    }

    // Hilfsfunktion zur Installation und Verifikation eines Datensatzes aus dist/
    async function installAndPlayDataset(datasetId, expectedName) {
      console.log(`\n--- Teste Installation & Gameplay für: ${expectedName} (${datasetId}) aus dist/ ---`);
      networkRequests.length = 0;

      const installResult = await cdp.eval(`(async () => {
        await window.StrassentrainerRuntime.ready;

        // A. Dataset On-Demand aus dist/dataset-repository/ laden
        const catalogResp = await fetch("dist/dataset-repository/catalog.json");
        const catalog = await catalogResp.json();
        const entry = catalog.datasets.find(candidate => candidate.id === "${datasetId}");
        if (!entry) throw new Error("Dataset fehlt im Katalog: ${datasetId}");
        const pkgUrl = "dist/dataset-repository/" + entry.downloadPath;
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
        const cityToSave = {
          ...pkg.city,
          boundary: pkg.city.boundary || pkg.boundary,
          package: pkg.package,
          version: pkg.package.version,
          contentHash: pkg.package.contentHash
        };
        await storage.saveCity(cityToSave, pkg.streets, pkg.pois, pkg.areas);
        await window.StrassentrainerRuntime.activateCity(cityToSave.id, { force: true });
        const runtimeCity = window.StrassentrainerRuntime.getActiveCity();

        return {
          valid: true,
          fetchMs: Number(fetchMs.toFixed(1)),
          streetCount: (pkg.streets || []).length,
          poiCount: (pkg.pois || []).length,
          cityId: pkg.city.id,
          cityName: pkg.city.name,
          runtimeCityId: runtimeCity && runtimeCity.id,
          runtimeCityName: runtimeCity && runtimeCity.name,
          version: cityToSave.package.version
        };
      })()`);

      if (installResult.runtimeCityId !== installResult.cityId || installResult.runtimeCityName !== expectedName) {
        throw new Error(`Runtime-Aktivierung fehlgeschlagen: ${JSON.stringify(installResult)}`);
      }
      console.log(`✓ ${expectedName} erfolgreich aus Repository geladen (${installResult.streetCount} Straßen, ${installResult.poiCount} POIs in ${installResult.fetchMs}ms)`);

      // Prüfe Gameplay
      const roundResult = await cdp.eval(`(async () => {
        const mainButton = document.getElementById("mainButton");
        if (!mainButton || mainButton.disabled) throw new Error("Spielstart-Button ist nicht bereit");
        mainButton.click();
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const state = window.STRASSENTRAINER_DEBUG.getGameState();
          if (state.status === "active" && state.currentRound && state.currentRound.target) {
            const mapElement = document.getElementById("map");
            mapElement.scrollIntoView({ block: "center", inline: "center" });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const mapRect = mapElement.getBoundingClientRect();
            return {
              status: state.status,
              question: document.getElementById("targetStreet").textContent.trim(),
              targetName: state.currentRound.target.name,
              mapCenter: {
                x: mapRect.left + mapRect.width / 2,
                y: mapRect.top + mapRect.height / 2
              }
            };
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("Freie Runde wurde nicht aktiv");
      })()`);

      if (!roundResult.question || roundResult.question !== roundResult.targetName) {
        throw new Error(`Ungültige Gameplay-Frage: ${JSON.stringify(roundResult)}`);
      }

      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: roundResult.mapCenter.x,
        y: roundResult.mapCenter.y,
        button: "left",
        clickCount: 1
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: roundResult.mapCenter.x,
        y: roundResult.mapCenter.y,
        button: "left",
        clickCount: 1
      });

      const playResult = await cdp.eval(`(async () => {
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const state = window.STRASSENTRAINER_DEBUG.getGameState();
          if (state.status === "answered") {
            return {
              status: state.status,
              score: document.getElementById("scoreValue").textContent.trim(),
              dist: document.getElementById("distanceValue").textContent.trim()
            };
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("Kartenklick wurde nicht ausgewertet");
      })()`);

      if (!playResult.score || playResult.score === "–" || !playResult.dist || playResult.dist === "–") {
        throw new Error(`Gameplay-Auswertung fehlt: ${JSON.stringify(playResult)}`);
      }

      console.log(`✓ Gameplay aktiv: Frage "${roundResult.question}" | Score: ${playResult.score} | Dist: ${playResult.dist}`);

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

    // Step D: Kreis Olpe über den normalen sichtbaren Benutzerpfad installieren.
    console.log("\n--- Installiere Kreis Olpe über Katalogdialog und immutable Publisher-URL ---");
    await cdp.eval(`document.getElementById("citySelectorButton").click()`);
    await new Promise(r => setTimeout(r, 250));
    await cdp.eval(`document.getElementById("addCityButton").click()`);
    await cdp.eval(`(() => {
      const input = document.getElementById("citySearchInput");
      input.value = "Kreis Olpe";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("citySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })()`);
    for (let i = 0; i < 100; i++) {
      const ready = await cdp.eval(`(() => {
        const results = document.getElementById("citySearchResults");
        return Boolean(results && results.querySelector('[data-city-id="de-nw-kreis-olpe"]'));
      })()`);
      if (ready) break;
      if (i === 99) throw new Error("Kreis Olpe wurde im Katalogdialog nicht gefunden");
      await new Promise(r => setTimeout(r, 100));
    }
    const districtSearch = await cdp.eval(`(() => {
      const results = document.getElementById("citySearchResults");
      const button = results.querySelector('[data-city-id="de-nw-kreis-olpe"]');
      const text = button && button.textContent.trim();
      if (button) button.click();
      return text;
    })()`);
    if (!districtSearch || !districtSearch.includes("Kreis Olpe") || !districtSearch.includes("Typ Landkreis")) {
      throw new Error(`District-Suchergebnis nicht eindeutig typisiert: ${districtSearch}`);
    }
    for (let i = 0; i < 100; i++) {
      const ready = await cdp.eval(`(() => {
        const button = document.getElementById("municipalityActionButton");
        return Boolean(button && !button.disabled);
      })()`);
      if (ready) break;
      if (i === 99) throw new Error("District-Downloadaktion wurde nicht bereit");
      await new Promise(r => setTimeout(r, 100));
    }
    await cdp.eval(`window.__districtLoadStartedAt = performance.now(); document.getElementById("municipalityActionButton").click()`);
    for (let i = 0; i < 200; i++) {
      const ready = await cdp.eval(`(() => {
        const panel = document.getElementById("cityValidationPanel");
        const button = document.getElementById("saveCityButton");
        return Boolean(panel && !panel.classList.contains("hidden") && button && !button.disabled);
      })()`);
      if (ready) break;
      if (i === 199) throw new Error("Kreis-Olpe-Paket wurde nicht valide heruntergeladen");
      await new Promise(r => setTimeout(r, 100));
    }
    await cdp.eval(`document.getElementById("saveCityButton").click()`);
    for (let i = 0; i < 200; i++) {
      const ready = await cdp.eval(`(() => {
        const panel = document.getElementById("cityCompletedPanel");
        return Boolean(panel && !panel.classList.contains("hidden"));
      })()`);
      if (ready) break;
      if (i === 199) throw new Error("Kreis-Olpe-Installation wurde nicht abgeschlossen");
      await new Promise(r => setTimeout(r, 100));
    }
    await cdp.eval(`document.getElementById("closeCompletedButton").click()`);
    const districtInstall = await cdp.eval(`(async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
      const active = await window.StrassentrainerCityStorage.getActiveCityData();
      return {
        activeName: document.getElementById("activeCityName").textContent.trim(),
        cityId: active && active.city && active.city.id,
        packageId: active && active.city && active.city.package && active.city.package.id,
        datasetKind: active && active.city && active.city.datasetKind,
        streets: active && active.streets ? active.streets.length : 0,
        pois: active && active.pois ? active.pois.length : 0,
        areas: active && active.areas ? active.areas.length : 0,
        districtLoadMs: performance.now() - window.__districtLoadStartedAt
      };
    })()`);
    if (districtInstall.activeName !== "Kreis Olpe"
      || districtInstall.cityId !== "osm-relation-1891506"
      || districtInstall.packageId !== "de-nw-kreis-olpe"
      || districtInstall.datasetKind !== "district"
      || districtInstall.streets < 1 || districtInstall.pois < 1 || districtInstall.areas !== 7) {
      throw new Error(`District-Installation/IndexedDB ungültig: ${JSON.stringify(districtInstall)}`);
    }
    const districtPackageRequests = networkRequests.filter(url => /\/data\/datasets\/de-nw-kreis-olpe\/[^/]+\/[0-9a-f]{64}\/package\.json$/.test(url));
    if (districtPackageRequests.length !== 1) {
      throw new Error(`Kreis Olpe wurde nicht exakt einmal über immutable URL geladen: ${JSON.stringify(districtPackageRequests)}`);
    }
    console.log(`✓ Normaler District-Installationspfad PASS: ${districtInstall.streets} Straßen, ${districtInstall.pois} POIs, 7 Gemeinden in ${districtInstall.districtLoadMs.toFixed(1)} ms`);

    const districtRound = await cdp.eval(`(async () => {
      document.getElementById("mainButton").click();
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "active" && state.currentRound && state.currentRound.target && state.currentRound.target.geometry) {
          const map = document.getElementById("map");
          map.scrollIntoView({ block: "center", inline: "center" });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = map.getBoundingClientRect();
          return { question: document.getElementById("targetStreet").textContent.trim(), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("District-Runde wurde nicht aktiv");
    })()`);
    if (!districtRound.question) throw new Error("District-Runde hat keine echte Frage");
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: districtRound.x, y: districtRound.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: districtRound.x, y: districtRound.y, button: "left", clickCount: 1 });
    const districtScore = await cdp.eval(`(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "answered" && state.currentRound && state.currentRound.result) return state.currentRound.result;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("District-Kartenklick wurde nicht ausgewertet");
    })()`);
    if (!Number.isFinite(districtScore.distanceMeters) || !Number.isFinite(districtScore.points)) {
      throw new Error(`District-Score ungültig: ${JSON.stringify(districtScore)}`);
    }
    console.log(`✓ District-Gameplay PASS: "${districtRound.question}", ${districtScore.distanceMeters.toFixed(1)} m, ${districtScore.points} Punkte`);

    if (phase17Only) {
      await cdp.eval(`window.StrassentrainerRuntime.activateTrainingArea("")`);
      await cdp.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0
      });
      await cdp.send("Page.reload");
      await new Promise(r => setTimeout(r, 1200));
      const offlineReady = await cdp.eval(`(async () => {
        await window.StrassentrainerRuntime.ready;
        const active = await window.StrassentrainerCityStorage.getActiveCityData();
        const area = window.StrassentrainerRuntime.getActiveTrainingArea();
        return { id: active?.city?.id, name: active?.city?.name, area };
      })()`);
      if (offlineReady.id !== "osm-relation-1891506" || offlineReady.name !== "Kreis Olpe" || offlineReady.area !== null) {
        throw new Error(`Whole-District wurde offline nicht aus IndexedDB geladen: ${JSON.stringify(offlineReady)}`);
      }
      networkRequests.length = 0;
      const offlineRound = await cdp.eval(`(async () => {
        document.getElementById("mainButton").click();
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const state = window.STRASSENTRAINER_DEBUG.getGameState();
          if (state.status === "active" && state.currentRound?.target?.geometry) {
            const map = document.getElementById("map");
            map.scrollIntoView({ block: "center", inline: "center" });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rect = map.getBoundingClientRect();
            return {
              question: document.getElementById("targetStreet").textContent.trim(),
              geometryValid: window.StrassentrainerTargets.isValidTargetGeometry(state.currentRound.target, window.StreetGeometry),
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("Offline-District-Runde wurde nicht aktiv");
      })()`);
      if (!offlineRound.question || !offlineRound.geometryValid) {
        throw new Error(`Offline-District-Frage ungültig: ${JSON.stringify(offlineRound)}`);
      }
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: offlineRound.x, y: offlineRound.y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: offlineRound.x, y: offlineRound.y, button: "left", clickCount: 1 });
      const offlineScore = await cdp.eval(`(async () => {
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const result = window.STRASSENTRAINER_DEBUG.getGameState().currentRound?.result;
          if (result) return result;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("Offline-District-Kartenklick wurde nicht ausgewertet");
      })()`);
      if (!Number.isFinite(offlineScore.distanceMeters) || !Number.isFinite(offlineScore.points)) {
        throw new Error(`Offline-District-Score ungültig: ${JSON.stringify(offlineScore)}`);
      }
      const offlineDataRequests = networkRequests.filter(url => url.includes("catalog.json") || url.includes("/data/datasets/") || url.includes("nominatim") || url.includes("overpass"));
      if (offlineDataRequests.length !== 0) {
        throw new Error(`Offline-District-Runde erzeugte Datenrequests: ${JSON.stringify(offlineDataRequests)}`);
      }
      console.log(`✓ Phase-17 Offline-District PASS: "${offlineRound.question}", ${offlineScore.distanceMeters.toFixed(1)} m, ${offlineScore.points} Punkte; 0 Datenrequests`);
      console.log("\n============================================================");
      console.log("✓ PHASE 17 BROWSER/INSTALLATION/OFFLINE PASS");
      console.log("============================================================");
      return;
    }

    // Phase 17.1: dieselbe In-Memory-TrainingArea-Engine für die amtlichen
    // Municipality Areas verwenden. Jede Runde wird über einen nativen CDP-
    // Kartenklick abgeschlossen; Membership und Geometrie werden fachlich geprüft.
    const wholeDuplicate = await cdp.eval(`(() => {
      const streets = window.STRASSENTRAINER_DEBUG.getTargets().streets;
      const duplicate = streets.find(target => target.areaIds.includes("osm-relation-163179") && target.displayName.includes(" · Olpe"));
      return duplicate ? { id: duplicate.id, displayName: duplicate.displayName, canonicalName: duplicate.canonicalName } : null;
    })()`);
    if (!wholeDuplicate || !wholeDuplicate.canonicalName || wholeDuplicate.displayName === wholeDuplicate.canonicalName) {
      throw new Error(`District Duplicate-Name-UX fehlt: ${JSON.stringify(wholeDuplicate)}`);
    }

    async function switchAreaAndPlay(areaId, expectedName) {
      const prepared = await cdp.eval(`(async () => {
        const startedAt = performance.now();
        const switched = window.StrassentrainerRuntime.activateTrainingArea("${areaId}");
        const switchMs = performance.now() - startedAt;
        if (!switched) throw new Error("TrainingArea-Wechsel fehlgeschlagen");
        const area = window.StrassentrainerRuntime.getActiveTrainingArea();
        const filterStartedAt = performance.now();
        const membership = window.StrassentrainerRuntime.getTrainingAreaMembership("${areaId}");
        const targetFilterMs = performance.now() - filterStartedAt;
        if (!area || !membership || membership.streets.length < 2 || membership.pois.length < 1) {
          throw new Error("TrainingArea besitzt keine plausiblen Targets");
        }
        const allMembershipCorrect = [...membership.streets, ...membership.pois].every(target =>
          Array.isArray(target.areaIds) && target.areaIds.includes("${areaId}")
        );
        const allGeometryValid = [...membership.streets.slice(0, 20), ...membership.pois.slice(0, 20)].every(target =>
          window.StrassentrainerTargets.isValidTargetGeometry(target, window.StreetGeometry)
        );
        const localizedDuplicate = membership.streets.find(target => target.id === "${wholeDuplicate.id}");
        const questionStartedAt = performance.now();
        document.getElementById("mainButton").click();
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const state = window.STRASSENTRAINER_DEBUG.getGameState();
          if (state.status === "active" && state.currentRound && state.currentRound.target && state.currentRound.target.geometry) {
            const map = document.getElementById("map");
            map.scrollIntoView({ block: "center", inline: "center" });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rect = map.getBoundingClientRect();
            return {
              areaName: area.name,
              selectorValue: document.getElementById("trainingAreaSelect").value,
              streetCount: membership.streets.length,
              poiCount: membership.pois.length,
              allMembershipCorrect,
              allGeometryValid,
              localizedDuplicate: localizedDuplicate ? localizedDuplicate.displayName : null,
              question: document.getElementById("targetStreet").textContent.trim(),
              targetId: state.currentRound.target.id,
              targetBelongsToArea: [...membership.streets, ...membership.pois].some(target => target.id === state.currentRound.target.id),
              targetGeometryValid: window.StrassentrainerTargets.isValidTargetGeometry(state.currentRound.target, window.StreetGeometry),
              switchMs,
              targetFilterMs,
              timeToFirstQuestionMs: performance.now() - questionStartedAt,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("Municipality-Runde wurde nicht aktiv");
      })()`);
      if (prepared.areaName !== expectedName || prepared.selectorValue !== areaId
        || !prepared.question || !prepared.targetId || !prepared.targetGeometryValid
        || !prepared.allMembershipCorrect || !prepared.allGeometryValid
        || !prepared.targetBelongsToArea) {
        throw new Error(`Municipality-Targetprüfung fehlgeschlagen: ${JSON.stringify(prepared)}`);
      }
      if (expectedName === "Olpe" && prepared.localizedDuplicate !== wholeDuplicate.canonicalName) {
        throw new Error(`Duplicate Name wurde im Olpe-Modus nicht lokalisiert: ${JSON.stringify(prepared)}`);
      }
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: prepared.x, y: prepared.y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: prepared.x, y: prepared.y, button: "left", clickCount: 1 });
      const result = await cdp.eval(`(async () => {
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const state = window.STRASSENTRAINER_DEBUG.getGameState();
          if (state.status === "answered" && state.currentRound && state.currentRound.result) {
            return { ...state.currentRound.result, rounds: window.STRASSENTRAINER_DEBUG.getStatistics().overall.roundsEvaluated };
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("Municipality-Kartenklick wurde nicht ausgewertet");
      })()`);
      if (!Number.isFinite(result.distanceMeters) || !Number.isFinite(result.points)) {
        throw new Error(`Municipality-Score ungültig: ${JSON.stringify(result)}`);
      }
      console.log(`✓ ${expectedName}-Modus PASS: ${prepared.streetCount} Straßen, ${prepared.poiCount} POIs, "${prepared.question}", ${result.distanceMeters.toFixed(1)} m, ${result.points} Punkte (Switch ${prepared.switchMs.toFixed(1)} ms, Filter ${prepared.targetFilterMs.toFixed(1)} ms, erste Frage ${prepared.timeToFirstQuestionMs.toFixed(1)} ms)`);
      return { prepared, result };
    }

    const statsBeforeAreaSwitches = await cdp.eval(`window.STRASSENTRAINER_DEBUG.getStatistics().overall.roundsEvaluated`);
    await switchAreaAndPlay("osm-relation-163179", "Olpe");
    await switchAreaAndPlay("osm-relation-160880", "Wenden");
    await switchAreaAndPlay("osm-relation-163178", "Attendorn");

    const wholeAfterSwitch = await cdp.eval(`(async () => {
      const switched = window.StrassentrainerRuntime.activateTrainingArea("");
      const label = document.getElementById("trainingAreaSelect").options[0].textContent.trim();
      document.getElementById("mainButton").click();
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "active" && state.currentRound && state.currentRound.target && state.currentRound.target.geometry) {
          const map = document.getElementById("map");
          map.scrollIntoView({ block: "center", inline: "center" });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = map.getBoundingClientRect();
          return { switched, label, activeArea: window.StrassentrainerRuntime.getActiveTrainingArea(), question: document.getElementById("targetStreet").textContent.trim(), geometryValid: window.StrassentrainerTargets.isValidTargetGeometry(state.currentRound.target, window.StreetGeometry), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Whole-District-Runde wurde nicht aktiv");
    })()`);
    if (!wholeAfterSwitch.switched || wholeAfterSwitch.label !== "Gesamter Kreis Olpe" || wholeAfterSwitch.activeArea !== null || !wholeAfterSwitch.question || !wholeAfterSwitch.geometryValid) {
      throw new Error(`Whole-District-Modus ungültig: ${JSON.stringify(wholeAfterSwitch)}`);
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: wholeAfterSwitch.x, y: wholeAfterSwitch.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: wholeAfterSwitch.x, y: wholeAfterSwitch.y, button: "left", clickCount: 1 });
    const wholeScore = await cdp.eval(`(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "answered" && state.currentRound && state.currentRound.result) return state.currentRound.result;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Whole-District-Kartenklick wurde nicht ausgewertet");
    })()`);
    if (!Number.isFinite(wholeScore.distanceMeters) || !Number.isFinite(wholeScore.points)) throw new Error("Whole-District-Score ungültig");

    const statsAfterAreaSwitches = await cdp.eval(`window.STRASSENTRAINER_DEBUG.getStatistics().overall.roundsEvaluated`);
    if (statsAfterAreaSwitches < statsBeforeAreaSwitches + 4) {
      throw new Error(`Datasetstatistik ging beim Area-Wechsel verloren: ${statsBeforeAreaSwitches} -> ${statsAfterAreaSwitches}`);
    }
    console.log(`✓ Switching-Matrix PASS: Whole → Olpe → Wenden → Attendorn → Whole; Statistik ${statsBeforeAreaSwitches} → ${statsAfterAreaSwitches}`);

    // Online-Reload mit persistierter Municipality Area und echter Runde.
    await cdp.eval(`window.StrassentrainerRuntime.activateTrainingArea("osm-relation-163179")`);
    await cdp.send("Page.reload");
    await new Promise(r => setTimeout(r, 1200));
    const reloadedArea = await cdp.eval(`(async () => {
      await window.StrassentrainerRuntime.ready;
      const area = window.StrassentrainerRuntime.getActiveTrainingArea();
      return area ? { id: area.id, name: area.name, selectorValue: document.getElementById("trainingAreaSelect").value } : null;
    })()`);
    if (!reloadedArea || reloadedArea.id !== "osm-relation-163179" || reloadedArea.selectorValue !== reloadedArea.id) {
      throw new Error(`Aktive Municipality wurde nach Reload nicht wiederhergestellt: ${JSON.stringify(reloadedArea)}`);
    }
    await switchAreaAndPlay("osm-relation-163179", "Olpe");
    console.log("✓ Online Reload mit aktiver Municipality Olpe PASS");

    // Step E: Offline-Test mit dem installierten District und persistierter Olpe Area.
    console.log("\n--- Teste District/Olpe Offline-Fähigkeit (Netzwerk trennen, Reload, Spielen) ---");
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

    const offlineReady = await cdp.eval(`(async () => {
      await window.StrassentrainerRuntime.ready;
      const active = await window.StrassentrainerCityStorage.getActiveCityData();
      const area = window.StrassentrainerRuntime.getActiveTrainingArea();
      return { id: active && active.city && active.city.id, name: active && active.city && active.city.name, areaId: area && area.id, areaName: area && area.name };
    })()`);
    if (offlineReady.id !== "osm-relation-1891506" || offlineReady.name !== "Kreis Olpe"
      || offlineReady.areaId !== "osm-relation-163179" || offlineReady.areaName !== "Olpe") {
      throw new Error(`District wurde offline nicht aus IndexedDB geladen: ${JSON.stringify(offlineReady)}`);
    }
    networkRequests.length = 0;

    const offlinePlayResult = await cdp.eval(`(async () => {
      const storage = window.StrassentrainerCityStorage;
      const activeCity = await storage.getActiveCityData();
      if (!activeCity || !activeCity.city) {
        throw new Error("Keine aktive Stadt im Offline-Speicher gefunden");
      }

      // Starte Runde offline
      const mainButton = document.getElementById("mainButton");
      if (!mainButton || mainButton.disabled) throw new Error("Offline-Spielstart ist nicht bereit");
      mainButton.click();
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "active" && state.currentRound && state.currentRound.target) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const state = window.STRASSENTRAINER_DEBUG.getGameState();
      if (state.status !== "active" || !state.currentRound || !state.currentRound.target) {
        throw new Error("Offline-Runde wurde nicht aktiv");
      }
      const map = document.getElementById("map");
      map.scrollIntoView({ block: "center", inline: "center" });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = map.getBoundingClientRect();
      const membership = window.StrassentrainerRuntime.getTrainingAreaMembership("osm-relation-163179");
      return {
        offlineActiveCity: activeCity.city.name,
        question: document.getElementById("targetStreet").textContent.trim(),
        streetsCount: activeCity.streets?.length || 0,
        targetGeometry: Boolean(state.currentRound.target.geometry),
        targetBelongsToOlpe: [...membership.streets, ...membership.pois].some(target => target.id === state.currentRound.target.id),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    })()`);

    console.log(`✓ Offline Reload PASS: Aktive Stadt "${offlinePlayResult.offlineActiveCity}" mit ${offlinePlayResult.streetsCount} Straßen aus IndexedDB geladen.`);
    console.log(`✓ Offline Frage: "${offlinePlayResult.question}"`);
    if (offlinePlayResult.offlineActiveCity !== "Kreis Olpe" || !offlinePlayResult.question || !offlinePlayResult.targetGeometry
      || !offlinePlayResult.targetBelongsToOlpe) {
      throw new Error(`Offline-Gameplay unvollständig: ${JSON.stringify(offlinePlayResult)}`);
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: offlinePlayResult.x, y: offlinePlayResult.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: offlinePlayResult.x, y: offlinePlayResult.y, button: "left", clickCount: 1 });
    const offlineScore = await cdp.eval(`(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "answered" && state.currentRound && state.currentRound.result) return state.currentRound.result;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Offline-Kartenklick wurde nicht ausgewertet");
    })()`);
    if (!Number.isFinite(offlineScore.distanceMeters) || !Number.isFinite(offlineScore.points)) {
      throw new Error(`Offline-Score ungültig: ${JSON.stringify(offlineScore)}`);
    }
    const offlineDataRequests = networkRequests.filter(url => url.includes("catalog.json") || url.includes("/data/datasets/") || url.includes("nominatim") || url.includes("overpass"));
    if (offlineDataRequests.length !== 0) {
      throw new Error(`Offline-Runde erzeugte Daten-/Geocoder-Requests: ${JSON.stringify(offlineDataRequests)}`);
    }
    console.log(`✓ Offline District Score PASS: ${offlineScore.distanceMeters.toFixed(1)} m, ${offlineScore.points} Punkte; 0 Datenrequests`);

    // Netzwerk wiederherstellen
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
    console.log("Netzwerk wiederhergestellt (offline = false)");

    // Step F: Update-Test
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

      const localVersion = localWenden && (localWenden.package?.version || localWenden.version);
      const updateAvailable = updatedWenden && localVersion && updatedWenden.version !== localVersion;

      return {
        localVersion: localVersion || null,
        remoteVersion: updatedWenden ? updatedWenden.version : null,
        updateAvailable: Boolean(updateAvailable)
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
