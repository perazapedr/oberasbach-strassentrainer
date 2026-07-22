"use strict";

const geometryApi = window.StreetGeometry;
const targetApi = window.StrassentrainerTargets;
const statisticsApi = window.StrassentrainerStatistics;
const timerApi = window.StrassentrainerTimer;
const {
  GAME_STATUS,
  MODE_CONFIGS,
  createGameEngine
} = window.StrassentrainerEngine;

const MAP_STYLE = {
  tileUrl: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
  roadContrastUrl: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png",
  roadContrastMinZoom: 15,
  roadContrastOpacity: 0.34,
  solution: "#d71936",
  connection: "#0067b9"
};

const CONFIG = {
  municipalityName: "Oberasbach",
  postalCode: "90522",
  countryName: "Deutschland",
  initialCenter: [49.4356, 10.9694],
  initialZoom: 13,
  geometryBbox: [10.9384173, 49.4017231, 10.9987491, 49.4454542],
  bounds: L.latLngBounds([49.4017231, 10.9384173], [49.4454542, 10.9987491]),
  geocoderDelayMs: 1150,
  geocoderResultLimit: 50,
  geometryCacheKey: "oberasbach-strassentrainer-geometrien-v3-vollstaendig",
  statisticsStorageKey: "oberasbach-strassentrainer-statistik-v1",
  contentSettingsStorageKey: "oberasbach-strassentrainer-inhalt-v1",
  debug: new URLSearchParams(window.location.search).get("debug") === "1",
  fireStations: [
    { position: [49.4193202, 10.9594029], name: "Freiwillige Feuerwehr Oberasbach" },
    { position: [49.4132163, 10.9510362], name: "Freiwillige Feuerwehr Rehdorf" },
    { position: [49.4337566, 10.9716011], name: "Freiwillige Feuerwehr Altenberg" }
  ],
  maxCacheEntries: 120
};

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
  mapHint: document.getElementById("mapHint"),
  mapPanel: document.getElementById("mapPanel"),
  modeCard: document.getElementById("modeCard"),
  modeSelect: document.getElementById("modeSelect"),
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

const map = L.map("map", {
  center: CONFIG.initialCenter,
  zoom: CONFIG.initialZoom,
  zoomControl: true,
  attributionControl: false,
  minZoom: 12,
  maxZoom: 19,
  maxBounds: CONFIG.bounds.pad(0.45),
  preferCanvas: true
});

L.tileLayer(MAP_STYLE.tileUrl, {
  subdomains: "abcd",
  maxZoom: 20,
  detectRetina: true,
  crossOrigin: true
}).addTo(map);

const roadContrastPane = map.createPane("roadContrastPane");
roadContrastPane.style.zIndex = "210";
roadContrastPane.style.pointerEvents = "none";
roadContrastPane.style.mixBlendMode = "multiply";

L.tileLayer(MAP_STYLE.roadContrastUrl, {
  pane: "roadContrastPane",
  minZoom: MAP_STYLE.roadContrastMinZoom,
  maxZoom: 20,
  opacity: MAP_STYLE.roadContrastOpacity,
  subdomains: "abcd",
  detectRetina: true,
  crossOrigin: true
}).addTo(map);

map.fitBounds(CONFIG.bounds, { animate: false, padding: [12, 12] });

const solutionLayers = L.featureGroup().addTo(map);
const answerLayers = L.featureGroup().addTo(map);
const fireStationLayers = L.featureGroup().addTo(map);

const statisticsStore = statisticsApi.createStatisticsStore(
  localStorage,
  CONFIG.statisticsStorageKey
);
const gameEngine = createGameEngine({
  scoreCalculator: (distanceMeters, _config, target) =>
    targetApi.calculateTargetScore(distanceMeters, target),
  statisticsStore,
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

const poiCategories = Array.isArray(window.OBERASBACH_POI_CATEGORIES)
  ? window.OBERASBACH_POI_CATEGORIES
  : [];
const contentRepository = {
  streetTargets: targetApi.prepareStreetTargets(window.OBERASBACH_STREETS, geometryApi),
  poiTargets: targetApi.preparePoiTargets(window.OBERASBACH_POIS, poiCategories),
  lastTargetId: null,
  selectedTargetIds: new Set(),
  unavailableTargetIds: new Set(),
  selectionCounts: { street: 0, poi: 0 }
};

let contentSettings = loadContentSettings();

const geometryRepository = {
  lastRequestAt: 0
};

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
    map.fitBounds(CONFIG.bounds, { animate, padding: [12, 12] });
  },
  showRoundSolution(guessLatLng, nearestCoordinate, target) {
    renderRoundSolutionOnMap(guessLatLng, nearestCoordinate, target);
  }
};

function addFireStations() {
  const stationIcon = L.divIcon({
    className: "",
    html: '<div class="fire-station-marker" aria-hidden="true">🚒</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  CONFIG.fireStations.forEach(station => {
    L.marker(station.position, {
      icon: stationIcon,
      interactive: false,
      keyboard: false,
      alt: station.name
    }).addTo(fireStationLayers);
  });
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
  els.poiCategoryOptions.innerHTML = poiCategories.map(category => `
    <label class="category-option">
      <input type="checkbox" data-poi-category="${escapeHtml(category.id)}"
        ${selected.has(category.id) ? "checked" : ""} />
      <span>${escapeHtml(category.label)}</span>
    </label>`).join("");
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

function readGeometryCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG.geometryCacheKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getCachedGeometry(street) {
  const cached = readGeometryCache()[street.id];
  if (!cached || !geometryApi.isValidStreetGeometry(cached.geometry, street.id)) return null;
  return cached.geometry;
}

function saveCachedGeometry(street, geometry) {
  try {
    const cache = readGeometryCache();
    cache[street.id] = { geometry, savedAt: Date.now() };

    const entries = Object.entries(cache)
      .sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0))
      .slice(0, CONFIG.maxCacheEntries);

    localStorage.setItem(CONFIG.geometryCacheKey, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) {
    // Die App funktioniert auch, wenn der Browser lokalen Speicher blockiert.
  }
}

async function waitForGeocoderSlot() {
  const elapsed = Date.now() - geometryRepository.lastRequestAt;
  const waitMs = Math.max(0, CONFIG.geocoderDelayMs - elapsed);
  if (waitMs > 0) {
    await new Promise(resolve => window.setTimeout(resolve, waitMs));
  }
  geometryRepository.lastRequestAt = Date.now();
}

async function fetchJsonWithTimeout(url, timeoutMs = 14000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function geocodeWithNominatim(street) {
  const queries = [street.displayName, ...(street.aliases || [])]
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const [minLon, minLat, maxLon, maxLat] = CONFIG.geometryBbox;

  for (const streetName of queries) {
    await waitForGeocoderSlot();
    const params = new URLSearchParams({
      q: `${streetName}, ${CONFIG.postalCode} ${CONFIG.municipalityName}, ${CONFIG.countryName}`,
      format: "geojson",
      polygon_geojson: "1",
      addressdetails: "1",
      dedupe: "0",
      bounded: "1",
      viewbox: `${minLon},${maxLat},${maxLon},${minLat}`,
      countrycodes: "de",
      limit: String(CONFIG.geocoderResultLimit),
      "accept-language": "de"
    });

    const data = await fetchJsonWithTimeout(`https://nominatim.openstreetmap.org/search.php?${params}`);
    const sameStreetInOberasbach = (data.features || []).filter(feature => {
      const properties = feature.properties || {};
      const isRoad = properties.category === "highway" || properties.class === "highway";
      return isRoad
        && geometryApi.featureMatchesStreet(feature, street)
        && geometryApi.featureBelongsToMunicipality(
          feature, CONFIG.municipalityName, CONFIG.postalCode
        );
    });
    const geometry = geometryApi.mergeStreetFeatures(
      sameStreetInOberasbach, street, CONFIG.geometryBbox, "nominatim"
    );
    if (geometry) return geometry;

    debugGeometry("Keine vollständige Liniengeometrie in Geocoding-Antwort", null, {
      streetId: street.id,
      displayName: street.displayName,
      query: streetName,
      returnedFeatureCount: (data.features || []).length,
      matchingFeatureCount: sameStreetInOberasbach.length,
      returnedGeometryTypes: [...new Set((data.features || []).map(feature => feature.geometry?.type))]
    });
  }

  return null;
}

async function resolveStreetGeometry(street) {
  const cached = getCachedGeometry(street);
  if (cached) {
    return cached;
  }

  let geometry = null;
  try {
    geometry = await geocodeWithNominatim(street);
  } catch (error) {
    console.warn("Nominatim-Abfrage fehlgeschlagen", error);
  }

  if (geometry) saveCachedGeometry(street, geometry);
  return geometry;
}

function renderTargetCategory(target) {
  const categoryLabel = target.categoryLabel || "Ort";
  const shouldShow = Boolean(gameState.config.showTargetCategory && categoryLabel);
  els.targetCategoryLabel.textContent = shouldShow ? `Kategorie: ${categoryLabel}` : "";
  els.targetCategoryLabel.classList.toggle("hidden", !shouldShow);
}

function renderActiveRound(target) {
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
  cancelAutoAdvance();
  stopRoundTimer();
  const preparationToken = ++roundPreparationToken;
  mapView.clearRound();
  gameEngine.startRound();

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

    const geometry = target.targetType === targetApi.TARGET_TYPES.STREET
      ? await resolveStreetGeometry(target)
      : target.geometry;
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
  els.distanceValue.textContent = hasDistance ? formatDistance(roundedDistance) : "–";
  els.scoreValue.textContent = result.points.toLocaleString("de-DE");
  els.resultTitle.textContent = result.timedOut
    ? "Zeit abgelaufen"
    : getResultTitle(roundedDistance, result.targetType);
  const targetDescription = result.targetType === targetApi.TARGET_TYPES.POI
    ? "Der rote Zielpunkt zeigt den richtigen Ort."
    : "Die rote Linie zeigt die richtige Straße.";
  els.resultMessage.textContent = result.timedOut
    ? `Die Runde wurde ohne Tipp und mit 0 Punkten gespeichert. ${targetDescription}`
    : getResultMessage(roundedDistance, result.targetType);
  els.resultCard.classList.remove("hidden");
  els.alarmCard.classList.remove("active");
  els.mainButton.disabled = false;
  const isLastTimedRound = gameState.config.mode === "timed"
    && gameState.results.length >= gameState.config.totalRounds;
  els.mainButton.textContent = isLastTimedRound
    ? "Auswertung anzeigen"
    : (gameState.config.mode === "timed" ? "Nächste Aufgabe" : "Nächster Alarm");
  els.mapHint.textContent = result.timedOut
    ? (result.targetType === targetApi.TARGET_TYPES.POI
      ? "Roter Punkt: richtiger Einsatzort"
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
  link.download = `strassentrainer-statistik-${new Date().toISOString().slice(0, 10)}.json`;
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
    "Statistik wirklich zurücksetzen? Alle lokal gespeicherten Statistikwerte werden gelöscht."
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
  els.instruction.textContent = `${availableCount} Oberasbacher ${contentLabel} stehen zur Auswahl.`;
  els.mainButton.disabled = availableCount === 0;
  els.mainButton.textContent = "Ersten Alarm auslösen";
  els.mapHint.textContent = "Die Karte enthält bewusst keine Straßennamen.";
  setStatus(
    availableCount > 0
      ? "GitHub-Pages-Modus aktiv: POIs werden aus der lokalen geprüften Datendatei geladen."
      : "Für die gewählte Inhaltsauswahl ist kein aktives Ziel vorhanden.",
    availableCount > 0 ? "ready" : "error"
  );
  renderScoreboard();
}

function renderCountdownConfiguration(mode) {
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

function initializeApplication() {
  mapView.clearRound();
  els.resultCard.classList.add("hidden");
  applyContentSettingsToControls();
  renderStatistics();
  const statisticsLoadWarning = statisticsStore.getLoadWarning();
  if (statisticsLoadWarning) setStatisticsMessage(statisticsLoadWarning, "error");

  if (contentRepository.streetTargets.length < 20 || contentRepository.poiTargets.length === 0) {
    els.targetStreet.textContent = "Lokale Straßenliste fehlt";
    els.instruction.textContent = "Die lokalen Straßen- oder POI-Datendateien wurden nicht korrekt geladen.";
    els.mainButton.disabled = true;
    els.mainButton.textContent = "Dateien prüfen";
    setStatus("Die statischen Projektdaten sind unvollständig.", "error");
    return;
  }

  startGame(MODE_CONFIGS.free);
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
  const geometry = await resolveStreetGeometry(street);
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

addFireStations();
map.on("click", event => submitGuess(event.latlng));
els.mainButton.addEventListener("click", handleMainButton);
els.modeSelect.addEventListener("change", handleModeChange);
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

initializeApplication();
