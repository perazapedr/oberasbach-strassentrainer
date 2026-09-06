# Phase 15.6: Dataset-Updates vollständig ohne Overpass

Dokumentation der vollständigen Entkopplung des Stadt-Aktualisierungsworkflows von Live-OSM-APIs (Overpass / Nominatim) hin zu statischen Katalog-Updates über den `CatalogDatasetProvider`.

---

## 1. Zielsetzung und Motivation

In Phase 15.5 wurde die Neuinstallation von Städten auf den statischen Katalog (`data/catalog.json`) umgestellt. Der Aktualisierungspfad installierter Städte (`startCityUpdate`) nutzte im Kern jedoch weiterhin den Legacy-Weg über Overpass-Abfragen.

Mit **Phase 15.6** ist nun auch der **vollständige Aktualisierungsworkflow** auf den `CatalogDatasetProvider` umgestellt:
- **0 Nominatim-Requests**
- **0 Overpass-Requests**
- **Sicherer Versionsvergleich** (CalVer / SemVer) via `comparePackageVersions()`
- **Vollständige kryptographische Prüfkette** vor jeder Datenübernahme
- **Deterministische Diff-Vorschau** (+/- Straßen, +/- POIs, Trainingsgebiete)
- **Ausdrückliche Bestätigungspflicht** („Update übernehmen“)
- **Vollständiger Erhalt lokaler Benutzerdaten** (Trainingsstatistiken, benutzerdefinierte Einsatzgebiete)
- **Active-City-Lifecycle**: Automatisches Neuladen aktiver Städte bzw. Unberührtlassen inaktiver Städte
- **Atomares Rollback**: Fehlgeschlagene Speicheroperationen hinterlassen keine inkonsistenten Teildaten

---

## 2. Architektur und Update-Pipeline

```
Installierte Stadt (Version A)
        ↓
CatalogDatasetProvider.checkForUpdate()
        ↓
data/catalog.json (Abgleich aktuelle vs. neueste Version via comparePackageVersions)
        ↓
Update verfügbar (hasUpdate: true, Version B > Version A)
        ↓
CatalogDatasetProvider.downloadDataset()
        ↓
Catalog-Hash ↔ Package-Hash-Vergleich (CATALOG_HASH_MISMATCH)
        ↓
SHA-256-Neuberechnung via verifyPackageHash (PACKAGE_HASH_MISMATCH)
        ↓
Package-Vertragsprüfung via validateCityPackage (PACKAGE_INVALID)
        ↓
Datensatzvalidierung via validateCityData ({ sourceMode: "download" })
        ↓
Deterministischer Versionsvergleich via updateApi.compareCityVersions()
        ↓
UI-Diff-Vorschau (Badges für +/- Straßen, +/- POIs, Gebiete, Version A → Version B)
        ↓
Benutzerbestätigung („Update übernehmen“)
        ↓
Atomares Schreiben in IndexedDB via storage.saveCity(..., { preserveUserAreas: false })
(unter Erhalt von User-Areas via areasForCityReplacement)
        ↓
Aktive Stadt reaktivieren (activateCity(..., { force: true })) / inaktive Stadt unberührt lassen
        ↓
Folgende Update-Prüfung liefert hasUpdate: false
```

### 2.1 Versionsvergleich & Downgrade-Schutz
- Die Methode `checkForUpdate()` in `dataset-provider.js` ermittelt die installierte Version aus `package.version`, `city.package.version` oder `city.version`.
- Der Versionsvergleich erfolgt über `comparePackageVersions(latest, current)`:
  - `hasUpdate = comparison > 0` (nur echt neuere Versionen bieten ein Update an).
  - Bei identischer Version (`comparison === 0`) oder älterer Katalogversion (`comparison < 0`) wird kein Update angeboten (`hasUpdate: false`). Ein versehentliches Downgrade ist technisch ausgeschlossen.

### 2.2 Kryptographische Validierungskette
Vor der Diff-Berechnung und Übernahme durchläuft das heruntergeladene Datenpaket die vollständige Sicherheitskette in `city-manager-ui.js`:
1. **Catalog-Hash-Abgleich**: Prüfung auf Übereinstimmung von `catalog.contentHash` mit `package.contentHash`.
2. **Kryptographische SHA-256-Neuberechnung**: `validator.verifyPackageHash(downloaded)` prüft die tatsächliche Prüfsumme der normalisierten JSON-Nutzdaten.
3. **Vertragsvalidierung**: `validator.validateCityPackage(downloaded)` prüft Schema 1, Metadaten und Pflichtfelder.
4. **Fachliche Validierung**: `validator.validateCityData(downloaded, { sourceMode: "download" })` prüft Straßennetz, Geometrien, Mindestanzahl spielbarer Straßen und POI-Kategorien.

### 2.3 Deterministischer Diff & UI-Vorschau
- Die bestehende Diff-Engine aus `city-update.js` (`compareCityVersions`) berechnet die Differenz zwischen dem aktuellen Datenbankstand und dem neuen Paket.
- Die UI rendert die Versionsänderung (`currentVersion → latestVersion`) sowie farblich abgegrenzte Badges (`badge-diff`) für hinzugefügte und entfernte Straßen und POIs.
- Erst durch Klick auf **„Update übernehmen“** wird die Transaktion ausgelöst.

### 2.4 Erhalt von Benutzerdaten & Gebieten
- **Statistiken**: Rundenergebnisse in `localStorage` sind an `targetId` gebunden. Bestehende Straßen behalten ihre Lernhistorie; entfernte Straßen verbleiben als historische Einträge erhalten.
- **Benutzerdefinierte Trainingsgebiete**: Lokale Einsatzgebiete (`source: "user"`) werden über `areasForCityReplacement()` in die neue Stadt übernommen.
- **Aktive Stadt**:
  - Fall A (Aktive Stadt wird aktualisiert): `activateCity(cityId, { force: true })` lädt den Engine-Kontext mit den neuen Geometrien neu.
  - Fall B (Inaktive Stadt wird aktualisiert): Die aktive Stadt bleibt unverändert aktiv.

---

## 3. Verifikation & Testabdeckung

### 3.1 Unit- & Regressionstests (`tests/city-update-tests.js`)
- **Suite 11**: 12 neue Tests für Catalog-Update-Prüfungen:
  - Gleiche Version liefert `hasUpdate: false`.
  - Neuere Version liefert `hasUpdate: true`.
  - Ältere Katalogversion verhindert Downgrade.
  - Abweisung bei fehlendem Dataset, fehlerhaftem Katalog, ungültiger Version, manipuliertem Katalog-Hash, manipuliertem Paket-Hash oder fehlerhafter Datensatzvalidierung.
  - AbortSignal bricht Update-Prüfung und Download sauber ab.
- **Suite 12**: 2 Tests mit echten Fixtures V1/V2:
  - Diff-Prüfung gegen Olpe V1 (`2026.09.05`) und Olpe V2 (`2026.09.06`): Exakt +1/-1 Straße, +1/-1 POI, 0 Gebiete.
  - Deterministische und reihenfolgeunabhängige Diff-Generierung.
- **Gesamtergebnis**: 36/36 Tests bestanden.

### 3.2 End-to-End Integrationssuite (`tests/catalog-update-integration-tests.js`)
11-stufiger E2E-Workflow ohne Mocks der Fachlogik:
1. Installation Olpe V1 über Catalog (461 Straßen, 114 POIs, 2 Gebiete).
2. Erzeugung von 5 Runden Trainingsstatistik und einem lokalen Benutzergebiet („Mein Einsatzgebiet“).
3. Prüfung gegen Katalog V1 meldet `hasUpdate: false`.
4. Umschalten auf Katalog V2: `checkForUpdate()` meldet `hasUpdate: true`.
5. Durchführung des Update-Workflows im CityManager (Diff-Vorschau, Bestätigung).
6. Atomare Aktualisierung der IndexedDB (neue Straße vorhanden, alte entfernt, lokales Gebiet erhalten).
7. Erneute Update-Prüfung meldet `hasUpdate: false`.
8. Vollständiger Erhalt aller 5 Statistikrunden und Historie.
9. Active City Management (Fall A und Fall B verifiziert).
10. Rollback-Sicherheit bei Storage-Fehler.
11. Gameplay nach Update (Spielziel der neuen Straße mit 1000 Punkten gespielt).
- **Netzwerk-Audit**: Nominatim-Requests = 0, Overpass-Requests = 0.

### 3.3 Real-Browser Smoke Test (`scripts/browser-update-smoke-test.js`)
Ausführung in echtem Headless Google Chrome über Chrome DevTools Protocol (CDP):
- Dynamischer lokaler HTTP-Server mit Umschaltung zwischen Katalog V1 und V2.
- Durchführung von V1-Installation, V2-Update-Check, Diff-Vorschau, Update-Übernahme und freier Spielrunde.
- **Netzwerk-Audit im Browser**:
  - Nominatim-Anfragen: **0**
  - Overpass-Anfragen: **0**
  - Status: **PASS**

---

## 4. Unveränderte Produktionsdaten & Abgrenzung

- `data/cities/oberasbach.json` (271 Straßen, 60 POIs) unverändert.
- `data/cities/de-nw-olpe.json` (461 Straßen, 114 POIs, 2 Gebiete) unverändert.
- `data/catalog.json` unverändert.
- Dedizierte Test-Fixtures liegen isoliert unter `tests/fixtures/update/`.
- Phase 15.7 (weitere NRW-Städte) wurde nicht begonnen.

