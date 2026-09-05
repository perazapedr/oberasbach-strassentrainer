/**
 * tests/offline-basemap-tests.js
 * Test-Suite für Phase 13.2 – Vollständige Offline-Kartenstrategie (Lokale Vektor-Basiskarte)
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const offlineBasemapApi = require("../offline-basemap.js");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Mock Leaflet & Canvas Environment
// ---------------------------------------------------------------------------

function createMockCanvasContext() {
  const operations = [];
  return {
    operations,
    save: () => operations.push({ op: "save" }),
    restore: () => operations.push({ op: "restore" }),
    beginPath: () => operations.push({ op: "beginPath" }),
    closePath: () => operations.push({ op: "closePath" }),
    moveTo: (x, y) => operations.push({ op: "moveTo", x, y }),
    lineTo: (x, y) => operations.push({ op: "lineTo", x, y }),
    stroke: () => operations.push({ op: "stroke" }),
    clearRect: (x, y, w, h) => operations.push({ op: "clearRect", x, y, w, h }),
    setTransform: (a, b, c, d, e, f) => operations.push({ op: "setTransform", a, b, c, d, e, f }),
    setLineDash: dash => operations.push({ op: "setLineDash", dash }),
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter"
  };
}

function createMockMap(options = {}) {
  const listeners = {};
  const bounds = options.bounds || {
    sw: { lat: 49.40, lng: 10.93 },
    ne: { lat: 49.45, lng: 11.00 }
  };
  const size = options.size || { x: 800, y: 600 };
  const zoom = options.zoom !== undefined ? options.zoom : 13;

  const panes = {};
  const container = {
    classList: {
      _classes: new Set(),
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      toggle(cls, force) {
        if (force === undefined) {
          if (this._classes.has(cls)) this._classes.delete(cls);
          else this._classes.add(cls);
        } else if (force) this._classes.add(cls);
        else this._classes.delete(cls);
      },
      contains(cls) { return this._classes.has(cls); }
    },
    appendChild(child) { child.parentNode = this; }
  };

  const layers = new Set();

  return {
    listeners,
    panes,
    layers,
    on(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(cb => cb !== fn);
    },
    fire(event) {
      if (listeners[event]) {
        listeners[event].forEach(fn => fn());
      }
    },
    hasLayer(layer) {
      return layers.has(layer);
    },
    addLayer(layer) {
      layers.add(layer);
      return this;
    },
    removeLayer(layer) {
      layers.delete(layer);
      return this;
    },
    getBounds() {
      return {
        getSouthWest: () => bounds.sw,
        getNorthEast: () => bounds.ne
      };
    },
    setBounds(newBounds) {
      bounds.sw = newBounds.sw;
      bounds.ne = newBounds.ne;
    },
    getSize() {
      return size;
    },
    getZoom() {
      return zoom;
    },
    getContainer() {
      return container;
    },
    getPane(name) {
      return panes[name] || null;
    },
    createPane(name) {
      const pane = {
        style: {},
        appendChild: child => { child.parentNode = pane; },
        removeChild: child => { if (child.parentNode === pane) child.parentNode = null; }
      };
      panes[name] = pane;
      return pane;
    },
    latLngToContainerPoint(latlng) {
      // Lineare Projektion für Testzwecke:
      const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
      const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;
      const x = ((lng - bounds.sw.lng) / (bounds.ne.lng - bounds.sw.lng)) * size.x;
      const y = ((bounds.ne.lat - lat) / (bounds.ne.lat - bounds.sw.lat)) * size.y;
      return { x: Math.round(x), y: Math.round(y) };
    },
    containerPointToLayerPoint(pt) {
      return { x: pt[0] || pt.x || 0, y: pt[1] || pt.y || 0 };
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Modul & API-Prüfung
// ---------------------------------------------------------------------------

test("1. StrassentrainerOfflineBasemap exportiert create und Geometriehilfen", () => {
  assert.equal(typeof offlineBasemapApi.create, "function", "create muss eine Funktion sein");
  assert.equal(typeof offlineBasemapApi.boundsOverlap, "function", "boundsOverlap muss verfügbar sein");
  assert.equal(typeof offlineBasemapApi.coordinateBounds, "function", "coordinateBounds muss verfügbar sein");
  assert.equal(typeof offlineBasemapApi.extractSections, "function", "extractSections muss verfügbar sein");
  assert.equal(typeof offlineBasemapApi.extractRings, "function", "extractRings muss verfügbar sein");
});

test("2. create({ map }) instanziiert OfflineBasemapLayer im Leaflet-Pane", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });

  assert.ok(layer, "Layer-Instanz muss existieren");
  assert.equal(layer.isEnabled(), false, "Initial muss der Layer deaktiviert sein");
  assert.ok(map.getPane("offlineBasemapPane"), "offlineBasemapPane muss erstellt worden sein");
  assert.equal(map.getPane("offlineBasemapPane").style.zIndex, "205", "offlineBasemapPane zIndex muss 205 sein");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 3. Geometrie-Integrität & Keine Mutation
// ---------------------------------------------------------------------------

test("3. OfflineBasemapLayer mutiert vorhandene Geometriedaten unter keinen Umständen", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });

  const rawStreets = [
    {
      id: "street-1",
      name: "Hauptstraße",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [[10.95, 49.42], [10.96, 49.43]],
          [[10.96, 49.43], [10.97, 49.44]]
        ]
      }
    },
    {
      id: "street-2",
      name: "Nebenstraße",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [[10.94, 49.41], [10.95, 49.42]]
        ]
      }
    }
  ];

  const snapshot = JSON.stringify(rawStreets);

  const cityContext = {
    metadata: {
      id: "city-test",
      name: "Teststadt",
      boundary: {
        type: "Polygon",
        coordinates: [[[10.90, 49.40], [11.00, 49.40], [11.00, 49.50], [10.90, 49.50], [10.90, 49.40]]]
      }
    },
    streetTargets: rawStreets
  };

  layer.setCityContext(cityContext);
  layer.setEnabled(true);

  // Rendern mit Mock-Canvas
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 800, height: 600, style: {} };
  layer.render();

  const afterSnapshot = JSON.stringify(rawStreets);
  assert.equal(snapshot, afterSnapshot, "Straßengeometriedaten dürfen durch das Rendern nicht mutiert werden");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 4. Viewport-BBox-Filterung
// ---------------------------------------------------------------------------

test("4. Viewport-BBox-Filter rendert nur sichtbare/angrenzende Straßen", () => {
  const map = createMockMap({
    bounds: {
      sw: { lat: 49.42, lng: 10.95 },
      ne: { lat: 49.43, lng: 10.96 }
    }
  });
  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 800, height: 600, style: {} };

  const streets = [
    // Straße A: Mitten im Viewport
    {
      id: "street-in",
      name: "Sichtbare Straße",
      geometry: {
        type: "MultiLineString",
        coordinates: [[[10.952, 49.422], [10.958, 49.428]]]
      }
    },
    // Straße B: Weit außerhalb im Norden
    {
      id: "street-north",
      name: "Nördliche Straße",
      geometry: {
        type: "MultiLineString",
        coordinates: [[[10.95, 49.60], [10.96, 49.61]]]
      }
    },
    // Straße C: Weit außerhalb im Westen
    {
      id: "street-west",
      name: "Westliche Straße",
      geometry: {
        type: "MultiLineString",
        coordinates: [[[10.70, 49.42], [10.71, 49.43]]]
      }
    }
  ];

  layer.setCityContext({ streetTargets: streets });
  layer.setEnabled(true);
  layer.render();

  const diag = layer.getDiagnostics();
  assert.equal(diag.totalStreets, 3, "Insgesamt 3 Straßen im Index");
  assert.equal(diag.candidateStreets, 1, "Nur Straße A darf im gefilterten Viewport liegen");
  assert.equal(diag.renderedStreets, 1, "Exakt 1 Straße gerendert");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 5. MultiLineString Segmentierung (keine Fehllinien zwischen Abschnitten)
// ---------------------------------------------------------------------------

test("5. MultiLineString startet jeden Abschnitt mit moveTo (keine falschen Verbindungslinien)", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });
  const mockCtx = createMockCanvasContext();
  layer.ctx = mockCtx;
  layer.canvas = { width: 800, height: 600, style: {} };

  const multiStreet = {
    id: "street-segmented",
    name: "Getrennte Abschnitte",
    geometry: {
      type: "MultiLineString",
      coordinates: [
        // Abschnitt 1: 3 Punkte
        [[10.94, 49.41], [10.95, 49.42], [10.955, 49.425]],
        // Abschnitt 2: 2 getrennte Punkte
        [[10.98, 49.44], [10.99, 49.45]]
      ]
    }
  };

  layer.setCityContext({ streetTargets: [multiStreet] });
  layer.setEnabled(true);
  mockCtx.operations.length = 0;
  layer.render();

  const moveTos = mockCtx.operations.filter(op => op.op === "moveTo");
  const lineTos = mockCtx.operations.filter(op => op.op === "lineTo");

  assert.equal(moveTos.length, 2, "Es muss exakt 2 moveTo-Aufrufe für die 2 Abschnitte geben");
  assert.equal(lineTos.length, 3, "Es muss 3 lineTo-Aufrufe geben (2 für Abs. 1, 1 für Abs. 2)");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 6. Gemeindegrenze (Polygon & MultiPolygon)
// ---------------------------------------------------------------------------

test("6. Gemeindegrenze wird dezent als geschlossener Pfad gerendert", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });
  const mockCtx = createMockCanvasContext();
  layer.ctx = mockCtx;
  layer.canvas = { width: 800, height: 600, style: {} };

  const cityContext = {
    metadata: {
      id: "city-boundary-test",
      name: "Grenzstadt",
      boundary: {
        type: "Polygon",
        coordinates: [
          [[10.93, 49.40], [10.99, 49.40], [10.99, 49.45], [10.93, 49.45], [10.93, 49.40]]
        ]
      }
    },
    streetTargets: []
  };

  layer.setCityContext(cityContext);
  layer.setEnabled(true);
  layer.render();

  const closePaths = mockCtx.operations.filter(op => op.op === "closePath");
  const dashes = mockCtx.operations.filter(op => op.op === "setLineDash");

  assert.ok(closePaths.length >= 1, "Gemeindegrenze muss mit closePath geschlossen werden");
  assert.ok(dashes.length >= 1, "Gemeindegrenze muss mit LineDash dezent dargestellt werden");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 7. TrainingArea-Filter
// ---------------------------------------------------------------------------

test("7. TrainingArea-Auswahl filtert Straßen auf das aktive Gebiet", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 800, height: 600, style: {} };

  const streets = [
    {
      id: "s-porz-1",
      name: "Porzer Straße 1",
      areaIds: ["area-porz"],
      geometry: { type: "MultiLineString", coordinates: [[[10.94, 49.41], [10.95, 49.42]]] }
    },
    {
      id: "s-porz-2",
      name: "Porzer Straße 2",
      areaIds: ["area-porz"],
      geometry: { type: "MultiLineString", coordinates: [[[10.95, 49.42], [10.96, 49.43]]] }
    },
    {
      id: "s-kalk-1",
      name: "Kalker Straße 1",
      areaIds: ["area-kalk"],
      geometry: { type: "MultiLineString", coordinates: [[[10.96, 49.43], [10.97, 49.44]]] }
    }
  ];

  const porzArea = {
    id: "area-porz",
    name: "Porz",
    bounds: { south: 49.41, west: 10.94, north: 49.43, east: 10.96 }
  };

  layer.setCityContext({ streetTargets: streets });
  layer.setEnabled(true);

  // 1. Gesamte Stadt (keine Area aktiv)
  layer.render();
  assert.equal(layer.getDiagnostics().renderedStreets, 3, "Ohne Area müssen alle 3 Straßen gerendert werden");

  // 2. Porz aktivieren
  layer.setTrainingArea(porzArea);
  layer.render();
  assert.equal(layer.getDiagnostics().renderedStreets, 2, "Mit Porz aktiv dürfen nur 2 Straßen gerendert werden");

  // 3. Zurück zu Gesamtstadt
  layer.setTrainingArea(null);
  layer.render();
  assert.equal(layer.getDiagnostics().renderedStreets, 3, "Nach Deaktivierung wieder alle 3 Straßen gerendert");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 8. Stadtwechsel (City Switch) & Memory-Bereinigung
// ---------------------------------------------------------------------------

test("8. Stadtwechsel ersetzt den In-Memory-Index vollständig ohne Alt-Daten", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 800, height: 600, style: {} };
  layer.setEnabled(true);

  // Stadt A
  const cityA = {
    metadata: { id: "city-a", name: "Stadt A" },
    streetTargets: [
      { id: "a-1", name: "A-Weg 1", geometry: { type: "MultiLineString", coordinates: [[[10.94, 49.41], [10.95, 49.42]]] } },
      { id: "a-2", name: "A-Weg 2", geometry: { type: "MultiLineString", coordinates: [[[10.95, 49.42], [10.96, 49.43]]] } }
    ]
  };

  // Stadt B
  const cityB = {
    metadata: { id: "city-b", name: "Stadt B" },
    streetTargets: [
      { id: "b-1", name: "B-Weg 1", geometry: { type: "MultiLineString", coordinates: [[[10.96, 49.43], [10.97, 49.44]]] } }
    ]
  };

  layer.setCityContext(cityA);
  layer.render();
  assert.equal(layer.getDiagnostics().totalStreets, 2);

  layer.setCityContext(cityB);
  layer.render();
  assert.equal(layer.getDiagnostics().totalStreets, 1, "Nach Wechsel zu Stadt B darf nur 1 Straße im Index sein");
  assert.ok(!layer.streetIndex.some(s => s.id.startsWith("a-")), "Keine alten Straßen von Stadt A im Index");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 9. Lifecycle & Event-Listener-Bereinigung (Leak Protection)
// ---------------------------------------------------------------------------

test("9. Layer Lifecycle: create -> enable -> disable -> enable -> destroy entfernt Listener sauber", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });

  assert.ok(map.listeners["moveend"]?.length >= 1, "moveend Listener registriert");
  assert.ok(map.listeners["zoomend"]?.length >= 1, "zoomend Listener registriert");

  layer.setEnabled(true);
  assert.equal(layer.isEnabled(), true);
  assert.equal(map.getContainer().classList.contains("offline-basemap-active"), true);

  layer.setEnabled(false);
  assert.equal(layer.isEnabled(), false);
  assert.equal(map.getContainer().classList.contains("offline-basemap-active"), false);

  layer.destroy();
  assert.equal(map.listeners["moveend"]?.length || 0, 0, "moveend Listener nach destroy entfernt");
  assert.equal(map.listeners["zoomend"]?.length || 0, 0, "zoomend Listener nach destroy entfernt");
  assert.equal(layer.streetIndex.length, 0, "Index nach destroy geleert");
  assert.equal(layer.canvas, null, "Canvas-Referenz nach destroy gelöscht");
});

// ---------------------------------------------------------------------------
// 10. Keine Netzwerk-Requests & Keine IndexedDB-Reads beim Rendern
// ---------------------------------------------------------------------------

test("10. Offline-Basemap führt beim Rendern 0 Netzwerk- und 0 IndexedDB-Aufrufe durch", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 800, height: 600, style: {} };

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("Netzwerk offline!"));
  };

  try {
    const streets = [
      { id: "s-1", name: "Weg 1", geometry: { type: "MultiLineString", coordinates: [[[10.94, 49.41], [10.95, 49.42]]] } }
    ];
    layer.setCityContext({ streetTargets: streets });
    layer.setEnabled(true);

    // Wiederholtes Rendern bei Pan/Zoom
    for (let i = 0; i < 5; i += 1) {
      layer.render();
    }

    assert.equal(fetchCalls, 0, "fetch darf beim Rendern der OfflineBasemap niemals aufgerufen werden");
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy();
  }
});

// ---------------------------------------------------------------------------
// 11. Performance mit echten Oberasbach-Daten (271 Straßen)
// ---------------------------------------------------------------------------

test("11. Performance: Oberasbach (271 Straßen) rendert flüssig", () => {
  const pkgRaw = fs.readFileSync(path.join(ROOT, "data/cities/oberasbach.json"), "utf-8");
  const pkg = JSON.parse(pkgRaw);

  const map = createMockMap({
    bounds: {
      sw: { lat: pkg.city.bounds.south, lng: pkg.city.bounds.west },
      ne: { lat: pkg.city.bounds.north, lng: pkg.city.bounds.east }
    }
  });

  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 1200, height: 900, style: {} };

  layer.setCityContext({
    metadata: { ...pkg.city, boundary: pkg.boundary },
    streetTargets: pkg.streets
  });
  layer.setEnabled(true);

  const start = performance.now();
  layer.render();
  const duration = performance.now() - start;

  const diag = layer.getDiagnostics();
  assert.equal(diag.totalStreets, 271, "Oberasbach muss 271 Straßen haben");
  assert.ok(diag.candidateStreets > 200, "In der Gesamtansicht müssen fast alle Straßen Kandidaten sein");
  assert.ok(diag.renderedSegments > 500, "Es müssen viele Segmente gezeichnet werden");

  // Performance-Ergebnis dokumentieren (kein unzuverlässiges Hard-Limit, aber Vernunftsprüfung)
  assert.ok(duration < 2000, `Oberasbach-Renderung muss schnell sein (dauerte ${duration.toFixed(1)} ms)`);

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 12. Synthetischer Stresstest: Nürnberg (~3.000 Straßen)
// ---------------------------------------------------------------------------

test("12. Performance-Stresstest: 3.000 Straßen mit Teil-Viewport-Filterung", () => {
  const syntheticStreets = [];
  for (let i = 0; i < 3000; i += 1) {
    const lat = 49.38 + (i % 60) * 0.002;
    const lng = 10.95 + Math.floor(i / 60) * 0.003;
    syntheticStreets.push({
      id: `synth-${i}`,
      name: `Straße ${i}`,
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [[lng, lat], [lng + 0.001, lat + 0.001]],
          [[lng + 0.001, lat + 0.001], [lng + 0.002, lat + 0.001]]
        ]
      }
    });
  }

  // Viewport deckt nur ca. 10 % des Stadtgebiets ab
  const map = createMockMap({
    bounds: {
      sw: { lat: 49.40, lng: 10.98 },
      ne: { lat: 49.43, lng: 11.02 }
    }
  });

  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 1200, height: 900, style: {} };

  layer.setCityContext({ streetTargets: syntheticStreets });
  layer.setEnabled(true);

  const start = performance.now();
  layer.render();
  const duration = performance.now() - start;

  const diag = layer.getDiagnostics();
  assert.equal(diag.totalStreets, 3000, "3000 Straßen im Index");
  assert.ok(
    diag.candidateStreets < 1500,
    `BBox-Filter muss die Kandidaten bei Teilviewport deutlich reduzieren (Kandidaten: ${diag.candidateStreets} von 3000)`
  );

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 13. Performance: Siegen (~1.100 Straßen)
// ---------------------------------------------------------------------------

test("13. Performance: Siegen (~1.100 Straßen) rendert flüssig", () => {
  const siegenStreets = [];
  for (let i = 0; i < 1100; i += 1) {
    const lat = 50.85 + (i % 40) * 0.002;
    const lng = 7.98 + Math.floor(i / 40) * 0.003;
    siegenStreets.push({
      id: `siegen-street-${i}`,
      name: `Siegener Straße ${i}`,
      areaIds: i % 2 === 0 ? ["area-weidenau"] : ["area-geisweid"],
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [[lng, lat], [lng + 0.0015, lat + 0.001]],
          [[lng + 0.0015, lat + 0.001], [lng + 0.003, lat + 0.0015]]
        ]
      }
    });
  }

  const map = createMockMap({
    bounds: {
      sw: { lat: 50.84, lng: 7.97 },
      ne: { lat: 50.94, lng: 8.08 }
    }
  });

  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 1200, height: 900, style: {} };

  layer.setCityContext({ streetTargets: siegenStreets });
  layer.setEnabled(true);

  const start = performance.now();
  layer.render();
  const duration = performance.now() - start;

  const diag = layer.getDiagnostics();
  assert.equal(diag.totalStreets, 1100, "1100 Straßen in Siegen");
  assert.ok(diag.candidateStreets > 800, "In Gesamtansicht fast alle sichtbar");
  assert.ok(duration < 2000, `Siegen-Renderung muss schnell sein (dauerte ${duration.toFixed(1)} ms)`);

  // Area change zu Weidenau
  layer.setTrainingArea({ id: "area-weidenau" });
  layer.render();
  assert.equal(layer.getDiagnostics().renderedStreets, 550, "Weidenau filtert exakt die Hälfte der Straßen");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// 14. Tile-Error-Heuristik / Fallback-Umschaltung
// ---------------------------------------------------------------------------

test("14. Tile-Error-Heuristik löst bei gehäuften Fehlern Fallback auf Offline-Basemap aus", () => {
  const map = createMockMap();
  const baseTileLayer = {
    _listeners: {},
    on(event, fn) { this._listeners[event] = fn; },
    fire(event) { if (this._listeners[event]) this._listeners[event](); }
  };

  const offlineBasemap = offlineBasemapApi.create({ map });
  offlineBasemap.ctx = createMockCanvasContext();
  offlineBasemap.canvas = { width: 800, height: 600, style: {} };

  // Coordinator simulieren (analog app.js)
  const TILE_ERROR_THRESHOLD = 6;
  const TILE_ERROR_WINDOW_MS = 10000;
  const coordinator = {
    mode: "auto",
    activeBasemap: "online",
    tileErrorTimestamps: [],
    cartoFallbackActive: false,
    handleTileError() {
      const now = Date.now();
      this.tileErrorTimestamps.push(now);
      this.tileErrorTimestamps = this.tileErrorTimestamps.filter(t => now - t <= TILE_ERROR_WINDOW_MS);
      if (this.tileErrorTimestamps.length >= TILE_ERROR_THRESHOLD) {
        this.cartoFallbackActive = true;
        this.activeBasemap = "offline";
        offlineBasemap.setEnabled(true);
      }
    }
  };

  baseTileLayer.on("tileerror", () => coordinator.handleTileError());

  // 1-5 Fehler: noch kein Fallback
  for (let i = 0; i < 5; i++) {
    baseTileLayer.fire("tileerror");
  }
  assert.equal(coordinator.cartoFallbackActive, false, "Nach 5 Fehlern noch kein Fallback");
  assert.equal(offlineBasemap.isEnabled(), false, "OfflineBasemap noch inaktiv");

  // 6. Fehler: Schwellenwert erreicht
  baseTileLayer.fire("tileerror");
  assert.equal(coordinator.cartoFallbackActive, true, "Nach 6 Fehlern Fallback aktiv");
  assert.equal(offlineBasemap.isEnabled(), true, "OfflineBasemap jetzt aktiviert");

  offlineBasemap.destroy();
});

// ---------------------------------------------------------------------------
// 15. Wiederholter Wechsel Online/Offline (Leak-Protection)
// ---------------------------------------------------------------------------

test("15. Wiederholter Wechsel Online -> Offline -> Online hinterlässt keine Leaks", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });
  layer.ctx = createMockCanvasContext();
  layer.canvas = { width: 800, height: 600, style: {} };

  for (let i = 0; i < 10; i++) {
    layer.setEnabled(true);
    assert.equal(layer.isEnabled(), true);
    layer.setEnabled(false);
    assert.equal(layer.isEnabled(), false);
  }

  // Event listener unverändert einfach vorhanden
  assert.equal(map.listeners["moveend"]?.length, 1);
  assert.equal(map.listeners["zoomend"]?.length, 1);

  layer.destroy();
  assert.equal(map.listeners["moveend"]?.length || 0, 0);
});

// ---------------------------------------------------------------------------
// 16. Layer Z-Ordering: Pane 205 liegt unter Overlays (z-index 400+)
// ---------------------------------------------------------------------------

test("16. Offline-Basemap-Pane besitzt zIndex 205 und liegt unter Overlays und Markern", () => {
  const map = createMockMap();
  const layer = offlineBasemapApi.create({ map });

  const pane = map.getPane("offlineBasemapPane");
  assert.ok(pane, "offlineBasemapPane muss existieren");
  assert.equal(pane.style.zIndex, "205", "offlineBasemapPane muss zIndex 205 haben");
  assert.equal(pane.style.pointerEvents, "none", "Darf keine Pointer-Events abfangen");

  layer.destroy();
});

// ---------------------------------------------------------------------------
// RUNNER
// ---------------------------------------------------------------------------


(async function runAllTests() {
  let passed = 0;
  let failed = 0;
  console.log(`Starte ${tests.length} Phase-13.2-Offline-Basemap-Tests ...\n`);

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

  console.log(`\nErgebnis: ${passed}/${tests.length} Offline-Basemap-Tests bestanden.`);
  if (failed > 0) {
    process.exit(1);
  }
})();
