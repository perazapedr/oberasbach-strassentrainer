# Leitfaden zur Erstellung und Pflege kuratierter Feuerwehr-Pakete

Dieser Leitfaden richtet sich an Feuerwehr-Ausbilder, Kreisbrandmeister und Maintainer des **Straßentrainers Deutschland**. Er erklärt Schritt für Schritt, wie deklarative Feuerwehr-Overlays erstellt, auf Basisdatensätze angewendet, gegen Schemas geprüft und über das statische Dataset-Repository veröffentlicht werden.

---

## 1. Grundprinzip: Warum deklarative Overlays?

Anstatt ganze JSON-Dateien manuell zu kopieren und zu verändern (was bei der nächsten OpenStreetMap-Aktualisierung zu unlösbaren Merge-Konflikten führt), speichert der Straßentrainer fachliche Feuerwehr-Anpassungen als **deklarative Overlay-Dateien**.

Ein Overlay dokumentiert exakt:
- Welche Basis-Version als Ausgangspunkt diente (`baseVersion`, `baseContentHash`).
- Welche konkreten Operationen (`changes`) durchgeführt werden.
- Welche Versionsnummer das resultierende kuratierte Paket erhält (`curatedVersion`).

---

## 2. Erstellung eines Overlays (`overlay.json`)

Erstelle eine JSON-Datei, z. B. `my-city-overlay.json`:

```json
{
  "schemaVersion": 1,
  "datasetId": "de-nw-kreis-olpe",
  "baseDatasetId": "de-nw-kreis-olpe",
  "baseVersion": "2026.09.07",
  "baseContentHash": "sha256:1c076dc3...",
  "curatedVersion": "1.0.0",
  "curatedAt": "2026-09-07T12:00:00.000Z",
  "title": "Feuerwehr Kreis Olpe – Ausbildungsstand",
  "sourceLabel": "KFV Olpe Fachbereich Ausbildung",
  "changes": [
    {
      "op": "street.rename",
      "streetId": "osm-relation-1891506:osm-relation-160880:street-abt-luke-strasse-1b2o3ss",
      "name": "Abt-Luke-Straße (Feuerwehrzufahrt Süd)"
    },
    {
      "op": "street.alias.add",
      "streetId": "osm-relation-1891506:osm-relation-160880:street-abt-maurus-kaufmann-weg-1yfiyx6",
      "alias": "Kaufmannsweg"
    },
    {
      "op": "street.disable",
      "streetId": "osm-relation-1891506:osm-relation-160880:street-adenauerstrasse-1ltltqd"
    },
    {
      "op": "poi.add",
      "value": {
        "id": "feuerwehr-geraetehaus-olpe",
        "name": "Feuerwehrhaus Olpe Löschzug 1",
        "category": "fire_station",
        "subcategory": "Feuerwehrgerätehaus",
        "position": { "lat": 51.0289, "lon": 7.8441 }
      }
    },
    {
      "op": "area.response.add",
      "value": {
        "id": "ausrueckebereich-lz1",
        "name": "Ausrückebereich LZ 1 (Stadtkern)",
        "parentId": "osm-relation-163179",
        "geometry": {
          "type": "Polygon",
          "coordinates": [[[7.83, 51.02], [7.86, 51.02], [7.86, 51.04], [7.83, 51.04], [7.83, 51.02]]]
        }
      }
    }
  ]
}
```

---

## 3. Kompilierung des kuratierten Pakets (`compose`)

Mit dem Tool `tools/dataset-curation` wird das Overlay auf die Basis angewendet:

```bash
node tools/dataset-curation/index.js compose \
  --base data/cities/de-nw-kreis-olpe.json \
  --overlay my-city-overlay.json \
  --out staging/curated-kreis-olpe.json
```

Das Tool führt automatisch folgende Schritte aus:
1. Prüft, ob `baseContentHash` im Overlay mit der Basisdatei übereinstimmt.
2. Wendet alle Operationen der Reihe nach an.
3. Berechnet die Zähler (`streetCount`, `poiCount`, `areaCount`) und Bounding Boxes neu.
4. Validiert das Ergebnis gegen das Gesamtschema `schemas/strassentrainer-dataset.schema.json`.
5. Berechnet die neue kanonische SHA-256-Prüfsumme (`contentHash`).

---

## 4. Rebase bei Aktualisierung der Rohdatenbasis (`rebase`)

Wenn ein neues Basispaket aus OpenStreetMap generiert wird (z. B. Quartals-Update):

```bash
node tools/dataset-curation/index.js rebase \
  --overlay my-city-overlay.json \
  --new-base data/cities/de-nw-kreis-olpe-2026-10.json \
  --out my-city-overlay-v2.json
```

### Konflikterkennung
Falls eine in den `changes` referenzierte Straße oder ein POI in der neuen OSM-Basis gelöscht oder umbenannt wurde, bricht der Rebase mit einer detaillierten Konfliktmeldung ab:
- `STREET_NOT_FOUND`: Die ID existiert in der neuen Basis nicht mehr.
- `TARGET_ALREADY_EXISTS`: Ein hinzuzufügender POI oder Alias kollidiert mit neuen Daten.

Der Kurator kann das Overlay anpassen und den Rebase erneut ausführen.

---

## 5. Veröffentlichung im Dataset-Repository

Um das fertige kuratierte Paket für die Webanwendung bereitzustellen:

```bash
# 1. Paket in das Staging-Verzeichnis für den Publisher legen
mkdir -p staging/datasets
cp staging/curated-kreis-olpe.json staging/datasets/

# 2. Dataset-Publisher ausführen
node tools/dataset-publisher/index.js \
  --source staging/datasets \
  --output dist/dataset-repository \
  --precompress
```

Der Publisher erzeugt:
- Ein immutable Versionsverzeichnis: `dist/dataset-repository/datasets/de-nw-kreis-olpe/<version>/<hash>/package.json`
- Optimierte Kompressionsartefakte (`.gz` Level 9 und `.br` Quality 11)
- `manifest.json` mit kryptografischer Prüfsumme
- Eintrag im globalen `catalog.json` mit `package.type: "curated"`

---

## 6. Überprüfung im Browser

1. Webanwendung im Browser öffnen.
2. `Katalog durchsuchen` wählen.
3. Nach dem kuratierten Paket suchen (gekennzeichnet als `Kuriert`).
4. Installieren – die Daten werden in IndexedDB gespeichert und stehen **vollständig offline** zur Verfügung.
5. Im Gebietswähler das kuratierte Wachgebiet (`response_area`) wählen und das Quiz starten.

