/**
 * offline-basemap.js
 * Straßentrainer - Lokale Vektor-Basiskarte (Phase 13.2)
 *
 * Rendert die in IndexedDB vorhandenen Straßengeometrien und administrativen Grenzen
 * als unbeschriftete, neutrale Orientierungskarte über ein performantes Canvas-Element.
 * Beseitigt die Online-Abhängigkeit von externen CARTO-Kacheln im Offline-Modus.
 */
(function initializeOfflineBasemap(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerOfflineBasemap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOfflineBasemapApi() {
  "use strict";

  const DEFAULT_OPTIONS = Object.freeze({
    paneName: "offlineBasemapPane",
    paneZIndex: "205",
    roadColor: "#8d99a4",
    boundaryColor: "rgba(100, 116, 139, 0.45)",
    areaBoundaryColor: "rgba(0, 103, 185, 0.45)"
  });

  function monotonicNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function coordinateBounds(coordinates) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (let index = 0; index < coordinates.length; index += 1) {
      const coord = coordinates[index];
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { minLon, minLat, maxLon, maxLat };
  }

  function boundsOverlap(first, second, epsilon = 1e-6) {
    return first.minLon <= second.maxLon + epsilon
      && first.maxLon + epsilon >= second.minLon
      && first.minLat <= second.maxLat + epsilon
      && first.maxLat + epsilon >= second.minLat;
  }

  function extractSections(geometry) {
    if (!geometry) return [];
    if (Array.isArray(geometry.sections)) return geometry.sections;
    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
      return [geometry.coordinates];
    }
    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      return geometry.coordinates;
    }
    if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
      return geometry.geometries.flatMap(extractSections);
    }
    return [];
  }

  function extractRings(geometry) {
    if (!geometry) return [];
    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
      return geometry.coordinates.filter(ring => Array.isArray(ring) && ring.length >= 2);
    }
    if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      return geometry.coordinates.flatMap(poly =>
        Array.isArray(poly) ? poly.filter(ring => Array.isArray(ring) && ring.length >= 2) : []
      );
    }
    return [];
  }

  function computeSectionsBbox(sections) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let count = 0;
    for (let s = 0; s < sections.length; s += 1) {
      const sec = sections[s];
      if (!Array.isArray(sec)) continue;
      for (let c = 0; c < sec.length; c += 1) {
        const pt = sec[c];
        const lon = Number(pt[0]);
        const lat = Number(pt[1]);
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          count += 1;
        }
      }
    }
    return count > 0 ? { minLon, minLat, maxLon, maxLat } : null;
  }

  function computeRingsBbox(rings) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let count = 0;
    for (let r = 0; r < rings.length; r += 1) {
      const ring = rings[r];
      if (!Array.isArray(ring)) continue;
      for (let c = 0; c < ring.length; c += 1) {
        const pt = ring[c];
        const lon = Number(pt[0]);
        const lat = Number(pt[1]);
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          count += 1;
        }
      }
    }
    return count > 0 ? { minLon, minLat, maxLon, maxLat } : null;
  }

  class OfflineBasemapLayer {
    constructor(map, options = {}) {
      if (!map) {
        throw new Error("OfflineBasemapLayer erfordert eine Leaflet-Map-Instanz.");
      }
      this.map = map;
      this.options = { ...DEFAULT_OPTIONS, ...options };
      this.enabled = false;
      this.cityContext = null;
      this.activeArea = null;

      this.streetIndex = [];
      this.boundary = null;
      this.areaBoundary = null;

      this.canvas = null;
      this.ctx = null;
      this.pane = null;

      this.diagnostics = {
        totalStreets: 0,
        candidateStreets: 0,
        renderedStreets: 0,
        renderedSegments: 0,
        lastRenderMs: 0
      };

      this._onMoveEnd = () => {
        if (this.enabled) this.render();
      };
      this._onResize = () => {
        if (this.enabled) this.render();
      };
      this._onViewReset = () => {
        if (this.enabled) this.render();
      };

      this._initCanvas();
      this._bindEvents();
    }

    _initCanvas() {
      const map = this.map;
      let pane = null;
      if (typeof map.getPane === "function") {
        pane = map.getPane(this.options.paneName);
        if (!pane && typeof map.createPane === "function") {
          pane = map.createPane(this.options.paneName);
          pane.style.zIndex = this.options.paneZIndex;
          pane.style.pointerEvents = "none";
        }
      }
      this.pane = pane;

      const canvas = typeof document !== "undefined" && typeof document.createElement === "function"
        ? document.createElement("canvas")
        : null;

      if (canvas) {
        canvas.className = "offline-basemap-canvas";
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.top = "0";
        canvas.style.pointerEvents = "none";
        canvas.style.display = "none";

        if (pane && typeof pane.appendChild === "function") {
          pane.appendChild(canvas);
        } else if (typeof map.getContainer === "function") {
          const container = map.getContainer();
          if (container && typeof container.appendChild === "function") {
            container.appendChild(canvas);
          }
        }
        this.canvas = canvas;
        this.ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
      }
    }

    _bindEvents() {
      const map = this.map;
      if (!map || typeof map.on !== "function") return;
      map.on("moveend", this._onMoveEnd);
      map.on("zoomend", this._onMoveEnd);
      map.on("resize", this._onResize);
      map.on("viewreset", this._onViewReset);
    }

    _unbindEvents() {
      const map = this.map;
      if (!map || typeof map.off !== "function") return;
      map.off("moveend", this._onMoveEnd);
      map.off("zoomend", this._onMoveEnd);
      map.off("resize", this._onResize);
      map.off("viewreset", this._onViewReset);
    }

    setEnabled(enabled) {
      const next = Boolean(enabled);
      if (this.enabled === next) return;
      this.enabled = next;

      if (this.canvas) {
        this.canvas.style.display = next ? "block" : "none";
      }

      if (typeof this.map.getContainer === "function") {
        const container = this.map.getContainer();
        if (container?.classList) {
          container.classList.toggle("offline-basemap-active", next);
        }
      }

      if (next) {
        this.render();
      }
    }

    isEnabled() {
      return this.enabled;
    }

    setCityContext(context) {
      this.cityContext = context || null;
      this.activeArea = context?.activeArea || null;
      this._buildIndex(context);
      if (this.enabled) {
        this.render();
      }
    }

    setTrainingArea(area) {
      this.activeArea = area || null;
      this._updateAreaBoundary(area);
      if (this.enabled) {
        this.render();
      }
    }

    _buildIndex(context) {
      this.streetIndex = [];
      this.boundary = null;
      this.areaBoundary = null;

      if (!context) return;

      const streets = Array.isArray(context.allStreetTargets)
        ? context.allStreetTargets
        : (Array.isArray(context.streetTargets)
          ? context.streetTargets
          : (Array.isArray(context.streets) ? context.streets : []));

      const indexedStreets = [];
      for (let i = 0; i < streets.length; i += 1) {
        const street = streets[i];
        if (!street) continue;
        const sections = extractSections(street.geometry || street);
        if (sections.length === 0) continue;
        const bbox = computeSectionsBbox(sections);
        if (!bbox) continue;

        indexedStreets.push({
          id: street.id,
          name: street.displayName || street.name || "",
          areaIds: Array.isArray(street.areaIds) ? street.areaIds : [],
          sections,
          bbox
        });
      }
      this.streetIndex = indexedStreets;
      this.diagnostics.totalStreets = indexedStreets.length;

      // Gemeindegrenze (Polygon / MultiPolygon)
      const boundaryGeom = context.metadata?.boundary
        || context.boundary
        || context.city?.boundary
        || null;

      if (boundaryGeom) {
        const rings = extractRings(boundaryGeom);
        if (rings.length > 0) {
          const bbox = computeRingsBbox(rings);
          if (bbox) {
            this.boundary = { rings, bbox };
          }
        }
      }

      this._updateAreaBoundary(this.activeArea);
    }

    _updateAreaBoundary(area) {
      this.areaBoundary = null;
      if (!area) return;

      const geom = area.polygon || area.boundary || null;
      if (geom) {
        const rings = extractRings(geom);
        if (rings.length > 0) {
          const bbox = computeRingsBbox(rings);
          if (bbox) {
            this.areaBoundary = { rings, bbox };
          }
        }
      }
    }

    _getViewportBbox() {
      const map = this.map;
      if (!map || typeof map.getBounds !== "function") return null;
      const bounds = map.getBounds();
      if (!bounds || typeof bounds.getSouthWest !== "function" || typeof bounds.getNorthEast !== "function") {
        return null;
      }
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const padLon = Math.abs(ne.lng - sw.lng) * 0.08;
      const padLat = Math.abs(ne.lat - sw.lat) * 0.08;

      return {
        minLon: Math.min(sw.lng, ne.lng) - padLon,
        minLat: Math.min(sw.lat, ne.lat) - padLat,
        maxLon: Math.max(sw.lng, ne.lng) + padLon,
        maxLat: Math.max(sw.lat, ne.lat) + padLat
      };
    }

    _repositionCanvas() {
      const map = this.map;
      const canvas = this.canvas;
      if (!canvas || !map) return;

      const size = typeof map.getSize === "function" ? map.getSize() : { x: 800, y: 600 };
      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      const targetWidth = Math.max(1, Math.round(size.x));
      const targetHeight = Math.max(1, Math.round(size.y));

      if (canvas.width !== Math.round(targetWidth * dpr) || canvas.height !== Math.round(targetHeight * dpr)) {
        canvas.width = Math.round(targetWidth * dpr);
        canvas.height = Math.round(targetHeight * dpr);
        canvas.style.width = targetWidth + "px";
        canvas.style.height = targetHeight + "px";
      }

      if (this.ctx && typeof this.ctx.setTransform === "function") {
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      if (this.pane && typeof map.containerPointToLayerPoint === "function") {
        const origin = map.containerPointToLayerPoint([0, 0]);
        if (typeof L !== "undefined" && L.DomUtil && typeof L.DomUtil.setPosition === "function") {
          L.DomUtil.setPosition(canvas, origin);
        } else if (origin) {
          canvas.style.transform = `translate3d(${Math.round(origin.x)}px, ${Math.round(origin.y)}px, 0px)`;
        }
      }
    }

    refresh() {
      this.render();
    }

    render() {
      if (!this.enabled) return;
      const startedAt = monotonicNow();
      const map = this.map;
      const canvas = this.canvas;
      const ctx = this.ctx;

      if (!canvas || !ctx || !map) return;

      this._repositionCanvas();

      const size = typeof map.getSize === "function" ? map.getSize() : { x: canvas.width, y: canvas.height };
      ctx.clearRect(0, 0, size.x, size.y);

      const viewportBbox = this._getViewportBbox();
      if (!viewportBbox) return;

      // 1. Gemeindegrenze zeichnen (subtil, im Hintergrund)
      if (this.boundary && boundsOverlap(this.boundary.bbox, viewportBbox)) {
        this._renderBoundaryRings(ctx, this.boundary.rings, this.options.boundaryColor, 1.8, [6, 4]);
      }

      // 2. TrainingArea-Grenze zeichnen (falls vorhanden)
      if (this.areaBoundary && boundsOverlap(this.areaBoundary.bbox, viewportBbox)) {
        this._renderBoundaryRings(ctx, this.areaBoundary.rings, this.options.areaBoundaryColor, 2.0, [4, 4]);
      }

      // 3. Straßen filtern
      const activeAreaId = this.activeArea?.id || null;
      const candidates = [];
      for (let i = 0; i < this.streetIndex.length; i += 1) {
        const entry = this.streetIndex[i];
        if (activeAreaId && !entry.areaIds.includes(activeAreaId)) {
          continue;
        }
        if (boundsOverlap(entry.bbox, viewportBbox)) {
          candidates.push(entry);
        }
      }

      this.diagnostics.candidateStreets = candidates.length;
      this.diagnostics.renderedStreets = candidates.length;

      // 4. Zoomabhängige Linienstärke
      const zoom = typeof map.getZoom === "function" ? map.getZoom() : 13;
      let lineWidth = 1.6;
      let strokeStyle = this.options.roadColor;

      if (zoom <= 11) {
        lineWidth = 1.0;
        strokeStyle = "rgba(141, 153, 164, 0.7)";
      } else if (zoom <= 13) {
        lineWidth = 1.5;
        strokeStyle = "rgba(141, 153, 164, 0.85)";
      } else if (zoom <= 15) {
        lineWidth = 2.2;
        strokeStyle = "rgba(125, 138, 150, 0.95)";
      } else {
        lineWidth = 3.2;
        strokeStyle = "rgba(110, 122, 134, 0.98)";
      }

      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      let totalSegments = 0;
      ctx.beginPath();
      for (let i = 0; i < candidates.length; i += 1) {
        const sections = candidates[i].sections;
        for (let s = 0; s < sections.length; s += 1) {
          const sec = sections[s];
          if (!Array.isArray(sec) || sec.length < 2) continue;
          const firstPt = this._toContainerPoint(sec[0]);
          if (!firstPt) continue;
          ctx.moveTo(firstPt.x, firstPt.y);
          for (let c = 1; c < sec.length; c += 1) {
            const pt = this._toContainerPoint(sec[c]);
            if (pt) {
              ctx.lineTo(pt.x, pt.y);
              totalSegments += 1;
            }
          }
        }
      }
      ctx.stroke();
      ctx.restore();

      this.diagnostics.renderedSegments = totalSegments;
      this.diagnostics.lastRenderMs = Math.round((monotonicNow() - startedAt) * 10) / 10;
    }

    _toContainerPoint(coord) {
      const map = this.map;
      if (!map || typeof map.latLngToContainerPoint !== "function") return null;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return map.latLngToContainerPoint([lat, lon]);
    }

    _renderBoundaryRings(ctx, rings, strokeStyle, lineWidth, lineDash) {
      if (!ctx || !Array.isArray(rings) || rings.length === 0) return;
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (Array.isArray(lineDash) && typeof ctx.setLineDash === "function") {
        ctx.setLineDash(lineDash);
      }
      ctx.beginPath();
      for (let r = 0; r < rings.length; r += 1) {
        const ring = rings[r];
        if (!Array.isArray(ring) || ring.length < 2) continue;
        const first = this._toContainerPoint(ring[0]);
        if (!first) continue;
        ctx.moveTo(first.x, first.y);
        for (let c = 1; c < ring.length; c += 1) {
          const pt = this._toContainerPoint(ring[c]);
          if (pt) ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
    }

    getDiagnostics() {
      return { ...this.diagnostics };
    }

    destroy() {
      this.setEnabled(false);
      this._unbindEvents();
      if (this.canvas) {
        if (typeof this.canvas.remove === "function") {
          this.canvas.remove();
        } else if (this.canvas.parentNode && typeof this.canvas.parentNode.removeChild === "function") {
          this.canvas.parentNode.removeChild(this.canvas);
        }
      }
      this.canvas = null;
      this.ctx = null;
      this.pane = null;
      this.streetIndex = [];
      this.boundary = null;
      this.areaBoundary = null;
      this.cityContext = null;
      this.activeArea = null;
    }
  }

  function create(options = {}) {
    const map = options.map || options;
    return new OfflineBasemapLayer(map, options);
  }

  return {
    create,
    coordinateBounds,
    boundsOverlap,
    extractSections,
    extractRings
  };
});

