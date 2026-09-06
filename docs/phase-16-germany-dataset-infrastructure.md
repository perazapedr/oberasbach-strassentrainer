# Phase 16 – Deutschlandweite Dataset-Infrastruktur

Dieses Dokument beschreibt die bundesweite Abstraktion und Erweiterung der Dataset-Pipeline des Straßentrainers auf alle 16 deutschen Bundesländer gemäß Masterplan 2.0.

---

## 1. Übersicht & Zielsetzung

Mit Phase 15.8 wurde eine automatisierte, staging-isolierte und deklarative Pipeline für Nordrhein-Westfalen geschaffen. Phase 16 generalisiert diese Infrastruktur auf ganz Deutschland:
- **Deklarative Regionen-Konfiguration (`regions.json`)**: Formale Definition aller Bundesländer mit Metadaten (`state`, `country`, `stateCode`, `defaultAdminLevel`, kanonische Dateimuster).
- **Entkoppelte Manifest-Struktur (`manifests/<regionId>.json`)**: Saubere Trennung regionaler Zieldefinitionen ohne Hardcodierung von Bundesland-Parametern.
- **Automatische Relation-Discovery (`--discover`)**: Schnelles Extrahieren aller administrativen Gemeinden (`admin_level=8`, `boundary=administrative`) direkt aus regionalen OSM-PBF-Extrakten via `osmium tags-filter` (~2s für >2.500 Gemeinden in Bayern).
- **Multi-Bundesland-Proof (Bayern & Zirndorf)**: Erfolgreicher realer PBF-Build der bayerischen Nachbargemeinde Zirndorf (`de-by-zirndorf`) gegen `bayern-latest.osm.pbf`.
- **Multi-Region-Katalog**: Koexistenz von Datensätzen aus mehreren Bundesländern (Oberasbach [BY], Zirndorf [BY], Köln [NW], Olpe [NW], Siegen [NW], Wenden [NW]) unter Einhaltung des Schema-1-Katalogs und sicherer relativer Pfade (`cities/<id>.json`).
- **Golden Master Oberasbach**: Vollständig unberührt, geschützt vor PBF-Überschreibung und fest im Bundesland Bayern verankert.

---

## 2. Architektur & Komponenten

```text
tools/dataset-pipeline/
├── regions.json                   # Bundesland-Definitionen (de-nw, de-by, etc.)
├── manifests/
│   ├── de-nw.json                 # NRW-Manifest (Olpe, Wenden, Siegen, Köln)
│   └── de-by.json                 # Bayern-Manifest (Zirndorf)
├── qa-policy.json                 # Deklarative QA-Schwellenwerte & Area-QA
├── published-state.json           # Baselines der produktiven Datensätze
├── index.js                       # Orchestrator CLI mit --region & --discover
└── lib/
    ├── manifest.js                # Parser, loadRegions, Schema- und Region-Prüfung
    ├── preflight.js               # Osmium & PBF Header-Prüfung
    ├── staging.js                 # Run-Isolation in temporärem Staging
    ├── qa.js                      # Multi-Stage Package & Area QA
    ├── publish.js                 # Atomare Promotion & Katalog-Generierung
    └── report.js                  # Strukturierte JSON- und Tabellenberichte
```

### 2.1 Region-Konfiguration (`regions.json`)

Jede Region definiert:
```json
{
  "schemaVersion": 1,
  "regions": {
    "de-nw": {
      "regionId": "de-nw",
      "country": "Deutschland",
      "state": "Nordrhein-Westfalen",
      "stateCode": "NW",
      "defaultAdminLevel": 8,
      "pbfFilePattern": "nordrhein-westfalen-latest.osm.pbf"
    },
    "de-by": {
      "regionId": "de-by",
      "country": "Deutschland",
      "state": "Bayern",
      "stateCode": "BY",
      "defaultAdminLevel": 8,
      "pbfFilePattern": "bayern-latest.osm.pbf"
    }
  }
}
```

### 2.2 CLI-Erweiterungen

| Parameter | Beschreibung |
| :--- | :--- |
| `--region <id>` | Spezifiziert die aktive Region (z. B. `de-by` oder `de-nw`). Lädt automatisch `manifests/<id>.json`. |
| `--regions <path>` | Pfad zur Regionen-Konfiguration (Standard: `tools/dataset-pipeline/regions.json`). |
| `--discover` | Scannt das übergebene PBF-File auf alle administrativen Gemeinden der Region und gibt eine formatierte Tabelle/JSON aus. |
| `--manifest <path>` | Expliziter Pfad zu einer Manifest-Datei (überschreibt Default der Region). |
| `--pbf <path>` | Pfad zum regionalen OSM-PBF-Extrakt. |
| `--all` / `--dataset <id>` | Selektiert alle oder ein bestimmtes Target aus dem Manifest. |
| `--no-publish` | Führt Build & QA im Staging durch, erzeugt Kandidatenkatalog ohne Promotion. |

---

## 3. Realer Build Zirndorf (`de-by-zirndorf`)

### 3.1 Parameter & Herkunft
- **Region**: Bayern (`de-by`), Deutschland
- **Source PBF**: `tools/dataset-builder/work/bayern-latest.osm.pbf` (850.807.454 Bytes, Timestamp: `2026-09-05T20:22:06.000Z`)
- **OSM-Relation**: 3351257 (`admin_level=8`, `boundary=administrative`)
- **Amtlicher Gemeindeschlüssel (AGS)**: `09573134`
- **Regionalschlüssel**: `095730134134`

### 3.2 Build-Metriken & Performance
- **Dauer**: 19,24 Sekunden
- **RSS-Delta**: 88 MB (striktes Budget: < 1,5 GB eingehalten)
- **Features verarbeitet**: 43.190
- **Extrahierte Straßen**: 345 (alle mit vollständiger `MultiLineString`-Geometrie)
- **Extrahierte Einrichtungen (POIs)**: 124 (kategorisiert)
- **Berechnete Trainingsgebiete (Areas)**: 0
- **Dateigröße**: 911.271 Bytes (~890 KB)
- **ContentHash**: `sha256:766615fdfddcbea7250d218f3b9f79c5f18e8e3b72fdcf99f7218e4867340f49`

### 3.3 Area-QA Audit-Bericht
Während des Builds wurden 11 Gebietskandidaten von Turf und dem Area Classifier geprüft:
- 5 Nachbargemeinden (Roßtal, Ammerndorf, Oberasbach, Cadolzburg, Stein) wurden korrekt abgewiesen (`REJECTED_SAME_ADMIN_LEVEL`).
- 5 externe Vororte (z. B. Weiherhof-Teile außerhalb, Gebersdorf, Großhabersdorf) wurden korrekt abgewiesen (`REJECTED_OUTSIDE`).
- 1 Relation (Zirndorf selbst) wurde korrekt abgewiesen (`REJECTED_TARGET_MUNICIPALITY`).
- **Ergebnis**: 0 unzulässige Gebiete übernommen. 100% QA-Konformität mit Phase 15.7a Area QA Policy.

---

## 4. Multi-Region-Katalog & Suche

Der Kandidatenkatalog (`tests/fixtures/multi-region-candidate-catalog.json`) belegt das reibungslose Zusammenspiel beider Bundesländer:

```text
Katalog-Übersicht (6 Datensätze):
1. Oberasbach (BY)       - 271 Straßen, 60 POIs, 0 Gebiete (Curated Golden Master)
2. Zirndorf (BY)         - 345 Straßen, 124 POIs, 0 Gebiete (OSM PBF Candidate)
3. Köln (NW)             - 4.628 Straßen, 4.453 POIs, 101 Gebiete (OSM PBF)
4. Olpe (NW)             - 461 Straßen, 114 POIs, 2 Gebiete (OSM PBF)
5. Siegen (NW)           - 1.176 Straßen, 426 POIs, 23 Gebiete (OSM PBF)
6. Wenden (NW)           - 460 Straßen, 37 POIs, 3 Gebiete (OSM PBF)
```

### 4.1 Suche & Netzwerkfreiheit
Die Suche über `CatalogDatasetProvider` arbeitet deterministisch und vollkommen offline:
- Suche nach `"Bayern"` liefert Oberasbach und Zirndorf.
- Suche nach `"Nordrhein-Westfalen"` liefert Köln, Olpe, Siegen und Wenden.
- Suche nach `"Zirndorf"` liefert Zirndorf.
- **Netzwerk-Audit**: 0 Aufrufe an Nominatim, 0 Aufrufe an Overpass.

---

## 5. Verifikation & Qualitätssicherung

Die Implementierung wurde durch automatische Tests und reale Browser-Runs abgesichert:

1. **Unit & Integration Suite**:
   - `tests/germany-dataset-infrastructure-tests.js`: 18/18 Tests PASS.
   - Gesamt-Testsuite: 36 Testdateien, 142/142 Tests PASS (~4,8s).
2. **Headless Chrome Browser Smoke Test (`--all`)**:
   - Wenden, Siegen und Köln erfolgreich installiert, geprüft und freie Runde gespielt.
   - 0 Overpass-, 0 Nominatim-Aufrufe.
3. **Headless Chrome Offline Smoke Test (`--offline`)**:
   - Olpe geladen, Service Worker aktiviert, Netzwerk offline gesetzt, Reload durchgeführt, freie Runde gestartet.
4. **Headless Chrome Update Smoke Test**:
   - Diff-Vorschau und Update von Version 2026.09.05 auf 2026.09.06 im Browser verifiziert.
5. **Format & Diff Hygiene**:
   - `git diff --check`: 0 Fehler, keine unerwünschten Artefakte.

