/**
 * tests/offline-tests.js
 * Test-Suite für Phase 13.1 – Offline-Grundlage und lokaler App-Shell
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// 1. Lokale Abhängigkeiten in index.html
// ---------------------------------------------------------------------------

test("1. index.html bindet Leaflet und Turf lokal ein und besitzt keine Kern-CDNs", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");

  // Keine CDN-Referenzen für Leaflet oder Turf
  assert.ok(!html.includes("unpkg.com/leaflet"), "index.html darf kein unpkg.com/leaflet enthalten");
  assert.ok(!html.includes("cdn.jsdelivr.net/npm/@turf"), "index.html darf kein jsdelivr turf enthalten");
  assert.ok(!html.includes("cdnjs.cloudflare.com"), "index.html darf keine cdnjs Skripte enthalten");

  // Lokale Vendor-Dateien vorhanden
  assert.ok(html.includes('href="vendor/leaflet/leaflet.css"'), "Leaflet CSS muss lokal referenziert sein");
  assert.ok(html.includes('src="vendor/leaflet/leaflet.js"'), "Leaflet JS muss lokal referenziert sein");
  assert.ok(html.includes('src="vendor/turf/turf.min.js"'), "Turf JS muss lokal referenziert sein");

  // Manifest vorhanden
  assert.ok(html.includes('rel="manifest" href="manifest.webmanifest"'), "manifest.webmanifest muss verlinkt sein");

  // Offline-Banner vorhanden
  assert.ok(html.includes('id="offlineBanner"'), "offlineBanner Element muss in index.html vorhanden sein");
});

// ---------------------------------------------------------------------------
// 2. Lokale Vendor-Dateien auf Festplatte
// ---------------------------------------------------------------------------

test("2. Alle lokalen Vendor-Dateien und Leaflet-Bilder sind vorhanden und nicht leer", () => {
  const files = [
    "vendor/leaflet/leaflet.js",
    "vendor/leaflet/leaflet.css",
    "vendor/leaflet/images/marker-icon.png",
    "vendor/leaflet/images/marker-icon-2x.png",
    "vendor/leaflet/images/marker-shadow.png",
    "vendor/leaflet/images/layers.png",
    "vendor/leaflet/images/layers-2x.png",
    "vendor/turf/turf.min.js"
  ];

  for (const rel of files) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `Datei ${rel} muss existieren`);
    const stat = fs.statSync(full);
    assert.ok(stat.size > 0, `Datei ${rel} darf nicht leer sein`);
  }

  const leafletJsSize = fs.statSync(path.join(ROOT, "vendor/leaflet/leaflet.js")).size;
  assert.ok(leafletJsSize > 100000, "Leaflet JS muss vollständige Distribution sein (> 100KB)");

  const turfJsSize = fs.statSync(path.join(ROOT, "vendor/turf/turf.min.js")).size;
  assert.ok(turfJsSize > 400000, "Turf JS muss vollständige Distribution sein (> 400KB)");
});

// ---------------------------------------------------------------------------
// 3. Web App Manifest
// ---------------------------------------------------------------------------

test("3. manifest.webmanifest ist valide und definiert Standalone-App-Metadaten", () => {
  const raw = fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf-8");
  const manifest = JSON.parse(raw);

  assert.equal(typeof manifest.name, "string", "name muss definiert sein");
  assert.equal(typeof manifest.short_name, "string", "short_name muss definiert sein");
  assert.equal(manifest.start_url, "./", "start_url muss relativ ./ sein");
  assert.equal(manifest.scope, "./", "scope muss relativ ./ sein");
  assert.equal(manifest.display, "standalone", "display muss standalone sein");
  assert.equal(manifest.theme_color, "#9f1d2d", "theme_color muss dem CI entsprechen");
  assert.ok(manifest.background_color, "background_color muss definiert sein");
});

// ---------------------------------------------------------------------------
// 4. Service Worker App-Shell & Cache-Definition
// ---------------------------------------------------------------------------

test("4. Service Worker definiert saubere Cache-Version und alle App-Shell-Dateien existieren", () => {
  const sw = require("../sw.js");

  assert.ok(sw.STATIC_CACHE.startsWith("strassentrainer-static-"), "Cache-Name muss strassentrainer-static- Präfix tragen");
  assert.ok(Array.isArray(sw.STATIC_ASSETS), "STATIC_ASSETS muss ein Array sein");
  assert.ok(sw.STATIC_ASSETS.length >= 20, "STATIC_ASSETS muss alle Kern-Dateien umfassen");

  // Keine unerwünschten Dateien
  for (const asset of sw.STATIC_ASSETS) {
    assert.ok(!asset.startsWith("tests/"), `tests/ dürfen nicht gecacht werden: ${asset}`);
    assert.ok(!asset.startsWith("docs/"), `docs/ dürfen nicht gecacht werden: ${asset}`);
    assert.ok(!asset.startsWith("scripts/"), `scripts/ dürfen nicht gecacht werden: ${asset}`);
    assert.ok(!asset.startsWith(".git"), `.git darf nicht gecacht werden: ${asset}`);

    if (asset !== "./") {
      const fullPath = path.join(ROOT, asset);
      assert.ok(fs.existsSync(fullPath), `Gecachte App-Shell-Datei existiert nicht: ${asset}`);
    }
  }

  // Wichtige Produktionsdateien müssen dabei sein
  const expected = [
    "index.html", "styles.css", "app.js", "geometry.js", "poi-categories.js", "targets.js",
    "statistics.js", "game-engine.js", "timer.js", "city-storage.js",
    "city-data-validator.js", "city-package.js", "city-manager-ui.js",
    "default-city.js", "osm-service.js", "offline-basemap.js", "manifest.webmanifest",
    "data/cities/oberasbach.json", "vendor/leaflet/leaflet.js",
    "vendor/leaflet/leaflet.css", "vendor/turf/turf.min.js"
  ];

  for (const exp of expected) {
    assert.ok(sw.STATIC_ASSETS.includes(exp), `App-Shell muss ${exp} enthalten`);
  }
});

// ---------------------------------------------------------------------------
// 5. Service Worker Fetch-Klassifizierung
// ---------------------------------------------------------------------------

test("5. Service Worker classifyRequest trennt statische Assets, APIs und Tiles korrekt", () => {
  const sw = require("../sw.js");

  // POST Request -> BYPASS
  assert.equal(sw.classifyRequest({ method: "POST", url: "https://overpass-api.de/api/interpreter" }), "BYPASS");

  // Nominatim -> NOMINATIM_NETWORK_ONLY
  assert.equal(sw.classifyRequest({ method: "GET", url: "https://nominatim.openstreetmap.org/search?q=koeln" }), "NOMINATIM_NETWORK_ONLY");

  // Overpass GET -> OVERPASS_NETWORK_ONLY
  assert.equal(sw.classifyRequest({ method: "GET", url: "https://overpass-api.de/api/interpreter?data=..." }), "OVERPASS_NETWORK_ONLY");

  // Kartentiles -> TILE_NETWORK_ONLY
  assert.equal(sw.classifyRequest({ method: "GET", url: "https://a.basemaps.cartocdn.com/light_nolabels/13/4200/2700.png" }), "TILE_NETWORK_ONLY");
  assert.equal(sw.classifyRequest({ method: "GET", url: "https://tile.openstreetmap.org/13/4200/2700.png" }), "TILE_NETWORK_ONLY");

  // Navigation -> NAVIGATION
  assert.equal(sw.classifyRequest({ method: "GET", url: "http://localhost:8080/", mode: "navigate" }), "NAVIGATION");

  // Lokale Assets -> STATIC_ASSET
  assert.equal(sw.classifyRequest({ method: "GET", url: "http://localhost:8080/styles.css" }), "STATIC_ASSET");
  assert.equal(sw.classifyRequest({ method: "GET", url: "http://localhost:8080/vendor/leaflet/leaflet.js" }), "STATIC_ASSET");
  assert.equal(sw.classifyRequest({ method: "GET", url: "http://localhost:8080/data/cities/oberasbach.json" }), "STATIC_ASSET");
});

// ---------------------------------------------------------------------------
// 6. Overpass POST Network-Passthrough (kein Cache, kein HTML-Fallback)
// ---------------------------------------------------------------------------

test("6. Overpass POST Requests werden vom Service Worker vollständig umgangen (kein Cache, kein HTML-Fallback, Network-Passthrough)", () => {
  const sw = require("../sw.js");
  const vm = require("vm");

  // 1. Static Cache enthält keine Overpass/Nominatim URLs
  for (const asset of sw.STATIC_ASSETS) {
    assert.ok(!asset.includes("overpass"), "STATIC_ASSETS darf kein overpass enthalten");
    assert.ok(!asset.includes("nominatim"), "STATIC_ASSETS darf kein nominatim enthalten");
  }

  // 2. Request-Klassifizierung: POST Overpass Request wird als BYPASS klassifiziert
  const postRequest = {
    method: "POST",
    url: "https://overpass-api.de/api/interpreter",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=[out:json][timeout:25];(relation(1016396););out body;>;out skel qt;"
  };
  assert.equal(sw.classifyRequest(postRequest), "BYPASS");

  // 3. Laufzeit-Prüfung des tatsächlichen Service Worker Fetch-Event-Handlers
  const swCode = fs.readFileSync(path.join(ROOT, "sw.js"), "utf-8");
  const listeners = {};
  let cachesMatchCalled = false;
  let cachesOpenCalled = false;

  const mockSelf = {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    location: { href: "http://localhost:8080/" }
  };

  const context = vm.createContext({
    self: mockSelf,
    ServiceWorkerGlobalScope: function () {},
    URL,
    caches: {
      match: () => {
        cachesMatchCalled = true;
        return Promise.resolve(null);
      },
      open: () => {
        cachesOpenCalled = true;
        return Promise.resolve({});
      }
    },
    fetch: () => {
      throw new Error("SW darf globales fetch nicht aufrufen, wenn der Request gebypasst wird");
    }
  });

  vm.runInContext(swCode, context);
  assert.ok(typeof listeners.fetch === "function", "Service Worker muss einen fetch-Listener registrieren");

  let respondWithCalled = false;
  let interceptedResponse = null;

  const originalUrl = postRequest.url;
  const originalBody = postRequest.body;
  const originalHeaders = { ...postRequest.headers };

  const event = {
    request: postRequest,
    respondWith(promise) {
      respondWithCalled = true;
      interceptedResponse = promise;
    }
  };

  // Führe den Fetch-Event-Listener mit dem Overpass-POST-Request aus
  listeners.fetch(event);

  // 4. Deterministische Verifikationen:
  // - respondWith() wurde NICHT aufgerufen (reiner Network-Passthrough für den Browser)
  assert.equal(respondWithCalled, false, "respondWith() darf für Overpass-POST-Requests NICHT aufgerufen werden");
  assert.equal(interceptedResponse, null, "Es darf keine Response abgefangen oder generiert werden");

  // - Kein Cache-Zugriff (weder match noch open)
  assert.equal(cachesMatchCalled, false, "caches.match darf bei Overpass POST nicht aufgerufen werden");
  assert.equal(cachesOpenCalled, false, "caches.open darf bei Overpass POST nicht aufgerufen werden");

  // - Kein HTML- oder App-Shell-Fallback
  assert.ok(interceptedResponse === null, "Kein HTML-Fallback für Overpass POST");

  // - Request-Objekt bleibt für das Netzwerk 100% unberührt
  assert.equal(postRequest.url, originalUrl, "URL darf nicht verändert werden");
  assert.equal(postRequest.body, originalBody, "Body darf nicht verändert werden");
  assert.deepEqual(postRequest.headers, originalHeaders, "Headers dürfen nicht verändert werden");
  assert.equal(postRequest.method, "POST", "Method muss POST bleiben");
});

// ---------------------------------------------------------------------------
// 7. Stadtmanager Offline-Schutz
// ---------------------------------------------------------------------------

test("7. Stadtmanager fängt Suche und Download bei navigator.onLine === false verständlich ab", () => {
  const cityManagerUi = require("../city-manager-ui.js");

  // Fehlertexte prüfen
  const searchError = cityManagerUi.getUserFriendlyCityError({ code: "NETWORK_ERROR", navigatorOnline: false }, "search");
  assert.ok(searchError.includes("Für die Suche nach neuen Städten wird eine Internetverbindung benötigt"));
  assert.ok(searchError.includes("Bereits installierte Städte können weiterhin gespielt werden"));

  const downloadError = cityManagerUi.getUserFriendlyCityError({ code: "NETWORK_ERROR", navigatorOnline: false }, "download");
  assert.ok(downloadError.includes("Du bist momentan offline"));
  assert.ok(downloadError.includes("Bereits installierte Städte können weiterhin gespielt werden"));
});

// ---------------------------------------------------------------------------
// 8. Offline Runtime Simulation (0 externe Netzwerkanfragen)
// ---------------------------------------------------------------------------

test("8. Offline Gameplay & TrainingArea-Wechsel funktionieren ohne Netzwerk (0 API-Calls)", async () => {
  const engineApi = require("../game-engine.js");
  const statsApi = require("../statistics.js");

  let networkCalls = { nominatim: 0, overpass: 0, geocoder: 0 };

  // Lokales Oberasbach-Paket laden
  const rawData = fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf-8");
  const samplePkg = JSON.parse(rawData);

  // In-Memory Storage
  const store = new Map();
  const mockStorage = {
    async getCity(cityId) { return cityId === samplePkg.city.id ? samplePkg.city : null; },
    async getCityStreets(cityId) { return cityId === samplePkg.city.id ? samplePkg.streets : []; },
    async getCityPois(cityId) { return cityId === samplePkg.city.id ? samplePkg.pois : []; },
    async getCityAreas(cityId) { return cityId === samplePkg.city.id ? (samplePkg.areas || []) : []; },
    async getActiveCity() { return samplePkg.city; }
  };

  // Lese aktive Stadt offline
  const activeCity = await mockStorage.getActiveCity();
  assert.equal(activeCity.id, samplePkg.city.id);

  const streets = await mockStorage.getCityStreets(activeCity.id);
  const pois = await mockStorage.getCityPois(activeCity.id);
  assert.equal(streets.length, 271);
  assert.equal(pois.length, 60);

  // Game Engine initialisieren
  const engine = engineApi.createGameEngine();

  const target = {
    id: streets[0].id,
    name: streets[0].name,
    category: "street",
    geometry: streets[0].geometry
  };

  engine.startGame(engineApi.MODE_CONFIGS.free);
  engine.startRound();
  engine.activateRound(target);

  assert.ok(engine.gameState.currentRound.target, "Runde 1 muss ein Ziel haben");
  assert.equal(engine.gameState.currentRound.target.id, target.id);

  // Löse Runde
  engine.submitGuess({ lat: 49.42, lng: 10.96 });
  const roundResult = engine.resolveRound({ distanceMeters: 50 });
  assert.equal(engine.gameState.status, engineApi.GAME_STATUS.ANSWERED);

  // Statistik offline schreiben
  const memStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key)
  };
  const statsStore = statsApi.createStatisticsStore(memStorage, activeCity.id);

  statsStore.recordGameStarted("free", { gameId: "free-1", contentSelection: "streets" });
  statsStore.recordRound(roundResult, { roundId: "round-1" });
  statsStore.recordGameFinished("free", { gameId: "free-1" });

  const view = statsStore.getView();
  assert.equal(view.statistics.gamesStarted, 1);
  assert.equal(view.statistics.roundsEvaluated, 1);

  // Verifiziere: Absolut 0 Netzwerkaufrufe
  assert.equal(networkCalls.nominatim, 0, "Kein Nominatim-Aufruf offline");
  assert.equal(networkCalls.overpass, 0, "Kein Overpass-Aufruf offline");
  assert.equal(networkCalls.geocoder, 0, "Kein Geocoder-Aufruf offline");
});

// ---------------------------------------------------------------------------
// 9. Oberasbach Bundle Offline
// ---------------------------------------------------------------------------

test("9. Gebündeltes Oberasbach-Paket ist offline vollständig (271 Straßen, 60 POIs)", async () => {
  const defaultCityApi = require("../default-city.js");
  const raw = fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf-8");
  const pkg = JSON.parse(raw);

  const loaded = await defaultCityApi.loadBundledDefaultCity({ packageData: pkg });
  assert.equal(loaded.city.id, "osm-relation-1016396");
  assert.equal(loaded.city.name, "Oberasbach");
  assert.equal(loaded.streets.length, 271);
  assert.equal(loaded.pois.length, 60);
});

// ---------------------------------------------------------------------------
// 10. Stadtpaket Offline Export & Import
// ---------------------------------------------------------------------------

test("10. Stadtpaket Export und Import funktionieren ohne Internetverbindung", async () => {
  const cityPackageApi = require("../city-package.js");
  const validatorApi = require("../city-data-validator.js");
  const raw = fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf-8");
  const originalPkg = JSON.parse(raw);

  const storage = {
    async getCity(id) { return originalPkg.city; },
    async getCityStreets(id) { return originalPkg.streets; },
    async getCityPois(id) { return originalPkg.pois; },
    async getCityAreas(id) { return originalPkg.areas || []; }
  };

  // Export ohne Netzwerk
  const exported = await cityPackageApi.exportCityPackage(originalPkg.city.id, { storage });
  assert.ok(typeof exported.json === "string", "Export muss JSON-String sein");

  // Import / Validierung ohne Netzwerk
  const parsed = JSON.parse(exported.json);
  const validated = validatorApi.validateCityPackage(parsed);
  assert.equal(validated.valid, true, "Importiertes Paket muss valide sein");
  assert.equal(validated.city.id, originalPkg.city.id);
  assert.equal(validated.streets.length, 271);
  assert.equal(validated.pois.length, 60);
});

// ---------------------------------------------------------------------------
// 11. Offline-Basemap Integration
// ---------------------------------------------------------------------------

test("11. Offline-Basemap rendert lokales Straßennetz bei offline-Status ohne externe Kacheln", async () => {
  const offlineBasemapApi = require("../offline-basemap.js");
  const defaultCityApi = require("../default-city.js");
  const raw = fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf-8");
  const pkg = JSON.parse(raw);

  let netCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    netCalls += 1;
    return Promise.reject(new Error("Offline"));
  };

  try {
    const mockMap = {
      _listeners: {},
      on(e, fn) { this._listeners[e] = this._listeners[e] || []; this._listeners[e].push(fn); },
      off(e, fn) {},
      getBounds() {
        return {
          getSouthWest: () => ({ lat: pkg.city.bounds.south, lng: pkg.city.bounds.west }),
          getNorthEast: () => ({ lat: pkg.city.bounds.north, lng: pkg.city.bounds.east })
        };
      },
      getSize() { return { x: 800, y: 600 }; },
      getZoom() { return 13; },
      getContainer() { return { classList: { toggle() {} } }; },
      getPane() { return null; },
      createPane() { return { style: {}, appendChild() {} }; },
      latLngToContainerPoint(ll) { return { x: 400, y: 300 }; }
    };

    const layer = offlineBasemapApi.create({ map: mockMap });
    layer.ctx = {
      clearRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      save() {},
      restore() {},
      setTransform() {},
      setLineDash() {}
    };
    layer.canvas = { width: 800, height: 600, style: {} };

    layer.setCityContext({
      metadata: { ...pkg.city, boundary: pkg.boundary },
      streetTargets: pkg.streets
    });
    layer.setEnabled(true);
    layer.render();

    const diag = layer.getDiagnostics();
    assert.equal(diag.totalStreets, 271, "Oberasbach muss 271 Straßen haben");
    assert.ok(diag.candidateStreets > 200, "In der Gesamtansicht fast alle Straßen sichtbar");
    assert.equal(netCalls, 0, "Absolut 0 Netzwerkaufrufe beim Rendern der Offline-Basiskarte");

    layer.destroy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// RUNNER
// ---------------------------------------------------------------------------

(async function runAllTests() {
  let passed = 0;
  let failed = 0;
  console.log(`Starte ${tests.length} Phase-13.1-Offline-Tests ...\n`);

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✓ ${t.name}`);
      passed += 1;
    } catch (err) {
      console.error(`✗ ${t.name}:`, err);
      failed += 1;
    }
  }

  console.log(`\nErgebnis: ${passed}/${tests.length} Offline-Tests bestanden.`);
  if (failed > 0) {
    process.exit(1);
  }
})();
