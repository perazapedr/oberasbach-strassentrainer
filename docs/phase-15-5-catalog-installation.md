# Phase 15.5: Installation vollständig ohne Overpass

Dokumentation der Umstellung des regulären Benutzer-Installationsworkflows auf den statischen Katalog (`data/catalog.json`) und vorab generierte Stadtpakete (`data/cities/*.json`).

---

## 1. Zielsetzung und Motivation

Vor Phase 15.5 lief die Installation neuer Städte im City Manager über den Legacy-OSM-Pfad:
1. Nominatim-Geokodierung für Gemeindenamen.
2. Overpass-API-Abfragen für Begrenzungen, Straßen und POIs.
3. Hohe Latenz, Abhängigkeit von Drittservern, Ausfallrisiko und Rate-Limits.

In Phase 15.5 wurde der normale produktive Benutzerworkflow vollständig auf **CatalogDatasetProvider** umgestellt:
- **0 Nominatim-Aufrufe**
- **0 Overpass-Aufrufe**
- Deterministische, kryptographisch gesicherte und schemakonforme Datensätze.
- Der bestehende `LegacyOsmDatasetProvider` bleibt im Code als technischer Fallback erhalten, ist aber nicht mehr Default.

---

## 2. Architektur & Installationsworkflow

### 2.1 Standard-Provider
In `dataset-provider.js` liefert `getDefaultProvider()` nun eine Instanz von `createCatalogDatasetProvider()`.
In `city-manager-ui.js` initialisiert `createCityManager()` standardmäßig diesen Catalog-Provider.

### 2.2 Relativer Pfad & Host-Unabhängigkeit
Sowohl in Node.js-Umgebungen als auch im Browser (z. B. GitHub Pages unter Subpfaden wie `/oberasbach-strassentrainer-gesamtstatistik/`) löst der Provider Katalog- und Paket-URLs relativ zur Dokument-Basis auf (`document.baseURI` / `window.location.href`). Dadurch werden ungültige Basis-URLs vermieden.

### 2.3 Vollständige Validierungskette vor dem Speichern
Vor dem Schreiben in IndexedDB durchläuft jedes heruntergeladene Stadtpaket folgende Prüfstufen in `city-manager-ui.js`:
1. **Objektprüfung**: Gültiges JSON-Objekt.
2. **Katalog-Hash-Abgleich**: Prüfung, ob `metadata.contentHash` mit `package.contentHash` übereinstimmt (`CATALOG_HASH_MISMATCH`).
3. **Kryptographische Neuberechnung**: `validator.verifyPackageHash(downloaded)` berechnet den SHA-256-Hash über die normalisierten Paketdaten (`PACKAGE_HASH_MISMATCH`).
4. **Paketvertrag**: `validator.validateCityPackage(downloaded)` prüft Metadaten, Schema-Version (`schemaVersion: 1`), Grenzen und Vollständigkeit.
5. **Datensatzvalidierung**: `validator.validateCityData(downloaded, { sourceMode: "download" })` prüft Straßen, Mindestanzahl spielbarer Straßen, Geometrien und POIs.

### 2.4 Atomizität und Rollback
- Bei Fehlern in einer der Validierungsstufen wird der Vorgang abgebrochen; es werden **keine Teildaten** in IndexedDB geschrieben.
- Bei manuellem Abbruch (`AbortController`) verbleibt die Applikation im Ausgangszustand.
- Erst bei erfolgreicher Validierung schaltet die UI in `validation-result` mit aktivierter Schaltfläche „Stadt speichern“.

### 2.5 Service Worker & Offline-Caching
In `sw.js` ist `data/catalog.json` in den `STATIC_ASSETS` registriert und wird über die Strategie `CATALOG_NETWORK_FIRST` bedient (Offline-Fallback auf gecachten Stand).

---

## 3. Verifikation

### 3.1 Unit- und Integrationsprüfungen
- **Neue Testsuite**: `tests/catalog-installation-integration-tests.js`
  - 11 dedizierte Tests:
    1. CityManager-Initialisierung mit CatalogDatasetProvider
    2. Katalogsuche (Olpe & Oberasbach, 0 Nominatim, 0 Overpass)
    3. Olpe-Installation über Catalog-Pipeline
    4. IndexedDB-Speicherung und Aktivierung
    5. Gameplay ohne Netzwerk (Rundenziel, Punkteberechnung)
    6. Bereits installierte Stadt ("Stadt auswählen" statt Download)
    7. Hash-Manipulationstest (`verifyPackageHash` fängt Manipulation ab)
    8. Catalog-Mismatch-Test (Katalog-Hash != Paket-Hash)
    9. Atomicity-Test (Validierungsfehler blockiert Speicherung)
    10. Abort-Test (Abbruch hinterlässt keine Reste)
    11. Reload- und Persistenztest
  - **Ergebnis**: 11/11 PASS, 0 Nominatim-Requests, 0 Overpass-Requests.

- **Gesamte Regression**:
  - `31/31` Testsuiten bestanden (100% PASS).

### 3.2 Realer Browser-Smoke-Test
- **Skript**: `scripts/browser-smoke-test.js`
- **Umgebung**: Headless Google Chrome über Chrome DevTools Protocol (CDP), lokaler Webserver.
- **Workflow im echten Browser**:
  1. Start der Anwendung.
  2. Öffnen des City-Selectors.
  3. Klick auf „Neue Stadt hinzufügen“.
  4. Suche nach „Olpe“ im Dialog.
  5. Auswahl von Olpe aus den Suchergebnissen.
  6. Klick auf „Stadt herunterladen“.
  7. Validierung: 461 Straßen, 114 POIs verifiziert.
  8. Speichern in IndexedDB und Schließen des Dialogs.
  9. Verifikation der aktiven Stadt in der Topbar („Olpe“).
  10. Start einer freien Spielrunde („Ersten Alarm auslösen“) → Rundenziel „Hudeweg“.
- **Netzwerk-Audit im echten Browser**:
  - `Nominatim-Requests: 0`
  - `Overpass-Requests:  0`
  - `Katalog-Requests:   1`
  - `Stadtpaket-Requests: 2` (Oberasbach Default-Bootstrap + Olpe Download)

---

## 4. Fazit
Phase 15.5 ist vollständig abgeschlossen. Der produktive Installationsworkflow für Städte ist zu 100% von externen OSM-Laufzeit-APIs entkoppelt.
