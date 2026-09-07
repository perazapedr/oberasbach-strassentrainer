"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { publishRepository } = require("../tools/dataset-publisher/index.js");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "tests", "fixtures", "update");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9334;
const USER_DATA_DIR = `/tmp/chrome-smoke-phase-15-6-${Date.now()}`;

async function buildImmutableUpdateRepository() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "strassentrainer-update-repository-"));
  const sourceDir = path.join(tempRoot, "source");
  const repositoryDir = path.join(tempRoot, "repository");
  fs.mkdirSync(sourceDir, { recursive: true });

  const sourcePackagePath = path.join(sourceDir, "olpe.json");
  fs.copyFileSync(path.join(FIXTURES_DIR, "olpe-v1.json"), sourcePackagePath);
  await publishRepository({ sourceDir, outputDir: repositoryDir, precompress: false });
  const catalogV1 = fs.readFileSync(path.join(repositoryDir, "catalog.json"));

  fs.copyFileSync(path.join(FIXTURES_DIR, "olpe-v2.json"), sourcePackagePath);
  await publishRepository({ sourceDir, outputDir: repositoryDir, precompress: false });
  const catalogV2 = fs.readFileSync(path.join(repositoryDir, "catalog.json"));

  const parsedV1 = JSON.parse(catalogV1.toString("utf8"));
  const parsedV2 = JSON.parse(catalogV2.toString("utf8"));
  const entryV1 = parsedV1.datasets[0];
  const entryV2 = parsedV2.datasets[0];
  if (!entryV1 || !entryV2 || entryV1.downloadPath === entryV2.downloadPath) {
    throw new Error("Publisher erzeugte keine unterschiedlichen immutable V1/V2-Pfade.");
  }
  if (!fs.existsSync(path.join(repositoryDir, entryV1.downloadPath))
    || !fs.existsSync(path.join(repositoryDir, entryV2.downloadPath))) {
    throw new Error("Publisher hat den alten oder neuen immutable Package-Stand nicht erhalten.");
  }

  return { tempRoot, repositoryDir, catalogV1, catalogV2, entryV1, entryV2 };
}

// MIME types for static server
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function startDynamicServer(serverState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url, "http://localhost");
        const pathname = decodeURIComponent(parsedUrl.pathname);

        // Dynamic routing for update testing
        if (pathname === "/data/catalog.json") {
          const catalogBytes = serverState.catalogVersion === "v2"
            ? serverState.repository.catalogV2
            : serverState.repository.catalogV1;
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-cache"
          });
          res.end(catalogBytes);
          return;
        }

        if (pathname.startsWith("/data/datasets/")) {
          const relativePath = pathname.slice("/data/".length);
          const artifactPath = path.resolve(serverState.repository.repositoryDir, relativePath);
          const relativeToRepository = path.relative(serverState.repository.repositoryDir, artifactPath);
          if (relativeToRepository.startsWith("..") || path.isAbsolute(relativeToRepository)
            || !fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable"
          });
          fs.createReadStream(artifactPath).pipe(res);
          return;
        }

        let filePath = path.join(ROOT, pathname);
        if (pathname === "/" || pathname === "") {
          filePath = path.join(ROOT, "index.html");
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-cache"
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Server Error: ${err.message}`);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForChrome(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (_) {}
    await delay(200);
  }
  throw new Error("Chrome DevTools Protocol not reachable within timeout.");
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.eventListeners = new Map();

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
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
    const msgId = ++this.id;
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
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || JSON.stringify(res.exceptionDetails);
      throw new Error(`Eval error: ${desc}`);
    }
    return res.result?.value;
  }

  async waitForFunction(fnStr, maxMs = 15000, intervalMs = 200) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const val = await this.eval(`(${fnStr})()`);
        if (val) return val;
      } catch (_) {}
      await delay(intervalMs);
    }
    throw new Error(`waitForFunction timed out after ${maxMs}ms: ${fnStr}`);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function runUpdateSmokeTest() {
  console.log("=== Starte Phase 15.6 Browser Update Smoke Test mit Headless Chrome ===");

  const repository = await buildImmutableUpdateRepository();
  const serverState = { catalogVersion: "v1", repository };
  console.log(`Immutable V1 URL: ${repository.entryV1.downloadPath}`);
  console.log(`Immutable V2 URL: ${repository.entryV2.downloadPath}`);
  const { server, port } = await startDynamicServer(serverState);
  console.log(`Lokaler HTTP-Server läuft auf Port ${port}`);

  let chromeProcess = null;
  let cdp = null;

  const capturedRequests = [];
  let nominatimCount = 0;
  let overpassCount = 0;
  let catalogRequests = 0;
  let packageRequests = 0;

  try {
    console.log("Starte Google Chrome Headless...");
    chromeProcess = spawn(CHROME_PATH, [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${USER_DATA_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-features=Translate",
      "about:blank"
    ], { stdio: "ignore" });

    await waitForChrome(DEBUG_PORT);
    console.log("Chrome DevTools Protocol bereit.");

    const newTabRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?http://127.0.0.1:${port}/index.html`, { method: "PUT" });
    const tabInfo = await newTabRes.json();
    console.log(`Tab geöffnet: ${tabInfo.webSocketDebuggerUrl}`);

    cdp = new CdpClient(tabInfo.webSocketDebuggerUrl);
    await cdp.ready;

    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    cdp.on("Runtime.consoleAPICalled", params => {
      const text = params.args.map(a => a.value !== undefined ? a.value : JSON.stringify(a)).join(" ");
      console.log(`[BROWSER ${params.type}] ${text}`);
    });

    cdp.on("Runtime.exceptionThrown", params => {
      console.error(`[BROWSER ERROR]`, params.exceptionDetails);
    });

    cdp.on("Network.requestWillBeSent", params => {
      const url = params.request.url;
      capturedRequests.push(url);
      if (url.includes("nominatim")) {
        nominatimCount++;
        console.warn(`[WARNUNG] Unerwarteter Nominatim-Aufruf: ${url}`);
      }
      if (url.includes("overpass") || url.includes("/api/interpreter")) {
        overpassCount++;
        console.warn(`[WARNUNG] Unerwarteter Overpass-Aufruf: ${url}`);
      }
      if (url.includes("catalog.json")) {
        catalogRequests++;
        console.log(`[NETZWERK] Katalog abgerufen: ${url}`);
      }
      if (url.includes("/data/datasets/") && url.endsWith("/package.json")) {
        packageRequests++;
        console.log(`[NETZWERK] Immutable Stadtpaket abgerufen: ${url}`);
      }
    });

    console.log("Warte auf Initialisierung der Anwendung...");
    await cdp.waitForFunction(`() => {
      const btn = document.getElementById("mainButton");
      return btn && !btn.disabled;
    }`, 15000);
    console.log("✓ Anwendung erfolgreich im Browser geladen.");

    // -----------------------------------------------------------------------
    // Schritt 1: Olpe V1 installieren
    // -----------------------------------------------------------------------
    console.log("\n[Schritt 1] Installiere Olpe V1 über Catalog...");
    await cdp.eval(`document.getElementById("citySelectorButton").click()`);
    await delay(300);

    await cdp.eval(`document.getElementById("addCityButton").click()`);
    await cdp.waitForFunction(`() => {
      const modal = document.getElementById("cityManagerModalOverlay");
      return modal && !modal.classList.contains("hidden");
    }`);

    await cdp.eval(`
      const input = document.getElementById("citySearchInput");
      input.value = "Olpe";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("citySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    `);

    await cdp.waitForFunction(`() => {
      const results = document.getElementById("citySearchResults");
      return results && results.children.length > 0 && results.textContent.includes("Olpe");
    }`);

    await cdp.eval(`
      const results = document.getElementById("citySearchResults");
      const firstBtn = results.querySelector(".city-search-result");
      if (firstBtn) firstBtn.click();
    `);

    await cdp.waitForFunction(`() => {
      const btn = document.getElementById("municipalityActionButton");
      return btn && !btn.disabled;
    }`);

    await cdp.eval(`document.getElementById("municipalityActionButton").click()`);

    await cdp.waitForFunction(`() => {
      const panel = document.getElementById("cityValidationPanel");
      const saveBtn = document.getElementById("saveCityButton");
      const outcome = document.getElementById("cityValidationOutcome");
      return panel && !panel.classList.contains("hidden") && saveBtn && !saveBtn.disabled && outcome && outcome.textContent.length > 0;
    }`, 20000);

    await cdp.eval(`document.getElementById("saveCityButton").click()`);

    await cdp.waitForFunction(`() => {
      const completedPanel = document.getElementById("cityCompletedPanel");
      return completedPanel && !completedPanel.classList.contains("hidden");
    }`);

    await cdp.eval(`
      const closeBtn = document.getElementById("closeCompletedButton");
      if (closeBtn) closeBtn.click();
    `);
    await delay(500);

    const activeCityV1 = await cdp.eval(`document.getElementById("activeCityName").textContent.trim()`);
    console.log(`✓ Olpe V1 aktiv: "${activeCityV1}"`);

    // Reale Statistik vor dem Update erzeugen: echte Runde + nativer CDP-Klick.
    const v1Round = await cdp.eval(`(async () => {
      document.getElementById("mainButton").click();
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "active" && state.currentRound && state.currentRound.target) {
          const mapElement = document.getElementById("map");
          mapElement.scrollIntoView({ block: "center", inline: "center" });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = mapElement.getBoundingClientRect();
          return {
            question: document.getElementById("targetStreet").textContent.trim(),
            target: state.currentRound.target,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("V1-Runde wurde nicht aktiv");
    })()`);
    if (!v1Round.question || !v1Round.target || !v1Round.target.geometry) {
      throw new Error(`V1-Runde ohne echte Frage/Geometrie: ${JSON.stringify(v1Round)}`);
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: v1Round.x, y: v1Round.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: v1Round.x, y: v1Round.y, button: "left", clickCount: 1 });
    const v1Result = await cdp.eval(`(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const state = window.STRASSENTRAINER_DEBUG.getGameState();
        if (state.status === "answered" && state.currentRound && state.currentRound.result) {
          return {
            distanceMeters: state.currentRound.result.distanceMeters,
            points: state.currentRound.result.points,
            roundsEvaluated: window.STRASSENTRAINER_DEBUG.getStatistics().overall.roundsEvaluated
          };
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Nativer V1-Kartenklick wurde nicht ausgewertet");
    })()`);
    if (!Number.isFinite(v1Result.distanceMeters) || !Number.isFinite(v1Result.points) || v1Result.roundsEvaluated < 1) {
      throw new Error(`V1-Statistik unvollständig: ${JSON.stringify(v1Result)}`);
    }
    console.log(`✓ Reale V1-Statistik erzeugt: ${v1Round.question}, ${v1Result.distanceMeters.toFixed(1)} m, ${v1Result.points} Punkte`);

    // -----------------------------------------------------------------------
    // Schritt 2: Auf Katalog V2 umschalten
    // -----------------------------------------------------------------------
    console.log("\n[Schritt 2] Schalte Server auf Katalog V2 um (Version 2026.09.06)...");
    serverState.catalogVersion = "v2";

    // -----------------------------------------------------------------------
    // Schritt 3: Update über UI auslösen
    // -----------------------------------------------------------------------
    console.log("\n[Schritt 3] Öffne Menü und starte Update-Prüfung...");
    await cdp.eval(`document.getElementById("citySelectorButton").click()`);
    await delay(400);

    const updateBtnExists = await cdp.eval(`(() => {
      const btns = document.querySelectorAll(".installed-city-update");
      return btns.length > 0;
    })()`);
    if (!updateBtnExists) {
      throw new Error("Kein Update-Button in der Liste der installierten Städte gefunden.");
    }

    await cdp.eval(`
      const updateBtn = document.querySelector('.installed-city-update[data-city-id="osm-relation-163179"]')
        || document.querySelector(".installed-city-update");
      if (updateBtn) updateBtn.click();
    `);

    // -----------------------------------------------------------------------
    // Schritt 4: Warte auf Diff-Vorschau
    // -----------------------------------------------------------------------
    console.log("Warte auf Diff-Vorschau und Validierung des Updates...");
    await cdp.waitForFunction(`() => {
      const outcome = document.getElementById("cityValidationOutcome");
      const saveBtn = document.getElementById("saveCityButton");
      return outcome && outcome.textContent.includes("Update für Olpe") && saveBtn && !saveBtn.disabled;
    }`, 20000);

    const outcomeText = await cdp.eval(`document.getElementById("cityValidationOutcome").textContent.trim()`);
    console.log(`Diff-Überschrift: "${outcomeText.split("\n")[0]}"`);
    if (!outcomeText.includes("2026.09.05 → 2026.09.06")) {
      throw new Error(`Erwartete Versionsänderung 2026.09.05 → 2026.09.06 nicht gefunden. Text: ${outcomeText}`);
    }

    const saveBtnLabel = await cdp.eval(`document.getElementById("saveCityButton").textContent.trim()`);
    console.log(`Aktionsbutton: "${saveBtnLabel}"`);
    if (saveBtnLabel !== "Update übernehmen") {
      throw new Error(`Erwartete Button-Beschriftung "Update übernehmen", erhalten: "${saveBtnLabel}"`);
    }

    // -----------------------------------------------------------------------
    // Schritt 5: Update übernehmen
    // -----------------------------------------------------------------------
    console.log("\n[Schritt 5] Klicke 'Update übernehmen'...");
    await cdp.eval(`document.getElementById("saveCityButton").click()`);

    await cdp.waitForFunction(`() => {
      const completedPanel = document.getElementById("cityCompletedPanel");
      const msg = document.getElementById("cityCompletedMessage");
      return completedPanel && !completedPanel.classList.contains("hidden") && msg && msg.textContent.includes("2026.09.06");
    }`, 20000);

    const completedMsg = await cdp.eval(`document.getElementById("cityCompletedMessage").textContent.trim()`);
    console.log(`✓ Abschlussmeldung: "${completedMsg}"`);

    await cdp.eval(`(() => {
      const closeBtn = document.getElementById("closeCompletedButton");
      if (closeBtn) closeBtn.click();
    })()`);
    await delay(500);

    // -----------------------------------------------------------------------
    // Schritt 6: Aktive Stadt nach Update prüfen
    // -----------------------------------------------------------------------
    const activeCityAfterUpdate = await cdp.eval(`document.getElementById("activeCityName").textContent.trim()`);
    console.log(`Aktive Stadt nach Update: "${activeCityAfterUpdate}"`);
    if (!activeCityAfterUpdate.includes("Olpe")) {
      throw new Error(`Olpe muss aktiv bleiben, gefunden: "${activeCityAfterUpdate}"`);
    }

    const persistedUpdate = await cdp.eval(`(async () => {
      const storage = window.StrassentrainerCityStorage;
      const city = await storage.getCity("osm-relation-163179");
      const streets = await storage.getCityStreets("osm-relation-163179");
      const pois = await storage.getCityPois("osm-relation-163179");
      return {
        version: city && city.package && city.package.version,
        contentHash: city && city.package && city.package.contentHash,
        hasNewStreet: streets.some(street => street.name === "Neue Teststraße"),
        hasRemovedStreet: streets.some(street => street.name === "Zur Wolfsschlade"),
        hasNewPoi: pois.some(poi => poi.name === "Neue Test-Feuerwache"),
        hasRemovedPoi: pois.some(poi => poi.name === "Polizei"),
        roundsEvaluated: window.STRASSENTRAINER_DEBUG.getStatistics().overall.roundsEvaluated
      };
    })()`);
    if (persistedUpdate.version !== "2026.09.06"
      || persistedUpdate.contentHash !== "sha256:c2b7ba6baf4eb3d42832bef02ab795fabdd327c347e8e3515df0bba9368e871a"
      || !persistedUpdate.hasNewStreet || persistedUpdate.hasRemovedStreet
      || !persistedUpdate.hasNewPoi || persistedUpdate.hasRemovedPoi
      || persistedUpdate.roundsEvaluated !== v1Result.roundsEvaluated) {
      throw new Error(`V2-Persistenz/Statistikerhalt fehlgeschlagen: ${JSON.stringify(persistedUpdate)}`);
    }
    console.log(`✓ V2 in IndexedDB verifiziert; Hash gespeichert; V1-Statistik (${persistedUpdate.roundsEvaluated} Runde) erhalten`);

    // -----------------------------------------------------------------------
    // Schritt 7: Freie Runde starten
    // -----------------------------------------------------------------------
    console.log("\n[Schritt 7] Starte freie Spielrunde nach Update...");
    await cdp.waitForFunction(`() => {
      const mainBtn = document.getElementById("mainButton");
      return mainBtn && !mainBtn.disabled;
    }`);
    await cdp.eval(`document.getElementById("mainButton").click()`);
    await delay(500);

    const roundTargetName = await cdp.eval(`(() => {
      const el = document.getElementById("targetStreet");
      return el ? el.textContent.trim() : "";
    })()`);
    console.log(`✓ Aktives Rundenziel in Olpe (V2): "${roundTargetName}"`);

    // -----------------------------------------------------------------------
    // Schritt 8: Erneute Update-Prüfung liefert 'Keine Aktualisierung erforderlich'
    // -----------------------------------------------------------------------
    console.log("\n[Schritt 8] Erneute Prüfung auf Aktualisierung...");
    await cdp.eval(`document.getElementById("citySelectorButton").click()`);
    await delay(400);

    await cdp.eval(`(() => {
      const updateBtn = document.querySelector('.installed-city-update[data-city-id="osm-relation-163179"]')
        || document.querySelector(".installed-city-update");
      if (updateBtn) updateBtn.click();
    })()`);

    await cdp.waitForFunction(`() => {
      const outcome = document.getElementById("cityValidationOutcome");
      return outcome && outcome.textContent.includes("Keine Aktualisierung erforderlich");
    }`, 15000);
    console.log("✓ Erneute Prüfung zeigt korrekt: 'Keine Aktualisierung erforderlich'");

    await cdp.eval(`(() => {
      const cancelBtn = document.getElementById("cancelValidationButton");
      if (cancelBtn) cancelBtn.click();
    })()`);
    await delay(300);

    // -----------------------------------------------------------------------
    // Schritt 9: Netzwerk-Audit Verifikation
    // -----------------------------------------------------------------------
    console.log("\n================ NETZWERK-AUDIT ================");
    console.log(`Gesamtzahl HTTP-Anfragen:   ${capturedRequests.length}`);
    console.log(`Nominatim-Anfragen:         ${nominatimCount}`);
    console.log(`Overpass-Anfragen:          ${overpassCount}`);
    console.log(`Katalog-Anfragen:           ${catalogRequests}`);
    console.log(`Stadtpaket-Anfragen:        ${packageRequests}`);
    console.log("================================================\n");

    if (nominatimCount !== 0) {
      throw new Error(`FEHLER: Nominatim-Anfragen gefunden (${nominatimCount})!`);
    }
    if (overpassCount !== 0) {
      throw new Error(`FEHLER: Overpass-Anfragen gefunden (${overpassCount})!`);
    }
    if (catalogRequests < 2) {
      throw new Error(`FEHLER: Zu wenige Katalog-Anfragen (${catalogRequests})! Erwartet >= 2`);
    }
    if (packageRequests < 2) {
      throw new Error(`FEHLER: Zu wenige Paket-Anfragen (${packageRequests})! Erwartet >= 2 (V1 und V2)`);
    }
    const requestedV1 = capturedRequests.some(url => url.endsWith(`/data/${repository.entryV1.downloadPath}`));
    const requestedV2 = capturedRequests.some(url => url.endsWith(`/data/${repository.entryV2.downloadPath}`));
    if (!requestedV1 || !requestedV2) {
      throw new Error("V1 und V2 müssen über verschiedene Package-URLs geladen worden sein.");
    }

    console.log("===============================================================");
    console.log("✓ BROWSER UPDATE SMOKE TEST ERFOLGREICH BESTANDEN!");
    console.log("✓ 100% OVERPASS-FREI: Nominatim = 0, Overpass = 0");
    console.log("✓ V1 -> V2 UPDATE VOLLSTÄNDIG IM BROWSER DURCHGEFÜHRT");
    console.log("===============================================================");
  } finally {
    if (cdp) cdp.close();
    if (chromeProcess) {
      chromeProcess.kill("SIGKILL");
    }
    server.close();
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch (_) {}
    try {
      fs.rmSync(repository.tempRoot, { recursive: true, force: true });
    } catch (_) {}
  }
}

runUpdateSmokeTest().catch(err => {
  console.error("FATAL BROWSER UPDATE SMOKE TEST ERROR:", err);
  process.exit(1);
});
