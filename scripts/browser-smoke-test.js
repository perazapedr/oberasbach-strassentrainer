"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9333;
const USER_DATA_DIR = `/tmp/chrome-smoke-phase-15-5-${Date.now()}`;

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

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url, "http://localhost");
        let filePath = path.join(ROOT, decodeURIComponent(parsedUrl.pathname));
        if (parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
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

async function runSmokeTest() {
  console.log("=== Starte Phase 15.5 Browser Smoke Test mit Headless Chrome ===");

  const { server, port } = await startStaticServer();
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
      if (url.includes("data/cities/")) {
        packageRequests++;
        console.log(`[NETZWERK] Stadtpaket abgerufen: ${url}`);
      }
    });

    console.log("Warte auf Initialisierung der Anwendung...");
    await cdp.waitForFunction(`() => {
      const btn = document.getElementById("mainButton");
      return btn && !btn.disabled;
    }`, 15000);
    console.log("✓ Anwendung erfolgreich im Browser geladen.");

    // 1. City Selector öffnen
    console.log("Öffne City-Selector-Menü...");
    await cdp.eval(`document.getElementById("citySelectorButton").click()`);
    await delay(300);

    // 2. Klick auf 'Neue Stadt hinzufügen'
    console.log("Klicke auf 'Neue Stadt hinzufügen'...");
    await cdp.eval(`document.getElementById("addCityButton").click()`);
    await cdp.waitForFunction(`() => {
      const modal = document.getElementById("cityManagerModalOverlay");
      return modal && !modal.classList.contains("hidden");
    }`);
    console.log("✓ City-Manager-Dialog geöffnet.");

    // 3. Nach 'Olpe' suchen
    console.log("Suche im Katalog nach 'Olpe'...");
    await cdp.eval(`
      const input = document.getElementById("citySearchInput");
      input.value = "Olpe";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("citySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    `);

    // 4. Warte auf Suchergebnis
    await cdp.waitForFunction(`() => {
      const results = document.getElementById("citySearchResults");
      return results && results.children.length > 0 && results.textContent.includes("Olpe");
    }`);
    console.log("✓ 'Olpe' in den Suchergebnissen gefunden.");

    // 5. Olpe auswählen
    console.log("Wähle Olpe aus...");
    await cdp.eval(`
      const results = document.getElementById("citySearchResults");
      const firstBtn = results.querySelector(".city-search-result");
      if (firstBtn) firstBtn.click();
    `);

    await cdp.waitForFunction(`() => {
      const name = document.getElementById("selectedMunicipalityName");
      const btn = document.getElementById("municipalityActionButton");
      return name && name.textContent.includes("Olpe") && btn && !btn.disabled;
    }`);
    const buttonText = await cdp.eval(`document.getElementById("municipalityActionButton").textContent.trim()`);
    console.log(`✓ Olpe ausgewählt. Aktionsbutton: "${buttonText}"`);

    // 6. Download starten
    console.log("Starte Download und Integritätsprüfung...");
    await cdp.eval(`document.getElementById("municipalityActionButton").click()`);

    // 7. Warte auf Validierungsergebnis
    await cdp.waitForFunction(`() => {
      const saveBtn = document.getElementById("saveCityButton");
      const outcome = document.getElementById("cityValidationOutcome");
      return saveBtn && !saveBtn.disabled && outcome && outcome.textContent.length > 0;
    }`, 20000);

    const streetCount = await cdp.eval(`document.getElementById("previewStreetCount").textContent.trim()`);
    const poiCount = await cdp.eval(`document.getElementById("previewPoiCount").textContent.trim()`);
    console.log(`✓ Validierung erfolgreich: ${streetCount} Straßen, ${poiCount} POIs.`);

    // 8. Speichern
    console.log("Speichere Stadt in IndexedDB...");
    await cdp.eval(`document.getElementById("saveCityButton").click()`);

    // 9. Warte auf Completed-Panel
    await cdp.waitForFunction(`() => {
      const completedPanel = document.getElementById("cityCompletedPanel");
      return completedPanel && !completedPanel.classList.contains("hidden");
    }`);
    console.log("✓ Stadt erfolgreich gespeichert.");

    // 10. Schließe Modal
    await cdp.eval(`
      const closeBtn = document.getElementById("closeCompletedButton");
      if (closeBtn) closeBtn.click();
    `);
    await delay(500);

    // 11. Prüfe aktive Stadt im Header
    const activeCity = await cdp.eval(`document.getElementById("activeCityName").textContent.trim()`);
    console.log(`Aktive Stadt in der Topbar: "${activeCity}"`);
    if (!activeCity.includes("Olpe")) {
      throw new Error(`Erwartete aktive Stadt "Olpe", erhalten: "${activeCity}"`);
    }
    console.log("✓ Olpe ist nun die aktive Stadt.");

    // 12. Starte eine freie Spielrunde mit Olpe
    console.log("Starte freie Trainingsrunde mit Olpe...");
    await cdp.waitForFunction(`() => {
      const mainBtn = document.getElementById("mainButton");
      return mainBtn && !mainBtn.disabled;
    }`);
    const mainBtnText = await cdp.eval(`document.getElementById("mainButton").textContent.trim()`);
    console.log(`Main-Button Text vor Klick: "${mainBtnText}"`);

    await cdp.eval(`document.getElementById("mainButton").click()`);
    await delay(500);

    const roundTargetName = await cdp.eval(`(() => {
      const el = document.getElementById("targetStreet");
      return el ? el.textContent.trim() : "";
    })()`);
    console.log(`Aktuelles Rundenziel in Olpe: "${roundTargetName}"`);

    // 13. Verifiziere Netzwerk-Metriken
    console.log("\n--- NETZWERK-AUDIT ERGEBNIS ---");
    console.log(`Gesamtzahl HTTP-Anfragen:   ${capturedRequests.length}`);
    console.log(`Nominatim-Anfragen:         ${nominatimCount}`);
    console.log(`Overpass-Anfragen:          ${overpassCount}`);
    console.log(`Katalog-Anfragen:           ${catalogRequests}`);
    console.log(`Stadtpaket-Anfragen:        ${packageRequests}`);
    console.log("-------------------------------\n");

    if (nominatimCount !== 0) {
      throw new Error(`FEHLER: Nominatim-Anfragen gefunden (${nominatimCount})!`);
    }
    if (overpassCount !== 0) {
      throw new Error(`FEHLER: Overpass-Anfragen gefunden (${overpassCount})!`);
    }
    if (catalogRequests === 0) {
      throw new Error("FEHLER: Es wurde keine Katalog-Anfrage registriert!");
    }
    if (packageRequests === 0) {
      throw new Error("FEHLER: Es wurde keine Stadtpaket-Anfrage registriert!");
    }

    console.log("===============================================================");
    console.log("✓ BROWSER SMOKE TEST ERFOLGREICH BESTANDEN!");
    console.log("✓ 100% OVERPASS-FREI: Nominatim = 0, Overpass = 0");
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
  }
}

runSmokeTest().catch(err => {
  console.error("FATAL BROWSER SMOKE TEST ERROR:", err);
  process.exit(1);
});
