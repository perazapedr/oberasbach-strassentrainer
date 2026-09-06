# Phase 16.2 – Dataset Publishing & Statisches Dataset-Repository

Dieses Dokument beschreibt die Architektur, das Veröffentlichungswerkzeug (`tools/dataset-publisher`), das Repository-Layout und die Verifikation des statischen Dataset-Repositorys im Projekt **Straßentrainer Deutschland**.

---

## 1. Übersicht & Zielsetzung

Mit Phase 16.2 wurde die Bereitstellung von Trainingsdatenpaketen auf ein **vollwertiges, statisch hostbares Dataset-Repository** (`dist/dataset-repository/`) umgestellt:
- **Entkopplung**: Die Datenpakete liegen nicht mehr unstrukturiert im Quellcode-Repository, sondern werden über ein klar definiertes, statisches Layout bereitgestellt.
- **On-Demand-Auslieferung**: Die Webanwendung lädt den kompakten `catalog.json` (< 10 KB) und lädt Datensätze erst bei Benutzerinstallation gezielt herunter (kein Megadownload).
- **Transportkompression**: Vorkomprimierte `.gz` (Level 9) und `.br` (Quality 11) Artefakte liegen neben jedem Paket bereit für CDNs, Nginx und Cloud-Speicher.
- **Integrität & Manifeste**: Jedes Paket wird von einem `manifest.json` begleitet, das kryptografische SHA-256-Hashes und Dateigrößen dokumentiert.
- **100 % Zero-Network-Garantie**: Installierte Datensätze laufen nach dem Download vollständig offline aus IndexedDB. Zur Laufzeit erfolgen **0 Anfragen** an Nominatim oder Overpass.

---

## 2. Statisches Repository-Layout (`dist/dataset-repository/`)

```text
dist/dataset-repository/
├── catalog.json                                # Globaler Katalog aller verfügbaren Datensätze (Schema 1)
└── datasets/
    ├── de-oberasbach-fire-training/            # Golden Master Oberasbach (Curated)
    │   ├── package.json                        # Vollständiges Datenpaket (573 KB raw)
    │   ├── package.json.gz                     # Precompressed Gzip L9 (57,5 KB, -90,0 %)
    │   ├── package.json.br                     # Precompressed Brotli Q11 (41,6 KB, -92,7 %)
    │   └── manifest.json                       # Metadaten, SHA-256 Hashes, Dateigrößen
    ├── de-by-zirndorf/                         # Zirndorf (OSM PBF)
    │   ├── package.json                        # 911 KB raw
    │   ├── package.json.gz                     # 95,5 KB (-89,5 %)
    │   ├── package.json.br                     # 66,2 KB (-92,7 %)
    │   └── manifest.json
    ├── de-nw-wenden/                           # Wenden (OSM PBF)
    │   ├── package.json                        # 987 KB raw
    │   ├── package.json.gz                     # 102,3 KB (-89,6 %)
    │   ├── package.json.br                     # 70,9 KB (-92,8 %)
    │   └── manifest.json
    ├── de-nw-olpe/                             # Olpe (OSM PBF)
    │   ├── package.json                        # 1,33 MB raw
    │   ├── package.json.gz                     # 137,8 KB (-89,6 %)
    │   ├── package.json.br                     # 95,0 KB (-92,8 %)
    │   └── manifest.json
    ├── de-nw-siegen/                           # Siegen (OSM PBF)
    │   ├── package.json                        # 4,18 MB raw
    │   ├── package.json.gz                     # 437,3 KB (-89,5 %)
    │   ├── package.json.br                     # 284,8 KB (-93,2 %)
    │   └── manifest.json
    └── de-nw-koeln/                            # Köln (OSM PBF - Großstadt)
        ├── package.json                        # 22,82 MB raw
        ├── package.json.gz                     # 2.450 KB (-89,3 %)
        ├── package.json.br                     # 1.455 KB (-93,6 %)
        └── manifest.json
```

---

## 3. Publisher-Tool (`tools/dataset-publisher/`)

Das Publisher-Werkzeug automatisiert die Erstellung und Verifikation des statischen Repositorys:

### 3.1 Aufruf & Parameter

```bash
# Vollständiges Publishing aller verifizierten Städte mit Pre-Compression
node tools/dataset-publisher/index.js

# Optionen:
#   --source <dir>      Quellverzeichnis mit Datenpaketen (Standard: data/cities)
#   --output <dir>      Zielverzeichnis des Repositorys (Standard: dist/dataset-repository)
#   --include <file>    Zusätzliches Paket zur Veröffentlichung einbinden (z. B. Fixtures/Kandidaten)
#   --dry-run           Führt alle QA-Validierungen durch, ohne das Zielverzeichnis zu schreiben
#   --no-compress       Überspringt Gzip/Brotli Pre-Compression (beschleunigt Tests)
```

### 3.2 Quality Gates & Sicherheitsarchitektur

1. **Paket-Validierung vor Promotion**:
   - `validator.validateCityPackage(pkg)`: Strikte Einhaltung des CityPackage-Schemas.
   - `validator.validateCityData(pkg)`: Vollständige Validierung von Straßen-, POI- und Gebietsgeometrien.
   - `validator.verifyPackageHash(pkg)`: Verifikation der kryptografischen SHA-256-Integrität.
   - Pakete mit Fehlern oder Hash-Diskrepanzen brechen den Publish-Vorgang sofort ab (`PACKAGE_VALIDATION_FAILED` / `HASH_VERIFICATION_FAILED`).

2. **Atomare Promotion & Rollback**:
   - Alle Artefakte werden zunächst in ein isoliertes temporäres Staging-Verzeichnis (`.tmp-dataset-repository-<runId>`) geschrieben.
   - Vorhandene Repositories werden gesichert.
   - Der Verzeichnistausch erfolgt atomar (`fs.renameSync`).
   - Bei unvorhergesehenen I/O-Fehlern wird das vorherige Repository nahtlos wiederhergestellt.

3. **Path-Traversal-Schutz**:
   - Dataset-IDs müssen strikt `^[a-z0-9][a-z0-9-_.]*$` entsprechen.
   - Relative Pfade werden mit `path.relative` gegen das Basisverzeichnis geprüft; Ausbrüche (`..`, absolute Pfade) werden hart abgewiesen.

4. **Golden Master Schutz**:
   - Oberasbach (`de-oberasbach-fire-training` / `oberasbach`) bleibt deterministisch an Position 0 im Katalog.
   - 271 Straßen, 60 POIs, 0 Areas, unveränderter Hash `sha256:1a085434...`.

---

## 4. Manifest-Format (`manifest.json`)

Jeder Datensatz enthält ein eigenes maschinenlesbares Manifest:

```json
{
  "schemaVersion": 1,
  "datasetId": "de-nw-wenden",
  "name": "Wenden",
  "displayName": "Wenden",
  "version": "2026.09.05",
  "contentHash": "sha256:a5e0edb8deb7e3cee8e7e0b0864e7e533c44ed76b5a1dc319526ff66149be6f4",
  "publishedAt": "2026-09-06T21:23:06.199Z",
  "counts": {
    "streetCount": 460,
    "poiCount": 37,
    "areaCount": 3
  },
  "files": {
    "package": {
      "path": "package.json",
      "sizeBytes": 987422,
      "sha256": "d628f963325f26541c4c4af37577b7586a94415b6d24ee17da3fca445202da35"
    },
    "gzip": {
      "path": "package.json.gz",
      "sizeBytes": 102275,
      "sha256": "9e5defabda3282b2a82ef1bc832208cd4bf12fd5a95555562c6483711e8593f4"
    },
    "brotli": {
      "path": "package.json.br",
      "sizeBytes": 70901,
      "sha256": "a0a4ffa75e5e86e17eb638b36f2b43a8a69484b058d77389fb08b691c4eb5287"
    }
  }
}
```

---

## 5. Browser-Integration & Headless-Chrome-Verifikation (CDP)

Die Ende-zu-Ende-Funktionalität wurde mit `scripts/browser-publisher-repository-test.js` in einer realen Headless-Chrome-Instanz (Chrome 152 via Chrome DevTools Protocol) verifiziert:

| Testfall | Ablauf / Szenario | Ergebnis | Verifikation |
| :--- | :--- | :---: | :--- |
| **Katalog-Laden** | Fetch `dist/dataset-repository/catalog.json` | **PASS** | 6 Datensätze geladen, Schema 1 konform |
| **Wenden-Installation** | On-Demand Download aus `datasets/de-nw-wenden/package.json`, Validierung, IDB-Speicherung, Spielstart | **PASS** | 460 Straßen, 37 POIs, Quiz-Runde aktiv, Score berechnet |
| **Köln-Installation** | Großstadt-Download (22,8 MB raw / ~2,4 MB gzip), Validierung, IDB-Speicherung, Spielstart | **PASS** | 4.628 Straßen, 4.453 POIs, 101 Areas, Spielstart in 260 ms |
| **Zirndorf-Installation** | Bayern OSM-Kandidat Download, Validierung, IDB-Speicherung, Spielstart | **PASS** | 345 Straßen, 124 POIs, Quiz-Runde aktiv |
| **Zero-Network Audit** | Überwachung aller Netzwerkanfragen während Installation & Spiel aller 3 Städte | **PASS** | **0 Anfragen** an `nominatim.openstreetmap.org`, **0 Anfragen** an `overpass-api.de` |
| **Offline-Reload** | `Network.emulateNetworkConditions({ offline: true })`, Browser-Reload, Zirndorf aus IDB laden, Spielen | **PASS** | Spiel lädt offline aus IndexedDB, Quiz-Frage erscheint, Rundenablauf offline |
| **Update-Erkennung** | Katalogversion erhöht (`2026.09.99`), App vergleicht IDB-Version mit Katalog | **PASS** | Update wird erkannt, Update-Möglichkeit gemeldet |
| **Integritätsschutz** | Manipuliertes Paket mit verändertem Straßeninhalt bei altem Hash im Repository | **PASS** | `verifyPackageHash` schlägt fehl (`mismatch`), manipuliertes Paket abgewiesen |

---

## 6. Exit Gate 16.2 Checklist

- [x] Publisher-Tool `tools/dataset-publisher/index.js` vollständig implementiert.
- [x] Statisches Repository-Layout unter `dist/dataset-repository/` aufgebaut (`catalog.json`, `datasets/<id>/package.json`, `manifest.json`, `.gz`, `.br`).
- [x] Strikte Validierung aller Pakete vor Veröffentlichung (Quality Gate).
- [x] Atomare Promotion mit Staging und Rollback.
- [x] Path-Traversal-Schutz implementiert und getestet.
- [x] Unit- & Integrationstests in `tests/dataset-publisher-tests.js` (5/5 PASS).
- [x] Browser-E2E-Tests in Headless Chrome via CDP (`scripts/browser-publisher-repository-test.js`) (Wenden, Köln, Zirndorf, Offline, Update, Integrität: 100 % PASS).
- [x] Golden Master Oberasbach 100 % unangetastet.
- [x] Game-Engine, Timer, Scoring unberührt.
