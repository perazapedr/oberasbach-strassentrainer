# OSM-PBF Dataset Builder (Phase 15.2)

Dieser Builder erzeugt das Olpe-Proof-of-Concept-Dataset aus einem lokalen Nordrhein-Westfalen-OSM-PBF. Er ist reines Build-/Entwicklungstooling. Die Web-App lädt nur das fertige JSON-Package und lädt, öffnet oder indiziert niemals PBF-Dateien.

## Systemvoraussetzungen

- Node.js 20 oder neuer
- `osmium-tool` 1.16 oder neuer; verifiziert mit 1.19.1 / libosmium 2.23.1
- ungefähr 3 GB freier Arbeitsspeicher für den vollständigen NRW-Lauf
- ungefähr 2 GB freier Plattenplatz für PBF und temporäre Extrakte

macOS mit Homebrew:

```bash
brew install osmium-tool
```

Debian/Ubuntu:

```bash
sudo apt-get install osmium-tool
```

Es gibt keine Builder-spezifischen npm-Abhängigkeiten. Der Builder verwendet die vorhandenen Projektmodule für Straßen-Normalisierung, POI-Registry, Validierung, Hashing und Turf-Geometrieoperationen. `package.json` ist ausschließlich dem Tooling zugeordnet und verändert die Browser-Abhängigkeiten nicht.

## PBF bereitstellen

Der Build funktioniert immer mit einem lokalen Pfad und benötigt während der Erzeugung keinen Downloadserver. Der aktuelle NRW-Extrakt kann außerhalb der App beispielsweise so bereitgestellt werden:

```bash
mkdir -p tools/dataset-builder/work
curl --fail --location \
  --output tools/dataset-builder/work/nordrhein-westfalen-latest.osm.pbf \
  https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf
```

`*.osm.pbf`, `work/`, `output/` und maschinenlesbare Build-Reports sind gezielt ignoriert. Nur die 1-KB-Testfixture ist als Ausnahme versionierbar.

## Olpe bauen

```bash
node tools/dataset-builder/index.js \
  --pbf tools/dataset-builder/work/nordrhein-westfalen-latest.osm.pbf \
  --municipality Olpe \
  --relation-id 163179 \
  --output data/cities/de-nw-olpe.json \
  --report tools/dataset-builder/reports/olpe-build.json
```

`--relation-id` ist optional. Ohne diese Option wählt der Builder eine eindeutige `boundary=administrative`, `admin_level=8`-Relation mit passendem Namen. Mehrdeutige Treffer brechen ab und verlangen die explizite Relation. Weitere Optionen:

- `--state` und `--country` setzen Package-Metadaten.
- `--verbose` zeigt die ausgeführten Osmium-Kommandos.
- `--keep-work` behält temporäre Grenz-, Extrakt- und GeoJSON-Dateien zur Diagnose.
- `--report` schreibt Counts, Laufzeit, Hash und Warnungen als JSON.

## Pipeline und räumliche Semantik

```text
regionaler PBF
→ administrative Relation auswählen
→ Relation und Referenzen mit Osmium auflösen
→ Polygon/MultiPolygon mit Osmium zusammensetzen
→ referenzvollständigen Municipality-Extrakt erzeugen
→ GeoJSON-Sequenz streamen
→ Straßen/POIs/Areas mit bestehenden Regeln klassifizieren
→ grenzschneidende Straßen an der echten Boundary clippen
→ normalisieren und deduplizieren
→ bestehenden City-Validator ausführen
→ Schema-1-Package bilden
→ bestehenden SHA-256-contentHash berechnen
→ bestehenden Package-Validator ausführen
```

Ways mit mindestens einem Punkt im Extraktionspolygon werden von Osmium vollständig übernommen. Deshalb clippt der Builder jede zulässige, benannte Straßengeometrie anschließend an der echten Municipality-Boundary. Vollständig außerhalb liegende Kandidaten werden verworfen. POI-Kandidaten dürfen zunächst aus der Osmium-Referenzvervollständigung stammen; der bestehende Validator entfernt vollständig außen liegende Objekte und dedupliziert sichere Node-/Flächen-Darstellungen.

Der Builder übernimmt exakt die sechs `highway`-Typen aus `osm-service.js` und klassifiziert POIs ausschließlich mit `poi-categories.js`. Alternative Namen stammen wie im Legacy-Pfad aus `official_name`, `alt_name`, `short_name` und `loc_name`. Zeitabhängige Package-Felder werden auf den PBF-Headerzeitpunkt gesetzt, sodass wiederholte Builds desselben PBF byte-identisch sind; der vorhandene Hash kanonisiert außerdem Listen und ignoriert nichtfachliche Metadaten.

## Tests

```bash
node tests/dataset-builder-tests.js
node tests/olpe-pbf-integration-tests.js
```

Die erste Suite verarbeitet die aus `mini-olpe.osm` erzeugte echte PBF-Testfixture und prüft Boundary-Auswahl, Polygon/MultiPolygon, Clipping, Straßen-Merge, Aliases, Node-/Way-/Relation-POIs, Area-Identitäten und Hash-Determinismus. Osmium muss dafür installiert sein. Die zweite Suite installiert das reale Olpe-Package über `StaticDatasetProvider`, den bestehenden Validator und IndexedDB, aktiviert Olpe, erzeugt Street-/POI-Targets und wertet eine freie Runde ohne Netzwerk aus.

## Einmaliger Legacy-Vergleich

Der folgende Lauf verwendet Live-Nominatim/Overpass und gehört ausdrücklich nicht zur automatischen Regression:

```bash
node tools/dataset-builder/download-legacy.js \
  --municipality Olpe \
  --relation-id 163179 \
  --output tools/dataset-builder/work/olpe-legacy-live.json

node tools/dataset-builder/compare.js \
  --pbf-package data/cities/de-nw-olpe.json \
  --pbf-build-report tools/dataset-builder/reports/olpe-build.json \
  --legacy-snapshot tools/dataset-builder/work/olpe-legacy-live.json \
  --output tools/dataset-builder/reports/olpe-comparison.md
```

Der JSON-Live-Snapshot bleibt unversioniert. Der kleine Markdown-Bericht ist reproduzierbar und versionierbar.

## Temporäre Daten aufräumen

Normale Builds verwenden ein Betriebssystem-Temp-Verzeichnis und entfernen es auch bei Fehlern. Nur `--keep-work` lässt dieses Verzeichnis absichtlich bestehen. Der manuell heruntergeladene PBF und Live-Snapshots liegen in `tools/dataset-builder/work/` und können bei Nichtgebrauch gelöscht werden; sie sind nicht Teil des Produkts.
