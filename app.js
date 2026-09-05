"use strict";

const geometryApi = window.StreetGeometry;
const targetApi = window.StrassentrainerTargets;
const statisticsApi = window.StrassentrainerStatistics;
const defaultCityApi = window.StrassentrainerDefaultCity;
const timerApi = window.StrassentrainerTimer;
const offlineBasemapApi = window.StrassentrainerOfflineBasemap;
const {
  GAME_STATUS,
  MODE_CONFIGS,
  createGameEngine
} = window.StrassentrainerEngine;

const cartoApiKey = (window.STRASSENTRAINER_CONFIG && window.STRASSENTRAINER_CONFIG.cartoApiKey) || "";
const cartoKeyQuery = cartoApiKey ? `?key=${encodeURIComponent(cartoApiKey)}` : "";

const MAP_STYLE = {
  tileUrl: `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png${cartoKeyQuery}`,
  roadContrastUrl: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png${cartoKeyQuery}`,
  roadContrastMinZoom: 15,
  roadContrastOpacity: 0.34,
  solution: "#d71936",
  connection: "#0067b9"
};

const CONFIG = {
  initialZoom: 13,
  minZoom: 8,
  maxZoom: 19,
  maxBoundsPadding: 0.45,
  contentSettingsStorageKey: "oberasbach-strassentrainer-inhalt-v1",
  debug: new URLSearchParams(window.location.search).get("debug") === "1"
};

const RUNTIME_STATUS = Object.freeze({
  BOOTING: "booting",
  LOADING_CITY: "loading-city",
  READY: "ready",
  ERROR: "error"
});

function monotonicNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function recordRuntimeTiming(diagnostics, name, startedAt) {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return;
  if (!diagnostics.timingsMs) diagnostics.timingsMs = {};
  diagnostics.timingsMs[name] = Math.round((monotonicNow() - startedAt) * 10) / 10;
}

const poiCategoriesApi = (typeof window !== "undefined" && window.StrassentrainerPoiCategories)
  || (typeof globalThis !== "undefined" && globalThis.StrassentrainerPoiCategories)
  || null;

const POI_CATEGORY_LABELS = Object.freeze({
  fire_station: "Feuerwehr",
  police: "Polizei",
  hospital: "Krankenhäuser",
  nursing_care: "Pflegeeinrichtungen",
  school: "Schulen",
  kindergarten: "Kindergärten",
  childcare: "Kindertagesstätte",
  supermarket: "Supermärkte",
  fuel: "Tankstellen",
  hotel: "Hotels",
  restaurant: "Gaststätten",
  sports_facility: "Sportstätten",
  company: "Unternehmen",
  public_building: "Öffentliche Gebäude"
});

function cityName(metadata) {
  return String(metadata && (metadata.displayName || metadata.name) || "Unbekannte Stadt").trim();
}

function createLeafletBounds(metadata) {
  const bounds = metadata && metadata.bounds;
  if (!bounds) return null;
  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);
  if (![south, west, north, east].every(Number.isFinite)
    || south > north || west > east) return null;
  const leafletBounds = L.latLngBounds([south, west], [north, east]);
  return !leafletBounds || (typeof leafletBounds.isValid === "function" && !leafletBounds.isValid())
    ? null
    : leafletBounds;
}

const els = {
  alarmCard: document.querySelector(".alarm-card"),
  targetStreet: document.getElementById("targetStreet"),
  instruction: document.getElementById("instruction"),
  mainButton: document.getElementById("mainButton"),
  resultCard: document.getElementById("resultCard"),
  resultTitle: document.getElementById("resultTitle"),
  distanceValue: document.getElementById("distanceValue"),
  scoreValue: document.getElementById("scoreValue"),
  resultMessage: document.getElementById("resultMessage"),
  roundValue: document.getElementById("roundValue"),
  totalScoreValue: document.getElementById("totalScoreValue"),
  scorePointsPanel: document.getElementById("scorePointsPanel"),
  statusCard: document.getElementById("statusCard"),
  statusText: document.getElementById("statusText"),
  offlineBanner: document.getElementById("offlineBanner"),
  offlineBasemapBadge: document.getElementById("offlineBasemapBadge"),
  mapHint: document.getElementById("mapHint"),
  mapPanel: document.getElementById("mapPanel"),
  modeCard: document.getElementById("modeCard"),
  modeSelect: document.getElementById("modeSelect"),
  trainingAreaFieldGroup: document.getElementById("trainingAreaFieldGroup"),
  trainingAreaSelect: document.getElementById("trainingAreaSelect"),
  timedSettings: document.getElementById("timedSettings"),
  secondsPerRoundSelect: document.getElementById("secondsPerRoundSelect"),
  totalRoundsSelect: document.getElementById("totalRoundsSelect"),
  contentSelectionSelect: document.getElementById("contentSelectionSelect"),
  showTargetCategoryCheckbox: document.getElementById("showTargetCategoryCheckbox"),
  poiCategoryDetails: document.getElementById("poiCategoryDetails"),
  poiCategoryOptions: document.getElementById("poiCategoryOptions"),
  targetCategoryLabel: document.getElementById("targetCategoryLabel"),
  timerPanel: document.getElementById("timerPanel"),
  timerValue: document.getElementById("timerValue"),
  timerProgress: document.getElementById("timerProgress"),
  endGameButton: document.getElementById("endGameButton"),
  summaryCard: document.getElementById("summaryCard"),
  summaryTotalPoints: document.getElementById("summaryTotalPoints"),
  summaryAveragePoints: document.getElementById("summaryAveragePoints"),
  summaryAverageDistance: document.getElementById("summaryAverageDistance"),
  summaryAverageTime: document.getElementById("summaryAverageTime"),
  summaryTimeouts: document.getElementById("summaryTimeouts"),
  summaryHitRate: document.getElementById("summaryHitRate"),
  summaryTotalDuration: document.getElementById("summaryTotalDuration"),
  summaryBestRound: document.getElementById("summaryBestRound"),
  summaryWorstRound: document.getElementById("summaryWorstRound"),
  summaryTargetBreakdown: document.getElementById("summaryTargetBreakdown"),
  repeatTimedButton: document.getElementById("repeatTimedButton"),
  examResultsCard: document.getElementById("examResultsCard"),
  examAwardCard: document.getElementById("examAwardCard"),
  examAwardSymbol: document.getElementById("examAwardSymbol"),
  examAwardName: document.getElementById("examAwardName"),
  examAwardPercentage: document.getElementById("examAwardPercentage"),
  examAwardDescription: document.getElementById("examAwardDescription"),
  examTotalPoints: document.getElementById("examTotalPoints"),
  examMaximumPoints: document.getElementById("examMaximumPoints"),
  examPercentage: document.getElementById("examPercentage"),
  examAverageDistance: document.getElementById("examAverageDistance"),
  examAverageTime: document.getElementById("examAverageTime"),
  examHitRate: document.getElementById("examHitRate"),
  examUnanswered: document.getElementById("examUnanswered"),
  examBestRound: document.getElementById("examBestRound"),
  examWorstRound: document.getElementById("examWorstRound"),
  examTargetBreakdown: document.getElementById("examTargetBreakdown"),
  examTaskList: document.getElementById("examTaskList"),
  returnToExamResultsButton: document.getElementById("returnToExamResultsButton"),
  legendCard: document.getElementById("legendCard"),
  statisticsDetails: document.getElementById("statisticsDetails"),
  statisticsHeading: document.getElementById("statisticsHeading"),
  statisticsModeFilter: document.getElementById("statisticsModeFilter"),
  statisticsTargetFilter: document.getElementById("statisticsTargetFilter"),
  statisticsOverview: document.getElementById("statisticsOverview"),
  statisticsBestTarget: document.getElementById("statisticsBestTarget"),
  statisticsWorstTarget: document.getElementById("statisticsWorstTarget"),
  statisticsMostPlayedTarget: document.getElementById("statisticsMostPlayedTarget"),
  statisticsHighestExam: document.getElementById("statisticsHighestExam"),
  statisticsHighestRank: document.getElementById("statisticsHighestRank"),
  statisticsLastPlayed: document.getElementById("statisticsLastPlayed"),
  statisticsImportStrategy: document.getElementById("statisticsImportStrategy"),
  statisticsExportButton: document.getElementById("statisticsExportButton"),
  statisticsImportButton: document.getElementById("statisticsImportButton"),
  statisticsResetButton: document.getElementById("statisticsResetButton"),
  statisticsImportInput: document.getElementById("statisticsImportInput"),
  statisticsMessage: document.getElementById("statisticsMessage")
};

if (typeof L !== "undefined" && L.Icon && L.Icon.Default) {
  L.Icon.Default.imagePath = "vendor/leaflet/images/";
}

const map = L.map("map", {
  center: [51, 10],
  zoom: CONFIG.minZoom,
  zoomControl: true,
  attributionControl: false,
  minZoom: CONFIG.minZoom,
  maxZoom: CONFIG.maxZoom,
  preferCanvas: true
});

const baseTileLayer = L.tileLayer(MAP_STYLE.tileUrl, {
  subdomains: "abcd",
  maxZoom: 20,
  detectRetina: true,
  crossOrigin: true
});

const roadContrastPane = map.createPane("roadContrastPane");
roadContrastPane.style.zIndex = "210";
roadContrastPane.style.pointerEvents = "none";
roadContrastPane.style.mixBlendMode = "multiply";

const contrastTileLayer = L.tileLayer(MAP_STYLE.roadContrastUrl, {
  pane: "roadContrastPane",
  minZoom: MAP_STYLE.roadContrastMinZoom,
  maxZoom: 20,
  opacity: MAP_STYLE.roadContrastOpacity,
  subdomains: "abcd",
  detectRetina: true,
  crossOrigin: true
});

const offlineBasemap = (typeof offlineBasemapApi !== "undefined" && offlineBasemapApi && typeof offlineBasemapApi.create === "function")
  ? offlineBasemapApi.create({ map })
  : ((typeof window !== "undefined" && window.StrassentrainerOfflineBasemap && typeof window.StrassentrainerOfflineBasemap.create === "function")
    ? window.StrassentrainerOfflineBasemap.create({ map })
    : null);

const TILE_ERROR_THRESHOLD = 6;
const TILE_ERROR_WINDOW_MS = 10000;

const basemapCoordinator = {
  mode: "auto",
  activeBasemap: "online",
  tileErrorTimestamps: [],
  cartoFallbackActive: false,

  isOnline() {
    return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true;
  },

  shouldUseOfflineBasemap() {
    if (this.mode === "offline") return true;
    if (this.mode === "online") return false;
    return !this.isOnline() || this.cartoFallbackActive;
  },

  update() {
    const needOffline = this.shouldUseOfflineBasemap();
    const targetBasemap = needOffline ? "offline" : "online";
    this.activeBasemap = targetBasemap;

    if (needOffline) {
      if (typeof map.hasLayer === "function" && map.hasLayer(baseTileLayer)) map.removeLayer(baseTileLayer);
      if (typeof map.hasLayer === "function" && map.hasLayer(contrastTileLayer)) map.removeLayer(contrastTileLayer);
      if (offlineBasemap) {
        offlineBasemap.setEnabled(true);
        if (cityContext) {
          offlineBasemap.setCityContext(cityContext);
        }
      }
    } else {
      if (offlineBasemap) offlineBasemap.setEnabled(false);
      if (typeof map.hasLayer === "function") {
        if (!map.hasLayer(baseTileLayer)) baseTileLayer.addTo(map);
        if (!map.hasLayer(contrastTileLayer)) contrastTileLayer.addTo(map);
      }
    }
    this._updateBannerBadge();
  },

  handleTileError() {
    if (this.mode === "online" || this.activeBasemap === "offline") return;
    const now = monotonicNow();
    this.tileErrorTimestamps.push(now);
    this.tileErrorTimestamps = this.tileErrorTimestamps.filter(t => now - t <= TILE_ERROR_WINDOW_MS);
    if (this.tileErrorTimestamps.length >= TILE_ERROR_THRESHOLD) {
      if (CONFIG.debug) {
        console.warn(`CARTO Basemap nicht erreichbar (${this.tileErrorTimestamps.length} Fehler), aktiviere Offline-Vektorkarte Fallback.`);
      }
      this.cartoFallbackActive = true;
      this.update();
    }
  },

  resetCartoFallback() {
    this.cartoFallbackActive = false;
    this.tileErrorTimestamps = [];
  },

  setMode(newMode) {
    if (!["auto", "online", "offline"].includes(newMode)) return;
    this.mode = newMode;
    if (newMode === "online") {
      this.resetCartoFallback();
    }
    this.update();
  },

  _updateBannerBadge() {
    const badge = els.offlineBasemapBadge || (typeof document !== "undefined" ? document.getElementById("offlineBasemapBadge") : null);
    if (badge) {
      if (this.activeBasemap === "offline") {
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
  }
};

if (typeof baseTileLayer.on === "function") {
  baseTileLayer.on("tileerror", () => basemapCoordinator.handleTileError());
}
if (typeof contrastTileLayer.on === "function") {
  contrastTileLayer.on("tileerror", () => basemapCoordinator.handleTileError());
}

if (!basemapCoordinator.shouldUseOfflineBasemap()) {
  baseTileLayer.addTo(map);
  contrastTileLayer.addTo(map);
} else {
  basemapCoordinator.update();
}

const solutionLayers = L.featureGroup().addTo(map);
const answerLayers = L.featureGroup().addTo(map);
const fireStationLayers = L.featureGroup().addTo(map);

let statisticsStore = statisticsApi.createStatisticsStore(
  localStorage,
  statisticsApi.getStatisticsStorageKey(defaultCityApi.DEFAULT_CITY_ID),
  {
    cityId: defaultCityApi.DEFAULT_CITY_ID,
    cityName: "Oberasbach"
  }
);
const gameStatisticsStore = Object.freeze({
  getSnapshot: (...args) => statisticsStore.getSnapshot(...args),
  recordGameStarted: (...args) => statisticsStore.recordGameStarted(...args),
  recordRound: (...args) => statisticsStore.recordRound(...args),
  recordGameFinished: (...args) => statisticsStore.recordGameFinished(...args)
});
const gameEngine = createGameEngine({
  scoreCalculator: (distanceMeters, _config, target) =>
    targetApi.calculateTargetScore(distanceMeters, target),
  statisticsStore: gameStatisticsStore,
  hitThresholdsMeters: statisticsApi.HIT_THRESHOLDS_METERS
});
const gameState = gameEngine.gameState;
let autoAdvanceTimeoutId = null;
let roundPreparationToken = 0;
let lastTimedConfig = null;
let examHistoryGuardActive = false;
const examGeometryByRound = new Map();

const roundTimer = timerApi.createDeadlineTimer({
  onTick: renderCountdown,
  onExpire: handleRoundTimeout
});

let poiCategories = [];
const contentRepository = {
  streetTargets: [],
  poiTargets: [],
  lastTargetId: null,
  selectedTargetIds: new Set(),
  unavailableTargetIds: new Set(),
  selectionCounts: { street: 0, poi: 0 }
};

let contentSettings = null;
let cityContext = null;
const runtimeState = {
  status: RUNTIME_STATUS.BOOTING,
  error: null,
  activationId: 0
};
let activationCommitQueue = Promise.resolve();
let pendingActivation = null;

function isCountdownMode(mode = gameState.config.mode) {
  return mode === "timed" || mode === "exam";
}

function isExamInProgress() {
  return gameState.config.mode === "exam"
    && gameState.startedAt !== null
    && gameState.status !== GAME_STATUS.FINISHED;
}

const mapView = {
  clearRound() {
    solutionLayers.clearLayers();
    answerLayers.clearLayers();
  },
  resetViewport(animate = true) {
    if (cityContext?.leafletBounds) {
      map.fitBounds(cityContext.leafletBounds, { animate, padding: [12, 12] });
      return;
    }
    if (cityContext?.metadata?.center) {
      map.setView(
        [Number(cityContext.metadata.center.lat), Number(cityContext.metadata.center.lon)],
        Number(cityContext.metadata.defaultZoom) || CONFIG.initialZoom,
        { animate }
      );
      return;
    }
    map.setView([51, 10], CONFIG.minZoom, { animate });
  },
  showRoundSolution(guessLatLng, nearestCoordinate, target) {
    renderRoundSolutionOnMap(guessLatLng, nearestCoordinate, target);
  }
};

function renderFireStations() {
  fireStationLayers.clearLayers();
  if (!cityContext) return;
  const stationIcon = L.divIcon({
    className: "",
    html: '<div class="fire-station-marker" aria-hidden="true">🚒</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  cityContext.fireStations.forEach(station => {
    L.marker([station.latitude, station.longitude], {
      icon: stationIcon,
      interactive: false,
      keyboard: false,
      alt: station.displayName
    }).addTo(fireStationLayers);
  });
}

function getPoiCategoryLabel(categoryId, suppliedCategories = []) {
  const supplied = suppliedCategories.find(category => category.id === categoryId);
  if (supplied?.label) return supplied.label;
  if (poiCategoriesApi && poiCategoriesApi.getLabel(categoryId)) return poiCategoriesApi.getLabel(categoryId);
  if (POI_CATEGORY_LABELS[categoryId]) return POI_CATEGORY_LABELS[categoryId];
  return String(categoryId || "Ort")
    .replace(/[_-]+/g, " ")
    .replace(/^./, character => character.toLocaleUpperCase("de-DE"));
}

function normalizeCityMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Stadtmetadaten fehlen.");
  }
  const id = String(metadata.id || "").trim();
  const name = cityName(metadata);
  if (!id || !name || name === "Unbekannte Stadt") {
    throw new Error("Die Stadt besitzt keine gültige ID oder Bezeichnung.");
  }
  return {
    ...metadata,
    id,
    name: String(metadata.name || name).trim(),
    displayName: name,
    bounds: metadata.bounds ? { ...metadata.bounds } : null,
    center: metadata.center ? { ...metadata.center } : null,
    postalCodes: Array.isArray(metadata.postalCodes) ? [...metadata.postalCodes] : []
  };
}

function getTrainingAreaStorageKey(cityId) {
  return `strassentrainer.trainingArea.${cityId}`;
}

function getSavedTrainingAreaId(cityId) {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(getTrainingAreaStorageKey(cityId))
      : null;
  } catch (_) {
    return null;
  }
}

function setSavedTrainingAreaId(cityId, areaId) {
  try {
    if (typeof localStorage !== "undefined") {
      if (areaId) {
        localStorage.setItem(getTrainingAreaStorageKey(cityId), String(areaId).trim());
      } else {
        localStorage.removeItem(getTrainingAreaStorageKey(cityId));
      }
    }
  } catch (_) {}
}

function createAreaLeafletBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) {
    return null;
  }
  if (typeof L !== "undefined" && typeof L.latLngBounds === "function") {
    return L.latLngBounds([south, west], [north, east]);
  }
  return {
    pad: () => createAreaLeafletBounds(bounds),
    getSouthWest: () => ({ lat: south, lng: west }),
    getNorthEast: () => ({ lat: north, lng: east })
  };
}

function buildCityContext(cityData, diagnostics = null) {
  const contextStartedAt = monotonicNow();
  const sourceType = "installed";
  if (!cityData || !Array.isArray(cityData.streets) || !Array.isArray(cityData.pois)) {
    throw new Error("Das lokale Stadtpaket ist unvollständig.");
  }
  const metadata = normalizeCityMetadata({
    ...cityData.city,
    boundary: cityData.city?.boundary || cityData.boundary || null
  });
  const leafletBounds = createLeafletBounds(metadata);
  const centerLat = Number(metadata.center?.lat);
  const centerLon = Number(metadata.center?.lon);
  if (!leafletBounds && ![centerLat, centerLon].every(Number.isFinite)) {
    throw new Error(`Für ${cityName(metadata)} fehlen gültige Kartenkoordinaten.`);
  }

  cityData.streets.forEach(street => {
    if (street?.cityId !== metadata.id) {
      throw new Error("Das Stadtpaket enthält eine Straße aus einer anderen Stadt.");
    }
  });
  cityData.pois.forEach(poi => {
    if (poi?.cityId !== metadata.id) {
      throw new Error("Das Stadtpaket enthält einen POI aus einer anderen Stadt.");
    }
  });
  const areas = Array.isArray(cityData.areas) ? cityData.areas : [];
  areas.forEach(area => {
    if (area?.cityId !== metadata.id) {
      throw new Error("Das Stadtpaket enthält ein Trainingsgebiet aus einer anderen Stadt.");
    }
  });

  const suppliedCategories = [];
  const categoryIds = [...new Set(cityData.pois
    .map(poi => String(poi?.category || "other-relevant"))
    .filter(Boolean))];
  const categories = categoryIds.map(id => ({
    id,
    label: getPoiCategoryLabel(id, suppliedCategories)
  }));
  if (poiCategoriesApi) {
    categories.sort((a, b) => {
      const defA = poiCategoriesApi.getById(a.id);
      const defB = poiCategoriesApi.getById(b.id);
      const orderA = defA ? defA.order : 999;
      const orderB = defB ? defB.order : 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.label.localeCompare(b.label, "de");
    });
  }
  const targetStartedAt = monotonicNow();
  const streetTargets = targetApi.prepareStreetTargets(cityData.streets, geometryApi);
  const poiTargets = targetApi.preparePoiTargets(cityData.pois, categories);
  recordRuntimeTiming(diagnostics, "targetPreparationMs", targetStartedAt);

  if (streetTargets.length === 0) {
    throw new Error(`Für ${cityName(metadata)} sind keine Straßen gespeichert.`);
  }
  const invalidStreet = streetTargets.find(target =>
    !targetApi.isValidTargetGeometry(target, geometryApi));
  if (invalidStreet) {
    throw new Error(`Die lokale Geometrie von „${invalidStreet.displayName}“ ist unvollständig.`);
  }
  const invalidPoi = poiTargets.find(target =>
    !target.displayName
    || !Number.isFinite(target.latitude)
    || !Number.isFinite(target.longitude)
    || !targetApi.isValidTargetGeometry(target, geometryApi));
  if (invalidPoi) {
    throw new Error(`Der lokale POI „${invalidPoi.displayName || invalidPoi.id}“ ist unvollständig.`);
  }

  const fireStations = poiTargets.filter(poi => poi.category === "fire_station"
    || poi.subcategory === "Feuerwehrgerätehaus");

  const allStreetTargets = streetTargets;
  const allPoiTargets = poiTargets;
  const allFireStations = fireStations;
  const cityLeafletBounds = leafletBounds;

  let activeAreaId = null;
  let activeArea = null;
  let currentStreetTargets = streetTargets;
  let currentPoiTargets = poiTargets;
  let currentFireStations = fireStations;
  let currentLeafletBounds = leafletBounds;

  const savedAreaId = getSavedTrainingAreaId(metadata.id);
  if (savedAreaId && areas.some(a => a.id === savedAreaId)) {
    const foundArea = areas.find(a => a.id === savedAreaId);
    const filteredStreets = allStreetTargets.filter(
      s => Array.isArray(s.areaIds) && s.areaIds.includes(foundArea.id)
    );
    if (filteredStreets.length >= 1) {
      activeAreaId = foundArea.id;
      activeArea = foundArea;
      currentStreetTargets = filteredStreets;
      currentPoiTargets = allPoiTargets.filter(
        p => Array.isArray(p.areaIds) && p.areaIds.includes(foundArea.id)
      );
      currentFireStations = allFireStations.filter(
        f => Array.isArray(f.areaIds) && f.areaIds.includes(foundArea.id)
      );
      if (foundArea.bounds) {
        currentLeafletBounds = createAreaLeafletBounds(foundArea.bounds) || cityLeafletBounds;
      }
    } else {
      setSavedTrainingAreaId(metadata.id, null);
    }
  }

  const context = {
    sourceType,
    metadata,
    areas,
    activeAreaId,
    activeArea,
    allStreetTargets,
    allPoiTargets,
    allFireStations,
    cityLeafletBounds,
    streetTargets: currentStreetTargets,
    poiTargets: currentPoiTargets,
    poiCategories: categories,
    fireStations: currentFireStations,
    leafletBounds: currentLeafletBounds
  };
  recordRuntimeTiming(diagnostics, "buildCityContextMs", contextStartedAt);
  return context;
}

function createStatisticsStoreForCityContext(context) {
  if (!context?.metadata?.id) throw new Error("Für die Statistik fehlt eine gültige Stadt-ID.");
  if (context.metadata.id === defaultCityApi.DEFAULT_CITY_ID) {
    defaultCityApi.migrateLegacyOberasbachStatistics(localStorage, statisticsApi);
  }
  const storageKey = statisticsApi.getStatisticsStorageKey(context.metadata.id);
  return statisticsApi.createStatisticsStore(localStorage, storageKey, {
    cityId: context.metadata.id,
    cityName: cityName(context.metadata)
  });
}

async function loadCityContext(cityId, diagnostics = null) {
  const startedAt = monotonicNow();
  const storage = window.StrassentrainerCityStorage;
  if (!storage) throw new Error("Der lokale Stadtspeicher ist nicht verfügbar.");
  let cityData = null;
  if (typeof storage.getCityData === "function") {
    cityData = await storage.getCityData(cityId, { diagnostics });
  } else {
    const city = await storage.getCity(cityId);
    if (city) {
      const [streets, pois] = await Promise.all([
        storage.getCityStreets(cityId),
        storage.getCityPois(cityId)
      ]);
      cityData = { city, streets, pois };
    }
  }
  if (!cityData) throw new Error("Die ausgewählte Stadt wurde lokal nicht gefunden.");
  const context = buildCityContext(cityData, diagnostics);
  recordRuntimeTiming(diagnostics, "loadCityContextMs", startedAt);
  return context;
}

async function clearActiveCityIdIfCurrent(expectedCityId) {
  const storage = window.StrassentrainerCityStorage;
  if (!storage || typeof storage.setActiveCityId !== "function") return;
  const currentId = typeof storage.getActiveCityId === "function"
    ? storage.getActiveCityId()
    : expectedCityId;
  if (currentId === expectedCityId) await storage.setActiveCityId(null);
}

async function loadInitialCityContext() {
  const storage = window.StrassentrainerCityStorage;
  if (!storage || typeof storage.getAllCities !== "function") {
    throw new Error("Der lokale Stadtspeicher ist nicht verfügbar.");
  }
  let cities = await storage.getAllCities();
  if (cities.length === 0) {
    await defaultCityApi.installBundledDefaultCityIfNeeded(storage);
    cities = await storage.getAllCities();
  }
  if (cities.length === 0) throw new Error("Es ist kein lokales Stadtpaket verfügbar.");

  let migrationWarning = null;
  if (cities.some(city => city.id === defaultCityApi.DEFAULT_CITY_ID)) {
    const migration = defaultCityApi.migrateLegacyOberasbachStatistics(localStorage, statisticsApi);
    if (migration.status === "invalid-legacy-statistics") {
      migrationWarning = "Die bisherige Oberasbach-Statistik war beschädigt und wurde nicht verändert.";
    }
  }

  let expectedCityId = typeof storage.getActiveCityId === "function"
    ? storage.getActiveCityId()
    : null;
  let warning = migrationWarning;
  if (!expectedCityId || !cities.some(city => city.id === expectedCityId)) {
    if (expectedCityId) {
      await clearActiveCityIdIfCurrent(expectedCityId);
      warning = warning || "Die zuletzt aktive Stadt wurde nicht mehr gefunden. Eine vorhandene lokale Stadt wurde aktiviert.";
    }
    expectedCityId = cities[0].id;
    await storage.setActiveCityId(expectedCityId);
  }

  try {
    return { context: await loadCityContext(expectedCityId), warning };
  } catch (error) {
    console.warn("Aktive Stadt konnte nicht geladen werden", error);
    try { await clearActiveCityIdIfCurrent(expectedCityId); } catch (_) {}
    const fallback = cities.find(city => city.id !== expectedCityId);
    if (!fallback) throw error;
    await storage.setActiveCityId(fallback.id);
    return {
      context: await loadCityContext(fallback.id),
      warning: warning || "Die zuletzt aktive Stadt konnte nicht geladen werden. Eine andere lokale Stadt wurde aktiviert."
    };
  }
}

function resetRuntimeForCityChange() {
  stopAllTimers();
  roundPreparationToken += 1;
  deactivateExamHistoryGuard();
  examGeometryByRound.clear();
  gameEngine.resetGame();
  mapView.clearRound();
  fireStationLayers.clearLayers();
  contentRepository.lastTargetId = null;
  contentRepository.selectedTargetIds.clear();
  contentRepository.unavailableTargetIds.clear();
  contentRepository.selectionCounts = { street: 0, poi: 0 };
}

function applyCityContext(
  nextContext,
  nextStatisticsStore = createStatisticsStoreForCityContext(nextContext),
  diagnostics = null
) {
  const applyStartedAt = monotonicNow();
  if (!nextContext?.metadata || !Array.isArray(nextContext.streetTargets)) {
    throw new Error("Der neue Stadtkontext ist ungültig.");
  }
  if (!nextStatisticsStore || typeof nextStatisticsStore.getSnapshot !== "function") {
    throw new Error("Der Statistik-Speicher der neuen Stadt ist ungültig.");
  }
  resetRuntimeForCityChange();
  cityContext = nextContext;
  statisticsStore = nextStatisticsStore;
  gameState.statistics = statisticsStore.getSnapshot();
  contentRepository.streetTargets = nextContext.streetTargets;
  contentRepository.poiTargets = nextContext.poiTargets;
  poiCategories = nextContext.poiCategories;
  contentSettings = loadContentSettings();
  applyContentSettingsToControls();
  applyContentSettingsToGameConfig();

  const mapStartedAt = monotonicNow();
  if (nextContext.leafletBounds) {
    map.setMaxBounds(nextContext.leafletBounds.pad(CONFIG.maxBoundsPadding));
    map.fitBounds(nextContext.leafletBounds, { animate: false, padding: [12, 12] });
  } else {
    map.setMaxBounds(null);
    map.setView(
      [Number(nextContext.metadata.center.lat), Number(nextContext.metadata.center.lon)],
      Number(nextContext.metadata.defaultZoom) || CONFIG.initialZoom,
      { animate: false }
    );
  }
  recordRuntimeTiming(diagnostics, "mapBoundsUpdateMs", mapStartedAt);
  els.mapPanel.setAttribute(
    "aria-label",
    `Unbeschriftete Straßenkarte von ${cityName(nextContext.metadata)}`
  );
  const markerStartedAt = monotonicNow();
  renderFireStations();
  recordRuntimeTiming(diagnostics, "fireStationMarkersMs", markerStartedAt);
  if (offlineBasemap) {
    offlineBasemap.setCityContext(nextContext);
  }
  renderTrainingAreaSelect(nextContext);
  renderStatistics();
  const statisticsLoadWarning = statisticsStore.getLoadWarning();
  setStatisticsMessage(statisticsLoadWarning || "", statisticsLoadWarning ? "error" : "");
  recordRuntimeTiming(diagnostics, "applyCityContextMs", applyStartedAt);
}

function renderTrainingAreaSelect(context) {
  if (!els.trainingAreaSelect || !els.trainingAreaFieldGroup) return;
  const areas = Array.isArray(context?.areas) ? context.areas : [];
  if (areas.length === 0) {
    els.trainingAreaFieldGroup.classList.add("hidden");
    els.trainingAreaSelect.innerHTML = '<option value="">Gesamte Stadt</option>';
    els.trainingAreaSelect.value = "";
    return;
  }
  els.trainingAreaFieldGroup.classList.remove("hidden");
  els.trainingAreaSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Gesamte Stadt";
  els.trainingAreaSelect.appendChild(defaultOption);

  const topLevel = areas.filter(a => !a.parentId || !areas.some(p => p.id === a.parentId));
  const childMap = new Map();
  for (const area of areas) {
    if (area.parentId && areas.some(p => p.id === area.parentId)) {
      if (!childMap.has(area.parentId)) childMap.set(area.parentId, []);
      childMap.get(area.parentId).push(area);
    }
  }

  for (const top of topLevel) {
    const opt = document.createElement("option");
    opt.value = top.id;
    opt.textContent = `${top.name} (${top.streetCount || 0} Straßen)`;
    els.trainingAreaSelect.appendChild(opt);

    const children = childMap.get(top.id) || [];
    for (const child of children) {
      const childOpt = document.createElement("option");
      childOpt.value = child.id;
      childOpt.textContent = `  ↳ ${child.name} (${child.streetCount || 0} Straßen)`;
      els.trainingAreaSelect.appendChild(childOpt);
    }
  }

  els.trainingAreaSelect.value = context.activeAreaId || "";
}

function activateTrainingArea(areaId, options = {}) {
  if (!cityContext) return false;
  const normalizedAreaId = areaId ? String(areaId).trim() : "";
  if (normalizedAreaId === (cityContext.activeAreaId || "")) {
    return true;
  }

  const isRoundActive = [GAME_STATUS.ACTIVE, GAME_STATUS.PREPARING].includes(gameState.status);
  if ((isRoundActive || isExamInProgress()) && !options.force) {
    const message = isExamInProgress()
      ? "Die laufende Prüfung wird vollständig verworfen. Möchtest du das Trainingsgebiet wirklich wechseln?"
      : "Die laufende Runde wird abgebrochen. Möchtest du das Trainingsgebiet wirklich wechseln?";
    const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(message)
      : false;
    if (!confirmed) {
      if (els.trainingAreaSelect) {
        els.trainingAreaSelect.value = cityContext.activeAreaId || "";
      }
      return false;
    }
  }

  stopAllTimers();
  roundPreparationToken += 1;
  deactivateExamHistoryGuard();
  examGeometryByRound.clear();
  gameEngine.resetGame();
  mapView.clearRound();
  fireStationLayers.clearLayers();
  contentRepository.lastTargetId = null;
  contentRepository.selectedTargetIds.clear();
  contentRepository.unavailableTargetIds.clear();
  contentRepository.selectionCounts = { street: 0, poi: 0 };

  const areas = Array.isArray(cityContext.areas) ? cityContext.areas : [];
  if (normalizedAreaId) {
    const targetArea = areas.find(a => a.id === normalizedAreaId);
    if (!targetArea) {
      console.warn(`Trainingsgebiet ${normalizedAreaId} nicht gefunden.`);
      return false;
    }
    cityContext.activeAreaId = targetArea.id;
    cityContext.activeArea = targetArea;
    cityContext.streetTargets = cityContext.allStreetTargets.filter(
      s => Array.isArray(s.areaIds) && s.areaIds.includes(targetArea.id)
    );
    cityContext.poiTargets = cityContext.allPoiTargets.filter(
      p => Array.isArray(p.areaIds) && p.areaIds.includes(targetArea.id)
    );
    cityContext.fireStations = cityContext.allFireStations.filter(
      f => Array.isArray(f.areaIds) && f.areaIds.includes(targetArea.id)
    );
    if (targetArea.bounds) {
      cityContext.leafletBounds = createAreaLeafletBounds(targetArea.bounds) || cityContext.cityLeafletBounds;
    }
    setSavedTrainingAreaId(cityContext.metadata.id, targetArea.id);
  } else {
    cityContext.activeAreaId = null;
    cityContext.activeArea = null;
    cityContext.streetTargets = cityContext.allStreetTargets;
    cityContext.poiTargets = cityContext.allPoiTargets;
    cityContext.fireStations = cityContext.allFireStations;
    cityContext.leafletBounds = cityContext.cityLeafletBounds;
    setSavedTrainingAreaId(cityContext.metadata.id, null);
  }

  contentRepository.streetTargets = cityContext.streetTargets;
  contentRepository.poiTargets = cityContext.poiTargets;

  renderFireStations();
  if (offlineBasemap) {
    offlineBasemap.setTrainingArea(cityContext.activeArea);
  }

  if (cityContext.leafletBounds && map) {
    map.setMaxBounds(cityContext.leafletBounds.pad ? cityContext.leafletBounds.pad(CONFIG.maxBoundsPadding) : null);
    map.fitBounds(cityContext.leafletBounds, { animate: false, padding: [12, 12] });
  }

  if (els.trainingAreaSelect) {
    els.trainingAreaSelect.value = cityContext.activeAreaId || "";
  }
  renderPoiCategoryOptions();

  if (gameState.config.mode === "free") {
    renderIdleGame();
  } else if (isCountdownMode(gameState.config.mode)) {
    renderCountdownConfiguration(gameState.config.mode);
  }
  return true;
}

function handleTrainingAreaChange() {
  if (!els.trainingAreaSelect) return;
  activateTrainingArea(els.trainingAreaSelect.value);
}

function finishRuntimeReady(warning = null) {
  runtimeState.status = RUNTIME_STATUS.READY;
  runtimeState.error = warning;
  startGame(MODE_CONFIGS.free);
  if (warning) setStatus(warning, "error");
}

function setRuntimeLoading(message) {
  runtimeState.status = RUNTIME_STATUS.LOADING_CITY;
  runtimeState.error = null;
  els.mainButton.disabled = true;
  els.mainButton.textContent = "Stadt wird geladen …";
  setStatus(message || "Stadtdaten werden geladen …");
}

function canChangeRuntimeCity() {
  return runtimeState.status === RUNTIME_STATUS.READY;
}

async function performCityActivation(cityId, diagnostics = null) {
  const activationStartedAt = monotonicNow();
  const activationId = ++runtimeState.activationId;
  setRuntimeLoading("Die ausgewählte Stadt wird lokal geladen …");
  let nextContext;
  let nextStatisticsStore;
  try {
    nextContext = await loadCityContext(cityId, diagnostics);
    const statisticsStartedAt = monotonicNow();
    nextStatisticsStore = createStatisticsStoreForCityContext(nextContext);
    recordRuntimeTiming(diagnostics, "statisticsStoreMs", statisticsStartedAt);
  } catch (error) {
    if (activationId === runtimeState.activationId) {
      await activationCommitQueue.catch(() => {});
      if (activationId === runtimeState.activationId && cityContext) {
        finishRuntimeReady("Die ausgewählte Stadt konnte nicht geladen werden. Die bisherige Stadt bleibt aktiv.");
      }
    }
    throw new Error("Die ausgewählte Stadt konnte nicht geladen werden. Die bisherige Stadt bleibt aktiv.", { cause: error });
  }
  if (activationId !== runtimeState.activationId) return null;

  const commit = async () => {
    if (activationId !== runtimeState.activationId) return null;
    const previousContext = cityContext;
    const previousStatisticsStore = statisticsStore;
    const storage = window.StrassentrainerCityStorage;
    const previousActiveCityId = typeof storage.getActiveCityId === "function"
      ? storage.getActiveCityId()
      : (previousContext?.sourceType === "installed" ? previousContext.metadata.id : null);
    try {
      applyCityContext(nextContext, nextStatisticsStore, diagnostics);
      await storage.setActiveCityId(cityId);
    } catch (error) {
      try {
        const currentActiveCityId = typeof storage.getActiveCityId === "function"
          ? storage.getActiveCityId()
          : null;
        if (currentActiveCityId !== previousActiveCityId) {
          await storage.setActiveCityId(previousActiveCityId || null);
        }
      } catch (_) {
        // Der Runtime-Rollback bleibt auch bei blockiertem localStorage vollständig.
      }
      if (previousContext) applyCityContext(previousContext, previousStatisticsStore);
      if (activationId === runtimeState.activationId && previousContext) {
        finishRuntimeReady("Die ausgewählte Stadt konnte nicht aktiviert werden. Die bisherige Stadt bleibt aktiv.");
      }
      throw new Error("Die ausgewählte Stadt konnte nicht aktiviert werden. Die bisherige Stadt bleibt aktiv.", { cause: error });
    }
    if (activationId === runtimeState.activationId) finishRuntimeReady();
    recordRuntimeTiming(diagnostics, "activationTotalMs", activationStartedAt);
    return nextContext;
  };
  const queuedCommit = activationCommitQueue.catch(() => {}).then(commit);
  activationCommitQueue = queuedCommit.catch(() => {});
  return queuedCommit;
}

function activateCity(cityId, options = {}) {
  const normalizedCityId = String(cityId || "").trim();
  if (!normalizedCityId) return Promise.reject(new Error("Eine gültige Stadt-ID ist erforderlich."));
  if (cityContext?.sourceType === "installed"
    && cityContext.metadata.id === normalizedCityId
    && runtimeState.status === RUNTIME_STATUS.READY
    && options.force !== true) {
    return Promise.resolve(cityContext);
  }
  if (pendingActivation?.cityId === normalizedCityId) return pendingActivation.promise;
  const promise = performCityActivation(normalizedCityId, options.diagnostics || null);
  pendingActivation = { cityId: normalizedCityId, promise };
  void promise.finally(() => {
    if (pendingActivation?.promise === promise) pendingActivation = null;
  }).catch(() => {});
  return promise;
}

async function deleteCity(cityId) {
  const storage = window.StrassentrainerCityStorage;
  if (!storage || typeof storage.deleteCity !== "function") {
    throw new Error("Der lokale Stadtspeicher ist nicht verfügbar.");
  }
  const isRuntimeCity = cityContext?.sourceType === "installed"
    && cityContext.metadata.id === cityId;
  if (!isRuntimeCity) return storage.deleteCity(cityId);
  if (!canChangeRuntimeCity()) {
    throw new Error("Die aktive Stadt kann während einer laufenden Runde nicht gelöscht werden.");
  }
  const activationId = ++runtimeState.activationId;
  setRuntimeLoading("Die aktive Stadt wird gelöscht …");
  const commit = async () => {
    await storage.deleteCity(cityId);
    if (activationId !== runtimeState.activationId) return true;
    let cities = await storage.getAllCities();
    if (cities.length === 0) {
      await defaultCityApi.installBundledDefaultCityIfNeeded(storage);
      cities = await storage.getAllCities();
    }
    if (cities.length === 0) throw new Error("Nach dem Löschen ist kein Stadtpaket verfügbar.");
    const nextCityId = storage.getActiveCityId?.() || cities[0].id;
    const nextContext = await loadCityContext(nextCityId);
    if (storage.getActiveCityId?.() !== nextCityId) await storage.setActiveCityId(nextCityId);
    applyCityContext(nextContext, createStatisticsStoreForCityContext(nextContext));
    finishRuntimeReady();
    return true;
  };
  const queuedCommit = activationCommitQueue.catch(() => {}).then(commit);
  activationCommitQueue = queuedCommit.catch(() => {});
  try {
    return await queuedCommit;
  } catch (error) {
    if (activationId === runtimeState.activationId) {
      finishRuntimeReady("Die Stadt konnte nicht lokal gelöscht werden. Sie bleibt aktiv.");
    }
    throw error;
  }
}

function setStatus(message, type = "loading") {
  els.statusText.textContent = message;
  els.statusCard.classList.remove("ready", "error");
  if (type === "ready") els.statusCard.classList.add("ready");
  if (type === "error") els.statusCard.classList.add("error");
}

function getGeometryDiagnostics(
  minimumDistanceMeters = gameState.currentRound?.result?.distanceMeters ?? null
) {
  const target = gameState.currentRound?.target;
  const geometry = target?.geometry;
  return {
    targetId: target?.id || null,
    targetType: target?.targetType || null,
    displayName: target?.name || null,
    geometryType: geometry?.type || null,
    sectionCount: geometry?.sections?.length
      || (geometry?.type === "Point" ? 1 : 0),
    source: geometry?.source || null,
    sourceGeometryTypes: geometry?.sourceGeometryTypes || [],
    osmFeatureIds: geometry?.featureIds || [],
    minimumDistanceMeters: Number.isFinite(minimumDistanceMeters)
      ? Math.round(minimumDistanceMeters * 10) / 10
      : null
  };
}

function debugGeometry(stage, minimumDistanceMeters = null, extra = {}) {
  if (!CONFIG.debug || isExamInProgress()) return;
  console.info(`[Straßentrainer Debug] ${stage}`, {
    ...getGeometryDiagnostics(minimumDistanceMeters),
    ...extra
  });
}

function getDefaultContentSettings() {
  return {
    contentSelection: "streets",
    poiCategories: poiCategories.map(category => category.id),
    showTargetCategory: true
  };
}

function loadContentSettings() {
  const defaults = getDefaultContentSettings();
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG.contentSettingsStorageKey) || "null");
    if (!stored || typeof stored !== "object") return defaults;
    const validSelections = new Set(["streets", "pois", "mixed"]);
    const validCategoryIds = new Set(defaults.poiCategories);
    const selectedCategories = Array.isArray(stored.poiCategories)
      ? stored.poiCategories.filter(categoryId => validCategoryIds.has(categoryId))
      : defaults.poiCategories;
    return {
      contentSelection: validSelections.has(stored.contentSelection)
        ? stored.contentSelection
        : defaults.contentSelection,
      poiCategories: selectedCategories.length > 0
        ? [...new Set(selectedCategories)]
        : defaults.poiCategories,
      showTargetCategory: stored.showTargetCategory !== false
    };
  } catch (_) {
    return defaults;
  }
}

function saveContentSettings() {
  try {
    localStorage.setItem(CONFIG.contentSettingsStorageKey, JSON.stringify(contentSettings));
  } catch (_) {
    // Die Auswahl gilt für die aktuelle Sitzung weiter, auch wenn localStorage blockiert ist.
  }
}

function renderPoiCategoryOptions() {
  const selected = new Set(contentSettings.poiCategories);
  const targets = contentRepository?.poiTargets || cityContext?.poiTargets || [];
  const counts = new Map();
  for (const target of targets) {
    if (target && target.active && target.quizEligible && target.category) {
      counts.set(target.category, (counts.get(target.category) || 0) + 1);
    }
  }

  els.poiCategoryOptions.innerHTML = poiCategories.map(category => {
    const count = counts.get(category.id) || 0;
    const isChecked = selected.has(category.id);
    const isDisabled = targets.length > 0 && count === 0;
    return `
    <label class="category-option${isDisabled ? " disabled" : ""}">
      <input type="checkbox" data-poi-category="${escapeHtml(category.id)}"
        ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""} />
      <span>${escapeHtml(category.label)}${targets.length > 0 ? ` (${count})` : ""}</span>
    </label>`;
  }).join("");
}

function applyContentSettingsToControls() {
  els.contentSelectionSelect.value = contentSettings.contentSelection;
  els.showTargetCategoryCheckbox.checked = contentSettings.showTargetCategory;
  els.poiCategoryDetails.classList.toggle(
    "hidden",
    contentSettings.contentSelection === "streets"
  );
  renderPoiCategoryOptions();
}

function applyContentSettingsToGameConfig() {
  if (!gameState?.config) return;
  gameState.config.contentSelection = contentSettings.contentSelection;
  gameState.config.poiCategories = [...contentSettings.poiCategories];
  gameState.config.showTargetCategory = contentSettings.showTargetCategory;
}

function handleContentSelectionChange() {
  contentSettings.contentSelection = els.contentSelectionSelect.value;
  applyContentSettingsToControls();
  applyContentSettingsToGameConfig();
  saveContentSettings();
  refreshConfigurationAfterSettingsChange();
}

function handleCategoryVisibilityChange() {
  contentSettings.showTargetCategory = els.showTargetCategoryCheckbox.checked;
  applyContentSettingsToGameConfig();
  saveContentSettings();
  if (gameState.status === GAME_STATUS.ACTIVE && gameState.currentRound?.target) {
    renderTargetCategory(gameState.currentRound.target);
  }
  refreshConfigurationAfterSettingsChange();
}

function handlePoiCategoryChange(event) {
  const checkbox = event.target?.closest?.("[data-poi-category]") || event.target;
  const categoryId = checkbox?.dataset?.poiCategory;
  if (!categoryId) return;
  const selected = new Set(contentSettings.poiCategories);
  if (checkbox.checked) selected.add(categoryId);
  else selected.delete(categoryId);
  if (selected.size === 0) {
    checkbox.checked = true;
    setStatus("Mindestens eine POI-Kategorie muss aktiv bleiben.", "error");
    return;
  }
  contentSettings.poiCategories = poiCategories
    .map(category => category.id)
    .filter(id => selected.has(id));
  applyContentSettingsToGameConfig();
  saveContentSettings();
  refreshConfigurationAfterSettingsChange();
}

function refreshConfigurationAfterSettingsChange() {
  const selectedMode = els.modeSelect.value;
  if (gameState.status === GAME_STATUS.FINISHED) {
    stopAllTimers();
    roundPreparationToken += 1;
    deactivateExamHistoryGuard();
    examGeometryByRound.clear();
    gameEngine.resetGame();
    mapView.clearRound();
    mapView.resetViewport(false);
    els.returnToExamResultsButton.classList.add("hidden");
    els.modeSelect.value = selectedMode;
  }
  if (gameState.status !== GAME_STATUS.IDLE) return;
  if (isCountdownMode(selectedMode)) renderCountdownConfiguration(selectedMode);
  else renderIdleGame();
}

function getEligibleTargetsByType(targetType) {
  if (targetType === targetApi.TARGET_TYPES.POI) {
    const selectedCategories = new Set(gameState.config.poiCategories || contentSettings.poiCategories);
    return contentRepository.poiTargets.filter(target => target.active
      && target.quizEligible
      && selectedCategories.has(target.category));
  }
  return contentRepository.streetTargets.filter(target =>
    !contentRepository.unavailableTargetIds.has(target.id));
}

function getConfiguredTargetTypes() {
  if (gameState.config.contentSelection === "pois") return [targetApi.TARGET_TYPES.POI];
  if (gameState.config.contentSelection === "mixed") {
    return [targetApi.TARGET_TYPES.STREET, targetApi.TARGET_TYPES.POI];
  }
  return [targetApi.TARGET_TYPES.STREET];
}

function getConfiguredTargetCount() {
  return getConfiguredTargetTypes().reduce(
    (total, targetType) => total + getEligibleTargetsByType(targetType).length,
    0
  );
}

function selectRoundTarget(excluded = new Set(), requestedType = null) {
  const configuredTypes = requestedType ? [requestedType] : getConfiguredTargetTypes();
  const types = configuredTypes.filter(targetType =>
    getEligibleTargetsByType(targetType).some(target => !excluded.has(target.id))
  );
  if (types.length === 0) return null;

  let preferredTypes = types;
  if (types.length > 1) {
    const smallestCount = Math.min(...types.map(type => contentRepository.selectionCounts[type]));
    preferredTypes = types.filter(type => contentRepository.selectionCounts[type] === smallestCount);
  }
  const targetType = preferredTypes[Math.floor(Math.random() * preferredTypes.length)];
  const eligible = getEligibleTargetsByType(targetType)
    .filter(target => !excluded.has(target.id));
  const withoutImmediateRepeat = eligible.filter(target => target.id !== contentRepository.lastTargetId);
  const newInSession = withoutImmediateRepeat.filter(target =>
    !contentRepository.selectedTargetIds.has(target.id));
  const pool = newInSession.length > 0
    ? newInSession
    : (withoutImmediateRepeat.length > 0 ? withoutImmediateRepeat : eligible);
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function renderTargetCategory(target) {
  const categoryLabel = target.categoryLabel || "Ort";
  const shouldShow = Boolean(gameState.config.showTargetCategory && categoryLabel);
  els.targetCategoryLabel.textContent = shouldShow ? `Kategorie: ${categoryLabel}` : "";
  els.targetCategoryLabel.classList.toggle("hidden", !shouldShow);
}

function renderActiveRound(target) {
  if (els.trainingAreaSelect) els.trainingAreaSelect.disabled = true;
  els.alarmCard.classList.add("active");
  els.targetStreet.textContent = target.displayName;
  renderTargetCategory(target);
  els.instruction.textContent = "Tippe jetzt möglichst genau auf den gesuchten Einsatzort in der Karte.";
  const hasCountdown = isCountdownMode();
  els.mainButton.disabled = hasCountdown;
  els.mainButton.textContent = hasCountdown
    ? "Tipp auf der Karte abgeben"
    : "Alarm überspringen";
  els.mapHint.textContent = `Wo liegt ${target.displayName}?`;
  setStatus("Einsatzort bereit. Dein Tipp zählt mit dem nächsten Kartenklick.", "ready");
}

function activateTargetForRound(target, geometry) {
  contentRepository.lastTargetId = target.id;
  contentRepository.selectedTargetIds.add(target.id);
  contentRepository.selectionCounts[target.targetType] += 1;
  renderActiveRound(target);
  gameEngine.activateRound({
    id: target.id,
    name: target.displayName,
    targetType: target.targetType,
    category: target.category,
    categoryLabel: target.categoryLabel,
    geometry
  });
  if (gameState.config.mode === "exam") {
    examGeometryByRound.set(gameState.currentRound.roundNumber, geometry);
  }
  if (isCountdownMode()) {
    startRoundTimer();
  }
  debugGeometry("Rundenziel vollständig vorbereitet");
}

async function startRound() {
  if (gameState.status === GAME_STATUS.PREPARING) return;
  if (isCountdownMode()
    && gameState.results.length >= gameState.config.totalRounds) {
    finishGame();
    return;
  }
  if (getConfiguredTargetCount() === 0) {
    gameEngine.cancelRound();
    renderRoundPreparationError();
    return;
  }
  cancelAutoAdvance();
  stopRoundTimer();
  const preparationToken = ++roundPreparationToken;
  mapView.clearRound();
  gameEngine.startRound();

  if (els.trainingAreaSelect) els.trainingAreaSelect.disabled = true;
  els.mainButton.disabled = true;
  els.mainButton.textContent = "Alarm wird vorbereitet …";
  els.targetStreet.textContent = "Zufallsalarm wird ausgelöst …";
  els.targetCategoryLabel.classList.add("hidden");
  els.instruction.textContent = "Die Lage des ausgewählten Einsatzortes wird vorbereitet.";
  els.resultCard.classList.add("hidden");
  els.alarmCard.classList.remove("active");
  els.mapHint.textContent = "Einen Moment – Einsatzort wird ausgewählt …";
  setStatus("Bereite einen zufälligen Einsatzort vor …");

  const attempted = new Set();
  let fallbackTargetType = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const target = selectRoundTarget(attempted, fallbackTargetType);
    if (!target) break;
    attempted.add(target.id);

    const geometry = target.geometry;
    if (preparationToken !== roundPreparationToken
      || gameState.status !== GAME_STATUS.PREPARING) return;
    const preparedTarget = { ...target, geometry };
    if (!targetApi.isValidTargetGeometry(preparedTarget, geometryApi)) {
      if (target.targetType === targetApi.TARGET_TYPES.STREET) {
        contentRepository.unavailableTargetIds.add(target.id);
        if (gameState.config.contentSelection === "mixed") {
          fallbackTargetType = targetApi.TARGET_TYPES.POI;
        }
      }
      continue;
    }

    activateTargetForRound(target, geometry);
    return;
  }

  if (preparationToken !== roundPreparationToken
    || gameState.status !== GAME_STATUS.PREPARING) return;
  gameEngine.cancelRound();
  renderRoundPreparationError();
}

function renderRoundPreparationError() {
  els.targetStreet.textContent = "Einsatzort konnte nicht vorbereitet werden";
  els.targetCategoryLabel.classList.add("hidden");
  els.instruction.textContent = "Für die gewählte Inhaltsauswahl konnte momentan kein gültiges Ziel vorbereitet werden.";
  els.mainButton.disabled = false;
  els.mainButton.textContent = "Erneut versuchen";
  els.mapHint.textContent = "Bitte versuche es erneut.";
  setStatus("Bitte Auswahl und Datendateien prüfen oder den Versuch wiederholen.", "error");
}

function evaluateDistanceToTarget(target, guessCoordinates) {
  return targetApi.evaluateTargetDistance(target, guessCoordinates, turf, geometryApi);
}

function submitGuess(latlng) {
  if (isCountdownMode()) roundTimer.checkNow();
  const target = gameState.currentRound?.target;
  if (gameState.status !== GAME_STATUS.ACTIVE
    || !targetApi.isValidTargetGeometry(target, geometryApi)) return;

  const evaluation = evaluateDistanceToTarget(target, [latlng.lng, latlng.lat]);
  if (!evaluation) return;
  if (isCountdownMode()) roundTimer.checkNow();
  if (gameState.status !== GAME_STATUS.ACTIVE) return;
  stopRoundTimer();
  gameEngine.submitGuess(
    { lat: latlng.lat, lng: latlng.lng },
    { timedOut: false }
  );
  resolveRound({ evaluation, latlng, target });
}

function resolveRound({ evaluation, latlng, target }) {
  const result = gameEngine.resolveRound({ distanceMeters: evaluation.distanceMeters });

  if (gameState.config.mode === "exam") {
    completeExamRound();
    return;
  }

  debugGeometry("Tipp gegen die vollständige Zielgeometrie ausgewertet", result.distanceMeters, {
    nearestSectionIndex: evaluation.sectionIndex,
    roundResult: result
  });
  mapView.showRoundSolution(latlng, evaluation.nearestCoordinate, target);
  renderRoundResult(result);
  scheduleTimedAdvance();
}

function completeExamRound() {
  stopRoundTimer();
  mapView.clearRound();
  mapView.resetViewport(false);
  els.resultCard.classList.add("hidden");
  els.alarmCard.classList.remove("active");
  renderScoreboard();
  if (gameState.results.length >= gameState.config.totalRounds) {
    finishGame();
  } else {
    startRound();
  }
}

function renderRoundResult(result) {
  const hasDistance = Number.isFinite(result.distanceMeters);
  const roundedDistance = hasDistance ? Math.round(result.distanceMeters) : null;
  const targetGeometryType = gameState.currentRound?.target?.geometry?.type;
  const isPoiArea = result.targetType === targetApi.TARGET_TYPES.POI
    && (targetGeometryType === "Polygon" || targetGeometryType === "MultiPolygon");
  els.distanceValue.textContent = hasDistance ? formatDistance(roundedDistance) : "–";
  els.scoreValue.textContent = result.points.toLocaleString("de-DE");
  els.resultTitle.textContent = result.timedOut
    ? "Zeit abgelaufen"
    : getResultTitle(roundedDistance, result.targetType);
  const targetDescription = result.targetType === targetApi.TARGET_TYPES.POI
    ? (isPoiArea
      ? "Die rote Zielfläche zeigt das richtige Gelände."
      : "Der rote Zielpunkt zeigt den richtigen Ort.")
    : "Die rote Linie zeigt die richtige Straße.";
  els.resultMessage.textContent = result.timedOut
    ? `Die Runde wurde ohne Tipp und mit 0 Punkten gespeichert. ${targetDescription}`
    : getResultMessage(roundedDistance, result.targetType);
  els.resultCard.classList.remove("hidden");
  els.alarmCard.classList.remove("active");
  els.mainButton.disabled = false;
  if (els.trainingAreaSelect) els.trainingAreaSelect.disabled = false;
  const isLastTimedRound = gameState.config.mode === "timed"
    && gameState.results.length >= gameState.config.totalRounds;
  els.mainButton.textContent = isLastTimedRound
    ? "Auswertung anzeigen"
    : (gameState.config.mode === "timed" ? "Nächste Aufgabe" : "Nächster Alarm");
  els.mapHint.textContent = result.timedOut
    ? (result.targetType === targetApi.TARGET_TYPES.POI
      ? (isPoiArea
        ? "Rote Fläche: richtiges Gelände"
        : "Roter Punkt: richtiger Einsatzort")
      : "Breite rote Linie: richtige Zielstraße")
    : "Rot: richtiges Ziel · Blau: dein Tipp · gestrichelt: kürzeste Verbindung";
  setStatus("Auswertung abgeschlossen.", "ready");
  renderScoreboard();
}

function coordinatesToLatLng(coordinates) {
  return [coordinates[1], coordinates[0]];
}

function renderRoundSolutionOnMap(guessLatLng, nearestCoordinate, target) {
  const geometry = target.geometry;
  const targetLatLngs = [];

  if (target.targetType === targetApi.TARGET_TYPES.STREET) {
    for (const coordinates of geometry.sections) {
      const latLngs = coordinates.map(coordinatesToLatLng);
      targetLatLngs.push(...latLngs);
      L.polyline(latLngs, {
        color: MAP_STYLE.solution,
        weight: 8,
        opacity: 0.96,
        lineCap: "round",
        lineJoin: "round",
        interactive: false
      }).addTo(solutionLayers);
    }
  } else if (geometry.type === "Point") {
    const targetLatLng = coordinatesToLatLng(geometry.coordinates);
    targetLatLngs.push(targetLatLng);
    const poiIcon = L.divIcon({
      className: "",
      html: '<div class="poi-solution-marker" title="Richtiger Einsatzort"></div>',
      iconSize: [25, 25],
      iconAnchor: [12.5, 12.5]
    });
    L.marker(targetLatLng, { icon: poiIcon, keyboard: false }).addTo(solutionLayers);
  } else {
    const polygons = geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [geometry.coordinates];
    for (const polygon of polygons) {
      const latLngRings = polygon.map(ring => ring.map(coordinatesToLatLng));
      targetLatLngs.push(...latLngRings.flat());
      L.polygon(latLngRings, {
        color: MAP_STYLE.solution,
        weight: 5,
        opacity: 0.96,
        fillColor: MAP_STYLE.solution,
        fillOpacity: 0.22,
        interactive: false
      }).addTo(solutionLayers);
    }
  }

  const resultPoints = [...targetLatLngs];
  if (guessLatLng && nearestCoordinate) {
    const guessIcon = L.divIcon({
      className: "",
      html: '<div class="guess-marker" title="Dein Tipp"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    const nearestLatLng = [nearestCoordinate[1], nearestCoordinate[0]];
    L.marker(guessLatLng, { icon: guessIcon, keyboard: false }).addTo(answerLayers);
    if (geometry.type !== "Point") {
      const solutionIcon = L.divIcon({
        className: "",
        html: '<div class="solution-marker" title="Nächstgelegener Zielpunkt"></div>',
        iconSize: [19, 19],
        iconAnchor: [9.5, 9.5]
      });
      L.marker(nearestLatLng, { icon: solutionIcon, keyboard: false }).addTo(answerLayers);
    }
    const connectionLayer = L.polyline([guessLatLng, nearestLatLng], {
      color: MAP_STYLE.connection,
      weight: 3,
      opacity: 0.85,
      dashArray: "7 8",
      interactive: false
    }).addTo(answerLayers);
    connectionLayer.trainerRole = "connection";
    resultPoints.push(guessLatLng, nearestLatLng);
  }

  const resultBounds = L.latLngBounds(resultPoints);
  if (resultBounds.isValid()) {
    map.fitBounds(resultBounds.pad(0.25), { animate: true, maxZoom: 17, padding: [28, 28] });
  }
}

function formatDistance(meters) {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  })} km`;
}

function getResultTitle(meters, targetType) {
  const isPoi = targetType === targetApi.TARGET_TYPES.POI;
  if (meters <= (isPoi ? 25 : 50)) return "Volltreffer!";
  if (meters <= (isPoi ? 75 : 150)) return "Sehr nah dran!";
  if (meters <= (isPoi ? 200 : 400)) return "Gute Ortskenntnis";
  if (meters <= (isPoi ? 500 : 900)) return "Richtige Gegend";
  return isPoi ? "Diesen Ort noch einmal ansehen" : "Diese Straße noch einmal ansehen";
}

function getResultMessage(meters, targetType) {
  const isPoi = targetType === targetApi.TARGET_TYPES.POI;
  if (meters <= (isPoi ? 25 : 50)) return "Du hast den alarmierten Einsatzort praktisch genau getroffen.";
  if (meters <= (isPoi ? 75 : 150)) return "Das wäre im Einsatz eine sehr gute Orientierung gewesen.";
  if (meters <= (isPoi ? 200 : 400)) return "Du warst nah dran. Präge dir die exakte Lage noch ein.";
  if (meters <= (isPoi ? 500 : 900)) return "Die grobe Richtung stimmt, aber der Zielbereich war noch deutlich entfernt.";
  return "Nutze die rote Markierung, um dir die Lage des Einsatzortes einzuprägen.";
}

function renderCountdown(snapshot) {
  if (!snapshot || !isCountdownMode()) return;
  const totalMs = gameState.config.secondsPerRound * 1000;
  const percentage = totalMs > 0
    ? Math.max(0, Math.min(100, snapshot.remainingMs / totalMs * 100))
    : 0;
  els.timerValue.textContent = String(snapshot.remainingSeconds);
  els.timerProgress.style.width = `${percentage}%`;
  els.timerPanel.classList.toggle("urgent", snapshot.urgent);
}

function startRoundTimer() {
  stopRoundTimer();
  els.timerPanel.classList.remove("hidden", "urgent");
  els.timerValue.textContent = String(gameState.config.secondsPerRound);
  els.timerProgress.style.width = "100%";
  roundTimer.start(gameState.config.secondsPerRound);
}

function stopRoundTimer() {
  roundTimer.stop();
  els.timerPanel.classList.add("hidden");
  els.timerPanel.classList.remove("urgent");
}

function cancelAutoAdvance() {
  if (autoAdvanceTimeoutId !== null) window.clearTimeout(autoAdvanceTimeoutId);
  autoAdvanceTimeoutId = null;
}

function stopAllTimers() {
  stopRoundTimer();
  cancelAutoAdvance();
}

function handleRoundTimeout() {
  if (!isCountdownMode() || gameState.status !== GAME_STATUS.ACTIVE) return;
  const target = gameState.currentRound?.target;
  if (!targetApi.isValidTargetGeometry(target, geometryApi)) return;
  stopRoundTimer();
  const result = gameEngine.expireRound();
  if (gameState.config.mode === "exam") {
    completeExamRound();
    return;
  }
  mapView.showRoundSolution(null, null, target);
  renderRoundResult(result);
  scheduleTimedAdvance();
}

function scheduleTimedAdvance() {
  if (gameState.config.mode !== "timed" || gameState.status !== GAME_STATUS.ANSWERED) return;
  cancelAutoAdvance();
  const delayMs = Math.max(0, Number(gameState.config.autoAdvanceDelaySeconds) || 0) * 1000;
  if (delayMs === 0) return;
  autoAdvanceTimeoutId = window.setTimeout(() => {
    autoAdvanceTimeoutId = null;
    if (gameState.status !== GAME_STATUS.ANSWERED) return;
    if (gameState.results.length >= gameState.config.totalRounds) {
      finishGame();
    } else {
      mapView.resetViewport();
      startRound();
    }
  }, delayMs);
}

function renderScoreboard() {
  els.roundValue.textContent = gameState.results.length.toLocaleString("de-DE");
  els.totalScoreValue.textContent = gameState.totalScore.toLocaleString("de-DE");
  els.scorePointsPanel.classList.toggle(
    "hidden",
    gameState.config.mode === "exam" && gameState.status !== GAME_STATUS.FINISHED
  );
  renderStatistics();
}

function formatStatisticNumber(value, maximumFractionDigits = 1) {
  return Number(value || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  });
}

function formatStatisticTarget(target) {
  if (!target) return "–";
  return `${target.name} · ${formatStatisticNumber(target.statistics.averagePoints)} Ø Punkte · ${target.statistics.roundsEvaluated.toLocaleString("de-DE")}×`;
}

function renderStatistics() {
  els.statisticsHeading.textContent = `Statistik – ${cityName(cityContext?.metadata)}`;
  const view = statisticsStore.getView({
    mode: els.statisticsModeFilter.value,
    targetType: els.statisticsTargetFilter.value
  });
  const stats = view.statistics;
  const values = [
    ["Gestartete Spiele", stats.gamesStarted.toLocaleString("de-DE")],
    ["Abgeschlossene Spiele", stats.gamesCompleted.toLocaleString("de-DE")],
    ["Ausgewertete Aufgaben", stats.roundsEvaluated.toLocaleString("de-DE")],
    ["Gesamtpunkte", formatStatisticNumber(stats.totalPoints, 0)],
    ["Ø Punkte/Aufgabe", formatStatisticNumber(stats.averagePoints)],
    ["Beste Punktzahl", stats.bestPoints === null ? "–" : formatStatisticNumber(stats.bestPoints, 0)],
    ["Ø Entfernung", stats.averageDistanceMeters === null ? "–" : formatDistance(Math.round(stats.averageDistanceMeters))],
    ["Beste Entfernung", stats.bestDistanceMeters === null ? "–" : formatDistance(Math.round(stats.bestDistanceMeters))],
    ["Schlechteste Entfernung", stats.worstDistanceMeters === null ? "–" : formatDistance(Math.round(stats.worstDistanceMeters))],
    ["Ø benötigte Zeit", `${formatStatisticNumber(stats.averageDurationSeconds)} s`],
    ["Zeitüberschreitungen", stats.timeoutCount.toLocaleString("de-DE")],
    ["Treffer", stats.hitCount.toLocaleString("de-DE")],
    ["Trefferquote", `${formatStatisticNumber(stats.hitRatePercent)} %`]
  ];
  els.statisticsOverview.innerHTML = values.map(([label, value]) => `
    <div class="statistics-value">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>`).join("");
  els.statisticsBestTarget.textContent = formatStatisticTarget(view.targets.best);
  els.statisticsWorstTarget.textContent = formatStatisticTarget(view.targets.worst);
  els.statisticsMostPlayedTarget.textContent = formatStatisticTarget(view.targets.mostPlayed);
  const highestExam = view.highestExam;
  els.statisticsHighestExam.textContent = highestExam
    ? `${(highestExam.highestPercentageBasisPoints / 100).toLocaleString("de-DE", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2
    })} %`
    : "–";
  els.statisticsHighestRank.textContent = highestExam?.highestAward
    ? `${highestExam.highestAward.symbol} ${highestExam.highestAward.name}`
    : "–";
  els.statisticsLastPlayed.textContent = view.lastPlayedAt
    ? new Date(view.lastPlayedAt).toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short"
    })
    : "–";
}

function setStatisticsMessage(message, type = "") {
  els.statisticsMessage.textContent = message;
  els.statisticsMessage.classList.remove("error", "success");
  if (type) els.statisticsMessage.classList.add(type);
}

function registerCurrentGameAfterStatisticsChange() {
  if (!gameState.statisticsGameStarted
    || gameState.status === GAME_STATUS.FINISHED
    || !gameState.gameId) return;
  statisticsStore.recordGameStarted(gameState.config.mode, {
    gameId: gameState.gameId,
    contentSelection: gameState.config.contentSelection,
    timestamp: new Date().toISOString()
  });
}

function exportStatistics() {
  const blob = new Blob([statisticsStore.exportJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = statisticsApi.getStatisticsExportFilename(
    cityName(cityContext?.metadata),
    new Date()
  );
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatisticsMessage("Statistik wurde als JSON-Datei exportiert.", "success");
}

async function importStatisticsFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const strategy = els.statisticsImportStrategy.value === "replace" ? "replace" : "merge";
  if (strategy === "replace" && !window.confirm(
    "Die vorhandene Statistik wird vollständig durch die importierte Datei ersetzt. Fortfahren?"
  )) {
    event.target.value = "";
    return;
  }
  try {
    const textContent = await file.text();
    statisticsStore.importJson(textContent, strategy);
    registerCurrentGameAfterStatisticsChange();
    gameState.statistics = statisticsStore.getSnapshot();
    renderStatistics();
    setStatisticsMessage(
      strategy === "merge"
        ? "Statistik wurde erfolgreich zusammengeführt."
        : "Statistik wurde erfolgreich ersetzt.",
      "success"
    );
  } catch (error) {
    setStatisticsMessage(`Import abgelehnt: ${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
}

function resetStatistics() {
  if (!window.confirm(
    `Statistik für ${cityName(cityContext?.metadata)} wirklich zurücksetzen? Nur die Statistik dieser Stadt wird gelöscht.`
  )) return;
  statisticsStore.reset();
  registerCurrentGameAfterStatisticsChange();
  gameState.statistics = statisticsStore.getSnapshot();
  renderStatistics();
  setStatisticsMessage("Die lokale Statistik wurde zurückgesetzt.", "success");
}

function handleMainButton() {
  cancelAutoAdvance();
  if (gameState.config.mode === "exam" && gameState.status === GAME_STATUS.FINISHED) {
    startCountdownGame(getCountdownConfigFromControls("exam"));
    return;
  }
  if (["timed", "exam"].includes(els.modeSelect.value)
    && gameState.status === GAME_STATUS.IDLE) {
    if (gameState.config.mode === els.modeSelect.value && gameState.startedAt !== null) {
      startRound();
    } else {
      startCountdownGame(getCountdownConfigFromControls(els.modeSelect.value));
    }
    return;
  }
  if (gameState.config.mode === "timed" && gameState.status === GAME_STATUS.ANSWERED) {
    if (gameState.results.length >= gameState.config.totalRounds) finishGame();
    else {
      mapView.resetViewport();
      startRound();
    }
    return;
  }
  if ([GAME_STATUS.IDLE, GAME_STATUS.ANSWERED].includes(gameState.status)) {
    mapView.resetViewport();
    startRound();
  } else if (gameState.status === GAME_STATUS.ACTIVE) {
    startRound();
  } else if (gameState.status === GAME_STATUS.FINISHED) {
    resetGame();
    startGame(MODE_CONFIGS.free);
  }
}

function renderIdleGame() {
  if (els.trainingAreaSelect) els.trainingAreaSelect.disabled = false;
  els.mainButton.classList.remove("hidden");
  els.modeCard.classList.remove("hidden");
  els.modeSelect.value = "free";
  els.timedSettings.classList.add("hidden");
  els.endGameButton.classList.add("hidden");
  els.summaryCard.classList.add("hidden");
  els.examResultsCard.classList.add("hidden");
  els.legendCard.classList.remove("hidden");
  stopAllTimers();
  els.alarmCard.classList.remove("active");
  els.resultCard.classList.add("hidden");
  els.targetCategoryLabel.classList.add("hidden");
  els.targetStreet.textContent = "Bereit für den ersten Alarm";
  const availableCount = getConfiguredTargetCount();
  const contentLabel = contentSettings.contentSelection === "streets"
    ? "Straßen"
    : (contentSettings.contentSelection === "pois" ? "Orte und Einrichtungen" : "Ziele");
  const areaNamePart = cityContext?.activeArea
    ? `${cityName(cityContext?.metadata)} (${cityContext.activeArea.name})`
    : cityName(cityContext?.metadata);
  els.instruction.textContent = `${availableCount} ${contentLabel} in ${areaNamePart} stehen zur Auswahl.`;
  els.mainButton.disabled = availableCount === 0;
  els.mainButton.textContent = "Ersten Alarm auslösen";
  els.mapHint.textContent = "Die Karte enthält bewusst keine Straßennamen.";
  setStatus(
    availableCount > 0
      ? `${areaNamePart} ist lokal geladen und spielbereit.`
      : "Für die gewählte Inhaltsauswahl ist kein aktives Ziel vorhanden.",
    availableCount > 0 ? "ready" : "error"
  );
  renderScoreboard();
}

function renderCountdownConfiguration(mode) {
  if (els.trainingAreaSelect) els.trainingAreaSelect.disabled = false;
  applyContentSettingsToGameConfig();
  const isExam = mode === "exam";
  els.mainButton.classList.remove("hidden");
  els.modeCard.classList.remove("hidden");
  els.timedSettings.classList.remove("hidden");
  els.endGameButton.classList.add("hidden");
  els.summaryCard.classList.add("hidden");
  els.examResultsCard.classList.add("hidden");
  els.legendCard.classList.toggle("hidden", isExam);
  els.resultCard.classList.add("hidden");
  els.alarmCard.classList.remove("active");
  els.targetCategoryLabel.classList.add("hidden");
  els.targetStreet.textContent = isExam
    ? "Prüfung konfigurieren"
    : "Zeittraining konfigurieren";
  els.instruction.textContent = isExam
    ? "Während der Prüfung gibt es keine Zwischenauflösung. Das Gesamtergebnis erscheint erst nach der letzten Aufgabe."
    : "Wähle Zeit und Aufgabenanzahl. Der Countdown startet erst, wenn das Ziel und die Karte bereit sind.";
  els.mainButton.disabled = getConfiguredTargetCount() === 0;
  els.mainButton.textContent = isExam ? "Prüfung starten" : "Training starten";
  els.mapHint.textContent = "Die Karte enthält bewusst keine Straßennamen.";
  setStatus(
    isExam
      ? "Prüfungsmodus bereit. Ein Neuladen verwirft die laufende Prüfung."
      : "Zeitmodus bereit. Ladezeiten zählen nicht zur Aufgabenzeit.",
    "ready"
  );
  renderScoreboard();
}

function startGame(config = MODE_CONFIGS.free) {
  contentRepository.selectedTargetIds.clear();
  contentRepository.selectionCounts = { street: 0, poi: 0 };
  gameEngine.startGame({
    ...config,
    contentSelection: contentSettings.contentSelection,
    poiCategories: [...contentSettings.poiCategories],
    showTargetCategory: contentSettings.showTargetCategory
  });
  if (gameState.config.mode === "free") renderIdleGame();
  return gameState;
}

function getCountdownConfigFromControls(mode) {
  return {
    ...MODE_CONFIGS[mode],
    secondsPerRound: Number(els.secondsPerRoundSelect.value),
    totalRounds: Number(els.totalRoundsSelect.value),
    contentSelection: contentSettings.contentSelection,
    poiCategories: [...contentSettings.poiCategories],
    showTargetCategory: contentSettings.showTargetCategory
  };
}

function startCountdownGame(config = getCountdownConfigFromControls("timed")) {
  stopAllTimers();
  roundPreparationToken += 1;
  contentRepository.selectedTargetIds.clear();
  contentRepository.selectionCounts = { street: 0, poi: 0 };
  examGeometryByRound.clear();
  if (config.mode !== "exam") lastTimedConfig = { ...config };
  els.modeSelect.value = config.mode;
  els.secondsPerRoundSelect.value = String(config.secondsPerRound);
  els.totalRoundsSelect.value = String(config.totalRounds);
  contentSettings = {
    contentSelection: config.contentSelection,
    poiCategories: Array.isArray(config.poiCategories)
      ? [...config.poiCategories]
      : [...contentSettings.poiCategories],
    showTargetCategory: config.showTargetCategory !== false
  };
  applyContentSettingsToControls();
  saveContentSettings();
  els.modeCard.classList.add("hidden");
  els.summaryCard.classList.add("hidden");
  els.examResultsCard.classList.add("hidden");
  els.legendCard.classList.toggle("hidden", config.mode === "exam");
  els.resultCard.classList.add("hidden");
  els.endGameButton.classList.remove("hidden");
  els.endGameButton.textContent = config.mode === "exam"
    ? "Prüfung abbrechen"
    : "Zeittraining beenden";
  els.mainButton.classList.remove("hidden");
  gameEngine.startGame(config);
  if (config.mode === "exam") activateExamHistoryGuard();
  renderScoreboard();
  startRound();
}

function startTimedTraining(config = getCountdownConfigFromControls("timed")) {
  startCountdownGame(config);
}

function finishGame(options = {}) {
  stopAllTimers();
  roundPreparationToken += 1;
  gameEngine.finishGame(options);
  if (els.trainingAreaSelect) els.trainingAreaSelect.disabled = false;
  els.alarmCard.classList.remove("active");
  els.targetCategoryLabel.classList.add("hidden");
  mapView.clearRound();
  if (gameState.config.mode === "exam") {
    deactivateExamHistoryGuard();
    els.targetStreet.textContent = "Prüfung abgeschlossen";
    els.instruction.textContent = `${gameState.results.length} Aufgaben wurden jetzt gemeinsam ausgewertet.`;
    els.mainButton.classList.remove("hidden");
    els.mainButton.disabled = false;
    els.mainButton.textContent = "Neue Prüfung mit denselben Einstellungen";
    els.endGameButton.classList.add("hidden");
    els.modeCard.classList.remove("hidden");
    els.timedSettings.classList.remove("hidden");
    els.resultCard.classList.add("hidden");
    els.summaryCard.classList.add("hidden");
    els.legendCard.classList.add("hidden");
    renderExamResults(gameState.summary, gameState.results);
    renderExamAnswerOverview();
    setStatus("Die Prüfung ist abgeschlossen. Erst jetzt sind Bewertungen und Lösungen sichtbar.", "ready");
    renderScoreboard();
  } else if (gameState.config.mode === "timed") {
    els.targetStreet.textContent = "Zeittraining beendet";
    els.instruction.textContent = `${gameState.results.length} von ${gameState.config.totalRounds} Aufgaben wurden gewertet.`;
    els.mainButton.classList.add("hidden");
    els.endGameButton.classList.add("hidden");
    els.modeCard.classList.remove("hidden");
    els.timedSettings.classList.remove("hidden");
    els.resultCard.classList.add("hidden");
    renderGameSummary(gameState.summary);
    els.mapHint.textContent = "Zeittraining abgeschlossen.";
    setStatus("Abschlussstatistik erstellt.", "ready");
  } else {
    els.mainButton.disabled = false;
    els.mainButton.textContent = "Neues Spiel";
    els.mapHint.textContent = "Spiel abgeschlossen.";
  }
  return gameState;
}

function formatDuration(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${remainder} min`;
}

function describeSummaryRound(result) {
  if (!result) return "–";
  const suffix = result.timedOut
    ? "Zeit abgelaufen"
    : `${formatDistance(Math.round(result.distanceMeters))}, ${result.points.toLocaleString("de-DE")} Punkte`;
  return `${result.targetName} · ${suffix}`;
}

function renderGameSummary(summary) {
  els.summaryTotalPoints.textContent = summary.totalPoints.toLocaleString("de-DE");
  els.summaryAveragePoints.textContent = Math.round(summary.averagePoints).toLocaleString("de-DE");
  els.summaryAverageDistance.textContent = Number.isFinite(summary.averageDistanceMeters)
    ? formatDistance(Math.round(summary.averageDistanceMeters))
    : "–";
  els.summaryAverageTime.textContent = `${summary.averageDurationSeconds.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} s`;
  els.summaryTimeouts.textContent = summary.timeoutCount.toLocaleString("de-DE");
  els.summaryHitRate.textContent = `${Math.round(summary.hitRatePercent)} %`;
  els.summaryTotalDuration.textContent = formatDuration(summary.totalDurationSeconds);
  els.summaryBestRound.textContent = describeSummaryRound(summary.bestRound);
  els.summaryWorstRound.textContent = describeSummaryRound(summary.worstRound);
  renderTargetBreakdown(els.summaryTargetBreakdown, summary);
  els.summaryCard.classList.remove("hidden");
}

function renderTargetBreakdown(container, summary) {
  const labels = { street: "Straßen", poi: "Orte und Einrichtungen" };
  container.innerHTML = `<h4>Ergebnisse nach Zieltyp</h4>${["street", "poi"].map(targetType => {
    const values = summary.byTargetType?.[targetType] || {};
    const averageDistance = Number.isFinite(values.averageDistanceMeters)
      ? formatDistance(Math.round(values.averageDistanceMeters))
      : "–";
    return `<div class="target-breakdown-row">
      <strong>${labels[targetType]}</strong>
      <span>${Number(values.roundCount || 0).toLocaleString("de-DE")} Aufgaben</span>
      <span>${Math.round(values.averagePoints || 0).toLocaleString("de-DE")} Ø Punkte</span>
      <span>${escapeHtml(averageDistance)} Ø Entfernung</span>
      <span>${Math.round(values.hitRatePercent || 0).toLocaleString("de-DE")} % Treffer</span>
    </div>`;
  }).join("")}`;
}

function formatSeconds(seconds) {
  return `${Number(seconds || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} s`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getExamRoundStatus(result) {
  if (result.timedOut) return "Nicht beantwortet";
  const threshold = statisticsApi.HIT_THRESHOLDS_METERS[
    result.targetType || targetApi.TARGET_TYPES.STREET
  ];
  return result.distanceMeters <= threshold ? "Treffer" : "Nicht getroffen";
}

function renderExamResults(summary, results) {
  const award = summary.award;
  els.examAwardCard.dataset.scheme = award.scheme;
  els.examAwardSymbol.textContent = award.symbol;
  els.examAwardName.textContent = award.name;
  els.examAwardPercentage.textContent = `${award.percentage.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} %`;
  els.examAwardDescription.textContent = award.description;
  els.examTotalPoints.textContent = summary.totalPoints.toLocaleString("de-DE");
  els.examMaximumPoints.textContent = summary.maximumPossiblePoints.toLocaleString("de-DE");
  els.examPercentage.textContent = `${summary.percentage.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} %`;
  els.examAverageDistance.textContent = Number.isFinite(summary.averageDistanceMeters)
    ? formatDistance(Math.round(summary.averageDistanceMeters))
    : "–";
  els.examAverageTime.textContent = formatSeconds(summary.averageDurationSeconds);
  els.examHitRate.textContent = `${Math.round(summary.hitRatePercent)} %`;
  els.examUnanswered.textContent = summary.unansweredCount.toLocaleString("de-DE");
  els.examBestRound.textContent = describeSummaryRound(summary.bestRound);
  els.examWorstRound.textContent = describeSummaryRound(summary.worstRound);
  renderTargetBreakdown(els.examTargetBreakdown, summary);
  els.examTaskList.innerHTML = results.map(result => {
    const distance = Number.isFinite(result.distanceMeters)
      ? formatDistance(Math.round(result.distanceMeters))
      : "–";
    return `<li class="exam-task-item">
      <div class="exam-task-heading">
        <span class="exam-task-number">${result.roundNumber}.</span>
        <span>${escapeHtml(result.targetName)}</span>
      </div>
      <div class="exam-task-category">${escapeHtml(result.targetCategoryLabel || "Straße")}</div>
      <div class="exam-task-details">
        <span>Entfernung: <strong>${escapeHtml(distance)}</strong></span>
        <span>Punkte: <strong>${result.points.toLocaleString("de-DE")}</strong></span>
        <span>Zeit: <strong>${escapeHtml(formatSeconds(result.durationSeconds))}</strong></span>
        <span>Status: <strong>${escapeHtml(getExamRoundStatus(result))}</strong></span>
      </div>
      <button class="exam-map-button" type="button" data-exam-round="${result.roundNumber}">
        Auf Karte ansehen
      </button>
    </li>`;
  }).join("");
  els.returnToExamResultsButton.classList.add("hidden");
  els.examResultsCard.classList.remove("hidden");
}

function getExamTargetForResult(result) {
  const geometry = examGeometryByRound.get(result?.roundNumber);
  const target = result && geometry ? {
    id: result.targetId,
    name: result.targetName,
    targetType: result.targetType || targetApi.TARGET_TYPES.STREET,
    category: result.targetCategory,
    categoryLabel: result.targetCategoryLabel,
    geometry
  } : null;
  return targetApi.isValidTargetGeometry(target, geometryApi) ? target : null;
}

function renderExamAnswerOverview() {
  if (gameState.config.mode !== "exam" || gameState.status !== GAME_STATUS.FINISHED) return 0;
  mapView.clearRound();
  const overviewPoints = [];
  let answeredCount = 0;

  gameState.results.forEach(result => {
    if (!result.guessCoordinates) return;
    const target = getExamTargetForResult(result);
    if (!target) return;
    const evaluation = evaluateDistanceToTarget(
      target,
      [result.guessCoordinates.lng, result.guessCoordinates.lat]
    );
    if (!evaluation?.nearestCoordinate) return;

    const roundNumber = Number(result.roundNumber);
    const guessLatLng = [result.guessCoordinates.lat, result.guessCoordinates.lng];
    const targetLatLng = coordinatesToLatLng(evaluation.nearestCoordinate);
    const targetIcon = L.divIcon({
      className: "",
      html: `<div class="exam-overview-marker exam-overview-target" title="Aufgabe ${roundNumber}: nächster Zielpunkt">${roundNumber}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    const guessIcon = L.divIcon({
      className: "",
      html: `<div class="exam-overview-marker exam-overview-guess" title="Aufgabe ${roundNumber}: dein Tipp">${roundNumber}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    L.marker(targetLatLng, {
      icon: targetIcon,
      interactive: false,
      keyboard: false,
      alt: `Aufgabe ${roundNumber}: nächster Zielpunkt`
    }).addTo(solutionLayers);
    L.polyline([guessLatLng, targetLatLng], {
      color: MAP_STYLE.connection,
      weight: 2.5,
      opacity: 0.76,
      dashArray: "6 7",
      interactive: false
    }).addTo(answerLayers);
    L.marker(guessLatLng, {
      icon: guessIcon,
      interactive: false,
      keyboard: false,
      alt: `Aufgabe ${roundNumber}: eigener Tipp`
    }).addTo(answerLayers);
    overviewPoints.push(guessLatLng, targetLatLng);
    answeredCount += 1;
  });

  const overviewBounds = L.latLngBounds(overviewPoints);
  if (overviewBounds.isValid()) {
    map.fitBounds(overviewBounds.pad(0.12), {
      animate: true,
      maxZoom: 14,
      padding: [36, 36]
    });
  } else {
    mapView.resetViewport(false);
  }
  els.returnToExamResultsButton.classList.add("hidden");
  els.mapHint.textContent = answeredCount > 0
    ? `Prüfungsübersicht: Blau = dein Tipp · Rot = Zielpunkt · gleiche Nummer = gleiche Aufgabe (${answeredCount} beantwortet)`
    : "Prüfungsübersicht: Es wurde keine Aufgabe beantwortet.";
  return answeredCount;
}

function showExamRoundOnMap(roundNumber) {
  if (gameState.config.mode !== "exam" || gameState.status !== GAME_STATUS.FINISHED) return;
  const result = gameState.results.find(candidate => candidate.roundNumber === roundNumber);
  const target = getExamTargetForResult(result);
  if (!target) return;

  mapView.clearRound();
  if (result.guessCoordinates) {
    const evaluation = evaluateDistanceToTarget(
      target,
      [result.guessCoordinates.lng, result.guessCoordinates.lat]
    );
    if (!evaluation) return;
    mapView.showRoundSolution(
      [result.guessCoordinates.lat, result.guessCoordinates.lng],
      evaluation.nearestCoordinate,
      target
    );
  } else {
    mapView.showRoundSolution(null, null, target);
  }
  els.returnToExamResultsButton.classList.remove("hidden");
  els.mapHint.textContent = result.timedOut
    ? `${result.targetName}: nicht beantwortet · rot: richtiges Ziel`
    : `${result.targetName}: richtiges Ziel, eigener Tipp und kürzeste Verbindung`;
  if (typeof els.mapPanel.scrollIntoView === "function") {
    els.mapPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function returnToExamResults() {
  renderExamAnswerOverview();
  if (typeof els.examResultsCard.scrollIntoView === "function") {
    els.examResultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function resetGame() {
  stopAllTimers();
  roundPreparationToken += 1;
  deactivateExamHistoryGuard();
  examGeometryByRound.clear();
  gameEngine.resetGame();
  mapView.clearRound();
  mapView.resetViewport(false);
  renderIdleGame();
  return gameState;
}

function handleModeChange() {
  const requestedMode = els.modeSelect.value;
  if (isExamInProgress() && !window.confirm(
    "Die laufende Prüfung wird vollständig verworfen. Möchtest du den Modus wirklich wechseln?"
  )) {
    els.modeSelect.value = "exam";
    return;
  }
  if (gameState.config.mode === "free"
    && gameState.results.length > 0
    && gameState.status !== GAME_STATUS.FINISHED) {
    gameEngine.finishGame();
  }
  stopAllTimers();
  roundPreparationToken += 1;
  deactivateExamHistoryGuard();
  examGeometryByRound.clear();
  gameEngine.resetGame();
  mapView.clearRound();
  mapView.resetViewport(false);
  els.modeSelect.value = requestedMode;
  if (isCountdownMode(requestedMode)) renderCountdownConfiguration(requestedMode);
  else startGame(MODE_CONFIGS.free);
}

function activateExamHistoryGuard() {
  examHistoryGuardActive = true;
  if (window.history?.pushState) {
    try {
      window.history.pushState({ strassentrainerExamGuard: true }, "", window.location.href);
    } catch (_) {
      // Die beforeunload-Warnung bleibt auch ohne History-API aktiv.
    }
  }
}

function deactivateExamHistoryGuard() {
  examHistoryGuardActive = false;
}

function discardExam({ renderConfiguration = true } = {}) {
  stopAllTimers();
  roundPreparationToken += 1;
  deactivateExamHistoryGuard();
  examGeometryByRound.clear();
  gameEngine.resetGame();
  mapView.clearRound();
  mapView.resetViewport(false);
  els.modeSelect.value = "exam";
  if (renderConfiguration) renderCountdownConfiguration("exam");
}

function handleEndGame() {
  if (isExamInProgress()) {
    if (!window.confirm(
      "Prüfung wirklich abbrechen? Alle bisherigen Prüfungsantworten werden verworfen."
    )) return;
    discardExam();
    return;
  }
  const isComplete = Number.isFinite(gameState.config.totalRounds)
    && gameState.results.length >= gameState.config.totalRounds;
  finishGame({ aborted: !isComplete });
}

function handleExamPopState() {
  if (!examHistoryGuardActive || !isExamInProgress()) return;
  if (!window.confirm(
    "Beim Verlassen wird die laufende Prüfung verworfen. Seite wirklich verlassen?"
  )) {
    try {
      window.history?.pushState?.(
        { strassentrainerExamGuard: true },
        "",
        window.location.href
      );
    } catch (_) {
      // Auf Dateisystem-URLs kann pushState eingeschränkt sein.
    }
    return;
  }
  discardExam({ renderConfiguration: false });
  window.history?.back?.();
}

function handleBeforeUnload(event) {
  if (!isExamInProgress()) return;
  event.preventDefault();
  event.returnValue = "";
}

function handlePageHide() {
  stopAllTimers();
  if (gameState.config.mode === "free"
    && gameState.results.length > 0
    && gameState.status !== GAME_STATUS.FINISHED) {
    gameEngine.finishGame();
  }
}

async function initializeApplication() {
  mapView.clearRound();
  els.resultCard.classList.add("hidden");
  els.targetStreet.textContent = "Stadtdaten werden geladen …";
  els.instruction.textContent = "Die zuletzt aktive Stadt wird aus dem lokalen Speicher vorbereitet.";
  els.mainButton.disabled = true;
  els.mainButton.textContent = "Initialisierung läuft …";
  setRuntimeLoading("Initialisiere die lokale Stadt …");

  try {
    const initial = await loadInitialCityContext();
    const initialStatisticsStore = createStatisticsStoreForCityContext(initial.context);
    applyCityContext(initial.context, initialStatisticsStore);
    finishRuntimeReady(initial.warning);
  } catch (error) {
    runtimeState.status = RUNTIME_STATUS.ERROR;
    runtimeState.error = error;
    els.targetStreet.textContent = "Stadtdaten konnten nicht geladen werden";
    els.instruction.textContent = "Bitte prüfe die lokalen Projektdateien und lade die Seite erneut.";
    els.mainButton.disabled = true;
    els.mainButton.textContent = "Dateien prüfen";
    setStatus("Die Anwendung konnte keinen vollständigen Stadtkontext aufbauen.", "error");
  }

  if (window.StrassentrainerCityManager) {
    try {
      await window.StrassentrainerCityManager.init({
        canChangeCity: canChangeRuntimeCity,
        activateCity,
        deleteCity,
        getRuntimeCity: () => cityContext?.metadata || null
      });
    } catch (error) {
      console.warn("Stadtmanager konnte nicht initialisiert werden", error);
    }
  }
}

async function prepareStreetForDebug(nameOrId) {
  if (!CONFIG.debug) throw new Error("Debugmodus mit ?debug=1 aktivieren.");
  if (isExamInProgress()) throw new Error("Debug-Zielauswahl ist während einer Prüfung gesperrt.");
  const normalizedQuery = geometryApi.normalizeStreetName(nameOrId);
  const street = contentRepository.streetTargets.find(candidate => candidate.id === nameOrId
    || geometryApi.getStreetNameKeys(candidate).has(normalizedQuery));
  if (!street) throw new Error(`Straße nicht gefunden: ${nameOrId}`);

  if (gameState.status === GAME_STATUS.FINISHED) startGame(MODE_CONFIGS.free);
  mapView.clearRound();
  gameEngine.startRound();
  els.resultCard.classList.add("hidden");
  setStatus(`Debug: Lade vollständige Geometrie für ${street.displayName} …`);
  const geometry = geometryApi.isValidStreetGeometry(street.geometry, street.id)
    ? street.geometry
    : null;
  if (!geometry) throw new Error(`Keine vollständige Liniengeometrie für ${street.displayName}.`);
  activateTargetForRound(street, geometry);
  return getGeometryDiagnostics();
}

function getDebugGameState() {
  if (!isExamInProgress()) return gameState;
  const round = gameState.currentRound;
  return {
    status: gameState.status,
    config: { ...gameState.config },
    startedAt: gameState.startedAt,
    finishedAt: null,
    currentRound: round ? {
      roundNumber: round.roundNumber,
      preparedAt: round.preparedAt,
      startedAt: round.startedAt,
      target: round.target ? {
        id: round.target.id,
        name: round.target.name,
        targetType: round.target.targetType,
        category: gameState.config.showTargetCategory ? round.target.category : null,
        categoryLabel: gameState.config.showTargetCategory ? round.target.categoryLabel : null
      } : null,
      guess: null,
      result: null
    } : null,
    completedRoundCount: gameState.results.length,
    results: [],
    totalScore: null,
    summary: null,
    statistics: gameState.statistics
  };
}

window.STRASSENTRAINER_DEBUG = {
  getCurrentGeometry: () => isExamInProgress()
    ? { locked: true, message: "Geometriediagnose während der Prüfung gesperrt." }
    : getGeometryDiagnostics(),
  getGameState: getDebugGameState,
  getStatistics: () => statisticsStore.getSnapshot(),
  getStatisticsView: filters => statisticsStore.getView(filters),
  exportStatistics: () => statisticsStore.exportJson(),
  getStatisticsStorageKey: () => statisticsStore.getStorageKey(),
  importStatistics: (jsonText, strategy = "replace") => {
    const snapshot = statisticsStore.importJson(jsonText, strategy);
    gameState.statistics = snapshot;
    renderStatistics();
    return snapshot;
  },
  getContentSettings: () => ({
    ...contentSettings,
    poiCategories: [...contentSettings.poiCategories]
  }),
  getTargets: () => isExamInProgress()
    ? { locked: true, message: "Zieldaten sind während der Prüfung gesperrt." }
    : {
      streets: contentRepository.streetTargets.map(target => ({ ...target, geometry: null })),
      pois: contentRepository.poiTargets.map(target => ({ ...target }))
    },
  showExamRound: roundNumber => showExamRoundOnMap(Number(roundNumber)),
  prepareStreet: nameOrId => prepareStreetForDebug(nameOrId)
};

map.on("click", event => submitGuess(event.latlng));
els.mainButton.addEventListener("click", handleMainButton);
els.modeSelect.addEventListener("change", handleModeChange);
if (els.trainingAreaSelect) {
  els.trainingAreaSelect.addEventListener("change", handleTrainingAreaChange);
}
els.secondsPerRoundSelect.addEventListener("change", refreshConfigurationAfterSettingsChange);
els.totalRoundsSelect.addEventListener("change", refreshConfigurationAfterSettingsChange);
els.contentSelectionSelect.addEventListener("change", handleContentSelectionChange);
els.showTargetCategoryCheckbox.addEventListener("change", handleCategoryVisibilityChange);
els.poiCategoryOptions.addEventListener("change", handlePoiCategoryChange);
els.endGameButton.addEventListener("click", handleEndGame);
els.repeatTimedButton.addEventListener("click", () => {
  if (lastTimedConfig) startTimedTraining(lastTimedConfig);
});
els.examTaskList.addEventListener("click", event => {
  const button = event.target.closest?.("[data-exam-round]");
  if (button) showExamRoundOnMap(Number(button.dataset.examRound));
});
els.returnToExamResultsButton.addEventListener("click", returnToExamResults);
els.statisticsModeFilter.addEventListener("change", renderStatistics);
els.statisticsTargetFilter.addEventListener("change", renderStatistics);
els.statisticsExportButton.addEventListener("click", exportStatistics);
els.statisticsImportButton.addEventListener("click", () => els.statisticsImportInput.click());
els.statisticsImportInput.addEventListener("change", importStatisticsFile);
els.statisticsResetButton.addEventListener("click", resetStatistics);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && roundTimer.isRunning()) roundTimer.checkNow();
});
window.addEventListener("pagehide", handlePageHide);
window.addEventListener("beforeunload", handleBeforeUnload);
window.addEventListener("popstate", handleExamPopState);
window.addEventListener("keydown", event => {
  if (event.key === "Enter"
    && !els.mainButton.disabled
    && ![GAME_STATUS.ACTIVE, GAME_STATUS.PREPARING].includes(gameState.status)) {
    handleMainButton();
  }
});

function updateOnlineStatus() {
  const isOnline = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
  if (els.offlineBanner) {
    if (!isOnline) {
      els.offlineBanner.classList.remove("hidden");
    } else {
      els.offlineBanner.classList.add("hidden");
    }
  }
  if (isOnline) {
    basemapCoordinator.resetCartoFallback();
  }
  basemapCoordinator.update();
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
}
updateOnlineStatus();

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(err => {
      if (CONFIG.debug) console.warn("Service Worker registration failed:", err);
    });
  });
}

const startupPromise = initializeApplication();

window.StrassentrainerRuntime = Object.freeze({
  ready: startupPromise,
  activateCity,
  deleteCity,
  canChangeCity: canChangeRuntimeCity,
  getActiveCity: () => cityContext?.metadata || null,
  getStatus: () => ({ status: runtimeState.status, error: runtimeState.error }),
  activateTrainingArea,
  getActiveTrainingArea: () => cityContext?.activeArea || null,
  getTrainingAreas: () => (cityContext?.areas ? [...cityContext.areas] : []),
  useOfflineBasemap: (force = true) => basemapCoordinator.setMode(force ? "offline" : "auto"),
  setBasemapMode: mode => basemapCoordinator.setMode(mode),
  getBasemapMode: () => basemapCoordinator.mode,
  getActiveBasemap: () => basemapCoordinator.activeBasemap,
  getOfflineBasemapDiagnostics: () => (offlineBasemap ? offlineBasemap.getDiagnostics() : null)
});
