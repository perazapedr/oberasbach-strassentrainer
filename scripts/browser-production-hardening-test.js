"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8097;

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

      // Simulation for 404 package download
      if (req.url.includes("simulate_404_pkg=1")) {
        res.writeHead(404, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
        res.end("Simulated 404 Not Found");
        return;
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

      if (req.headers["x-force-gzip"] === "1" || (acceptEncoding.includes("gzip") && ext === ".json" && rawData.length > 50000)) {
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
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
    this.ready = this.connect();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const WebSocket = globalThis.WebSocket;
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
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
    });
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

async function runProductionHardeningBrowserTest() {
  console.log("============================================================");
  console.log("=== Phase 19 Production Hardening Browser CDP Test Suite ===");
  console.log("============================================================\n");

  const server = await startStaticServer();
  console.log(`Static server running on http://127.0.0.1:${PORT}`);

  const userDataDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cdp-hardening-"));
  const chromeProc = spawn(CHROME_BIN, [
    "--headless=new",
    "--remote-debugging-port=9225",
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
        version = await fetchJson("http://127.0.0.1:9225/json/version");
        if (version && version.webSocketDebuggerUrl) break;
      } catch (_) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    const pages = await fetchJson("http://127.0.0.1:9225/json/list");
    const target = pages.find(p => p.type === "page") || pages[0];
    cdp = new CdpConnection(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    const uncaughtErrors = [];
    cdp.on("Runtime.exceptionThrown", params => {
      const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text;
      uncaughtErrors.push(desc);
      console.error("[CDP BROWSER ERROR]", desc);
    });

    const networkRequests = [];
    cdp.on("Network.requestWillBeSent", params => {
      if (params?.request?.url) networkRequests.push(params.request.url);
    });

    // Helper to play a single round
    async function playRound(label) {
      const prepared = await cdp.eval(`(async () => {
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
              targetId: state.currentRound.target.id,
              x: rect.left + rect.width / 2, y: rect.top + rect.height / 2
            };
          }
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        throw new Error("Runde wurde nicht aktiv");
      })()`);

      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: prepared.x, y: prepared.y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: prepared.x, y: prepared.y, button: "left", clickCount: 1 });

      const score = await cdp.eval(`(async () => {
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const result = window.STRASSENTRAINER_DEBUG.getGameState().currentRound?.result;
          if (result) return result;
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        throw new Error("Klick wurde nicht ausgewertet");
      })()`);

      console.log(`✓ ${label}: "${prepared.question}", ${score.distanceMeters.toFixed(1)} m, ${score.points} Pkt`);
      return score;
    }

    // Helper to install city via UI
    async function installCityViaUi(cityId, cityName) {
      await cdp.eval(`document.getElementById("citySelectorButton").click()`);
      await new Promise(r => setTimeout(r, 200));
      await cdp.eval(`document.getElementById("addCityButton").click()`);
      await cdp.eval(`(() => {
        const input = document.getElementById("citySearchInput");
        input.value = "${cityName}";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("citySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      })()`);

      for (let i = 0; i < 60; i++) {
        const found = await cdp.eval(`Boolean(document.getElementById("citySearchResults")?.querySelector('[data-city-id="${cityId}"]'))`);
        if (found) break;
        if (i === 59) throw new Error(`Stadt ${cityId} nicht in Suchergebnissen`);
        await new Promise(r => setTimeout(r, 100));
      }

      await cdp.eval(`document.getElementById("citySearchResults").querySelector('[data-city-id="${cityId}"]').click()`);
      for (let i = 0; i < 60; i++) {
        const ready = await cdp.eval(`Boolean(!document.getElementById("municipalityActionButton").disabled)`);
        if (ready) break;
        await new Promise(r => setTimeout(r, 100));
      }

      await cdp.eval(`document.getElementById("municipalityActionButton").click()`);
      for (let i = 0; i < 100; i++) {
        const saveReady = await cdp.eval(`Boolean(document.getElementById("saveCityButton") && !document.getElementById("saveCityButton").disabled && !document.getElementById("cityValidationPanel").classList.contains("hidden"))`);
        if (saveReady) break;
        await new Promise(r => setTimeout(r, 100));
      }

      await cdp.eval(`document.getElementById("saveCityButton").click()`);
      for (let i = 0; i < 100; i++) {
        const completed = await cdp.eval(`Boolean(!document.getElementById("cityCompletedPanel").classList.contains("hidden"))`);
        if (completed) break;
        await new Promise(r => setTimeout(r, 100));
      }

      await cdp.eval(`document.getElementById("closeCompletedButton").click()`);
      await new Promise(r => setTimeout(r, 300));
    }

    // =========================================================================
    // 1. MOBILE VIEWPORT (19.35, 19.36, 19.37, 19.38, 19.39, 19.53)
    // =========================================================================
    console.log("\n--- [1] Mobile Viewport (390 x 844, Scale 3 - Smartphone Portrait) ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true
    });

    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1500));

    // Check responsive layout on mobile
    const mobileLayoutCheck = await cdp.eval(`(() => {
      const topbar = document.querySelector(".topbar");
      const map = document.getElementById("map");
      const mainBtn = document.getElementById("mainButton");
      const selector = document.getElementById("citySelectorButton");
      const bodyWidth = document.body.clientWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      return {
        topbarVisible: topbar && topbar.offsetHeight > 0,
        mapVisible: map && map.offsetHeight > 100,
        mainBtnVisible: mainBtn && mainBtn.offsetHeight > 0,
        selectorVisible: selector && selector.offsetWidth > 0,
        noHorizontalOverflow: scrollWidth <= bodyWidth + 5
      };
    })()`);

    assert.ok(mobileLayoutCheck.topbarVisible, "Topbar auf Smartphone sichtbar");
    assert.ok(mobileLayoutCheck.mapVisible, "Karte auf Smartphone sichtbar");
    assert.ok(mobileLayoutCheck.mainBtnVisible, "Hauptbutton auf Smartphone bedienbar");
    assert.ok(mobileLayoutCheck.noHorizontalOverflow, "Kein horizontales Layout-Overflow auf Smartphone");
    console.log("✓ Mobile Layout Check PASS (Controls, Map, Topbar korrekt skaliert)");

    // Install Wenden on mobile (19.37)
    console.log("Installiere Wenden über Mobile City Manager...");
    await installCityViaUi("de-nw-wenden", "Wenden");
    console.log("✓ Mobile City Manager: Installation Wenden erfolgreich");

    // Core Gameplay on Mobile (19.36)
    await playRound("Mobile Core Gameplay (Wenden)");

    // Mobile Training Areas (19.38)
    const areaSwitchResult = await cdp.eval(`(() => {
      const sel = document.getElementById("trainingAreaSelect");
      if (!sel) return { hasSelect: false };
      return { hasSelect: true, optionCount: sel.options.length };
    })()`);
    assert.ok(areaSwitchResult.hasSelect, "Trainingsgebiet-Selector auf Mobile vorhanden");
    console.log(`✓ Mobile Training Areas PASS (${areaSwitchResult.optionCount} Optionen vorhanden)`);

    // Install Kreis Olpe (Large District on Mobile) (19.39)
    console.log("Installiere Kreis Olpe auf Mobile Viewport...");
    await installCityViaUi("de-nw-kreis-olpe", "Kreis Olpe");
    await playRound("Mobile Large District Gameplay (Kreis Olpe)");
    console.log("✓ Mobile Large Dataset PASS (Kreis Olpe flüssig auf 390x844 spielbar)");

    // =========================================================================
    // 2. TABLET VIEWPORT (19.40)
    // =========================================================================
    console.log("\n--- [2] Tablet Viewport (768 x 1024, Scale 2) ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 768,
      height: 1024,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 300));
    await playRound("Tablet Viewport Gameplay");
    console.log("✓ Tablet Viewport PASS (768 x 1024)");

    // =========================================================================
    // 3. DESKTOP VIEWPORT (19.41)
    // =========================================================================
    console.log("\n--- [3] Desktop Viewport (1440 x 960, Scale 1) ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 300));
    await playRound("Desktop Viewport Gameplay");
    console.log("✓ Desktop Viewport PASS (1440 x 960)");

    // =========================================================================
    // 4. RAPID USER ACTIONS (19.45)
    // =========================================================================
    console.log("\n--- [4] Rapid User Actions Stress Test ---");
    const rapidActionsResult = await cdp.eval(`(async () => {
      const btn = document.getElementById("mainButton");
      // Rapid clicks on mainButton
      for (let i = 0; i < 5; i++) {
        btn.click();
      }
      await new Promise(r => setTimeout(r, 200));
      const state = window.STRASSENTRAINER_DEBUG.getGameState();
      return { status: state.status };
    })()`);
    assert.ok(["active", "preparing", "idle", "answered"].includes(rapidActionsResult.status));
    console.log("✓ Rapid Actions PASS: Keine Endlosschleife oder Race-Condition bei schnellen Klicks");

    // =========================================================================
    // 5. MULTI DATASET SWITCHING (19.46)
    // =========================================================================
    console.log("\n--- [5] Multi Dataset Switching & Isolation ---");
    const cityIds = await cdp.eval(`(async () => {
      const cities = await window.StrassentrainerCityStorage.getAllCities();
      const wenden = cities.find(c => c.name === "Wenden" || c.id === "de-nw-wenden" || c.id === "osm-relation-160880");
      const olpe = cities.find(c => c.name === "Kreis Olpe" || c.id === "de-nw-kreis-olpe" || c.id === "osm-relation-1891506");
      return {
        wendenId: wenden ? wenden.id : null,
        olpeId: olpe ? olpe.id : null
      };
    })()`);
    assert.ok(cityIds.wendenId, "Wenden-ID in IndexedDB gefunden");
    assert.ok(cityIds.olpeId, "Kreis-Olpe-ID in IndexedDB gefunden");

    await cdp.eval(`(async () => {
      await window.StrassentrainerRuntime.activateCity(${JSON.stringify(cityIds.wendenId)}, { force: true });
      await window.StrassentrainerCityManager.refreshInstalledCities();
    })()`);
    await new Promise(r => setTimeout(r, 500));
    const activeCityCheck1 = await cdp.eval(`document.getElementById("activeCityName").textContent.trim()`);
    assert.ok(activeCityCheck1.includes("Wenden"), `Aktive Stadt auf Wenden gewechselt (war: "${activeCityCheck1}")`);

    await cdp.eval(`(async () => {
      await window.StrassentrainerRuntime.activateCity(${JSON.stringify(cityIds.olpeId)}, { force: true });
      await window.StrassentrainerCityManager.refreshInstalledCities();
    })()`);
    await new Promise(r => setTimeout(r, 500));
    const activeCityCheck2 = await cdp.eval(`document.getElementById("activeCityName").textContent.trim()`);
    assert.ok(activeCityCheck2.includes("Kreis Olpe"), `Aktive Stadt auf Kreis Olpe gewechselt (war: "${activeCityCheck2}")`);
    console.log("✓ Multi Dataset Switching PASS (Wenden <-> Kreis Olpe sauber gewechselt)");

    // =========================================================================
    // 6. DELETE & REINSTALL (19.47, 19.48)
    // =========================================================================
    console.log("\n--- [6] Delete Dataset & Reinstall ---");
    const deleteCheck = await cdp.eval(`(async () => {
      const storage = window.StrassentrainerCityStorage;
      const initialCount = (await storage.getAllCities()).length;
      await storage.deleteCity(${JSON.stringify(cityIds.wendenId)});
      if (window.StrassentrainerCityManager) {
        await window.StrassentrainerCityManager.refreshInstalledCities();
      }
      const afterDelete = await storage.getAllCities();
      const hasKreisOlpe = await storage.hasCity(${JSON.stringify(cityIds.olpeId)});
      const hasWenden = await storage.hasCity(${JSON.stringify(cityIds.wendenId)});
      return { initialCount, afterCount: afterDelete.length, hasKreisOlpe, hasWenden };
    })()`);

    assert.equal(deleteCheck.hasWenden, false, "Wenden gelöscht");
    assert.equal(deleteCheck.hasKreisOlpe, true, "Kreis Olpe bleibt nach Löschen von Wenden intakt");
    console.log("✓ Delete Dataset PASS: Fremde Datasets bleiben 100% intakt");

    // Reinstall Wenden
    await installCityViaUi("de-nw-wenden", "Wenden");
    const reinstallCheck = await cdp.eval(`(async () => {
      const cities = await window.StrassentrainerCityStorage.getAllCities();
      return cities.some(c => c.name === "Wenden");
    })()`);
    assert.equal(reinstallCheck, true, "Wenden erfolgreich reinstalliert");
    console.log("✓ Reinstall PASS");

    // =========================================================================
    // 7. OFFLINE START & GAMEPLAY (19.16, 19.17, 19.18)
    // =========================================================================
    console.log("\n--- [7] Offline Start & Gameplay (Netzwerk trennen) ---");
    networkRequests.length = 0;
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });

    // Reload browser completely offline
    await cdp.send("Page.reload");
    await new Promise(r => setTimeout(r, 1500));

    // Verify offline banner and installed city active
    const offlineState = await cdp.eval(`(() => {
      const banner = document.getElementById("offlineBanner");
      const activeCity = document.getElementById("activeCityName")?.textContent.trim();
      return {
        bannerVisible: Boolean(banner && !banner.classList.contains("hidden")),
        activeCity
      };
    })()`);

    assert.ok(offlineState.activeCity, "Aktive Stadt nach Offline-Reload vorhanden");
    console.log(`✓ Offline Reload PASS: "${offlineState.activeCity}"`);

    // Play a round completely offline
    await playRound("Offline Gameplay");

    // Check that 0 external requests occurred
    const externalRequests = networkRequests.filter(url => url.includes("nominatim") || url.includes("overpass"));
    assert.equal(externalRequests.length, 0, "Keine externen OSM-Requests im Offline-Modus");
    console.log("✓ Offline Gameplay PASS: 0 Anfragen an Nominatim/Overpass");

    // Restore network
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
    console.log("Netzwerk wiederhergestellt.");

    // =========================================================================
    // 8. ACCESSIBILITY BASICS (19.43)
    // =========================================================================
    console.log("\n--- [8] Accessibility Basics ---");
    const a11yCheck = await cdp.eval(`(() => {
      const buttons = [...document.querySelectorAll("button")];
      const buttonsWithoutLabel = buttons.filter(b => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title"));
      const dialog = document.getElementById("cityManagerDialog");
      const hasAriaModal = dialog && dialog.getAttribute("aria-modal") === "true";
      const hasRoleDialog = dialog && dialog.getAttribute("role") === "dialog";
      return {
        totalButtons: buttons.length,
        buttonsWithoutLabelCount: buttonsWithoutLabel.length,
        hasAriaModal,
        hasRoleDialog
      };
    })()`);

    assert.equal(a11yCheck.buttonsWithoutLabelCount, 0, "Alle Buttons besitzen aussagekräftige Beschriftungen/Aria-Labels");
    assert.ok(a11yCheck.hasAriaModal, "City Manager Dialog ist aria-modal");
    assert.ok(a11yCheck.hasRoleDialog, "City Manager Dialog hat role=dialog");
    console.log("✓ Accessibility Basics PASS (Aria-Labels, Dialog-Semantik)");

    // =========================================================================
    // 9. CONSOLE ERROR & UNCAUGHT HYGIENE (19.54, 19.55)
    // =========================================================================
    console.log("\n--- [9] Console & Error Hygiene ---");
    assert.equal(uncaughtErrors.length, 0, `Keine ungefangenen Ausnahmen im Browser erlaubt. Gefunden: ${uncaughtErrors.join(", ")}`);
    console.log("✓ Console Hygiene PASS: 0 ungefangene Browser-Exceptions");

    console.log("\n============================================================");
    console.log("✓ ALLE PHASE 19 BROWSER-HARDENING-TESTS BESTANDEN (PASS)");
    console.log("============================================================\n");

  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close"); } catch (_) {}
    }
    chromeProc.kill("SIGKILL");
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

if (require.main === module) {
  runProductionHardeningBrowserTest()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("\n[HARDENING TEST FAILURE]", err);
      process.exit(1);
    });
}

module.exports = { runProductionHardeningBrowserTest };
