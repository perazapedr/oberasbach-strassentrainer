/**
 * Straßentrainer - Service Worker
 * Phase 14.4a: Karteneditor-/Overpass-Stabilisierung
 */

const STATIC_CACHE = "strassentrainer-static-v9";

const STATIC_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "geometry.js",
  "poi-categories.js",
  "targets.js",
  "statistics.js",
  "game-engine.js",
  "timer.js",
  "city-storage.js",
  "city-data-validator.js",
  "custom-training-area.js",
  "city-package.js",
  "city-update.js",
  "city-manager-ui.js",
  "default-city.js",
  "osm-service.js",
  "offline-basemap.js",
  "manifest.webmanifest",
  "data/cities/oberasbach.json",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
  "vendor/leaflet/images/layers.png",
  "vendor/leaflet/images/layers-2x.png",
  "vendor/turf/turf.min.js"
];

function classifyRequest(request) {
  const method = request?.method || "GET";
  if (method !== "GET") {
    return "BYPASS";
  }

  const url = new URL(request.url, typeof self !== "undefined" && self.location ? self.location.href : "http://localhost/");

  if (url.hostname.includes("nominatim.openstreetmap.org")) {
    return "NOMINATIM_NETWORK_ONLY";
  }

  if (url.pathname.includes("/api/interpreter") || url.hostname.includes("overpass")) {
    return "OVERPASS_NETWORK_ONLY";
  }

  if (url.hostname.includes("cartocdn.com") || url.hostname.includes("tile.openstreetmap.org")) {
    return "TILE_NETWORK_ONLY";
  }

  if (request.mode === "navigate") {
    return "NAVIGATION";
  }

  return "STATIC_ASSET";
}

if (typeof self !== "undefined" && "addEventListener" in self && typeof ServiceWorkerGlobalScope !== "undefined") {
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(STATIC_CACHE)
        .then((cache) => cache.addAll(STATIC_ASSETS))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key.startsWith("strassentrainer-static-") && key !== STATIC_CACHE) {
              return caches.delete(key);
            }
          })
        );
      }).then(() => self.clients.claim())
    );
  });

  self.addEventListener("fetch", (event) => {
    const strategy = classifyRequest(event.request);

    if (strategy === "BYPASS" || strategy === "NOMINATIM_NETWORK_ONLY" || strategy === "OVERPASS_NETWORK_ONLY") {
      return;
    }

    if (strategy === "TILE_NETWORK_ONLY") {
      event.respondWith(
        fetch(event.request).catch(() => {
          return new Response("", { status: 408, statusText: "Tile unavailable offline" });
        })
      );
      return;
    }

    if (strategy === "NAVIGATION") {
      event.respondWith(
        fetch(event.request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put("./index.html", clone));
          }
          return response;
        }).catch(async () => {
          const cached = await caches.match("./index.html", { ignoreSearch: true })
            || await caches.match("index.html", { ignoreSearch: true })
            || await caches.match("./");
          return cached || Response.error();
        })
      );
      return;
    }

    // STATIC_ASSET: Cache First with fallback to Network
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.type === "basic") {
            const clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    STATIC_CACHE,
    STATIC_ASSETS,
    classifyRequest
  };
}
