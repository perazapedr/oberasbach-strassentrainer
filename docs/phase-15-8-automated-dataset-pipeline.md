# Phase 15.8: Automatisierte Dataset-Pipeline NRW

## 1. Übersicht und Zielsetzung

Mit Phase 15.8 wird die Erzeugung, Validierung, Qualitätssicherung und Publikation kommunaler Trainingsdatensätze aus OpenStreetMap-PBF-Dateien vollständig automatisiert. Bislang manuell auszuführende Einzelschritte (`dataset-builder`, `catalog-builder`, Validierung, Hashing, Prüfberichte) sind nun in einer deterministischen, atomaren und rollback-fähigen End-to-End-Pipeline gebündelt.

Zentrale Sicherheitsregel:
> **Kein fehlerhaftes Dataset darf automatisch in den offiziellen Datenbestand gelangen. Ein einzelner Pflichtfehler führt zum sofortigen Abbruch (`PUBLISH BLOCKED`).**

---

## 2. Architektur der Pipeline

```
OpenStreetMap PBF
       ↓
   PREFLIGHT          (Osmium, PBF-Integrität, OSM-Timestamp, Manifest)
       ↓
    STAGING           (Isolierter temporärer Ordner <tmp>/strassentrainer-pipeline/<runId>/)
       ↓
     BUILD            (Isolierte Node-Child-Prozesse per Dataset, Bounded Concurrency)
       ↓
   VALIDATE           (verifyPackageHash, validateCityPackage, validateCityData)
       ↓
      QA              (Area Containment/Hierarchy, Street QA, POI QA, Regression Guardrails)
       ↓
CANDIDATE CATALOG     (Validierung des Gesamtkatalogs inkl. geschütztem Golden Oberasbach)
       ↓
  PUBLISH GATE        (Publish nur bei 100% PASS aller Pflichtkriterien)
       ↓
    PUBLISH           (Atomare Promotion mit Dateisystem-Rollback-Sicherung)
```

---

## 3. Kernkomponenten und Dateien

| Datei | Zweck |
|---|---|
| `tools/dataset-pipeline/index.js` | CLI-Entrypoint, Signal-Handling (SIGINT/SIGTERM), Ablaufsteuerung |
| `tools/dataset-pipeline/datasets.json` | Deklaratives NRW-Manifest (Olpe, Wenden, Siegen, Köln) |
| `tools/dataset-pipeline/qa-policy.json` | Deklarative QA-Grenzwerte (Containment, Drop-Ratios, keine Namens-Hardcodes) |
| `tools/dataset-pipeline/published-state.json` | Formales Modell des publizierten Baseline-Zustands (Versionen, Hashes) |
| `tools/dataset-pipeline/lib/manifest.js` | Parser, Schemaprüfung, Oberasbach-Schutz, Filterung |
| `tools/dataset-pipeline/lib/preflight.js` | Prüfung von Osmium, PBF-Existenz, Header-Timestamp |
| `tools/dataset-pipeline/lib/qa.js` | Validierung, Area Containment (15.7a), Drop-Ratios, Invariantenprüfung |
| `tools/dataset-pipeline/lib/staging.js` | Temporäre Run-Isolation unter `/tmp/strassentrainer-pipeline/` |
| `tools/dataset-pipeline/lib/publish.js` | Atomare Promotion (`.tmp` → Rename), Rollback-Wiederherstellung |
| `tools/dataset-pipeline/lib/report.js` | JSON-Laufberichte und formatierte Terminal-Zusammenfassung |
| `tests/dataset-pipeline-tests.js` | Vollständige Testsuite (27 Unit- und Integrationstests) |

---

## 4. Sicherheitsregeln und Invarianten

### 4.1 Oberasbach-Schutzregel
Oberasbach ist das handgeprüfte *Curated Golden Reference Dataset*. Die Pipeline verbietet:
- Oberasbach als PBF-Build-Target im Manifest zu definieren (`OBERASBACH_PROTECTED`).
- Oberasbach automatisch aus PBF neu zu erzeugen oder zu normalisieren.
- Oberasbach neu zu hashen oder in `data/cities/` zu überschreiben.

Im finalen Kandidaten-Katalog (`data/catalog.json`) bleibt Oberasbach jedoch dauerhaft als erster Eintrag erhalten.

### 4.2 Version / Hash Invariante (`SAME_VERSION_DIFFERENT_CONTENT`)
Für alle bereits publizierten Datensätze gilt:
- Gleiche `datasetId` + gleicher `contentHash` → Status `UNCHANGED`.
- Gleiche `datasetId` + geänderter `contentHash` bei gleicher `version` → **STRIKT VERBOTEN** (`SAME_VERSION_DIFFERENT_CONTENT`), Publish blockiert.
- Geänderter `contentHash` erfordert zwingend eine höhere SemVer/CalVer-Version → Status `CHANGED`.

### 4.3 Vollständige Atomarität & Rollback
- Bei `--all` werden entweder **alle** Targets erfolgreich promoviert oder **keines**.
- Tritt während des Schreibens von Paketen, dem Katalog oder `published-state.json` ein Fehler auf, greift der Rollback-Mechanismus und stellt alle vorherigen Dateiinhalte bitgenau wieder her.

---

## 5. Messwerte des realen NRW-Pipeline-Laufs

Ausgeführt mit `nordrhein-westfalen-latest.osm.pbf` (911 MB, Timestamp `2026-09-05T20:22:06.000Z`):

| Dataset | Status | Klassifikation | Dauer | Peak RSS | Straßen | POIs | Areas | SHA-256 Hash |
|---|---|---|---:|---:|---:|---:|---:|---|
| **Olpe** | PASS | UNCHANGED | 16.14 s | 102.4 MB | 461 | 114 | 2 | `sha256:6c89d676e5...` |
| **Wenden** | PASS | UNCHANGED | 15.98 s | 135.6 MB | 460 | 37 | 3 | `sha256:a5e0edb8de...` |
| **Siegen** | PASS | UNCHANGED | 23.87 s | 374.8 MB | 1.176 | 426 | 23 | `sha256:f3d357f23c...` |
| **Köln** | PASS | UNCHANGED | 161.46 s | 763.0 MB | 4.628 | 4.453 | 101 | `sha256:82533736b9...` |

- **Gesamtlaufzeit**: 227.26 Sekunden (~3.8 Minuten)
- **Preflight, Build, QA, Candidate Catalog**: 100% PASS
- **Oberasbach**: Unverändert im Katalog erhalten (271 Straßen, 60 POIs, 0 Areas)

