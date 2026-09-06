"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9335;
const USER_DATA_DIR = `/tmp/chrome-smoke-phase-15-7-${Date.now()}`;

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

  async waitForFunction(fnStr, maxMs = 25000, intervalMs = 200) {
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

async function installAndPlayCity(cdp, cityName, expectedCounts = null) {
  console.log(`\n--- Teste Installation & Gameplay für "${cityName}" ---`);

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

  // 3. Nach Stadt suchen
  console.log(`Suche im Katalog nach "${cityName}"...`);
  await cdp.eval(`(() => {
    const input = document.getElementById("citySearchInput");
    input.value = ${JSON.stringify(cityName)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("citySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  })()`);

  // 4. Warte auf Suchergebnis
  await cdp.waitForFunction(`() => {
    const results = document.getElementById("citySearchResults");
    return results && results.children.length > 0 && results.textContent.includes(${JSON.stringify(cityName)});
  }`);
  console.log(`✓ "${cityName}" in den Suchergebnissen gefunden.`);

  // 5. Stadt auswählen
  console.log(`Wähle ${cityName} aus...`);
  await cdp.eval(`(() => {
    const results = document.getElementById("citySearchResults");
    const firstBtn = results.querySelector(".city-search-result");
    if (firstBtn) firstBtn.click();
  })()`);

  await cdp.waitForFunction(`() => {
    const name = document.getElementById("selectedMunicipalityName");
    const btn = document.getElementById("municipalityActionButton");
    return name && name.textContent.includes(${JSON.stringify(cityName)}) && btn && !btn.disabled;
  }`);
  const buttonText = await cdp.eval(`document.getElementById("municipalityActionButton").textContent.trim()`);
  console.log(`✓ ${cityName} ausgewählt. Aktionsbutton: "${buttonText}"`);

  // 6. Download starten
  console.log("Starte Download und Integritätsprüfung...");
  await cdp.eval(`document.getElementById("municipalityActionButton").click()`);

  // 7. Warte auf Validierungsergebnis (große Städte wie Köln können 5-10s brauchen)
  await cdp.waitForFunction(`() => {
    const saveBtn = document.getElementById("saveCityButton");
    const outcome = document.getElementById("cityValidationOutcome");
    return saveBtn && !saveBtn.disabled && outcome && outcome.textContent.length > 0;
  }`, 35000);

  const streetCount = await cdp.eval(`document.getElementById("previewStreetCount").textContent.trim()`);
  const poiCount = await cdp.eval(`document.getElementById("previewPoiCount").textContent.trim()`);
  console.log(`✓ Validierung erfolgreich: ${streetCount} Straßen, ${poiCount} POIs.`);

  if (expectedCounts) {
    if (expectedCounts.streets !== undefined && Number(streetCount) !== expectedCounts.streets) {
      throw new Error(`Unerwartete Straßenzahl für ${cityName}: erwartet ${expectedCounts.streets}, erhalten ${streetCount}`);
    }
    if (expectedCounts.pois !== undefined && Number(poiCount) !== expectedCounts.pois) {
      throw new Error(`Unerwartete POI-Zahl für ${cityName}: erwartet ${expectedCounts.pois}, erhalten ${poiCount}`);
    }
  }

  // 8. Speichern
  console.log(`Speichere ${cityName} in IndexedDB...`);
  await cdp.eval(`document.getElementById("saveCityButton").click()`);

  // 9. Warte auf Completed-Panel
  await cdp.waitForFunction(`() => {
    const completedPanel = document.getElementById("cityCompletedPanel");
    return completedPanel && !completedPanel.classList.contains("hidden");
  }`, 25000);
  console.log(`✓ ${cityName} erfolgreich in IndexedDB gespeichert.`);

  // 10. Schließe Modal
  await cdp.eval(`(() => {
    const closeBtn = document.getElementById("closeCompletedButton");
    if (closeBtn) closeBtn.click();
  })()`);
  await delay(500);

  // 11. Prüfe aktive Stadt im Header
  const activeCity = await cdp.eval(`document.getElementById("activeCityName").textContent.trim()`);
  console.log(`Aktive Stadt in der Topbar: "${activeCity}"`);
  if (!activeCity.includes(cityName)) {
    throw new Error(`Erwartete aktive Stadt "${cityName}", erhalten: "${activeCity}"`);
  }
  console.log(`✓ ${cityName} ist nun die aktive Stadt.`);

  // 12. Starte freie Spielrunde
  console.log(`Starte freie Trainingsrunde mit ${cityName}...`);
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
  console.log(`Aktuelles Rundenziel in ${cityName}: "${roundTargetName}"`);
  if (!roundTargetName) {
    throw new Error(`Kein Rundenziel für ${cityName} generiert!`);
  }
  console.log(`✓ Freie Runde in ${cityName} erfolgreich gestartet.`);

  // Stoppe die Runde sauber für den nächsten Test
  await cdp.eval(`(() => {
    const btn = document.getElementById("mainButton");
    if (btn && btn.textContent.includes("Abbrechen")) btn.click();
  })()`);
  await delay(300);
}

async function runOfflineSmokeTest(cdp, port) {
  console.log("\n===============================================================");
  console.log("=== STARTE P15-BASELINE-OFFLINE-SMOKE ===");
  console.log("===============================================================");

  // 1. Olpe online installieren (falls noch nicht aktiv)
  const currentActive = await cdp.eval(`document.getElementById("activeCityName")?.textContent.trim() || ""`);
  if (!currentActive.includes("Olpe")) {
    await installAndPlayCity(cdp, "Olpe", { streets: 461, pois: 114 });
  }

  // 2. Warte auf ServiceWorker-Registrierung und Vorbereitung
  console.log("Warte auf aktiven Service Worker...");
  await cdp.waitForFunction(`() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === "activated")`, 15000);
  await delay(1000);

  // 3. Emuliere vollständige Offline-Bedingung über Chrome DevTools Protocol
  console.log("Setze Netzwerk über Chrome DevTools Protocol auf OFFLINE...");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0
  });

  // 4. Seite neu laden im Offline-Modus
  console.log("Führe Seiten-Reload im Offline-Modus durch...");
  let loadFired = false;
  cdp.on("Page.loadEventFired", () => { loadFired = true; });
  await cdp.send("Page.reload");

  const reloadStart = Date.now();
  while (!loadFired && Date.now() - reloadStart < 15000) {
    await delay(100);
  }

  // 5. Warte auf Initialisierung der App aus Cache + IndexedDB
  console.log("Warte auf Initialisierung aus lokalem Cache und IndexedDB...");
  await cdp.waitForFunction(`() => {
    return Boolean(window.StrassentrainerRuntime
      && typeof window.StrassentrainerRuntime.getActiveCity === "function"
      && window.StrassentrainerRuntime.getActiveCity()
      && document.getElementById("mainButton")
      && !document.getElementById("mainButton").disabled
      && document.getElementById("activeCityName")
      && !document.getElementById("activeCityName").textContent.includes("Keine Stadt"));
  }`, 25000);
  console.log("✓ Anwendung offline erfolgreich aus Cache initialisiert.");

  // 6. Verifiziere aktive Stadt ist weiterhin Olpe
  const activeCityOffline = await cdp.eval(`document.getElementById("activeCityName")?.textContent.trim() || ""`);
  console.log(`Aktive Stadt nach Offline-Reload: "${activeCityOffline}"`);
  if (!activeCityOffline.includes("Olpe")) {
    throw new Error(`Offline-Reload verlor aktive Stadt! Erhalten: "${activeCityOffline}"`);
  }
  console.log("✓ Olpe erfolgreich aus IndexedDB wiederhergestellt.");

  // 7. Starte freie Runde im Offline-Modus
  console.log("Starte freie Trainingsrunde offline...");
  await cdp.eval(`document.getElementById("mainButton").click()`);
  await delay(500);

  const targetOffline = await cdp.eval(`(() => {
    const el = document.getElementById("targetStreet");
    return el ? el.textContent.trim() : "";
  })()`);
  console.log(`Offline-Rundenziel in Olpe: "${targetOffline}"`);
  if (!targetOffline) {
    throw new Error("Offline-Runde konnte kein Ziel generieren!");
  }

  // Stoppe Runde
  await cdp.eval(`(() => {
    const btn = document.getElementById("mainButton");
    if (btn && btn.textContent.includes("Abbrechen")) btn.click();
  })()`);

  // Stelle Online-Status wieder her
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  });

  console.log("===============================================================");
  console.log("✓ P15-BASELINE-OFFLINE-SMOKE: VOLLSTÄNDIGER PASS!");
  console.log("===============================================================\n");
}

async function runSmokeTests() {
  const args = process.argv.slice(2);
  const runOffline = args.includes("--offline");
  const runAll = args.includes("--all") || args.length === 0;
  let targetCities = [];

  if (runAll) {
    targetCities = [
      { name: "Wenden", expected: { streets: 460, pois: 37 } },
      { name: "Siegen", expected: { streets: 1176, pois: 426 } },
      { name: "Köln", expected: { streets: 4628, pois: 4453 } }
    ];
  } else {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--city" && args[i + 1]) {
        targetCities.push({ name: args[++i], expected: null });
      } else if (!args[i].startsWith("--")) {
        targetCities.push({ name: args[i], expected: null });
      }
    }
  }

  console.log("=== Starte Phase 15.7 Browser Smoke Tests mit Headless Chrome ===");
  if (runOffline) {
    console.log("Modus: P15-BASELINE-OFFLINE-SMOKE");
  } else {
    console.log(`Zielstädte: ${targetCities.map(c => c.name).join(", ")}`);
  }

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

    // Führe Tests für jede Zielstadt durch
    for (const { name, expected } of targetCities) {
      await installAndPlayCity(cdp, name, expected);
    }

    // Führe Offline-Smoke durch falls angefordert oder bei Default
    if (runOffline) {
      await runOfflineSmokeTest(cdp, port);
    }

    // Netzwerk-Audit
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
    if (!runOffline && packageRequests === 0) {
      throw new Error("FEHLER: Es wurde keine Stadtpaket-Anfrage registriert!");
    }

    console.log("===============================================================");
    console.log("✓ ALLE BROWSER SMOKE TESTS ERFOLGREICH BESTANDEN!");
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

runSmokeTests().catch(err => {
  console.error("FATAL BROWSER SMOKE TEST ERROR:", err);
  process.exit(1);
});
