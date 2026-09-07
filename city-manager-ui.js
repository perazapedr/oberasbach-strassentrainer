(function initializeCityManager(root, factory) {
  "use strict";

  const commonJsPackage = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./city-package.js")
    : null;
  const commonJsUpdate = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./city-update.js")
    : null;
  const commonJsPoiCategories = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./poi-categories.js")
    : null;
  const commonJsCustomAreas = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./custom-training-area.js")
    : null;
  const commonJsDatasetProvider = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./dataset-provider.js")
    : null;
  const api = factory(
    root,
    commonJsPackage,
    commonJsUpdate,
    commonJsPoiCategories,
    commonJsCustomAreas,
    commonJsDatasetProvider
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerCityManager = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCityManagerApi(root, commonJsPackage, commonJsUpdate, commonJsPoiCategories, commonJsCustomAreas, commonJsDatasetProvider) {
  "use strict";

  const STATES = Object.freeze({
    IDLE: "idle",
    SEARCHING: "searching",
    SEARCH_RESULTS: "search-results",
    CHECKING_INSTALLED: "checking-installed",
    MUNICIPALITY_SELECTED: "municipality-selected",
    ACTIVATING: "activating",
    DOWNLOADING: "downloading",
    VALIDATING: "validating",
    VALIDATION_RESULT: "validation-result",
    SAVING: "saving",
    COMPLETED: "completed",
    ERROR: "error"
  });

  function getUserFriendlyCityError(error, context) {
    const code = asText(error && error.code);
    const status = Number(error && error.status) || 0;
    const isOnline = typeof error?.navigatorOnline === "boolean"
      ? error.navigatorOnline
      : (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
        ? navigator.onLine
        : true);

    if (code === "CATALOG_HASH_MISMATCH" || code === "PACKAGE_HASH_MISMATCH" || code === "HASH_MISMATCH") {
      return "Das Datenpaket konnte nicht sicher geprüft werden und wurde nicht installiert.";
    }

    if (context === "search") {
      if (!isOnline) {
        return "Für die Suche nach neuen Städten wird eine Internetverbindung benötigt.\n\nBereits installierte Städte können weiterhin gespielt werden.";
      }
      if (code === "CATALOG_UNAVAILABLE") {
        return "Die Liste verfügbarer Trainingsgebiete konnte momentan nicht geladen werden.\n\nBereits installierte Gebiete können weiterhin gespielt werden.";
      }
      if (code === "TIMEOUT") {
        return "Die Stadtsuche dauert momentan ungewöhnlich lange. Bitte versuche es erneut.";
      }
      return "Die Stadtsuche ist momentan nicht erreichbar. Bereits installierte Städte können weiterhin gespielt werden.";
    }
    if (context === "validation") {
      if (code === "CATALOG_HASH_MISMATCH" || code === "PACKAGE_HASH_MISMATCH") {
        return "Integritätsprüfung fehlgeschlagen: Die Prüfsumme des Datenpakets stimmt nicht überein. Es wurde nichts gespeichert.";
      }
      if (code === "PACKAGE_INVALID") {
        return "Das heruntergeladene Datenpaket ist ungültig oder beschädigt. Es wurde nichts gespeichert.";
      }
      return "Die heruntergeladenen Stadtdaten konnten nicht sicher verwendet werden. Es wurde nichts gespeichert.";
    }
    if (context === "storage" || code === "STORAGE_FAILED") {
      return "Die Stadt konnte nicht lokal gespeichert werden. Bitte versuche es erneut und prüfe, ob ausreichend lokaler Speicher verfügbar ist.";
    }
    if (context === "update") {
      if (!isOnline) {
        return "Du bist momentan offline.\n\nFür die Prüfung von Aktualisierungen wird eine Internetverbindung benötigt. Bereits installierte Städte können weiterhin gespielt werden.";
      }
      if (code === "CATALOG_UNAVAILABLE") {
        return "Updates konnten momentan nicht geprüft werden. Der Dataset-Katalog ist nicht erreichbar.";
      }
      if (code === "DATASET_NOT_FOUND") {
        return "Für dieses Dataset ist derzeit kein Online-Update verfügbar.";
      }
      if (code === "INVALID_VERSION") {
        return "Die Versionsinformation des Datasets ist ungültig. Update konnte nicht geprüft werden.";
      }
      if (code === "DOWNLOAD_FAILED") {
        return "Das Update-Paket konnte nicht heruntergeladen werden.";
      }
      if (code === "CATALOG_HASH_MISMATCH" || code === "PACKAGE_HASH_MISMATCH") {
        return "Integritätsprüfung fehlgeschlagen: Die Prüfsumme des Datenpakets stimmt nicht überein. Es wurde nichts geändert.";
      }
      if (code === "PACKAGE_INVALID") {
        return "Das Update-Paket ist ungültig oder beschädigt. Es wurde nichts geändert.";
      }
      if (code === "TIMEOUT") {
        return "Die Prüfung auf Aktualisierungen hat zu lange gedauert. Bitte versuche es erneut.";
      }
      return "Aktualisierungen konnten momentan nicht geprüft werden. Bitte versuche es später erneut.";
    }
    if (context !== "download") {
      return "Der Stadtvorgang konnte nicht abgeschlossen werden. Bitte versuche es erneut.";
    }

    if (code === "ABORTED") return "Download wurde abgebrochen. Es wurden keine Stadtdaten gespeichert.";
    if (code === "DOWNLOAD_FAILED") {
      return "Das Dataset konnte nicht heruntergeladen werden.";
    }
    if (code === "PACKAGE_INVALID") {
      return "Die heruntergeladenen Stadtdaten konnten nicht sicher verwendet werden. Es wurde nichts gespeichert.";
    }
    if (code === "NO_STREETS") {
      return "Für diese Gemeinde konnten keine spielbaren Straßen gefunden werden. Es wurde nichts gespeichert.";
    }
    if (code === "TOO_FEW_STREETS") {
      const streetCount = Number(error && error.streetCount);
      return Number.isInteger(streetCount)
        ? `Es wurden nur ${streetCount} spielbare Straßen gefunden. Diese Gemeinde eignet sich derzeit nicht für den Straßentrainer.`
        : "Für diese Gemeinde wurden zu wenige spielbare Straßen gefunden. Sie eignet sich derzeit nicht für den Straßentrainer.";
    }
    if (code === "TIMEOUT") {
      return "Der Download hat zu lange gedauert. Bitte versuche es erneut.";
    }
    if (code === "NETWORK_ERROR") {
      if (!isOnline) {
        return "Du bist momentan offline.\n\nFür das Herunterladen neuer Städte wird eine Internetverbindung benötigt. Bereits installierte Städte können weiterhin gespielt werden.";
      }
      return "Der OpenStreetMap-Datendienst konnte momentan nicht erreicht werden.\n\nDeine Internetverbindung scheint grundsätzlich zu bestehen. Bitte versuche den Download in Kürze erneut.";
    }
    if (!isOnline) {
      return "Für die Installation eines neuen Trainingsgebiets wird einmalig eine Internetverbindung benötigt.\n\nBereits installierte Städte können weiterhin gespielt werden.";
    }
    if (code === "HTTP_ERROR" && status === 429) {
      return "Der OpenStreetMap-Datendienst ist momentan stark ausgelastet (sehr viele Anfragen). Bitte warte kurz und versuche es in Kürze erneut.";
    }
    if (code === "HTTP_ERROR" && [502, 503, 504].includes(status)) {
      return "Der OpenStreetMap-Datendienst ist momentan ausgelastet und nicht verfügbar. Die Stadt konnte deshalb nicht vollständig geladen werden. Bitte versuche es später erneut.";
    }
    if (code === "HTTP_ERROR" && (status === 500 || status >= 500)) {
      return "Der OpenStreetMap-Datendienst hat einen vorübergehenden Serverfehler gemeldet. Bitte versuche den Download erneut.";
    }
    if (code === "INVALID_JSON" || code === "INVALID_RESPONSE") {
      return "Der OpenStreetMap-Datendienst hat keine sicher verwendbare Antwort geliefert. Bitte versuche den Download erneut.";
    }
    return "Die Daten für diese Stadt konnten momentan nicht vollständig geladen werden. Bitte versuche den Download erneut.";
  }

  const REQUIRED_ELEMENT_IDS = [
    "citySelector", "citySelectorButton", "activeCityName", "cityMenu", "installedCityList",
    "addCityButton", "importCityButton", "cityImportFileInput", "cityManagerHeaderStatus",
    "cityManagerModalOverlay", "cityManagerDialog",
    "closeCityManagerButton", "cityManagerAlert", "citySearchPanel", "citySearchForm", "citySearchInput",
    "citySearchButton", "citySearchStatus", "citySearchResults", "selectedMunicipalityPanel",
    "selectedMunicipalityName", "selectedMunicipalityContext", "municipalityActionButton",
    "cityDownloadPanel", "cityDownloadTitle", "cityDownloadProgress", "cityProgressBar",
    "cityProgressMessage", "cancelCityDownloadButton", "cityValidationPanel", "cityValidationOutcome",
    "cityPreviewMetadata",
    "previewStreetCount", "previewPoiCount", "previewFireStationCount", "previewCategoryCounts",
    "cityWarningSummary", "toggleWarningDetailsButton", "cityWarningDetails", "cancelValidationButton",
    "saveCityButton", "cityCompletedPanel", "cityCompletedMessage", "activateImportedCityButton",
    "closeCompletedButton",
    "cityManagerLiveRegion", "deleteCityModalOverlay", "deleteCityDialog", "deleteCityMessage",
    "deleteCityStatus", "cancelDeleteCityButton", "confirmDeleteCityButton"
  ];

  const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex=\"-1\"])"
  ].join(",");

  const poiCategoriesApi = commonJsPoiCategories
    || (root && root.StrassentrainerPoiCategories)
    || (typeof globalThis !== "undefined" && globalThis.StrassentrainerPoiCategories)
    || null;

  const CATEGORY_LABELS = Object.freeze({
    fire_station: "Feuerwehren",
    police: "Polizei",
    hospital: "Krankenhäuser",
    nursing_care: "Pflegeeinrichtungen",
    school: "Schulen",
    kindergarten: "Kindergärten",
    childcare: "Kindertagesstätten",
    supermarket: "Supermärkte",
    fuel: "Tankstellen",
    hotel: "Hotels",
    restaurant: "Gaststätten",
    sports_facility: "Sportstätten",
    company: "Unternehmen",
    public_building: "Öffentliche Gebäude",
    "senior-care": "Senioren- und Pflegeeinrichtungen",
    health: "Gesundheit",
    "public-facility": "Öffentliche Einrichtungen",
    "sports-leisure": "Sport und Freizeit",
    hospitality: "Gastronomie und Beherbergung",
    "other-relevant": "Sonstige einsatzrelevante Orte"
  });

  function asText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function setHidden(element, hidden) {
    if (!element) return;
    if (hidden) element.classList.add("hidden");
    else element.classList.remove("hidden");
  }

  function clampProgress(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function municipalityName(municipality) {
    return asText(municipality && (municipality.displayName || municipality.name)) || "Unbekannte Gemeinde";
  }

  function municipalityContext(municipality, includeCountryFallback = false) {
    const parts = [];
    const datasetKind = asText(municipality && (municipality.datasetKind || municipality.package?.datasetKind));
    if (datasetKind === "district") parts.push("Typ Landkreis");
    const district = asText(municipality && municipality.district);
    const state = asText(municipality && municipality.state);
    if (district) parts.push(district);
    if (state && !parts.includes(state)) parts.push(state);
    if (parts.length === 0 && Array.isArray(municipality && municipality.postalCodes)) {
      const postalCodes = municipality.postalCodes.map(asText).filter(Boolean);
      if (postalCodes.length) parts.push(postalCodes.join(", "));
    }
    const country = asText(municipality && municipality.country);
    if ((includeCountryFallback || parts.length === 0) && country && !parts.includes(country)) parts.push(country);
    return parts.join(" · ");
  }

  function municipalityCityId(municipality) {
    const datasetId = asText(municipality && municipality.id);
    if (datasetId) return datasetId;
    const osmType = asText(municipality && municipality.osmType);
    const osmId = Number(municipality && municipality.osmId);
    if (!osmType || !Number.isSafeInteger(osmId) || osmId <= 0) return null;
    return `osm-${osmType}-${osmId}`;
  }

  function isUpdateableCity(city) {
    if (!city || typeof city !== "object") return false;
    let osmType = asText(city.osmType);
    let osmId = Number(city.osmId);
    if ((!osmType || !Number.isSafeInteger(osmId)) && typeof city.id === "string") {
      const match = city.id.match(/^osm-([a-z]+)-(\d+)$/);
      if (match) {
        osmType = match[1];
        osmId = Number(match[2]);
      }
    }
    return osmType === "relation" && Number.isSafeInteger(osmId) && osmId > 0;
  }

  function isCuratedCity(city) {
    if (!city || typeof city !== "object") return false;
    if (city.package?.type === "curated") return true;
    const source = asText(city.source);
    return source.includes("curated") || city.id === "osm-relation-1016396";
  }

  function formatDate(dateValue) {
    if (!dateValue) return "";
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  function createCityManager(options = {}) {
    const documentRef = options.document || (root && root.document) || null;
    const storage = options.storage || (root && root.StrassentrainerCityStorage) || null;
    const datasetProviderApi = commonJsDatasetProvider
      || (root && root.StrassentrainerDatasetProvider)
      || null;
    const datasetProvider = options.datasetProvider
      || (options.osmService && datasetProviderApi
        && typeof datasetProviderApi.createLegacyOsmDatasetProvider === "function"
        ? datasetProviderApi.createLegacyOsmDatasetProvider(options.osmService)
        : (datasetProviderApi && typeof datasetProviderApi.createCatalogDatasetProvider === "function"
            ? datasetProviderApi.createCatalogDatasetProvider()
            : (datasetProviderApi && typeof datasetProviderApi.getDefaultProvider === "function"
                ? datasetProviderApi.getDefaultProvider()
                : (root && root.StrassentrainerDatasetProvider) || null)));
    const validator = options.validator || (root && root.StrassentrainerCityDataValidator) || null;
    const packageApi = options.packageApi || (root && root.StrassentrainerCityPackage) || commonJsPackage;
    const updateApi = options.updateApi || (root && root.StrassentrainerCityUpdate) || commonJsUpdate;
    const customAreasApi = options.customAreasApi
      || (root && root.StrassentrainerCustomTrainingAreas)
      || commonJsCustomAreas;
    const AbortControllerClass = options.AbortController
      || (root && root.AbortController)
      || (typeof AbortController !== "undefined" ? AbortController : null);
    const schedule = options.setTimeout || (root && root.setTimeout) || (callback => callback());

    let elements = null;
    let initialized = false;
    let listenersBound = false;
    let phase = STATES.IDLE;
    let modalOpen = false;
    let menuOpen = false;
    let installedCities = [];
    let activeCityId = null;
    let searchResults = [];
    let selectedMunicipality = null;
    let selectedMunicipalityInstalled = false;
    let validatedPackage = null;
    let alertMessage = "";
    let noticeMessage = "";
    let progress = { stage: "", message: "Download wird vorbereitet …", progress: 0 };
    let warningDetailsExpanded = false;
    let previousFocus = null;
    let reopenMenuAfterModal = false;
    let searchController = null;
    let downloadController = null;
    let searchOperationId = 0;
    let selectionOperationId = 0;
    let downloadOperationId = 0;
    let refreshOperationId = 0;
    let activeOperationId = 0;
    let pendingCityActivation = null;
    let lastSearchQuery = "";
    let errorContext = "";
    let deleteTarget = null;
    let deleteOpen = false;
    let deleting = false;
     let workflowSource = "download";
    let importedAlreadyInstalled = false;
    let importedActiveCity = false;
    let importMode = "new";
    let importConflictMessage = "";
    let importInstalledCity = null;
    let importDiff = null;
    let completedCity = null;
    let completedActivationAvailable = false;
    let activatingCompletedCity = false;
    let updatingCity = null;
    let updateDiff = null;
    let updateCheckResult = null;
    let importOperationId = 0;
    const exportingCityIds = new Set();
    let canChangeCity = typeof options.canChangeCity === "function" ? options.canChangeCity : () => true;
    let activateCityCallback = typeof options.activateCity === "function" ? options.activateCity : null;
    let deleteCityCallback = typeof options.deleteCity === "function" ? options.deleteCity : null;
    let getRuntimeCity = typeof options.getRuntimeCity === "function" ? options.getRuntimeCity : () => null;

    function requireDependencies() {
      if (!documentRef) throw new Error("CityManager benötigt ein document.");
      if (!storage) throw new Error("StrassentrainerCityStorage ist nicht verfügbar.");
      if (!datasetProvider) throw new Error("StrassentrainerDatasetProvider ist nicht verfügbar.");
      if (datasetProviderApi && typeof datasetProviderApi.assertDatasetProvider === "function") {
        datasetProviderApi.assertDatasetProvider(datasetProvider);
      } else {
        const requiredMethods = ["searchDatasets", "getDatasetMetadata", "downloadDataset", "checkForUpdate"];
        if (requiredMethods.some(method => typeof datasetProvider[method] !== "function")) {
          throw new Error("StrassentrainerDatasetProvider ist unvollständig.");
        }
      }
      if (!validator) throw new Error("StrassentrainerCityDataValidator ist nicht verfügbar.");
      if (!packageApi || typeof packageApi.readCityPackageFile !== "function"
        || typeof packageApi.exportAndDownloadCityPackage !== "function") {
        throw new Error("StrassentrainerCityPackage ist nicht verfügbar.");
      }
      if (!AbortControllerClass) throw new Error("AbortController ist nicht verfügbar.");
    }

    function collectElements() {
      const found = {};
      const missing = [];
      REQUIRED_ELEMENT_IDS.forEach(id => {
        found[id] = documentRef.getElementById(id);
        if (!found[id]) missing.push(id);
      });
      if (missing.length) throw new Error(`CityManager-Markup fehlt: ${missing.join(", ")}`);
      return found;
    }

    function announce(message) {
      if (!elements) return;
      elements.cityManagerLiveRegion.textContent = message || "";
    }

    function syncDocumentModalState() {
      const bodyClassList = documentRef && documentRef.body && documentRef.body.classList;
      if (!bodyClassList) return;
      if (modalOpen || deleteOpen) bodyClassList.add("city-modal-open");
      else bodyClassList.remove("city-modal-open");
    }

    function setHeaderStatus(message) {
      if (!elements) return;
      elements.cityManagerHeaderStatus.textContent = message || "";
    }

    function isCityChangeAllowed() {
      try {
        return canChangeCity() !== false;
      } catch (_) {
        return false;
      }
    }

    async function activateCity(cityId, activationOptions) {
      if (activateCityCallback) return activateCityCallback(cityId, activationOptions);
      return storage.setActiveCityId(cityId);
    }

    async function removeCity(cityId) {
      if (deleteCityCallback) return deleteCityCallback(cityId);
      return storage.deleteCity(cityId);
    }

    function runtimeCity() {
      try {
        return getRuntimeCity() || null;
      } catch (_) {
        return null;
      }
    }

    function providerRequiresNetwork(operation) {
      return typeof datasetProvider.requiresNetwork === "function"
        && datasetProvider.requiresNetwork(operation) === true;
    }

    function explainBlockedCityChange() {
      const message = "Ein Stadtwechsel ist gerade nicht möglich. Bitte warte, bis der laufende Stadtvorgang abgeschlossen ist.";
      setHeaderStatus(message);
      if (modalOpen) {
        alertMessage = message;
        render();
      }
      announce(message);
    }

    function sortedCities(cities) {
      return [...cities].sort((first, second) => municipalityName(first).localeCompare(
        municipalityName(second),
        "de",
        { sensitivity: "base" }
      ));
    }

    function makeElement(tagName, className, textContent) {
      const element = documentRef.createElement(tagName);
      if (className) element.className = className;
      if (textContent !== undefined) element.textContent = textContent;
      return element;
    }

    function renderInstalledCities() {
      if (!elements) return;
      elements.installedCityList.replaceChildren();

      if (installedCities.length === 0) {
        elements.installedCityList.appendChild(makeElement(
          "p",
          "installed-city-empty city-menu-empty",
          "Noch keine Stadt installiert"
        ));
      }

      installedCities.forEach(city => {
        const row = makeElement(
          "div",
          city.id === activeCityId ? "installed-city-row active" : "installed-city-row"
        );
        row.setAttribute("role", "none");

        const selectButton = makeElement("button", "installed-city-select installed-city-button");
        selectButton.type = "button";
        selectButton.setAttribute("role", "menuitemradio");
        selectButton.setAttribute("aria-checked", city.id === activeCityId ? "true" : "false");
        selectButton.dataset.cityId = city.id;

        const label = makeElement("span", "installed-city-name", municipalityName(city));
        const isCurated = isCuratedCity(city);
        if (isCurated) {
          const badge = makeElement("span", "city-badge curated", "Kuratiert");
          badge.title = "Redaktionell strukturiertes Trainingspaket. Daten werden nicht automatisch durch OpenStreetMap überschrieben.";
          label.appendChild(badge);
        }
        selectButton.appendChild(label);
        if (city.id === activeCityId) {
          selectButton.appendChild(makeElement("span", "installed-city-check installed-city-active", "✓"));
        }
        const context = municipalityContext(city);
        let dataStand = "";
        if (isCurated) {
          const versionStr = city.package?.version ? `v${city.package.version}` : "v1.0.0";
          const verifiedAt = city.package?.verification?.verifiedAt || city.updatedAt || city.createdAt;
          const verifiedDate = verifiedAt ? formatDate(verifiedAt) : "";
          dataStand = `Kuratiertes Trainingspaket ${versionStr}${verifiedDate ? ` · Paketangabe: ${verifiedDate}` : ""}`;
        } else {
          const standDate = city.updatedAt || city.createdAt ? formatDate(city.updatedAt || city.createdAt) : "";
          dataStand = `OpenStreetMap-Daten${standDate ? ` · Datenstand: ${standDate}` : ""}`;
        }
        const details = [context, dataStand].filter(Boolean).join(" · ");
        if (details) selectButton.appendChild(makeElement("span", "installed-city-context", details));
        selectButton.addEventListener("click", () => activateInstalledCity(city, { fromModal: false }));

        let updateButton = null;
        if (isUpdateableCity(city)) {
          const isCurated = isCuratedCity(city);
          updateButton = makeElement("button", "installed-city-update", "⟳");
          updateButton.type = "button";
          updateButton.setAttribute("role", "menuitem");
          updateButton.dataset.cityId = city.id;
          const updateLabel = isCurated
            ? `${municipalityName(city)} mit OpenStreetMap vergleichen`
            : `${municipalityName(city)} auf Aktualisierung prüfen`;
          updateButton.setAttribute("aria-label", updateLabel);
          updateButton.title = updateLabel;
          updateButton.addEventListener("click", event => {
            event.stopPropagation();
            startCityUpdate(city, updateButton);
          });
        }

        const exportButton = makeElement("button", "installed-city-export", "⇩");
        exportButton.type = "button";
        exportButton.setAttribute("role", "menuitem");
        exportButton.dataset.cityId = city.id;
        exportButton.disabled = exportingCityIds.has(city.id);
        exportButton.setAttribute("aria-label", `${municipalityName(city)} als Stadtdatei exportieren`);
        exportButton.addEventListener("click", event => {
          event.stopPropagation();
          void exportInstalledCity(city);
        });

        const deleteButton = makeElement("button", "installed-city-delete", "✕");
        deleteButton.type = "button";
        deleteButton.setAttribute("role", "menuitem");
        deleteButton.dataset.cityId = city.id;
        deleteButton.setAttribute("aria-label", `${municipalityName(city)} löschen`);
        deleteButton.addEventListener("click", event => {
          event.stopPropagation();
          requestDeleteCity(city, deleteButton);
        });

        row.appendChild(selectButton);
        if (updateButton) row.appendChild(updateButton);
        row.appendChild(exportButton);
        row.appendChild(deleteButton);
        elements.installedCityList.appendChild(row);
      });

      const activeCity = runtimeCity() || installedCities.find(city => city.id === activeCityId);
      elements.activeCityName.textContent = activeCity ? municipalityName(activeCity) : "Keine Stadt ausgewählt";
    }

    function renderSearchResults() {
      elements.citySearchResults.replaceChildren();
      searchResults.forEach(municipality => {
        const button = makeElement("button", "city-search-result");
        button.type = "button";
        button.setAttribute("role", "option");
        const selected = municipalityCityId(municipality) === municipalityCityId(selectedMunicipality);
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.dataset.cityId = municipalityCityId(municipality) || "";
        button.disabled = [STATES.SEARCHING, STATES.CHECKING_INSTALLED, STATES.ACTIVATING].includes(phase);
        button.appendChild(makeElement("strong", "", municipalityName(municipality)));
        button.appendChild(makeElement(
          "span",
          "",
          municipalityContext(municipality, true) || "Deutschland"
        ));
        button.addEventListener("click", () => selectMunicipality(municipality));
        elements.citySearchResults.appendChild(button);
      });
    }

    async function exportInstalledCity(city) {
      const cityId = asText(city?.id);
      if (!cityId || exportingCityIds.has(cityId)) return;
      exportingCityIds.add(cityId);
      renderInstalledCities();
      setHeaderStatus(`${municipalityName(city)} wird als Stadtdatei vorbereitet …`);
      try {
        const exported = await packageApi.exportAndDownloadCityPackage(cityId, {
          storage,
          document: documentRef
        });
        setHeaderStatus(`${municipalityName(city)} wurde als „${exported.filename}“ exportiert.`);
        announce(`${municipalityName(city)} wurde erfolgreich exportiert.`);
      } catch (error) {
        const message = asText(error?.message)
          || "Die Stadt konnte wegen inkonsistenter lokaler Daten nicht exportiert werden.";
        setHeaderStatus(message);
        announce(message);
      } finally {
        exportingCityIds.delete(cityId);
        renderInstalledCities();
      }
    }

    function collectIssues(kind) {
      if (!validatedPackage || !validatedPackage.validation) return [];
      const report = validatedPackage.validation;
      return ["package", "municipality", "streets", "pois", "areas"].flatMap(sectionName => {
        const section = report[sectionName];
        const issues = section && Array.isArray(section[kind]) ? section[kind] : [];
        return issues.map(issue => ({ ...issue, sectionName }));
      });
    }

    function groupedIssues(issues) {
      const groups = new Map();
      issues.forEach(issue => {
        const message = asText(issue.message) || "Die Datenprüfung hat einen nicht näher beschriebenen Hinweis gemeldet.";
        const key = `${issue.sectionName}:${asText(issue.code)}:${message}`;
        const current = groups.get(key) || { sectionName: issue.sectionName, message, count: 0 };
        current.count += 1;
        groups.set(key, current);
      });
      return [...groups.values()];
    }

    function appendIssueList(container, issues, limit) {
      container.replaceChildren();
      const groups = groupedIssues(issues);
      const visibleGroups = groups.slice(0, limit);
      const labels = {
        package: "Trainingspaket",
        municipality: "Gemeinde",
        streets: "Straßen",
        pois: "Einrichtungen",
        areas: "Trainingsgebiete"
      };
      ["package", "municipality", "streets", "pois", "areas"].forEach(sectionName => {
        const sectionGroups = visibleGroups.filter(group => group.sectionName === sectionName);
        if (!sectionGroups.length) return;
        container.appendChild(makeElement("h4", "", labels[sectionName]));
        const list = makeElement("ul");
        sectionGroups.forEach(group => {
          const prefix = group.count > 1 ? `${group.count} × ` : "";
          list.appendChild(makeElement("li", "", `${prefix}${group.message}`));
        });
        container.appendChild(list);
      });
      if (groups.length > limit) {
        container.appendChild(makeElement(
          "p",
          "city-warning-limit",
          `${groups.length - limit} weitere Hinweisgruppen werden aus Gründen der Übersicht nicht einzeln angezeigt.`
        ));
      }
    }

    function renderDiffDetailsList(container, title, items, formatFn) {
      if (!items || items.length === 0) return;
      const details = makeElement("details", "city-diff-details");
      const summary = makeElement("summary", "city-diff-summary-item", `${title} (${items.length})`);
      details.appendChild(summary);
      const ul = makeElement("ul", "city-diff-list");
      const maxDisplay = 30;
      const count = Math.min(items.length, maxDisplay);
      for (let i = 0; i < count; i += 1) {
        const li = makeElement("li", "city-diff-list-item", formatFn(items[i]));
        ul.appendChild(li);
      }
      if (items.length > maxDisplay) {
        ul.appendChild(makeElement("li", "city-diff-more", `+ ${items.length - maxDisplay} weitere`));
      }
      details.appendChild(ul);
      container.appendChild(details);
    }

    function renderUpdateDiffPanel(city, packageData, diff) {
      const isCurated = isCuratedCity(updatingCity || city);
      elements.cityPreviewMetadata.replaceChildren();
      elements.cityPreviewMetadata.appendChild(makeElement("strong", "", municipalityName(city)));
      const context = municipalityContext(city, true);
      if (context) elements.cityPreviewMetadata.appendChild(documentRef.createTextNode(` · ${context}`));
      elements.cityPreviewMetadata.appendChild(makeElement("br"));
      const currentVer = updateCheckResult?.currentVersion || updatingCity?.package?.version || updatingCity?.dataVersion || city?.package?.version || city?.dataVersion || 1;
      const currentStand = updatingCity?.updatedAt || updatingCity?.createdAt || city?.updatedAt || city?.createdAt;
      const sourceLabel = isCurated ? "Kuratiert" : (packageData?.package?.source || updatingCity?.package?.source || "Katalog");
      elements.cityPreviewMetadata.appendChild(documentRef.createTextNode(
        `Installierte Version: ${currentVer}${currentStand ? ` (${formatDate(currentStand)})` : ""} · Quelle: ${sourceLabel}`
      ));

      elements.previewCategoryCounts.replaceChildren();
      setHidden(elements.cityWarningSummary, true);
      setHidden(elements.toggleWarningDetailsButton, true);
      setHidden(elements.cityWarningDetails, true);

      elements.cityValidationOutcome.replaceChildren();
      elements.cityValidationOutcome.classList.remove("invalid");

      if (!diff || !diff.summary || !diff.summary.hasChanges) {
        elements.cityValidationOutcome.appendChild(makeElement("h3", "", "Keine Aktualisierung erforderlich"));
        elements.cityValidationOutcome.appendChild(makeElement(
          "p",
          "city-validation-success",
          `Die installierte Stadt ist auf dem neuesten Stand (${currentVer}).`
        ));
        if (diff && diff.summary) {
          const s = diff.summary;
          const info = makeElement(
            "p",
            "city-diff-summary-text",
            `${s.streets.unchanged} Straßen und ${s.pois.unchanged} Einrichtungen sind unverändert.`
          );
          elements.cityValidationOutcome.appendChild(info);
        }
        setHidden(elements.saveCityButton, true);
        elements.cancelValidationButton.disabled = false;
        elements.cancelValidationButton.textContent = "Schließen";
        return;
      }

      // Changes exist
      const nextVer = packageData?.package?.version || updateCheckResult?.latestVersion || "";
      const headingText = isCurated
        ? `OpenStreetMap-Vergleich für ${municipalityName(city)}`
        : (nextVer
          ? `Update für ${municipalityName(city)} verfügbar (${currentVer} → ${nextVer})`
          : `Neue OSM-Daten für ${municipalityName(city)} gefunden`);
      elements.cityValidationOutcome.appendChild(makeElement("h3", "", headingText));

      if (isCurated) {
        elements.cityValidationOutcome.appendChild(makeElement(
          "p",
          "city-validation-info",
          "Kuratiertes Stadtpaket: OpenStreetMap dient als Vergleichsquelle. Kuratierte Daten werden nicht automatisch überschrieben."
        ));
      } else {
        elements.cityValidationOutcome.appendChild(makeElement(
          "p",
          "city-validation-success",
          "Folgende Änderungen gegenüber der lokal installierten Version wurden ermittelt:"
        ));
      }

      const summaryBox = makeElement("div", "city-diff-summary-card");

      // Streets
      const sStreets = diff.summary.streets;
      const streetBox = makeElement("div", "city-diff-group");
      streetBox.appendChild(makeElement("strong", "city-diff-group-title", "Straßen"));
      const streetBadges = makeElement("div", "city-diff-badges");
      if (sStreets.added > 0) streetBadges.appendChild(makeElement("span", "badge-diff badge-added", `+ ${sStreets.added} neu`));
      if (sStreets.removed > 0) streetBadges.appendChild(makeElement("span", "badge-diff badge-removed", `- ${sStreets.removed} entfernt`));
      if (sStreets.modified > 0) streetBadges.appendChild(makeElement("span", "badge-diff badge-modified", `~ ${sStreets.modified} geändert`));
      streetBadges.appendChild(makeElement("span", "badge-diff badge-unchanged", `= ${sStreets.unchanged} unverändert`));
      streetBox.appendChild(streetBadges);
      summaryBox.appendChild(streetBox);

      // POIs
      const sPois = diff.summary.pois;
      const poiBox = makeElement("div", "city-diff-group");
      poiBox.appendChild(makeElement("strong", "city-diff-group-title", "Einrichtungen"));
      const poiBadges = makeElement("div", "city-diff-badges");
      if (sPois.added > 0) poiBadges.appendChild(makeElement("span", "badge-diff badge-added", `+ ${sPois.added} neu`));
      if (sPois.removed > 0) poiBadges.appendChild(makeElement("span", "badge-diff badge-removed", `- ${sPois.removed} entfernt`));
      if (sPois.modified > 0) poiBadges.appendChild(makeElement("span", "badge-diff badge-modified", `~ ${sPois.modified} geändert`));
      poiBadges.appendChild(makeElement("span", "badge-diff badge-unchanged", `= ${sPois.unchanged} unverändert`));
      poiBox.appendChild(poiBadges);
      summaryBox.appendChild(poiBox);

      // Areas
      const sAreas = diff.summary.areas;
      if (sAreas.totalCandidate > 0 || sAreas.totalCurrent > 0) {
        const areaBox = makeElement("div", "city-diff-group");
        areaBox.appendChild(makeElement("strong", "city-diff-group-title", "Trainingsgebiete"));
        const areaBadges = makeElement("div", "city-diff-badges");
        if (sAreas.added > 0) areaBadges.appendChild(makeElement("span", "badge-diff badge-added", `+ ${sAreas.added} neu`));
        if (sAreas.removed > 0) areaBadges.appendChild(makeElement("span", "badge-diff badge-removed", `- ${sAreas.removed} entfernt`));
        if (sAreas.modified > 0) areaBadges.appendChild(makeElement("span", "badge-diff badge-modified", `~ ${sAreas.modified} geändert`));
        if (sAreas.added === 0 && sAreas.removed === 0 && sAreas.modified === 0) {
          areaBadges.appendChild(makeElement("span", "badge-diff badge-unchanged", "keine Änderungen"));
        } else {
          areaBadges.appendChild(makeElement("span", "badge-diff badge-unchanged", `= ${sAreas.unchanged} unverändert`));
        }
        areaBox.appendChild(areaBadges);
        summaryBox.appendChild(areaBox);
      }

      elements.cityValidationOutcome.appendChild(summaryBox);

      // Expandable lists
      const detailsContainer = makeElement("div", "city-diff-details-container");
      renderDiffDetailsList(detailsContainer, "Neue Straßen", diff.streets.added, item => item.name);
      renderDiffDetailsList(detailsContainer, "Entfernte Straßen", diff.streets.removed, item => item.name);
      renderDiffDetailsList(detailsContainer, "Geänderte Straßen", diff.streets.modified, item => {
        const changeTypes = [];
        if (item.changes.name) changeTypes.push(`Name: „${item.previousName}“ → „${item.name}“`);
        if (item.changes.geometry) changeTypes.push("Geometrie");
        if (item.changes.aliases) changeTypes.push("Aliase");
        if (item.changes.osmWayIds) changeTypes.push("Way-Zusammensetzung");
        return `${item.name} (${changeTypes.join(", ")})`;
      });
      if (diff.streets.possibleRenames && diff.streets.possibleRenames.length > 0) {
        renderDiffDetailsList(detailsContainer, "Mögliche Umbenennungen (gleiche OSM-Ways)", diff.streets.possibleRenames, item => {
          return `„${item.oldName}“ → „${item.newName}“ (${item.sharedWayCount} gemeinsame Ways)`;
        });
      }

      renderDiffDetailsList(detailsContainer, "Neue Einrichtungen", diff.pois.added, item => `${item.name} (${item.categoryLabel || item.category || ""})`);
      renderDiffDetailsList(detailsContainer, "Entfernte Einrichtungen", diff.pois.removed, item => `${item.name} (${item.categoryLabel || item.category || ""})`);
      renderDiffDetailsList(detailsContainer, "Geänderte Einrichtungen", diff.pois.modified, item => {
        const changeTypes = [];
        if (item.changes.name) changeTypes.push(`Name: „${item.previousName}“ → „${item.name}“`);
        if (item.changes.category) changeTypes.push("Kategorie");
        if (item.changes.position) changeTypes.push("Position");
        if (item.changes.address) changeTypes.push("Adresse");
        if (item.changes.geometry) changeTypes.push("Geometrie");
        return `${item.name} (${changeTypes.join(", ")})`;
      });

      renderDiffDetailsList(detailsContainer, "Neue Trainingsgebiete", diff.areas.added, item => item.name);
      renderDiffDetailsList(detailsContainer, "Entfernte Trainingsgebiete", diff.areas.removed, item => item.name);
      renderDiffDetailsList(detailsContainer, "Geänderte Trainingsgebiete", diff.areas.modified, item => {
        const changeTypes = [];
        if (item.changes.name) changeTypes.push(`Name: „${item.previousName}“ → „${item.name}“`);
        if (item.changes.parentId) changeTypes.push("Hierarchie");
        if (item.changes.bounds || item.changes.boundary) changeTypes.push("Gebietsgrenze");
        return `${item.name} (${changeTypes.join(", ")})`;
      });

      elements.cityValidationOutcome.appendChild(detailsContainer);

      // Buttons
      if (isCurated) {
        setHidden(elements.saveCityButton, true);
        elements.cancelValidationButton.textContent = "Schließen";
        elements.cancelValidationButton.disabled = false;
      } else {
        setHidden(elements.saveCityButton, false);
        elements.saveCityButton.disabled = phase === STATES.SAVING;
        elements.saveCityButton.textContent = phase === STATES.SAVING ? "Update wird gespeichert …" : "Update übernehmen";
        elements.cancelValidationButton.textContent = "Nicht aktualisieren";
        elements.cancelValidationButton.disabled = phase === STATES.SAVING;
      }
    }

    function renderValidation() {
      const packageData = validatedPackage || {};
      const city = packageData.city || {};
      if (workflowSource === "update") {
        renderUpdateDiffPanel(city, packageData, updateDiff);
        return;
      }
      setHidden(elements.saveCityButton, false);
      const streets = Array.isArray(packageData.streets) ? packageData.streets : [];
      const pois = Array.isArray(packageData.pois) ? packageData.pois : [];
      const fireStationCount = pois.filter(poi => poi && poi.category === "fire_station").length;
      elements.previewStreetCount.textContent = String(streets.length);
      elements.previewPoiCount.textContent = String(pois.length);
      elements.previewFireStationCount.textContent = String(fireStationCount);

      const context = municipalityContext(city, true);
      const source = asText(city.source) || "Nicht angegeben";
      const dataVersion = city.dataVersion === undefined || city.dataVersion === null
        ? "Nicht angegeben"
        : String(city.dataVersion);
      elements.cityPreviewMetadata.replaceChildren();
      elements.cityPreviewMetadata.appendChild(makeElement("strong", "", municipalityName(city)));
      if (context) elements.cityPreviewMetadata.appendChild(documentRef.createTextNode(` · ${context}`));
      elements.cityPreviewMetadata.appendChild(makeElement("br"));
      elements.cityPreviewMetadata.appendChild(documentRef.createTextNode(`Quelle: ${source} · Datenversion: ${dataVersion}`));

      elements.previewCategoryCounts.replaceChildren();
      const categoryCounts = new Map();
      pois.forEach(poi => {
        const category = asText(poi && poi.category);
        if (!category) return;
        const current = categoryCounts.get(category) || {
          count: 0,
          label: asText(poi.categoryLabel)
            || (poiCategoriesApi && poiCategoriesApi.getLabel(category))
            || CATEGORY_LABELS[category]
            || category
        };
        current.count += 1;
        categoryCounts.set(category, current);
      });
      [...categoryCounts.entries()].sort((first, second) => {
        const firstLabel = first[1].label;
        const secondLabel = second[1].label;
        return firstLabel.localeCompare(secondLabel, "de");
      }).forEach(([, entry]) => {
        const item = makeElement("span", "city-category-count");
        item.appendChild(makeElement("strong", "", String(entry.count)));
        item.appendChild(documentRef.createTextNode(` ${entry.label}`));
        elements.previewCategoryCounts.appendChild(item);
      });

      const warnings = collectIssues("warnings");
      const errors = collectIssues("errors");
      elements.cityValidationOutcome.replaceChildren();
      if (packageData.valid) elements.cityValidationOutcome.classList.remove("invalid");
      else elements.cityValidationOutcome.classList.add("invalid");
      const heading = packageData.valid
        ? `${workflowSource === "import" ? "Importprüfung" : "Datenprüfung"} für ${municipalityName(city)} erfolgreich`
        : "Stadtpaket konnte nicht bestätigt werden";
      elements.cityValidationOutcome.appendChild(makeElement("h3", "", heading));
      elements.cityValidationOutcome.appendChild(makeElement(
        "p",
        packageData.valid ? "city-validation-success" : "city-validation-error",
        packageData.valid
          ? (workflowSource === "import"
            ? "Schema, Stadtmetadaten, IDs, Straßengeometrien und Einrichtungen wurden lokal geprüft."
            : "Gemeindegrenze, Straßengeometrien und Einrichtungen wurden geprüft.")
          : "Die Daten wurden geladen, konnten aber nicht als vollständiges spielbares Stadtpaket bestätigt werden."
      ));
      if (workflowSource === "import" && packageData.package && !packageData.package.legacy) {
        const pkg = packageData.package;
        const card = makeElement("div", "city-package-preview-card");
        const header = makeElement("div", "city-package-preview-header");
        const isCurated = pkg.type === "curated";
        header.appendChild(makeElement("span", isCurated ? "city-badge curated" : "city-badge osm", isCurated ? "Kuratiert" : "OSM"));
        header.appendChild(makeElement("strong", "city-package-preview-title", `${pkg.title || municipalityName(city)} (v${pkg.version || "1.0.0"})`));
        card.appendChild(header);

        const meta = makeElement("div", "city-package-meta");
        meta.appendChild(makeElement("div", "city-package-meta-row", `Paket-ID: ${pkg.id}`));
        if (isCurated && pkg.verification) {
          const selfDeclared = makeElement("div", "city-package-meta-row city-package-self-declared", "Paketangaben (selbstdeklariert):");
          meta.appendChild(selfDeclared);
          if (pkg.verification.maintainer) {
            meta.appendChild(makeElement("div", "city-package-meta-row", `· Maintainer: ${pkg.verification.maintainer}`));
          }
          if (pkg.verification.verifiedAt) {
            meta.appendChild(makeElement("div", "city-package-meta-row", `· Stand: ${formatDate(pkg.verification.verifiedAt)}`));
          }
          if (pkg.verification.note) {
            meta.appendChild(makeElement("div", "city-package-meta-row", `· Hinweis: ${pkg.verification.note}`));
          }
        }
        if (pkg.contentHash) {
          const hashRow = makeElement("div", "city-package-meta-row city-package-hash-row");
          hashRow.appendChild(documentRef.createTextNode("Dateiintegrität (SHA-256): "));
          const hashPrefix = pkg.contentHash.length > 20 ? `${pkg.contentHash.substring(0, 19)}…` : pkg.contentHash;
          const codeEl = makeElement("code", "city-package-hash", hashPrefix);
          codeEl.title = `${pkg.contentHash} (Prüfsumme bestätigt die Unverfälschtheit des Dateiinhalts, keine kryptografische Autoren-Signatur)`;
          hashRow.appendChild(codeEl);
          meta.appendChild(hashRow);
        }
        card.appendChild(meta);
        elements.cityValidationOutcome.appendChild(card);
      }

      if (workflowSource === "import" && importedAlreadyInstalled) {
        if (importMode === "blocked") {
          elements.cityValidationOutcome.appendChild(makeElement(
            "div",
            "city-validation-error city-import-conflict-banner",
            importConflictMessage || "Der Import ist für diese Stadt blockiert."
          ));
        } else if (importMode === "same") {
          elements.cityValidationOutcome.appendChild(makeElement(
            "div",
            "city-validation-info city-import-same-banner",
            importConflictMessage || "Dieses Trainingspaket ist bereits in der gleichen Version installiert."
          ));
        } else if (importMode === "update") {
          elements.cityValidationOutcome.appendChild(makeElement(
            "div",
            "city-validation-success city-import-update-banner",
            importConflictMessage || "Ein Update für das installierte Trainingspaket liegt vor."
          ));
        } else {
          elements.cityValidationOutcome.appendChild(makeElement(
            "p",
            "city-validation-error",
            importConflictMessage || "Diese Stadt ist bereits installiert. Sie wird nur nach einem ausdrücklichen Klick ersetzt."
          ));
        }
      }

      if (workflowSource === "import" && importDiff && importDiff.summary) {
        const diffBox = makeElement("div", "city-update-preview-box");
        diffBox.appendChild(makeElement("h4", "city-diff-title", "Änderungen zur installierten Version"));
        const pills = makeElement("div", "city-diff-pills");
        const s = importDiff.summary.streets;
        pills.appendChild(makeElement("span", "diff-pill", `Straßen: +${s.added} / -${s.removed} / ~${s.modified}`));
        const p = importDiff.summary.pois;
        pills.appendChild(makeElement("span", "diff-pill", `Einrichtungen: +${p.added} / -${p.removed} / ~${p.modified}`));
        if (importDiff.summary.areas) {
          const a = importDiff.summary.areas;
          pills.appendChild(makeElement("span", "diff-pill", `Gebiete: +${a.added} / -${a.removed} / ~${a.modified}`));
        }
        diffBox.appendChild(pills);
        elements.cityValidationOutcome.appendChild(diffBox);
      }

      if (errors.length) {
        const errorList = makeElement("div", "city-validation-errors");
        appendIssueList(errorList, errors, 8);
        elements.cityValidationOutcome.appendChild(errorList);
      }

      setHidden(elements.cityWarningSummary, warnings.length === 0);
      elements.cityWarningSummary.textContent = warnings.length
        ? `${warnings.length} ${warnings.length === 1 ? "Hinweis" : "Hinweise"} aus der Datenprüfung. Warnungen verhindern die Speicherung nicht.`
        : "";
      setHidden(elements.toggleWarningDetailsButton, warnings.length === 0);
      elements.toggleWarningDetailsButton.setAttribute("aria-expanded", warningDetailsExpanded ? "true" : "false");
      elements.toggleWarningDetailsButton.textContent = warningDetailsExpanded ? "Details ausblenden" : "Details anzeigen";
      setHidden(elements.cityWarningDetails, warnings.length === 0 || !warningDetailsExpanded);
      appendIssueList(elements.cityWarningDetails, warnings, 20);

      const isBlocked = importMode === "blocked" || importMode === "same";
      elements.saveCityButton.disabled = !packageData.valid || phase === STATES.SAVING || isBlocked;
      setHidden(elements.saveCityButton, isBlocked && importMode === "blocked");

      if (phase === STATES.SAVING) {
        elements.saveCityButton.textContent = "Stadt wird gespeichert …";
      } else if (workflowSource === "import") {
        if (importMode === "update") {
          const fromVer = importInstalledCity?.package?.version || "1.0.0";
          const toVer = packageData.package?.version || "1.0.0";
          elements.saveCityButton.textContent = `Paket aktualisieren (v${fromVer} → v${toVer})`;
        } else if (importMode === "replace") {
          const isIncomingCurated = Boolean(packageData.package && packageData.package.type === "curated" && !packageData.package.legacy);
          elements.saveCityButton.textContent = isIncomingCurated
            ? "Auf kuratiertes Paket aktualisieren"
            : "Vorhandene Stadt ersetzen";
        } else if (importMode === "same") {
          elements.saveCityButton.textContent = "Bereits installiert";
        } else if (importedAlreadyInstalled) {
          elements.saveCityButton.textContent = "Vorhandene Stadt ersetzen";
        } else {
          elements.saveCityButton.textContent = "Importieren";
        }
      } else {
        elements.saveCityButton.textContent = "Stadt speichern";
      }
      elements.cancelValidationButton.disabled = phase === STATES.SAVING;
      if (isBlocked) {
        elements.cancelValidationButton.textContent = "Schließen";
      } else {
        elements.cancelValidationButton.textContent = "Abbrechen";
      }
    }

    function render() {
      if (!elements) return;
      const searchVisible = ![
        STATES.DOWNLOADING,
        STATES.VALIDATING,
        STATES.VALIDATION_RESULT,
        STATES.SAVING,
        STATES.COMPLETED
      ].includes(phase);
      const downloadVisible = phase === STATES.DOWNLOADING || phase === STATES.VALIDATING;
      const validationVisible = phase === STATES.VALIDATION_RESULT || phase === STATES.SAVING;
      const completedVisible = phase === STATES.COMPLETED;

      setHidden(elements.citySearchPanel, !searchVisible);
      setHidden(elements.cityDownloadPanel, !downloadVisible);
      setHidden(elements.cityValidationPanel, !validationVisible);
      setHidden(elements.cityCompletedPanel, !completedVisible);
      setHidden(elements.cityManagerAlert, !alertMessage);
      elements.cityManagerAlert.textContent = alertMessage;

      const managerBusy = [
        STATES.SEARCHING, STATES.CHECKING_INSTALLED, STATES.ACTIVATING,
        STATES.DOWNLOADING, STATES.VALIDATING, STATES.SAVING
      ].includes(phase);
      elements.cityManagerDialog.setAttribute("aria-busy", managerBusy ? "true" : "false");
      elements.citySearchForm.setAttribute("aria-busy", phase === STATES.SEARCHING ? "true" : "false");
      elements.cityDownloadPanel.setAttribute(
        "aria-busy",
        downloadVisible ? "true" : "false"
      );

      elements.citySearchButton.disabled = [STATES.SEARCHING, STATES.ACTIVATING].includes(phase);
      elements.citySearchButton.textContent = phase === STATES.SEARCHING ? "Suche läuft …" : "Suchen";
      elements.citySearchInput.disabled = [
        STATES.ACTIVATING,
        STATES.DOWNLOADING,
        STATES.VALIDATING,
        STATES.SAVING
      ].includes(phase);

      let searchStatus = noticeMessage;
      if (phase === STATES.SEARCHING) searchStatus = "Gemeinden werden gesucht …";
      else if (phase === STATES.SEARCH_RESULTS) {
        searchStatus = searchResults.length
          ? `${searchResults.length} ${searchResults.length === 1 ? "Gemeinde gefunden" : "Gemeinden gefunden"}.`
          : "Keine passende deutsche Gemeinde gefunden. Bitte prüfe die Schreibweise.";
      } else if (phase === STATES.CHECKING_INSTALLED) searchStatus = "Installationsstatus wird geprüft …";
      else if (phase === STATES.ACTIVATING) searchStatus = "Stadt wird als aktiv vorgemerkt …";
      elements.citySearchStatus.textContent = searchStatus;

      renderSearchResults();
      const selectedVisible = Boolean(selectedMunicipality) && searchVisible;
      setHidden(elements.selectedMunicipalityPanel, !selectedVisible);
      if (selectedMunicipality) {
        elements.selectedMunicipalityName.textContent = municipalityName(selectedMunicipality);
        const baseContext = municipalityContext(selectedMunicipality, true);
        const installedCity = selectedMunicipalityInstalled
          ? installedCities.find(c => c.id === municipalityCityId(selectedMunicipality))
          : null;
        const dataStand = installedCity
          ? (isCuratedCity(installedCity)
            ? "Kuratiertes Stadtpaket"
            : (installedCity.updatedAt || installedCity.createdAt
              ? `Datenstand: ${formatDate(installedCity.updatedAt || installedCity.createdAt)}`
              : ""))
          : "";
        elements.selectedMunicipalityContext.textContent = [baseContext, dataStand].filter(Boolean).join(" · ");
        elements.municipalityActionButton.disabled = [STATES.CHECKING_INSTALLED, STATES.ACTIVATING].includes(phase);
        if (phase === STATES.CHECKING_INSTALLED) {
          elements.municipalityActionButton.textContent = "Wird geprüft …";
        } else if (phase === STATES.ACTIVATING) {
          elements.municipalityActionButton.textContent = "Stadt wird ausgewählt …";
        } else if (selectedMunicipalityInstalled) {
          elements.municipalityActionButton.textContent = "Stadt auswählen";
        } else if (phase === STATES.ERROR && errorContext === "download") {
          elements.municipalityActionButton.textContent = "Erneut herunterladen";
        } else {
          elements.municipalityActionButton.textContent = "Stadt herunterladen";
        }

        let panelUpdateButton = elements.selectedMunicipalityPanel.querySelector
          ? elements.selectedMunicipalityPanel.querySelector(".city-selected-update-button")
          : null;
        if (selectedMunicipalityInstalled && installedCity && isUpdateableCity(installedCity)) {
          if (!panelUpdateButton) {
            panelUpdateButton = makeElement("button", "secondary-button city-dialog-secondary city-selected-update-button");
            panelUpdateButton.type = "button";
            elements.selectedMunicipalityPanel.appendChild(panelUpdateButton);
          }
          setHidden(panelUpdateButton, false);
          panelUpdateButton.textContent = isCuratedCity(installedCity)
            ? "Mit OpenStreetMap vergleichen"
            : "Auf Aktualisierung prüfen";
          panelUpdateButton.onclick = () => startCityUpdate(installedCity, panelUpdateButton);
        } else if (panelUpdateButton) {
          setHidden(panelUpdateButton, true);
        }
      }

      if (downloadVisible) {
        const cityName = municipalityName(selectedMunicipality || updatingCity);
        elements.cityDownloadTitle.textContent = phase === STATES.VALIDATING
          ? (workflowSource === "import" ? "Stadtdatei wird geprüft" : `${cityName} wird geprüft`)
          : (workflowSource === "update"
            ? `${cityName} – OpenStreetMap-Stand wird geladen`
            : `${cityName} wird heruntergeladen`);
        const progressValue = phase === STATES.VALIDATING ? 100 : clampProgress(progress.progress);
        elements.cityDownloadProgress.setAttribute("aria-valuenow", String(progressValue));
        elements.cityDownloadProgress.setAttribute("aria-valuetext", asText(progress.message) || "Download läuft");
        elements.cityProgressBar.style.width = `${progressValue}%`;
        elements.cityProgressMessage.textContent = phase === STATES.VALIDATING
          ? (workflowSource === "import"
            ? "Die ausgewählte JSON-Datei wird sicher eingelesen und validiert …"
            : "Die heruntergeladenen Daten werden validiert …")
          : (asText(progress.message) || "Download läuft …");
        setHidden(elements.cancelCityDownloadButton, phase !== STATES.DOWNLOADING);
        elements.cancelCityDownloadButton.disabled = phase !== STATES.DOWNLOADING;
      }

      if (validationVisible) renderValidation();
      if (completedVisible) {
        setHidden(elements.activateImportedCityButton, !completedActivationAvailable);
        elements.activateImportedCityButton.disabled = activatingCompletedCity;
        elements.activateImportedCityButton.textContent = activatingCompletedCity
          ? "Stadt wird aktiviert …"
          : "Stadt aktivieren";
        elements.closeCompletedButton.disabled = activatingCompletedCity;
      }
    }

    function setMenuOpen(open) {
      menuOpen = Boolean(open);
      setHidden(elements.cityMenu, !menuOpen);
      elements.citySelectorButton.setAttribute("aria-expanded", menuOpen ? "true" : "false");
    }

    function cancelSearch() {
      searchOperationId += 1;
      if (searchController) searchController.abort();
      searchController = null;
    }

    function cancelDownload(options = {}) {
      const wasDownloading = phase === STATES.DOWNLOADING || phase === STATES.VALIDATING;
      downloadOperationId += 1;
      if (downloadController) downloadController.abort();
      downloadController = null;
      if (wasDownloading && modalOpen && !options.closing) {
        phase = (selectedMunicipality && workflowSource !== "update") ? STATES.MUNICIPALITY_SELECTED : STATES.IDLE;
        alertMessage = "";
        noticeMessage = workflowSource === "update"
          ? "Aktualisierungsprüfung abgebrochen. Es wurden keine Stadtdaten geändert."
          : "Download abgebrochen. Es wurden keine Stadtdaten gespeichert.";
        progress = { stage: "", message: "Download wird vorbereitet …", progress: 0 };
        render();
        announce(noticeMessage);
      }
    }

    function resetWorkflow() {
      importOperationId += 1;
      cancelSearch();
      cancelDownload({ closing: true });
      phase = STATES.IDLE;
      searchResults = [];
      selectedMunicipality = null;
      selectedMunicipalityInstalled = false;
      validatedPackage = null;
      alertMessage = "";
      noticeMessage = "";
      errorContext = "";
      warningDetailsExpanded = false;
      lastSearchQuery = "";
      progress = { stage: "", message: "Download wird vorbereitet …", progress: 0 };
      workflowSource = "download";
      importedAlreadyInstalled = false;
      importedActiveCity = false;
      importMode = "new";
      importConflictMessage = "";
      importInstalledCity = null;
      importDiff = null;
      completedCity = null;
      completedActivationAvailable = false;
      activatingCompletedCity = false;
      updatingCity = null;
      updateDiff = null;
      updateCheckResult = null;
      if (elements) {
        elements.citySearchInput.value = "";
        elements.cityImportFileInput.value = "";
        setHidden(elements.saveCityButton, false);
      }
    }

    function open(opener) {
      if (!initialized) return Promise.resolve(init()).then(() => open(opener));
      if (modalOpen) return true;
      resetWorkflow();
      previousFocus = opener || documentRef.activeElement || elements.citySelectorButton;
      reopenMenuAfterModal = previousFocus === elements.addCityButton;
      modalOpen = true;
      syncDocumentModalState();
      setMenuOpen(false);
      setHidden(elements.cityManagerModalOverlay, false);
      elements.cityManagerModalOverlay.setAttribute("aria-hidden", "false");
      if (!isCityChangeAllowed()) {
        noticeMessage = "Bitte warte, bis der laufende Stadtvorgang abgeschlossen ist.";
      }
      render();
      schedule(() => elements.citySearchInput.focus(), 0);
      return true;
    }

    function close(options = {}) {
      if (!initialized || !modalOpen) return false;
      if (phase === STATES.SAVING && !options.force) return false;
      cancelSearch();
      cancelDownload({ closing: true });
      modalOpen = false;
      syncDocumentModalState();
      setHidden(elements.cityManagerModalOverlay, true);
      elements.cityManagerModalOverlay.setAttribute("aria-hidden", "true");
      const focusTarget = previousFocus;
      const shouldReopenMenu = reopenMenuAfterModal;
      previousFocus = null;
      reopenMenuAfterModal = false;
      resetWorkflow();
      if (shouldReopenMenu) setMenuOpen(true);
      if (focusTarget && typeof focusTarget.focus === "function") schedule(() => focusTarget.focus(), 0);
      return true;
    }

    async function refreshInstalledCities() {
      if (!initialized) return [];
      const operationId = ++refreshOperationId;
      try {
        const [cities, nextActiveCityId] = await Promise.all([
          storage.getAllCities(),
          Promise.resolve(storage.getActiveCityId())
        ]);
        if (operationId !== refreshOperationId) return installedCities;
        installedCities = sortedCities(Array.isArray(cities) ? cities : []);
        activeCityId = asText(nextActiveCityId) || null;
        renderInstalledCities();
        return [...installedCities];
      } catch (_) {
        if (operationId === refreshOperationId) {
          installedCities = [];
          activeCityId = null;
          renderInstalledCities();
          setHeaderStatus("Die lokal installierten Städte konnten nicht geladen werden.");
        }
        return [];
      }
    }

    function requestCityImport() {
      if (!initialized) return;
      setMenuOpen(false);
      elements.cityImportFileInput.click();
    }

    async function handleImportFileSelection(event) {
      const file = event?.target?.files?.[0] || null;
      if (!file) return;
      open(elements.importCityButton);
      const operationId = ++importOperationId;
      workflowSource = "import";
      phase = STATES.VALIDATING;
      selectedMunicipality = null;
      validatedPackage = null;
      importedAlreadyInstalled = false;
      importedActiveCity = false;
      importMode = "new";
      importConflictMessage = "";
      importInstalledCity = null;
      importDiff = null;
      alertMessage = "";
      noticeMessage = "";
      warningDetailsExpanded = false;
      render();
      announce("Die ausgewählte Stadtdatei wird lokal geprüft.");

      try {
        const result = await packageApi.readCityPackageFile(file);
        if (operationId !== importOperationId || !modalOpen) return;
        validatedPackage = result;
        if (result.valid && result.city?.id) {
          const installedCity = await storage.getCity(result.city.id);
          importedAlreadyInstalled = Boolean(installedCity);
          importInstalledCity = installedCity || null;
          if (operationId !== importOperationId || !modalOpen) return;
          const currentRuntimeCityId = asText(runtimeCity()?.id);
          importedActiveCity = result.city.id === activeCityId || result.city.id === currentRuntimeCityId;

          const isInstalledCurated = Boolean(installedCity?.package && installedCity.package.type === "curated" && !installedCity.package.legacy);
          const isIncomingCurated = Boolean(result.package && result.package.type === "curated" && !result.package.legacy);

          if (importedAlreadyInstalled) {
            if (isInstalledCurated && !isIncomingCurated) {
              importMode = "blocked";
              importConflictMessage = "Für diese Stadt ist ein kuratiertes Trainingspaket installiert. Das unstrukturierte OSM-Paket kann das kuratierte Paket nicht überschreiben.";
            } else if (!isInstalledCurated && isIncomingCurated) {
              importMode = "replace";
              importConflictMessage = "Das unstrukturierte OSM-Paket wird durch ein kuratiertes Trainingspaket ersetzt.";
              try {
                const currentData = await loadStoredCityData(result.city.id);
                if (updateApi && typeof updateApi.compareCityVersions === "function" && currentData) {
                  importDiff = updateApi.compareCityVersions(currentData, result);
                }
              } catch (_) {}
            } else if (isInstalledCurated && isIncomingCurated) {
              const installedPkg = installedCity.package || {};
              const incomingPkg = result.package || {};
              if (installedPkg.id && incomingPkg.id && installedPkg.id !== incomingPkg.id) {
                importMode = "blocked";
                importConflictMessage = `Die Paket-ID der Importdatei (${incomingPkg.id}) stimmt nicht mit dem installierten Trainingspaket (${installedPkg.id}) überein.`;
              } else {
                const versionComparison = validator.comparePackageVersions(installedPkg.version, incomingPkg.version);
                if (versionComparison < 0) {
                  importMode = "update";
                  importConflictMessage = `Aktualisierung von Version ${installedPkg.version || "1.0.0"} auf ${incomingPkg.version}.`;
                  try {
                    const currentData = await loadStoredCityData(result.city.id);
                    if (updateApi && typeof updateApi.compareCityVersions === "function" && currentData) {
                      importDiff = updateApi.compareCityVersions(currentData, result);
                    }
                  } catch (_) {}
                } else if (versionComparison === 0) {
                  const hashesMatch = Boolean(
                    installedPkg.contentHash
                    && incomingPkg.contentHash
                    && installedPkg.contentHash.trim() === incomingPkg.contentHash.trim()
                  );
                  if (hashesMatch) {
                    importMode = "same";
                    importConflictMessage = `Dieses Trainingspaket (Version ${incomingPkg.version}) ist bereits unverändert installiert.`;
                  } else {
                    importMode = "blocked";
                    importConflictMessage = "Die Datei trägt dieselbe Paketversion wie das installierte Paket, enthält aber veränderte Daten. Import blockiert.";
                  }
                } else {
                  importMode = "blocked";
                  importConflictMessage = `Ältere Paketversion kann eine neuere nicht überschreiben (Installiert: v${installedPkg.version || "1.0.0"}, Datei: v${incomingPkg.version}).`;
                }
              }
            } else {
              importMode = "replace";
              importConflictMessage = "Diese Stadt ist bereits installiert. Sie wird nur nach einem ausdrücklichen Klick ersetzt.";
              try {
                const currentData = await loadStoredCityData(result.city.id);
                if (updateApi && typeof updateApi.compareCityVersions === "function" && currentData) {
                  importDiff = updateApi.compareCityVersions(currentData, result);
                }
              } catch (_) {}
            }
          } else {
            importMode = "new";
            importConflictMessage = "";
          }
        }
        phase = STATES.VALIDATION_RESULT;
        alertMessage = result.valid ? "" : packageApi.validationErrorMessage(result);
        render();
        announce(result.valid
          ? (importConflictMessage || `Importvorschau für ${municipalityName(result.city)} ist bereit.`)
          : alertMessage);
        schedule(() => {
          const focusTarget = (result.valid && importMode !== "blocked" && importMode !== "same")
            ? elements.saveCityButton
            : elements.cancelValidationButton;
          if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
        }, 0);
      } catch (error) {
        if (operationId !== importOperationId || !modalOpen) return;
        phase = STATES.ERROR;
        errorContext = "import";
        alertMessage = asText(error?.message) || "Die ausgewählte Stadtdatei konnte nicht geprüft werden.";
        render();
        announce(alertMessage);
      } finally {
        elements.cityImportFileInput.value = "";
      }
    }

    async function performSearch(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if ([STATES.ACTIVATING, STATES.DOWNLOADING, STATES.VALIDATING, STATES.SAVING].includes(phase)) return;
      const query = asText(elements.citySearchInput.value);
      if (!query) {
        noticeMessage = "Bitte gib eine Stadt oder Gemeinde ein.";
        alertMessage = "";
        render();
        return;
      }
      if (providerRequiresNetwork("search")
        && typeof navigator !== "undefined" && navigator.onLine === false) {
        cancelSearch();
        phase = STATES.ERROR;
        errorContext = "search";
        alertMessage = "Für die Suche nach neuen Städten wird eine Internetverbindung benötigt.\n\nBereits installierte Städte können weiterhin gespielt werden.";
        render();
        announce(alertMessage);
        return;
      }
      if (phase === STATES.SEARCHING && query === lastSearchQuery) return;

      workflowSource = "download";

      cancelSearch();
      const operationId = ++searchOperationId;
      searchController = new AbortControllerClass();
      lastSearchQuery = query;
      phase = STATES.SEARCHING;
      searchResults = [];
      selectedMunicipality = null;
      selectedMunicipalityInstalled = false;
      validatedPackage = null;
      alertMessage = "";
      noticeMessage = "";
      errorContext = "";
      render();
      announce("Gemeinden werden gesucht.");

      try {
        const results = await datasetProvider.searchDatasets(query, { signal: searchController.signal });
        if (operationId !== searchOperationId || !modalOpen || searchController.signal.aborted) return;
        searchResults = Array.isArray(results) ? results : [];
        phase = STATES.SEARCH_RESULTS;
        render();
        announce(searchResults.length
          ? `${searchResults.length} Gemeinden gefunden.`
          : "Keine passende deutsche Gemeinde gefunden. Bitte prüfe die Schreibweise.");
      } catch (error) {
        if (operationId !== searchOperationId || !modalOpen) return;
        if (searchController.signal.aborted || (error && error.code === "ABORTED")) return;
        phase = STATES.ERROR;
        errorContext = "search";
        alertMessage = getUserFriendlyCityError(error, "search");
        render();
        announce(alertMessage);
      } finally {
        if (operationId === searchOperationId) searchController = null;
      }
    }

    async function selectMunicipality(municipality) {
      if (![STATES.SEARCH_RESULTS, STATES.MUNICIPALITY_SELECTED, STATES.ERROR].includes(phase)) return;
      const cityId = municipalityCityId(municipality);
      if (!cityId) {
        phase = STATES.ERROR;
        errorContext = "selection";
        alertMessage = "Dieses Trainingsgebiet besitzt keine gültige Kennung.";
        render();
        return;
      }
      const operationId = ++selectionOperationId;
      selectedMunicipality = municipality;
      selectedMunicipalityInstalled = false;
      phase = STATES.CHECKING_INSTALLED;
      alertMessage = "";
      noticeMessage = "";
      render();
      try {
        let installed = false;
        const targetId = asText(municipality.cityId) || cityId;
        if (targetId) {
          installed = Boolean(await storage.hasCity(targetId));
        }
        if (!installed && municipality.id && municipality.id !== targetId) {
          installed = Boolean(await storage.hasCity(municipality.id));
        }
        if (!installed && Array.isArray(installedCities)) {
          installed = installedCities.some(c =>
            (targetId && c.id === targetId) ||
            (cityId && (c.id === cityId || c.package?.id === cityId)) ||
            (municipality.id && (c.id === municipality.id || c.package?.id === municipality.id))
          );
        }
        if (operationId !== selectionOperationId || !modalOpen) return;
        selectedMunicipalityInstalled = Boolean(installed);
        phase = STATES.MUNICIPALITY_SELECTED;
        noticeMessage = installed
          ? "Diese Stadt ist bereits installiert. Du kannst sie direkt auswählen."
          : "Gemeinde ausgewählt. Der Download startet erst nach deiner Bestätigung.";
        render();
        announce(noticeMessage);
      } catch (_) {
        if (operationId !== selectionOperationId || !modalOpen) return;
        phase = STATES.ERROR;
        errorContext = "storage";
        alertMessage = "Der lokale Installationsstatus konnte nicht geprüft werden.";
        render();
      }
    }

    function activateInstalledCity(city, activateOptions = {}) {
      const cityId = asText(city && city.id);
      if (!cityId) return Promise.resolve();
      if (pendingCityActivation?.cityId === cityId) return pendingCityActivation.promise;
      const promise = performInstalledCityActivation(city, activateOptions);
      pendingCityActivation = { cityId, promise };
      void promise.finally(() => {
        if (pendingCityActivation?.promise === promise) pendingCityActivation = null;
      }).catch(() => {});
      return promise;
    }

    async function performInstalledCityActivation(city, activateOptions = {}) {
      if (!city || !asText(city.id)) return;
      if (!isCityChangeAllowed()) {
        explainBlockedCityChange();
        return;
      }
      const operationId = ++activeOperationId;
      if (city.id === activeCityId) {
        setHeaderStatus(`${municipalityName(city)} ist bereits aktiv und spielbereit.`);
        if (activateOptions.fromModal && modalOpen) {
          phase = STATES.COMPLETED;
          elements.cityCompletedMessage.textContent = `${municipalityName(city)} ist bereits aktiv und spielbereit.`;
          render();
        } else {
          setMenuOpen(false);
        }
        return;
      }
      const previousPhase = phase;
      if (activateOptions.fromModal) {
        phase = STATES.ACTIVATING;
        alertMessage = "";
        render();
      }
      try {
        await activateCity(city.id);
        if (operationId !== activeOperationId) return;
        await refreshInstalledCities();
        setHeaderStatus(`${municipalityName(city)} ist aktiv und spielbereit.`);
        announce(`${municipalityName(city)} wurde als aktive Stadt ausgewählt.`);
        if (activateOptions.fromModal && modalOpen) {
          phase = STATES.COMPLETED;
          elements.cityCompletedMessage.textContent = `${municipalityName(city)} ist bereits installiert und jetzt aktiv. Karte und Trainingsziele wurden umgeschaltet.`;
          render();
        } else {
          setMenuOpen(false);
        }
      } catch (_) {
        if (operationId !== activeOperationId) return;
        if (activateOptions.fromModal && modalOpen) {
          phase = previousPhase === STATES.MUNICIPALITY_SELECTED ? previousPhase : STATES.MUNICIPALITY_SELECTED;
          alertMessage = "Die ausgewählte Stadt konnte nicht geladen werden. Die bisherige Stadt bleibt aktiv.";
          render();
        } else {
          setHeaderStatus("Die ausgewählte Stadt konnte nicht geladen werden. Die bisherige Stadt bleibt aktiv.");
        }
      }
    }

    async function handleMunicipalityAction() {
      const retryingFailedDownload = phase === STATES.ERROR && errorContext === "download";
      if ((!retryingFailedDownload && phase !== STATES.MUNICIPALITY_SELECTED) || !selectedMunicipality) return;
      if (selectedMunicipalityInstalled) {
        const storageCityId = asText(selectedMunicipality.cityId);
        const candidateId = asText(selectedMunicipality.id);
        const city = installedCities.find(c =>
          (storageCityId && c.id === storageCityId) ||
          (candidateId && (c.id === candidateId || c.package?.id === candidateId))
        ) || {
          id: storageCityId || candidateId || municipalityCityId(selectedMunicipality),
          name: municipalityName(selectedMunicipality)
        };
        await activateInstalledCity(city, { fromModal: true });
        return;
      }
      await downloadSelectedMunicipality();
    }

    async function downloadSelectedMunicipality() {
      const retryingFailedDownload = phase === STATES.ERROR && errorContext === "download";
      if ((!retryingFailedDownload && phase !== STATES.MUNICIPALITY_SELECTED)
        || !selectedMunicipality || selectedMunicipalityInstalled) return;

      if (providerRequiresNetwork("download")
        && typeof navigator !== "undefined" && navigator.onLine === false) {
        cancelDownload({ closing: true });
        phase = STATES.ERROR;
        errorContext = "download";
        alertMessage = "Für die Installation eines neuen Trainingsgebiets wird einmalig eine Internetverbindung benötigt.\n\nBereits installierte Städte können weiterhin gespielt werden.";
        render();
        announce(alertMessage);
        return;
      }

      cancelDownload({ closing: true });
      workflowSource = "download";
      const operationId = ++downloadOperationId;
      const controller = new AbortControllerClass();
      downloadController = controller;
      phase = STATES.DOWNLOADING;
      progress = { stage: "preparing", message: "Dataset wird geladen …", progress: 0 };
      alertMessage = "";
      noticeMessage = "";
      validatedPackage = null;
      warningDetailsExpanded = false;
      render();
      announce(`${municipalityName(selectedMunicipality)} wird geladen.`);

      let validationStarted = false;
      try {
        const downloadResult = await datasetProvider.downloadDataset(selectedMunicipality.id, {
          metadata: selectedMunicipality,
          signal: controller.signal,
          discoverAreas: true,
          onProgress: nextProgress => {
            if (operationId !== downloadOperationId || phase !== STATES.DOWNLOADING || !modalOpen) return;
            progress = {
              stage: asText(nextProgress && nextProgress.stage),
              message: asText(nextProgress && nextProgress.message) || "Download läuft …",
              progress: clampProgress(nextProgress && nextProgress.progress)
            };
            render();
            announce(progress.message);
          }
        });
        const downloaded = downloadResult && downloadResult.dataset;
        if (operationId !== downloadOperationId || !modalOpen || controller.signal.aborted) return;
        phase = STATES.VALIDATING;
        validationStarted = true;
        render();
        announce("Datenpaket wird geprüft …");

        if (!downloaded || typeof downloaded !== "object") {
          const err = new Error("Das heruntergeladene Datenpaket ist ungültig.");
          err.code = "PACKAGE_INVALID";
          throw err;
        }

        // 1. Catalog ↔ Package contentHash check
        const catalogHash = asText(selectedMunicipality?.contentHash).toLowerCase().replace(/^sha256:/, "");
        const declaredHash = asText(downloaded?.package?.contentHash).toLowerCase().replace(/^sha256:/, "");
        if (catalogHash && declaredHash && catalogHash !== declaredHash) {
          const err = new Error(`Integritätsprüfung fehlgeschlagen: Katalog-Hash (${catalogHash}) stimmt nicht mit Paket-Hash (${declaredHash}) überein.`);
          err.code = "CATALOG_HASH_MISMATCH";
          throw err;
        }

        // 2. Cryptographic recomputation: verifyPackageHash
        if (typeof validator.verifyPackageHash === "function" && downloaded?.package) {
          const hashCheck = validator.verifyPackageHash(downloaded);
          if (!hashCheck.valid) {
            const err = new Error("Die berechnete Prüfsumme stimmt nicht mit dem Datenpaket überein.");
            err.code = "PACKAGE_HASH_MISMATCH";
            throw err;
          }
        }

        // 3. Package contract validation: validateCityPackage
        let packageValidation = null;
        if (typeof validator.validateCityPackage === "function" && downloaded?.package) {
          packageValidation = validator.validateCityPackage(downloaded);
        }

        // 4. City data validation: validateCityData
        const result = validator.validateCityData(downloaded, { sourceMode: "download" });
        if (operationId !== downloadOperationId || !modalOpen || controller.signal.aborted) return;
        if (packageValidation && !packageValidation.valid && result) {
          result.valid = false;
          if (!result.validation) result.validation = { municipality: { errors: [] } };
          if (packageValidation.validation?.municipality?.errors && result.validation?.municipality?.errors) {
            result.validation.municipality.errors.push(...packageValidation.validation.municipality.errors);
          }
        }
        if (downloaded.package && result) {
          result.package = downloaded.package;
          if (result.city && !result.city.package) {
            result.city.package = downloaded.package;
          }
        }
        validatedPackage = result;
        phase = STATES.VALIDATION_RESULT;
        render();
        announce(result && result.valid
          ? "Datenprüfung abgeschlossen. Die Stadt kann gespeichert werden."
          : "Datenprüfung fehlgeschlagen. Die Stadt kann nicht gespeichert werden.");
      } catch (error) {
        if (operationId !== downloadOperationId || !modalOpen) return;
        if (controller.signal.aborted || (error && error.code === "ABORTED")) {
          phase = STATES.MUNICIPALITY_SELECTED;
          noticeMessage = "Download abgebrochen. Es wurden keine Stadtdaten gespeichert.";
          render();
          announce(noticeMessage);
          return;
        }
        phase = STATES.ERROR;
        errorContext = validationStarted ? "validation" : "download";
        alertMessage = errorContext === "validation"
          ? getUserFriendlyCityError(error, "validation")
          : getUserFriendlyCityError(error, "download");
        render();
        announce(alertMessage);
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          const diag = error && (error.diagnostics || (typeof datasetProvider?.formatErrorDiagnostics === "function" && datasetProvider.formatErrorDiagnostics(error)));
          if (diag) console.warn(diag);
        }
      } finally {
        if (operationId === downloadOperationId) downloadController = null;
      }
    }

    async function loadStoredCityData(cityId) {
      if (typeof storage.getCityData === "function") return storage.getCityData(cityId);
      if (typeof storage.getCity !== "function" || typeof storage.getCityStreets !== "function"
        || typeof storage.getCityPois !== "function") return null;
      const [city, streets, pois] = await Promise.all([
        storage.getCity(cityId),
        storage.getCityStreets(cityId),
        storage.getCityPois(cityId)
      ]);
      const areas = typeof storage.getCityAreas === "function"
        ? await storage.getCityAreas(cityId)
        : [];
      return city ? { city, streets, pois, areas } : null;
    }

    async function startCityUpdate(city, opener) {
      if (!city || !city.id) return;
      if (!isCityChangeAllowed()) {
        explainBlockedCityChange();
        return;
      }
      if (providerRequiresNetwork("update")
        && typeof navigator !== "undefined" && navigator.onLine === false) {
        setHeaderStatus("Für die Aktualisierungsprüfung wird eine Internetverbindung benötigt. Bereits installierte Städte können weiterhin gespielt werden.");
        announce("Für die Aktualisierungsprüfung wird eine Internetverbindung benötigt.");
        if (modalOpen) {
          phase = STATES.ERROR;
          errorContext = "update";
          alertMessage = getUserFriendlyCityError({ code: "NETWORK_ERROR", navigatorOnline: false }, "update");
          render();
        }
        return;
      }

      if (!modalOpen) {
        open(opener);
      }
      cancelDownload({ closing: true });
      workflowSource = "update";
      updatingCity = city;
      selectedMunicipality = {
        id: city.package?.id || city.id,
        name: city.name,
        displayName: city.displayName || city.name,
        district: city.district,
        state: city.state,
        country: city.country,
        postalCodes: city.postalCodes,
        osmType: city.osmType || "relation",
        osmId: city.osmId,
        bounds: city.bounds,
        center: city.center
      };
      const operationId = ++downloadOperationId;
      const controller = new AbortControllerClass();
      downloadController = controller;
      phase = STATES.DOWNLOADING;
      progress = { stage: "checking", message: "Katalog wird auf Aktualisierungen geprüft …", progress: 0 };
      alertMessage = "";
      noticeMessage = "";
      validatedPackage = null;
      updateDiff = null;
      updateCheckResult = null;
      warningDetailsExpanded = false;
      render();
      announce(`${municipalityName(city)} wird auf Aktualisierungen geprüft.`);

      let validationStarted = false;
      try {
        const updateCheck = await datasetProvider.checkForUpdate(city, {
          metadata: selectedMunicipality,
          signal: controller.signal,
          discoverAreas: true,
          onProgress: nextProgress => {
            if (operationId !== downloadOperationId || phase !== STATES.DOWNLOADING || !modalOpen) return;
            progress = {
              stage: asText(nextProgress && nextProgress.stage),
              message: asText(nextProgress && nextProgress.message) || "Download läuft …",
              progress: clampProgress(nextProgress && nextProgress.progress)
            };
            render();
            announce(progress.message);
          }
        });
        if (operationId !== downloadOperationId || !modalOpen || controller.signal.aborted) return;
        updateCheckResult = updateCheck;

        let downloaded = null;
        if (updateCheck && updateCheck.dataset) {
          // Legacy Provider: Daten wurden bereits in checkForUpdate geladen
          downloaded = updateCheck.dataset;
        } else if (!updateCheck || !updateCheck.hasUpdate) {
          // Catalog Provider: Kein Update verfügbar
          phase = STATES.VALIDATION_RESULT;
          render();
          announce(elements.cityValidationOutcome?.textContent || "Keine Aktualisierung erforderlich.");
          return;
        } else {
          // Catalog Provider: Update verfügbar -> Paket herunterladen
          phase = STATES.DOWNLOADING;
          progress = { stage: "downloading", message: "Neues Datenpaket wird heruntergeladen …", progress: 20 };
          render();
          announce(`${municipalityName(city)} wird heruntergeladen …`);

          const datasetId = (updateCheck.metadata && updateCheck.metadata.id) || selectedMunicipality.id;
          const downloadResult = await datasetProvider.downloadDataset(datasetId, {
            signal: controller.signal,
            onProgress: nextProgress => {
              if (operationId !== downloadOperationId || phase !== STATES.DOWNLOADING || !modalOpen) return;
              progress = {
                stage: asText(nextProgress && nextProgress.stage),
                message: asText(nextProgress && nextProgress.message) || "Download läuft …",
                progress: clampProgress(nextProgress && nextProgress.progress)
              };
              render();
              announce(progress.message);
            }
          });
          downloaded = downloadResult && downloadResult.dataset;
        }

        if (operationId !== downloadOperationId || !modalOpen || controller.signal.aborted) return;
        phase = STATES.VALIDATING;
        validationStarted = true;
        render();
        announce("Die heruntergeladenen Stadtdaten werden geprüft.");

        if (!downloaded || typeof downloaded !== "object") {
          const err = new Error("Das heruntergeladene Datenpaket ist ungültig.");
          err.code = "PACKAGE_INVALID";
          throw err;
        }

        // 1. Catalog ↔ Package contentHash check & SHA-256 (nur für Pakete mit Metadaten)
        if (downloaded.package || updateCheck?.metadata?.contentHash) {
          const catalogHash = asText(updateCheck?.metadata?.contentHash).toLowerCase().replace(/^sha256:/, "");
          const declaredHash = asText(downloaded?.package?.contentHash).toLowerCase().replace(/^sha256:/, "");
          if (catalogHash && declaredHash && catalogHash !== declaredHash) {
            const err = new Error(`Integritätsprüfung fehlgeschlagen: Katalog-Hash (${catalogHash}) stimmt nicht mit Paket-Hash (${declaredHash}) überein.`);
            err.code = "CATALOG_HASH_MISMATCH";
            throw err;
          }

          // 2. Cryptographic recomputation: verifyPackageHash
          if (typeof validator.verifyPackageHash === "function" && downloaded?.package) {
            const hashCheck = validator.verifyPackageHash(downloaded);
            if (!hashCheck.valid) {
              const err = new Error("Die berechnete Prüfsumme stimmt nicht mit dem Datenpaket überein.");
              err.code = "PACKAGE_HASH_MISMATCH";
              throw err;
            }
          }
        }

        // 3. Package contract validation: validateCityPackage
        let packageValidation = null;
        if (typeof validator.validateCityPackage === "function" && downloaded?.package) {
          packageValidation = validator.validateCityPackage(downloaded);
        }

        // 4. City data validation: validateCityData
        const result = validator.validateCityData(downloaded, { sourceMode: "download" });
        if (packageValidation && !packageValidation.valid && result) {
          result.valid = false;
          if (!result.validation) result.validation = { municipality: { errors: [] } };
          if (packageValidation.validation?.municipality?.errors && result.validation?.municipality?.errors) {
            result.validation.municipality.errors.push(...packageValidation.validation.municipality.errors);
          }
        }
        if (!result || !result.valid) {
          phase = STATES.ERROR;
          errorContext = "validation";
          alertMessage = "Die heruntergeladenen Stadtdaten konnten nicht sicher verwendet werden. Es wurde nichts geändert.";
          render();
          announce(alertMessage);
          return;
        }

        if (downloaded.package && result) {
          result.package = downloaded.package;
          if (result.city && !result.city.package) {
            result.city.package = downloaded.package;
          }
        }
        validatedPackage = result;

        const currentData = await loadStoredCityData(city.id);
        if (operationId !== downloadOperationId || !modalOpen || controller.signal.aborted) return;
        if (!currentData || !currentData.city) {
          throw new Error("Die installierte Stadt konnte nicht für den Versionsvergleich geladen werden.");
        }

        if (!updateApi || typeof updateApi.compareCityVersions !== "function") {
          throw new Error("Das Versionsvergleichs-Modul ist nicht verfügbar.");
        }

        const diff = updateApi.compareCityVersions(currentData, result);
        updateDiff = diff;

        phase = STATES.VALIDATION_RESULT;
        render();
        announce(diff.summary.hasChanges
          ? `Versionsvergleich für ${municipalityName(city)} abgeschlossen. Änderungen gefunden.`
          : `Versionsvergleich für ${municipalityName(city)} abgeschlossen. Keine Änderungen.`);
      } catch (error) {
        if (operationId !== downloadOperationId || !modalOpen) return;
        if (controller.signal.aborted || (error && error.code === "ABORTED")) {
          phase = STATES.IDLE;
          noticeMessage = "Aktualisierungsprüfung abgebrochen. Es wurden keine Stadtdaten geändert.";
          render();
          announce(noticeMessage);
          return;
        }
        phase = STATES.ERROR;
        errorContext = validationStarted ? "validation" : "update";
        alertMessage = getUserFriendlyCityError(error, errorContext);
        render();
        announce(alertMessage);
      } finally {
        if (operationId === downloadOperationId) downloadController = null;
      }
    }

    function normalizedPackageAreas(packageAreas) {
      const defaultSource = validatedPackage?.package?.type === "curated" ? "curated" : "osm";
      return (Array.isArray(packageAreas) ? packageAreas : [])
        .filter(area => area && area.source !== "user")
        .map(area => ({
          ...area,
          kind: area.kind || "administrative",
          source: area.source || defaultSource
        }));
    }

    async function areasForCityReplacement(cityId, packageAreas, nextBoundary) {
      const packageOwnedAreas = normalizedPackageAreas(packageAreas);
      if (typeof storage.getCityAreas !== "function") return packageOwnedAreas;
      const existingAreas = await storage.getCityAreas(cityId);
      let userAreas = (Array.isArray(existingAreas) ? existingAreas : [])
        .filter(area => area && area.source === "user");
      if (customAreasApi && typeof customAreasApi.revalidateUserAreas === "function") {
        userAreas = customAreasApi.revalidateUserAreas(userAreas, nextBoundary);
      }
      return [...packageOwnedAreas, ...userAreas];
    }

    async function saveValidatedCity() {
      if (phase !== STATES.VALIDATION_RESULT || !validatedPackage || !validatedPackage.valid) return;
      if (!isCityChangeAllowed()) {
        explainBlockedCityChange();
        return;
      }
      phase = STATES.SAVING;
      alertMessage = "";
      render();
      announce("Stadt wird lokal gespeichert.");
      let citySaved = false;
      let previousActivePackage = null;
      let rollbackSucceeded = false;
      try {
        if (workflowSource === "update") {
          const currentCity = updatingCity || (await storage.getCity(validatedPackage.city.id));
          const currentVersion = Number(currentCity?.dataVersion) || 1;
          const nextVersion = currentVersion + 1;
          const nowIso = new Date().toISOString();

          previousActivePackage = await loadStoredCityData(currentCity.id);

          const nextPackage = validatedPackage.package || currentCity.package || null;
          const nextVersionStr = nextPackage?.version || String(nextVersion);

          const cityToSave = {
            ...(validatedPackage.boundary && !validatedPackage.city.boundary
              ? { ...validatedPackage.city, boundary: validatedPackage.boundary }
              : validatedPackage.city),
            id: currentCity.id,
            osmId: currentCity.osmId,
            osmType: currentCity.osmType || "relation",
            source: nextPackage?.source || currentCity.source || "catalog",
            package: nextPackage,
            version: nextVersionStr,
            contentHash: nextPackage?.contentHash || currentCity.contentHash,
            createdAt: currentCity.createdAt || validatedPackage.city.createdAt || nowIso,
            updatedAt: nowIso,
            lastOsmCheckAt: nowIso,
            dataVersion: nextVersion
          };
          const areasToSave = await areasForCityReplacement(
            cityToSave.id,
            validatedPackage.areas,
            cityToSave.boundary || validatedPackage.boundary
          );
          await storage.saveCity(
            cityToSave,
            validatedPackage.streets,
            validatedPackage.pois,
            areasToSave,
            { preserveUserAreas: false }
          );
          citySaved = true;

          const isActive = currentCity.id === activeCityId || currentCity.id === runtimeCity()?.id;
          if (isActive) {
            await activateCity(cityToSave.id, { force: true });
          }
          await refreshInstalledCities();
          phase = STATES.COMPLETED;
          completedCity = cityToSave;
          completedActivationAvailable = false;
          elements.cityCompletedMessage.textContent = `${municipalityName(cityToSave)} wurde erfolgreich auf Version ${nextVersionStr} aktualisiert.${isActive ? " Die aktive Stadt wurde neu geladen." : ""}`;
          setHeaderStatus(`${municipalityName(cityToSave)} wurde auf Version ${nextVersionStr} aktualisiert.`);
          render();
          announce(elements.cityCompletedMessage.textContent);
          return;
        }

        if (workflowSource === "import" && importedAlreadyInstalled && importedActiveCity) {
          previousActivePackage = await loadStoredCityData(validatedPackage.city.id);
          if (!previousActivePackage) {
            throw new Error("Die bisherige aktive Stadt konnte nicht für ein sicheres Ersetzen gelesen werden.");
          }
        }
        const cityToSave = validatedPackage.boundary && !validatedPackage.city.boundary
          ? { ...validatedPackage.city, boundary: validatedPackage.boundary }
          : validatedPackage.city;
        const areasToSave = importedAlreadyInstalled
          ? await areasForCityReplacement(
            cityToSave.id,
            validatedPackage.areas,
            cityToSave.boundary || validatedPackage.boundary
          )
          : normalizedPackageAreas(validatedPackage.areas);
        await storage.saveCity(
          cityToSave,
          validatedPackage.streets,
          validatedPackage.pois,
          areasToSave,
          { preserveUserAreas: false }
        );
        citySaved = true;
        if (workflowSource === "download" || importedActiveCity) {
          await activateCity(validatedPackage.city.id, { force: true });
        }
        await refreshInstalledCities();
        phase = STATES.COMPLETED;
        completedCity = validatedPackage.city;
        completedActivationAvailable = workflowSource === "import" && !importedActiveCity;
        if (workflowSource === "import") {
          if (importMode === "update") {
            const ver = validatedPackage.package?.version || "1.0.0";
            elements.cityCompletedMessage.textContent = `${municipalityName(validatedPackage.city)} wurde erfolgreich auf Trainingspaket-Version ${ver} aktualisiert.${importedActiveCity ? " Der aktive Stadtkontext wurde neu geladen." : ""}`;
            setHeaderStatus(`${municipalityName(validatedPackage.city)} wurde auf Version ${ver} aktualisiert.`);
          } else if (importMode === "replace" && validatedPackage.package?.type === "curated") {
            elements.cityCompletedMessage.textContent = `${municipalityName(validatedPackage.city)} wurde erfolgreich durch das kuratierte Trainingspaket ersetzt.${importedActiveCity ? " Der aktive Stadtkontext wurde neu geladen." : ""}`;
            setHeaderStatus(`${municipalityName(validatedPackage.city)} wurde auf kuratiertes Paket umgestellt.`);
          } else if (importedActiveCity) {
            elements.cityCompletedMessage.textContent = `${municipalityName(validatedPackage.city)} wurde ersetzt. Der aktive Stadtkontext wurde vollständig neu geladen.`;
            setHeaderStatus(`${municipalityName(validatedPackage.city)} wurde ersetzt und neu geladen.`);
          } else {
            elements.cityCompletedMessage.textContent = `${municipalityName(validatedPackage.city)} wurde importiert. Die bisher aktive Stadt bleibt unverändert.`;
            setHeaderStatus(`${municipalityName(validatedPackage.city)} wurde importiert.`);
          }
        } else {
          elements.cityCompletedMessage.textContent = `${municipalityName(validatedPackage.city)} wurde installiert, aktiviert und ist sofort spielbereit.`;
          setHeaderStatus(`${municipalityName(validatedPackage.city)} wurde installiert und aktiviert.`);
        }
        render();
        announce(elements.cityCompletedMessage.textContent);
      } catch (_) {
        if (citySaved && previousActivePackage) {
          try {
            await storage.saveCity(
              previousActivePackage.city,
              previousActivePackage.streets,
              previousActivePackage.pois,
              previousActivePackage.areas || []
            );
            rollbackSucceeded = true;
          } catch (_) {
            rollbackSucceeded = false;
          }
        }
        phase = STATES.VALIDATION_RESULT;
        if (citySaved) await refreshInstalledCities();
        alertMessage = rollbackSucceeded
          ? "Die ersetzte aktive Stadt konnte nicht neu geladen werden. Die bisherige Stadtversion wurde vollständig wiederhergestellt."
          : (citySaved
            ? "Die Stadt wurde gespeichert, konnte aber nicht aktiviert werden. Die bisherige Stadt bleibt aktiv."
            : getUserFriendlyCityError(null, "storage"));
        render();
        announce(alertMessage);
      }
    }

    async function activateCompletedImport() {
      if (phase !== STATES.COMPLETED || !completedActivationAvailable || !completedCity
        || activatingCompletedCity) return;
      if (!isCityChangeAllowed()) {
        explainBlockedCityChange();
        return;
      }
      activatingCompletedCity = true;
      render();
      try {
        await activateCity(completedCity.id);
        await refreshInstalledCities();
        completedActivationAvailable = false;
        elements.cityCompletedMessage.textContent = `${municipalityName(completedCity)} ist jetzt aktiv und sofort spielbereit.`;
        setHeaderStatus(`${municipalityName(completedCity)} wurde aktiviert.`);
        announce(elements.cityCompletedMessage.textContent);
      } catch (_) {
        alertMessage = "Die importierte Stadt konnte nicht aktiviert werden. Die bisherige Stadt bleibt aktiv.";
        announce(alertMessage);
      } finally {
        activatingCompletedCity = false;
        render();
      }
    }

    function toggleWarningDetails() {
      if (phase !== STATES.VALIDATION_RESULT && phase !== STATES.SAVING) return;
      warningDetailsExpanded = !warningDetailsExpanded;
      render();
    }

    function cancelValidation() {
      if (phase === STATES.SAVING) return;
      if (workflowSource === "update") {
        validatedPackage = null;
        updateDiff = null;
        updateCheckResult = null;
        updatingCity = null;
        phase = STATES.IDLE;
        alertMessage = "";
        noticeMessage = "Die Aktualisierung wurde abgebrochen. Es wurden keine Stadtdaten geändert.";
        warningDetailsExpanded = false;
        render();
        announce(noticeMessage);
        return;
      }
      validatedPackage = null;
      importMode = "new";
      importConflictMessage = "";
      importInstalledCity = null;
      importDiff = null;
      phase = selectedMunicipality ? STATES.MUNICIPALITY_SELECTED : STATES.IDLE;
      alertMessage = "";
      noticeMessage = workflowSource === "import"
        ? "Der Import wurde abgebrochen. Es wurden keine Stadtdaten gespeichert."
        : "Die Installation wurde verworfen. Es wurden keine Stadtdaten gespeichert.";
      warningDetailsExpanded = false;
      render();
      announce(noticeMessage);
    }

    function requestDeleteCity(city, opener) {
      if (!city || deleting) return;
      if (city.id === activeCityId && !isCityChangeAllowed()) {
        explainBlockedCityChange();
        return;
      }
      deleteTarget = city;
      deleteOpen = true;
      syncDocumentModalState();
      previousFocus = opener || documentRef.activeElement || elements.citySelectorButton;
      setMenuOpen(false);
      elements.deleteCityMessage.textContent = `„${municipalityName(city)}“ wirklich löschen?`;
      elements.deleteCityStatus.textContent = "";
      elements.confirmDeleteCityButton.disabled = false;
      elements.cancelDeleteCityButton.disabled = false;
      setHidden(elements.deleteCityModalOverlay, false);
      elements.deleteCityModalOverlay.setAttribute("aria-hidden", "false");
      schedule(() => elements.cancelDeleteCityButton.focus(), 0);
    }

    function closeDeleteDialog() {
      if (!deleteOpen || deleting) return false;
      deleteOpen = false;
      deleteTarget = null;
      syncDocumentModalState();
      setHidden(elements.deleteCityModalOverlay, true);
      elements.deleteCityModalOverlay.setAttribute("aria-hidden", "true");
      const focusTarget = previousFocus;
      previousFocus = null;
      setMenuOpen(true);
      if (focusTarget && typeof focusTarget.focus === "function") schedule(() => focusTarget.focus(), 0);
      return true;
    }

    async function confirmDeleteCity() {
      if (!deleteOpen || !deleteTarget || deleting) return;
      if (deleteTarget.id === activeCityId && !isCityChangeAllowed()) {
        elements.deleteCityStatus.textContent = "Die aktive Stadt kann während eines anderen Stadtvorgangs nicht gelöscht werden.";
        return;
      }
      deleting = true;
      elements.confirmDeleteCityButton.disabled = true;
      elements.cancelDeleteCityButton.disabled = true;
      elements.deleteCityStatus.textContent = "Stadt wird gelöscht …";
      const target = deleteTarget;
      try {
        await removeCity(target.id);
        try {
          if (typeof localStorage !== "undefined" && typeof localStorage.removeItem === "function") {
            localStorage.removeItem("strassentrainer.trainingArea." + target.id);
          }
        } catch (_) {}
        await refreshInstalledCities();
        deleting = false;
        deleteOpen = false;
        deleteTarget = null;
        syncDocumentModalState();
        setHidden(elements.deleteCityModalOverlay, true);
        elements.deleteCityModalOverlay.setAttribute("aria-hidden", "true");
        setHeaderStatus(`${municipalityName(target)} wurde lokal gelöscht. Statistikdaten blieben unverändert.`);
        announce(`${municipalityName(target)} wurde gelöscht.`);
        previousFocus = null;
        setMenuOpen(true);
        schedule(() => elements.citySelectorButton.focus(), 0);
      } catch (_) {
        deleting = false;
        elements.confirmDeleteCityButton.disabled = false;
        elements.cancelDeleteCityButton.disabled = false;
        elements.deleteCityStatus.textContent = "Die Stadt konnte nicht lokal gelöscht werden.";
      }
    }

    function trapFocus(event, dialog) {
      if (event.key !== "Tab" || !dialog || typeof dialog.querySelectorAll !== "function") return;
      const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => {
        let current = element;
        while (current && current !== dialog) {
          if (current.classList && current.classList.contains("hidden")) return false;
          current = current.parentElement || current.parentNode;
        }
        return !element.disabled;
      });
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleDocumentKeydown(event) {
      if (deleteOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDeleteDialog();
          return;
        }
        trapFocus(event, elements.deleteCityDialog);
        return;
      }
      if (!modalOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(event, elements.cityManagerDialog);
    }

    function bindListeners() {
      if (listenersBound) return;
      listenersBound = true;
      elements.citySelectorButton.addEventListener("click", () => setMenuOpen(!menuOpen));
      elements.addCityButton.addEventListener("click", () => open(elements.addCityButton));
      elements.importCityButton.addEventListener("click", requestCityImport);
      elements.cityImportFileInput.addEventListener("change", handleImportFileSelection);
      elements.citySearchForm.addEventListener("submit", performSearch);
      elements.municipalityActionButton.addEventListener("click", handleMunicipalityAction);
      elements.cancelCityDownloadButton.addEventListener("click", () => cancelDownload());
      elements.toggleWarningDetailsButton.addEventListener("click", toggleWarningDetails);
      elements.cancelValidationButton.addEventListener("click", cancelValidation);
      elements.saveCityButton.addEventListener("click", saveValidatedCity);
      elements.activateImportedCityButton.addEventListener("click", activateCompletedImport);
      elements.closeCompletedButton.addEventListener("click", close);
      elements.closeCityManagerButton.addEventListener("click", close);
      elements.cancelDeleteCityButton.addEventListener("click", closeDeleteDialog);
      elements.confirmDeleteCityButton.addEventListener("click", confirmDeleteCity);
      elements.cityManagerModalOverlay.addEventListener("click", event => {
        if (event.target === elements.cityManagerModalOverlay) close();
      });
      elements.deleteCityModalOverlay.addEventListener("click", event => {
        if (event.target === elements.deleteCityModalOverlay) closeDeleteDialog();
      });
      documentRef.addEventListener("keydown", handleDocumentKeydown);
      documentRef.addEventListener("click", event => {
        if (menuOpen && !elements.citySelector.contains(event.target)) setMenuOpen(false);
      });
    }

    async function init(initOptions = {}) {
      if (typeof initOptions.canChangeCity === "function") canChangeCity = initOptions.canChangeCity;
      if (typeof initOptions.activateCity === "function") activateCityCallback = initOptions.activateCity;
      if (typeof initOptions.deleteCity === "function") deleteCityCallback = initOptions.deleteCity;
      if (typeof initOptions.getRuntimeCity === "function") getRuntimeCity = initOptions.getRuntimeCity;
      if (initialized) {
        await refreshInstalledCities();
        return api;
      }
      requireDependencies();
      elements = collectElements();
      initialized = true;
      bindListeners();
      setMenuOpen(false);
      setHidden(elements.cityManagerModalOverlay, true);
      elements.cityManagerModalOverlay.setAttribute("aria-hidden", "true");
      setHidden(elements.deleteCityModalOverlay, true);
      elements.deleteCityModalOverlay.setAttribute("aria-hidden", "true");
      render();
      renderInstalledCities();
      syncDocumentModalState();
      await refreshInstalledCities();
      return api;
    }

    function getState() {
      return {
        initialized,
        phase,
        modalOpen,
        menuOpen,
        installedCities: [...installedCities],
        activeCityId,
        searchResults: [...searchResults],
        selectedMunicipality,
        selectedMunicipalityInstalled,
        validatedPackage,
        workflowSource,
        importedAlreadyInstalled,
        importedActiveCity,
        importMode,
        importConflictMessage,
        importDiff,
        completedCity,
        completedActivationAvailable,
        deleteOpen,
        deleteTarget,
        updatingCity,
        updateDiff
      };
    }

    const api = Object.freeze({ init, open, close, refreshInstalledCities, getState, startCityUpdate });
    return api;
  }

  let defaultManager = null;

  function getDefaultManager() {
    if (!defaultManager) defaultManager = createCityManager();
    return defaultManager;
  }

  return Object.freeze({
    getUserFriendlyCityError,
    init: options => getDefaultManager().init(options),
    open: opener => getDefaultManager().open(opener),
    close: options => getDefaultManager().close(options),
    refreshInstalledCities: () => getDefaultManager().refreshInstalledCities(),
    getState: () => getDefaultManager().getState(),
    startCityUpdate: (city, opener) => getDefaultManager().startCityUpdate(city, opener),
    createCityManager
  });
});
