# Straßentrainer Dataset-Pipeline

Automatisierte, reproduzierbare und isolierte Pipeline zur Erzeugung, Validierung und Publikation von Trainingsdatensätzen aus OpenStreetMap-PBF-Dateien.

## Architektur

```
OpenStreetMap PBF
       ↓
   PREFLIGHT          (Osmium, PBF-Integrität, OSM-Timestamp, Manifest)
       ↓
    STAGING           (Isolierter temporärer Ordner)
       ↓
     BUILD            (Isolierte Node-Child-Prozesse per Dataset, Bounded Concurrency)
       ↓
   VALIDATE           (verifyPackageHash, validateCityPackage, validateCityData)
       ↓
      QA              (Area Containment/Hierarchy, Street QA, POI QA, Regression Guardrails)
       ↓
CANDIDATE CATALOG     (Validierung des Gesamtkatalogs inkl. geschütztem Oberasbach)
       ↓
  PUBLISH GATE        (Publish nur bei 100% PASS aller Pflichtkriterien)
       ↓
    PUBLISH           (Atomare Promotion mit Dateisystem-Rollback-Sicherung)
```

## Verwendung

```bash
# Gesamtes NRW-Manifest bauen & im Staging validieren (kein Publish auf data/)
node tools/dataset-pipeline/index.js \
  --pbf tools/dataset-builder/work/nordrhein-westfalen-latest.osm.pbf \
  --all \
  --no-publish

# Einzelnen Datensatz bauen & validieren
node tools/dataset-pipeline/index.js \
  --pbf tools/dataset-builder/work/nordrhein-westfalen-latest.osm.pbf \
  --dataset de-nw-siegen \
  --dry-run

# Vollständiger autorisierter Publish-Lauf
node tools/dataset-pipeline/index.js \
  --pbf tools/dataset-builder/work/nordrhein-westfalen-latest.osm.pbf \
  --all
```

## Optionen

- `--pbf <path>`: Pfad zur regionalen `.osm.pbf`-Datei (Pflicht).
- `--all`: Alle aktiven Datensätze des Manifests bauen.
- `--dataset <id>`: Nur den spezifizierten Datensatz bauen (z. B. `de-nw-olpe`).
- `--dry-run`: Führt alle Schritte bis zum Katalog durch, simuliert den Publish.
- `--no-publish`: Baut und prüft ins Staging, publiziert nicht.
- `--keep-staging`: Löscht das Staging-Verzeichnis nach dem Lauf nicht.
- `--jobs <n>`: Begrenzung der Parallelität (Standard: `1`).
- `--verbose`: Ausführliche Konsolenausgabe.
- `--report <path>`: Schreibt einen maschinenlesbaren JSON-Laufbericht.

## Sicherheitsregeln & Invarianten

1. **Oberasbach-Schutz**: Oberasbach ist ein handgeprüfter Golden Dataset und darf niemals automatisch aus PBF neu generiert, überschrieben oder verändert werden. Es bleibt jedoch stets Teil des Katalogs.
2. **Same Version Different Content**: Besitzt ein bereits publiziertes Dataset geänderten Inhalt (`contentHash`), muss die Paketversion zwingend erhöht sein. Identische Version bei neuem Hash blockiert den Publish (`SAME_VERSION_DIFFERENT_CONTENT`).
3. **Full Run Atomicity**: Schlägt bei `--all` auch nur ein einzelnes Target fehl, wird kein einziges Paket publiziert.
4. **Rollback-Sicherheit**: Tritt während der Promotion ein Fehler auf, wird der vorherige Dateizustand automatisch und vollständig wiederhergestellt.

