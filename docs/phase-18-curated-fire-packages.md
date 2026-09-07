# Phase 18 – Kuratierte Feuerwehr-Pakete (Curated Fire Training Packages)

Dieses Dokument beschreibt die Architektur, das deklarative Overlay-Modell, das Curation-Tool (`tools/dataset-curation`), die Rebase- und Update-Mechanismen sowie die browserbasierte Verifikation von kuratierten Feuerwehr-Paketen im Projekt **Straßentrainer Deutschland**.

---

## 1. Übersicht & Motivation

Während OSM-basierte Datenpakete (Phase 15–17) vollständige Geometrien für Kommunen und Landkreise liefern, erfordert die **praktische Feuerwehr-Ausbildung** gezielte fachliche Anpassungen:
- **Lokale Umbenennungen & Funkruf-Bezeichnungen**: Straßen müssen unter dem taktischen Namen bekannt sein (z. B. „SYNTHETIC Umbenannte Teststraße“).
- **Feuerwehr-Aliase**: Alternative Bezeichnungen oder Einsatzstichwort-Objektbezeichnungen (z. B. „SYNTHETIC Feuerwehr-Alias“), die im Quiz als gültige Such- und Antwortbegriffe dienen.
- **Ausschluss nicht relevanter Straßen**: Privatwege, Forstwege oder Fußgängerzonen, die für Einsatzfahrzeuge irrelevant sind, werden deaktiviert (`active: false`, `quizEligible: false`), ohne die Geometrie für den Kartengebietskontext zu zerstören.
- **Spezifische Gefahren- und Übungs-POIs**: Hinzufügen, Editieren oder Entfernen von Feuerwehr-relevanten POIs (Gerätehäuser, Einsatzzentralen, Gefahrgutbetriebe, Brandmeldeanlagen).
- **Kuratierte Wach- und Einsatzgebiete (`response_area`)**: Vordefinierte Ausrückebereiche (`kind: "response_area"`, `source: "curated"`), die direkt im Gebietswähler zur Verfügung stehen.

**Kernanforderung**: Kuratierte Daten dürfen niemals als monolithische, unversionierte Forks von Rohdaten existieren. Sie werden als **deklarative Overlay-Dateien** gepflegt und deterministisch auf eine definierte Basis-Version (`baseVersion`, `baseContentHash`) angewendet.

---

## 2. Deklaratives Curation-Overlay-Modell

Ein Overlay ist eine schlanke JSON-Datei, die die Differenzen zur OSM- oder Basis-Version deklariert:

```json
{
  "schemaVersion": 1,
  "datasetId": "de-nw-kreis-olpe",
  "baseDatasetId": "de-nw-kreis-olpe",
  "baseVersion": "2026.09.07",
  "baseContentHash": "sha256:1c076dc3988e06c6019b982a6521196b83830d2b7ab0b110f438aa1352be7455",
  "curatedVersion": "1.0.0",
  "curatedAt": "2026-09-07T00:00:00.000Z",
  "title": "Kreis Olpe – Kuratiertes Feuerwehr-Trainingspaket",
  "sourceLabel": "Freiwillige Feuerwehr Kreis Olpe",
  "changes": [
    {
      "op": "street.rename",
      "streetId": "osm-relation-1891506:osm-relation-160880:street-abt-luke-strasse-1b2o3ss",
      "name": "SYNTHETIC Umbenannte Teststraße"
    },
    {
      "op": "street.alias.add",
      "streetId": "osm-relation-1891506:osm-relation-160880:street-abt-maurus-kaufmann-weg-1yfiyx6",
      "alias": "SYNTHETIC Feuerwehr-Alias"
    },
    {
      "op": "street.disable",
      "streetId": "osm-relation-1891506:osm-relation-160880:street-adenauerstrasse-1ltltqd"
    },
    {
      "op": "poi.add",
      "value": {
        "id": "curated-synthetic-poi-added",
        "name": "SYNTHETIC Added POI",
        "category": "public_building",
        "position": { "lat": 51.030, "lon": 7.842 },
        "geometry": null,
        "source": "synthetic-curation"
      }
    },
    {
      "op": "poi.edit",
      "poiId": "osm-relation-1891506:poi:node-262442795",
      "patch": { "name": "SYNTHETIC Edited Hotel" }
    },
    {
      "op": "poi.remove",
      "poiId": "osm-relation-1891506:poi:node-269751037"
    },
    {
      "op": "poi.category",
      "poiId": "osm-relation-1891506:poi:node-269751040",
      "category": "public_building"
    },
    {
      "op": "area.response.add",
      "value": {
        "id": "curated-response-synthetic-olpe",
        "name": "SYNTHETIC Curated Response Area",
        "parentId": "osm-relation-163179",
        "geometry": {
          "type": "Polygon",
          "coordinates": [[[7.835, 51.025], [7.850, 51.025], [7.850, 51.035], [7.835, 51.035], [7.835, 51.025]]]
        }
      }
    }
  ]
}
```

### Unterstützte Operationen
| Operation | Ziel | Parameter | Beschreibung |
|:---|:---|:---|:---|
| `street.rename` | Straße | `streetId`, `name` | Ändert den primären Anzeigenamen der Straße |
| `street.alias.add` | Straße | `streetId`, `alias` | Fügt einen alternativen Such- und Erkennungsalias hinzu |
| `street.alias.remove`| Straße | `streetId`, `alias` | Entfernt einen fehlerhaften oder irreleitenden Alias |
| `street.disable` | Straße | `streetId` | Setzt `active: false` und `quizEligible: false` |
| `street.enable` | Straße | `streetId` | Aktiviert eine zuvor deaktivierte Straße wieder |
| `poi.add` | POI | `value: { id, name, category, position, ... }` | Ergänzt ein neues feuerwehrrelevantes Ziel |
| `poi.edit` | POI | `poiId`, `patch: { name, category, ... }` | Modifiziert Eigenschaften eines existierenden POIs |
| `poi.remove` | POI | `poiId` | Entfernt einen irrelevanten POI vollständig |
| `poi.category` | POI | `poiId`, `category` | Ändert die taktische Zielkategorie (z. B. `public_building`) |
| `area.response.add` | Area | `value: { id, name, geometry, parentId, ... }` | Registriert ein kuratiertes Einsatzgebiet (`response_area`) |
| `area.response.remove`| Area| `areaId` | Entfernt ein kuratiertes Einsatzgebiet |

---

## 3. Composer & Rebase-Architektur (`tools/dataset-curation`)

Das Werkzeug `tools/dataset-curation` stellt sowohl eine Node.js-API als auch ein CLI-Interface bereit:

### 1. Komposition (`composeCuratedPackage`)
1. Überprüfung der Basispaket-Integrität und des `baseContentHash`.
2. Sukzessive, atomare Anwendung der deklarativen Operationen.
3. Neuberechnung der Bounding-Boxen und Counts (`streetCount`, `poiCount`, `areaCount`).
4. Setzen von `package.type = "curated"` und Übernahme der Metadaten (`sourceLabel`, `curatedVersion`).
5. Validierung gegen das Gesamtschema (`city-data-validator.js`).
6. Deterministische SHA-256-Prüfsummenberechnung (`computePackageHash`).

### 2. Rebase bei Basis-Updates (`rebaseOverlay`)
Wenn die OpenStreetMap-Rohdatenbasis aktualisiert wird (z. B. `2026.09.07` → `2026.10.01`):
1. Das Werkzeug prüft, ob die in den Operationen referenzierten `streetId`s und `poiId`s in der neuen Basis noch existieren.
2. Wenn eine Straße in OSM gelöscht oder umbenannt wurde, wird ein präziser **Rebase-Konflikt** gemeldet (`STREET_NOT_FOUND`, `POI_NOT_FOUND`).
3. Bei erfolgreichem Rebase werden `baseVersion` und `baseContentHash` im Overlay aktualisiert.

---

## 4. Laufzeit-Integration & Target-Filterung

Damit deaktivierte Straßen (`active: false`, `quizEligible: false`) im Quiz nicht abgefragt werden, jedoch im Kartenkontext und bei der Gebietsberechnung erhalten bleiben:
- **`targets.js` (`prepareStreetTargets`)**:
  Überträgt `active: rawStreet.active !== false` und `quizEligible: rawStreet.quizEligible !== false` deterministisch auf das interne Target-Modell.
- **`app.js` (`getEligibleTargetsByType`)**:
  Filtert beim Ziehen der Quiz-Fragen strikt nach `target.active && target.quizEligible`.
- **`window.STRASSENTRAINER_DEBUG.getEligibleTargets(type)`**:
  Ermöglicht der Testsuite und Debug-Tools die präzise Inspektion der tatsächlich qualifizierten Quiz-Ziele.
- **Gebietsmitgliedschaft (`computeMembership`)**:
  Kuratierte Einsatzgebiete filtern Straßen und POIs geometrisch. Deaktivierte Straßen innerhalb des Polygons bleiben für Auswertungen erhalten, werden aber vom Spielbetrieb ausgeschlossen.

---

## 5. Verifikation & Qualitätstore (Exit Criteria)

Die Implementierung wurde über eine lückenlose Testmatrix abgesichert:

1. **Unit- & Integrations-Tests (`tests/dataset-curation-tests.js`)**:
   - 12 Tests für Compose, Operations, Rebase, Konflikte, Hash-Integrität und Schema-Validierung (12/12 PASS).
2. **Vollständige Gesamttests (`node --test tests/*.js`)**:
   - 186/186 Tests bestanden, inklusive Oberasbach Golden Master (`sha256:1a085434...`).
3. **Headless Chrome CDP Smoke Suite (`scripts/browser-publisher-repository-test.js`)**:
   - Bereitstellung eines dynamischen, isolierten Test-Repositories mit synthetischem Kreis-Olpe-Paket (`curated.json`).
   - Download und atomare Installation in IndexedDB über Catalog-Provider und immutable URL.
   - **Curated Feature-Check**: Verifikation von Umbenennung, Alias, Ausschluss deaktivierter Straßen aus aktiven Quiz-Targets, POI add/edit/remove und kuratierter Response Area.
   - **Echte CDP-Spielrunde Online**: Auswahl der kuratierten Response Area, nativer Klick mit `Input.dispatchMouseEvent`, endliche Distanz- und Punkteberechnung.
   - **Offline-Fähigkeit**: Netzwerktrennung, Page-Reload, erneute Spielrunde aus IndexedDB mit **0 externen Requests** (Catalog: 0, Nominatim: 0, Overpass: 0).
   - **Atomares v1 → v2 Update**: Publikation von Version 1.1.0 im Repository, In-App Update-Erkennung, atomare Installation im Browser, Erhalt lokaler Wachgebiete und Spielstatistiken.

