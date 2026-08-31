(function initializeCityManager(root, factory) {
  "use strict";

  const commonJsPackage = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./city-package.js")
    : null;
  const api = factory(root, commonJsPackage);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerCityManager = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCityManagerApi(root, commonJsPackage) {
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

    if (context === "search") {
      if (code === "TIMEOUT") {
        return "Die Stadtsuche dauert momentan ungewöhnlich lange. Bitte versuche es erneut.";
      }
      return "Die Stadtsuche ist momentan nicht erreichbar. Bereits installierte Städte können weiterhin gespielt werden.";
    }
    if (context === "validation") {
      return "Die heruntergeladenen Stadtdaten konnten nicht sicher verwendet werden. Es wurde nichts gespeichert.";
    }
    if (context === "storage") {
      return "Die Stadt konnte nicht lokal gespeichert werden. Bitte versuche es erneut und prüfe, ob ausreichend lokaler Speicher verfügbar ist.";
    }
    if (context !== "download") {
      return "Der Stadtvorgang konnte nicht abgeschlossen werden. Bitte versuche es erneut.";
    }

    if (code === "ABORTED") return "Download wurde abgebrochen. Es wurden keine Stadtdaten gespeichert.";
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
      return "Der OpenStreetMap-Datendienst konnte nicht erreicht werden. Bitte prüfe deine Internetverbindung und versuche es erneut.";
    }
    if (code === "HTTP_ERROR" && status === 429) {
      return "Der OpenStreetMap-Datendienst erhält momentan sehr viele Anfragen. Bitte warte kurz und versuche den Download erneut.";
    }
    if (code === "HTTP_ERROR" && [502, 503, 504].includes(status)) {
      return "Der OpenStreetMap-Datendienst ist momentan ausgelastet. Die Stadt konnte deshalb nicht vollständig geladen werden. Bitte versuche es erneut.";
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

  const CATEGORY_LABELS = Object.freeze({
    fire_station: "Feuerwehren",
    school: "Schulen",
    kindergarten: "Kindergärten",
    childcare: "Kindertagesstätten",
    supermarket: "Supermärkte",
    "senior-care": "Senioren- und Pflegeeinrichtungen",
    fuel: "Tankstellen",
    health: "Gesundheit",
    "public-facility": "Öffentliche Einrichtungen",
    "sports-leisure": "Sport und Freizeit",
    hospitality: "Gastronomie und Beherbergung",
    company: "Unternehmen",
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
    const osmType = asText(municipality && municipality.osmType);
    const osmId = Number(municipality && municipality.osmId);
    if (!osmType || !Number.isSafeInteger(osmId) || osmId <= 0) return null;
    return `osm-${osmType}-${osmId}`;
  }

  function createCityManager(options = {}) {
    const documentRef = options.document || (root && root.document) || null;
    const storage = options.storage || (root && root.StrassentrainerCityStorage) || null;
    const osmService = options.osmService || (root && root.StrassentrainerOsmService) || null;
    const validator = options.validator || (root && root.StrassentrainerCityDataValidator) || null;
    const packageApi = options.packageApi || (root && root.StrassentrainerCityPackage) || commonJsPackage;
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
    let completedCity = null;
    let completedActivationAvailable = false;
    let activatingCompletedCity = false;
    let importOperationId = 0;
    const exportingCityIds = new Set();
    let canChangeCity = typeof options.canChangeCity === "function" ? options.canChangeCity : () => true;
    let activateCityCallback = typeof options.activateCity === "function" ? options.activateCity : null;
    let deleteCityCallback = typeof options.deleteCity === "function" ? options.deleteCity : null;
    let getRuntimeCity = typeof options.getRuntimeCity === "function" ? options.getRuntimeCity : () => null;

    function requireDependencies() {
      if (!documentRef) throw new Error("CityManager benötigt ein document.");
      if (!storage) throw new Error("StrassentrainerCityStorage ist nicht verfügbar.");
      if (!osmService) throw new Error("StrassentrainerOsmService ist nicht verfügbar.");
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
        selectButton.appendChild(label);
        if (city.id === activeCityId) {
          selectButton.appendChild(makeElement("span", "installed-city-check installed-city-active", "✓"));
        }
        const context = municipalityContext(city);
        if (context) selectButton.appendChild(makeElement("span", "installed-city-context", context));
        selectButton.addEventListener("click", () => activateInstalledCity(city, { fromModal: false }));

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
      return ["municipality", "streets", "pois"].flatMap(sectionName => {
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
        municipality: "Gemeinde",
        streets: "Straßen",
        pois: "Einrichtungen"
      };
      ["municipality", "streets", "pois"].forEach(sectionName => {
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

    function renderValidation() {
      const packageData = validatedPackage || {};
      const city = packageData.city || {};
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
          label: asText(poi.categoryLabel) || CATEGORY_LABELS[category] || category
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
      if (workflowSource === "import" && importedAlreadyInstalled) {
        elements.cityValidationOutcome.appendChild(makeElement(
          "p",
          "city-validation-error",
          "Diese Stadt ist bereits installiert. Sie wird nur nach einem ausdrücklichen Klick ersetzt."
        ));
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

      elements.saveCityButton.disabled = !packageData.valid || phase === STATES.SAVING;
      if (phase === STATES.SAVING) elements.saveCityButton.textContent = "Stadt wird gespeichert …";
      else if (workflowSource === "import" && importedAlreadyInstalled) {
        elements.saveCityButton.textContent = "Vorhandene Stadt ersetzen";
      } else if (workflowSource === "import") elements.saveCityButton.textContent = "Importieren";
      else elements.saveCityButton.textContent = "Stadt speichern";
      elements.cancelValidationButton.disabled = phase === STATES.SAVING;
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
        elements.selectedMunicipalityContext.textContent = municipalityContext(selectedMunicipality, true);
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
      }

      if (downloadVisible) {
        const cityName = municipalityName(selectedMunicipality);
        elements.cityDownloadTitle.textContent = phase === STATES.VALIDATING
          ? (workflowSource === "import" ? "Stadtdatei wird geprüft" : `${cityName} wird geprüft`)
          : `${cityName} wird heruntergeladen`;
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
        phase = selectedMunicipality ? STATES.MUNICIPALITY_SELECTED : STATES.IDLE;
        alertMessage = "";
        noticeMessage = "Download abgebrochen. Es wurden keine Stadtdaten gespeichert.";
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
      completedCity = null;
      completedActivationAvailable = false;
      activatingCompletedCity = false;
      if (elements) {
        elements.citySearchInput.value = "";
        elements.cityImportFileInput.value = "";
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
          importedAlreadyInstalled = await storage.hasCity(result.city.id);
          if (operationId !== importOperationId || !modalOpen) return;
          const currentRuntimeCityId = asText(runtimeCity()?.id);
          importedActiveCity = result.city.id === activeCityId || result.city.id === currentRuntimeCityId;
        }
        phase = STATES.VALIDATION_RESULT;
        alertMessage = result.valid ? "" : packageApi.validationErrorMessage(result);
        render();
        announce(result.valid
          ? `Importvorschau für ${municipalityName(result.city)} ist bereit. Es wurde noch nichts gespeichert.`
          : alertMessage);
        schedule(() => {
          const focusTarget = result.valid ? elements.saveCityButton : elements.cancelValidationButton;
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
        const results = await osmService.searchMunicipalities(query, { signal: searchController.signal });
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
        alertMessage = "Diese Gemeinde besitzt keine verwendbare OSM-Kennung.";
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
        const installed = await storage.hasCity(cityId);
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
        const cityId = municipalityCityId(selectedMunicipality);
        const city = installedCities.find(candidate => candidate.id === cityId) || {
          id: cityId,
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
      cancelDownload({ closing: true });
      workflowSource = "download";
      const operationId = ++downloadOperationId;
      const controller = new AbortControllerClass();
      downloadController = controller;
      phase = STATES.DOWNLOADING;
      progress = { stage: "preparing", message: "Gemeindedownload wird vorbereitet …", progress: 0 };
      alertMessage = "";
      noticeMessage = "";
      validatedPackage = null;
      warningDetailsExpanded = false;
      render();
      announce(`${municipalityName(selectedMunicipality)} wird heruntergeladen.`);

      let validationStarted = false;
      try {
        const downloaded = await osmService.fetchCityData(selectedMunicipality, {
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
        if (operationId !== downloadOperationId || !modalOpen || controller.signal.aborted) return;
        phase = STATES.VALIDATING;
        validationStarted = true;
        render();
        announce("Die heruntergeladenen Stadtdaten werden geprüft.");

        const result = validator.validateCityData(downloaded, { sourceMode: "download" });
        if (operationId !== downloadOperationId || !modalOpen || controller.signal.aborted) return;
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
      return city ? { city, streets, pois } : null;
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
        if (workflowSource === "import" && importedAlreadyInstalled && importedActiveCity) {
          previousActivePackage = await loadStoredCityData(validatedPackage.city.id);
          if (!previousActivePackage) {
            throw new Error("Die bisherige aktive Stadt konnte nicht für ein sicheres Ersetzen gelesen werden.");
          }
        }
        await storage.saveCity(validatedPackage.city, validatedPackage.streets, validatedPackage.pois);
        citySaved = true;
        if (workflowSource === "download" || importedActiveCity) {
          await activateCity(validatedPackage.city.id, { force: true });
        }
        await refreshInstalledCities();
        phase = STATES.COMPLETED;
        completedCity = validatedPackage.city;
        completedActivationAvailable = workflowSource === "import" && !importedActiveCity;
        if (workflowSource === "import" && importedActiveCity) {
          elements.cityCompletedMessage.textContent = `${municipalityName(validatedPackage.city)} wurde ersetzt. Der aktive Stadtkontext wurde vollständig neu geladen.`;
          setHeaderStatus(`${municipalityName(validatedPackage.city)} wurde ersetzt und neu geladen.`);
        } else if (workflowSource === "import") {
          elements.cityCompletedMessage.textContent = `${municipalityName(validatedPackage.city)} wurde importiert. Die bisher aktive Stadt bleibt unverändert.`;
          setHeaderStatus(`${municipalityName(validatedPackage.city)} wurde importiert.`);
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
              previousActivePackage.pois
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
      validatedPackage = null;
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
        completedCity,
        completedActivationAvailable,
        deleteOpen,
        deleteTarget
      };
    }

    const api = Object.freeze({ init, open, close, refreshInstalledCities, getState });
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
    createCityManager
  });
});
