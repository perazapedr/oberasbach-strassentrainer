# Phase 15.0 Baseline

- Datum: 2026-09-06 (Europe/Berlin)
- Branch: `feature/multi-city`
- Commit SHA: `753a9fe71303e105b4b863b478ce3ecd98aefc43`
- Upstream: `origin/feature/multi-city`
- Working Tree vor Phase 15.0: sauber (`git status --porcelain=v1 -uall` ohne Ausgabe)
- Package-System: keines; die Regression besteht aus direkt ausführbaren Node-Testdateien.

## Teststatus

Alle im Repository vorhandenen Dateien `tests/*-tests.js` wurden einzeln mit Node ausgeführt.

| Testdatei | Bereich | Status |
| --- | --- | --- |
| `tests/city-data-validator-tests.js` | Stadtpaket-Validierung | PASS |
| `tests/city-manager-ui-tests.js` | Stadtverwaltung/UI | PASS |
| `tests/city-package-tests.js` | Paketimport und -export | PASS |
| `tests/city-storage-tests.js` | IndexedDB/Storage | PASS |
| `tests/city-update-tests.js` | Stadtupdates | PASS |
| `tests/curated-package-tests.js` | Kuratierte Pakete | PASS |
| `tests/custom-training-area-tests.js` | Eigene Trainingsgebiete | PASS |
| `tests/free-mode-integration-tests.js` | Freier, Zeit- und Prüfungsmodus | PASS |
| `tests/game-engine-tests.js` | Game Engine und Modusabläufe | PASS |
| `tests/geometry-tests.js` | Geometrie | PASS |
| `tests/multi-city-integration-tests.js` | Multi-City/CityContext | PASS |
| `tests/oberasbach-migration-tests.js` | Default-Paket und Migration | PASS |
| `tests/offline-basemap-tests.js` | Lokale Offline-Basemap | PASS |
| `tests/offline-tests.js` | App Shell, lokale Vendor-Dateien, Service Worker | PASS |
| `tests/osm-chunk-tests.js` | Overpass-Chunking | PASS |
| `tests/osm-service-tests.js` | Nominatim/Overpass | PASS |
| `tests/performance-architecture-tests.js` | Architektur/Performance | PASS |
| `tests/poi-category-tests.js` | POI-Registry und Kategorien | PASS |
| `tests/statistics-tests.js` | Statistik | PASS |
| `tests/targets-tests.js` | Zielmodell und Auswertung | PASS |
| `tests/timer-tests.js` | Timer | PASS |
| `tests/training-area-tests.js` | Trainingsgebiete | PASS |

Ergebnis der vollständigen automatisierten Regression: **22/22 Testsuiten PASS**.

## Oberasbach Golden Dataset

Der Browser-Laufzeitpfad lädt über `default-city.js` das gebündelte Paket
`data/cities/oberasbach.json`, validiert dessen interne Zähler und speichert es bei
leerer Datenbank atomar über `city-storage.js` in IndexedDB. Die früheren
Build-Quellen `data/oberasbach-streets.js` und `data/oberasbach-pois.js` werden von
`index.html` nicht geladen.

- City-ID: `osm-relation-1016396`
- Quelle: `curated+openstreetmap`
- Pakettyp/-version: `curated` / `1.0.0`
- Straßen: **271**
- POIs: **60**
- Paket-SHA-256: `2fe29136278c4476f13688b57faa482d9ee5654c2443664d00a0d1d4359c2bab`
- Status: **PASS**

Die Migrationstests bestätigen zusätzlich die lokale Installation und Aktivierung,
die unveränderten kuratierten Namen/POIs, vollständige Straßengeometrien,
deterministische netzwerkfreie Paketgenerierung und den Schutz einer bereits
installierten OSM-Version vor automatischem Überschreiben. Die Targets- und
Integrationstests bestätigen die Verfügbarkeit von Straßen und konfigurierten POIs
als Trainingsziele.

## Gameplay

- Freier Modus: **PASS** – Start, Zielwahl, Tipp, Auswertung und nächste Runde sind durch den Integrationstest abgedeckt.
- Zeitmodus: **PASS** – Start, Tipp, Timeout, manuelle nächste Runde und Schutz vor doppelten Timern sind abgedeckt.
- Prüfungsmodus: **PASS** – Aufgabenfolge, unterdrückte Zwischenauflösung, Abschlussauswertung, Punkte/Rang und verzögerte Statistikübernahme sind abgedeckt.

Die Nachweise stammen aus `free-mode-integration-tests.js`,
`game-engine-tests.js`, `timer-tests.js`, `targets-tests.js` und
`statistics-tests.js`. Es wurden keine Spielregeln oder produktiven Gameplay-Dateien
verändert.

## Statistik

Status: **PASS**.

Getestet sind Speichern und Laden über `localStorage`, Schema-1-Migration und
Schema-2-Validierung, stadtbezogene Schlüssel und Trennung, Aktualisierung durch
freie, zeitgesteuerte und abgeschlossene Prüfungsrunden, Deduplizierung, Reset sowie
stadtgebundener Import/Export einschließlich Merge/Replace. Die Oberasbach-Migration
kopiert Legacy-Statistik nicht destruktiv und überschreibt keinen vorhandenen neuen
Statistikschlüssel.

## Offline

- Lokale Leaflet- und Turf-Dateien: **PASS** (automatisiert)
- Service Worker und vollständige App Shell: **PASS** (automatisiert)
- Offline-Basemap ohne Netzwerk-/IndexedDB-Aufrufe beim Rendern: **PASS** (automatisiert)
- Installierte Straßen- und POI-Runden ohne Netzwerkzugriff: **PASS** (automatisiert)
- Echter Browser-Smoke mit Online-Laden, Offline-Neuladen und gespielter Runde: **NOT VERIFIED**

Der echte Browser-Smoke konnte in der Arbeitsumgebung nicht gestartet werden. Die
bereitgestellte Browser-Anbindung brach beim Laden ihres Clients mit
`Importing module "node:process" is not allowed in node_repl` ab, noch bevor ein Tab
geöffnet werden konnte. Dieser Punkt wird deshalb nicht aus den automatisierten
Tests abgeleitet.

Manuelle Verifikation:

1. Repository über einen lokalen HTTP-Server ausliefern und die App online öffnen.
2. Warten, bis Oberasbach installiert, aktiv und spielbereit ist.
3. In den Browser-Entwicklerwerkzeugen Netzwerk auf „Offline“ stellen.
4. Die App neu laden und prüfen, dass App Shell und Oberasbach aus lokalem Cache bzw. IndexedDB laden.
5. Je eine Straßen- und POI-Runde starten, einen Tipp abgeben, auswerten und die nächste Runde öffnen.
6. Im Netzwerkprotokoll bestätigen, dass während der Runde keine Nominatim-/Overpass-Abfrage erfolgt.

## Known Issues

### TA-POLYGON-001 – DEFERRED

Eine eindeutig innerhalb der Stadtgrenze gezeichnete Custom Region wird im realen
Oberasbach-Browserpfad teilweise als außerhalb erkannt.

Der Fehler wird in Phase 15.0 nicht repariert. Er blockiert weder Phase 15,
`DatasetProvider`, Dataset Builder, Installationsarchitektur noch Dataset Updates.
Er blockiert später jedoch die finale Abnahme von Custom Areas,
Feuerwehr-Einsatzgebieten und Phase 17.3.

## Geschützte Legacy-Pfade und Scope

- Overpass-/Nominatim-Pfad weiterhin vorhanden und unverändert: **PASS**
- Game Engine, Timer, Scoring, Ränge, Kernstatistik und Zielauswertung unverändert: **PASS**
- `DatasetProvider` implementiert: **NEIN**
- PBF/Geofabrik/osmium/PostGIS/Dataset Builder implementiert: **NEIN**
- Neue Paket-, Katalog-, Repository- oder CDN-Architektur implementiert: **NEIN**

## Exit Gate

| Kriterium | Status |
| --- | --- |
| bestehende Regression | PASS |
| Oberasbach 271 / 60 | PASS |
| Spielmodi | PASS |
| Statistik | PASS |
| Offline | NOT VERIFIED |
| Known Issues dokumentiert | PASS |
| `git diff --check` | PASS |
| Game Engine unverändert | PASS |
| Overpass unverändert | PASS |

## Ergebnis

**PHASE 15.0 PARTIAL**

Ein echter Browser-Offline-Smoke bleibt erforderlich. Daher wird Phase 15.0 nicht
als vollständig abgeschlossen und noch nicht als bereit für Phase 15.1 markiert.
