# Straßentrainer – Offizieller Dataset Package Contract (Schema 1)

Dieser Vertrag definiert die verbindliche Schnittstelle zwischen Dataset-Erzeugern (z. B. dem OSM-PBF Dataset Builder) und der Straßentrainer-Web-App (DatasetProvider, Validator, Storage, Game Engine).

---

## 1. Zweck

Der Package Contract entkoppelt die Erzeugung von Trainingsdaten von deren Konsum:
- **Builder-Freiheit**: Ein Builder kann in jeder Sprache und Technologie (z. B. Node.js mit Osmium, Rust, Python) implementiert oder umgebaut werden.
- **App-Stabilität**: Die Web-App verarbeitet Datensätze rein über diesen stabilen Vertrag ohne Kenntnis von PBF, Live-Overpass, Geofabrik oder internen Builder-Strukturen.
- **Garantie**: Jedes Datenpaket, das diesen Contract erfüllt, ist in der Web-App ohne Netzwerkzugriff installier- und direkt spielbar.

---

## 2. Schema-Version

- Das aktuelle normative Schema ist **`schemaVersion: 1`**.
- Die Schema-Version bezeichnet die **strukturelle Syntax und semantische Struktur** des JSON-Formats.
- **Stabilität**: Feldänderungen innerhalb von Schema 1 sind strikt abwärtskompatibel zu halten. Neue optionale Metadatenfelder dürfen hinzukommen. Eine Erhöhung auf `schemaVersion: 2` ist ausschließlich für nicht rückwärtskompatible strukturelle Brechungen reserviert.

---

## 3. Vollständiges Referenz-Beispiel

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-09-06T12:00:00.000Z",
  "package": {
    "id": "de-nw-musterstadt",
    "type": "osm",
    "datasetKind": "municipality",
    "version": "2026.09.06",
    "title": "Musterstadt – Offizielles Trainingspaket",
    "createdAt": "2026-09-06T12:00:00.000Z",
    "updatedAt": "2026-09-06T12:00:00.000Z",
    "source": "osm-pbf",
    "verification": {
      "status": "unverified"
    },
    "contentHash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "city": {
    "id": "osm-relation-99999",
    "name": "Musterstadt",
    "displayName": "Musterstadt",
    "district": "Musterkreis",
    "state": "Nordrhein-Westfalen",
    "country": "Deutschland",
    "postalCodes": ["12345"],
    "osmType": "relation",
    "osmId": 99999,
    "adminLevel": 8,
    "officialMunicipalityKey": "05999999",
    "bounds": {
      "south": 51.0000,
      "west": 7.0000,
      "north": 51.0500,
      "east": 7.0500
    },
    "center": {
      "lat": 51.0250,
      "lon": 7.0250
    },
    "defaultZoom": 13,
    "streetCount": 1,
    "poiCount": 1,
    "hasAreas": true,
    "areaCount": 1
  },
  "boundary": {
    "type": "Polygon",
    "coordinates": [
      [
        [7.0000, 51.0000],
        [7.0500, 51.0000],
        [7.0500, 51.0500],
        [7.0000, 51.0500],
        [7.0000, 51.0000]
      ]
    ]
  },
  "streets": [
    {
      "id": "osm-relation-99999:street-hauptstrasse-a1b2c3",
      "cityId": "osm-relation-99999",
      "name": "Hauptstraße",
      "aliases": ["Hauptstr."],
      "geometry": {
        "type": "MultiLineString",
        "coordinates": [
          [
            [7.0100, 51.0100],
            [7.0200, 51.0200]
          ]
        ]
      },
      "osmWayIds": [10001, 10002]
    }
  ],
  "pois": [
    {
      "id": "osm-relation-99999:poi-feuerwache-d4e5f6",
      "cityId": "osm-relation-99999",
      "name": "Feuerwache Musterstadt",
      "category": "fire_station",
      "position": {
        "lat": 51.0200,
        "lon": 7.0150
      },
      "geometry": null
    }
  ],
  "areas": [
    {
      "id": "osm-relation-99999:area-nord-g7h8i9",
      "cityId": "osm-relation-99999",
      "name": "Ortsteil Nord",
      "parentId": null,
      "tier": 1,
      "adminLevel": 10,
      "bounds": {
        "south": 51.0250,
        "west": 7.0000,
        "north": 51.0500,
        "east": 7.0500
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [7.0000, 51.0250],
            [7.0500, 51.0250],
            [7.0500, 51.0500],
            [7.0000, 51.0500],
            [7.0000, 51.0250]
          ]
        ]
      }
    }
  ],
  "provenance": {
    "source": "OpenStreetMap PBF",
    "sourcePbf": "nordrhein-westfalen-latest.osm.pbf",
    "osmDataTimestamp": "2026-09-05T20:22:06.000Z",
    "builderVersion": "0.1.0",
    "generatedAt": "2026-09-06T12:00:00.000Z",
    "osmRelationId": 99999
  },
  "build": {
    "warnings": []
  }
}
```

---

## 4. Pflichtfelder

Auf Top-Level-Ebene müssen in jedem offiziellen Paket folgende Felder zwingend vorhanden sein:
- `schemaVersion`: Integer (Wert `1`)
- `city`: Objekt mit administrativer Identität, Bounds, Center, OSM-Relation
- `boundary`: Valide GeoJSON-Flächengeometrie (`Polygon` oder `MultiPolygon`)
- `streets`: Nicht-leeres Array spielbarer Straßenobjekte
- `pois`: Array valider POI-Objekte (darf leer sein, in der Praxis $\ge 0$)
- `package`: Objekt mit Paketidentität, Version und `contentHash`

---

## 5. Optionale Felder

Folgende Felder sind optional und erweitern das Paket:
- `exportedAt`: ISO-8601-Zeitstempel der Serialisierung
- `areas`: Array administrativer Trainingsgebiete (TrainingAreas)
- `categories`: Array von POI-Kategoriendefinitionen
- `provenance`: Objekt mit Erzeugungs- und Quelldaten-Nachweis
- `build`: Objekt mit Build-Diagnosedaten (insb. `warnings`)

---

## 6. Dataset Identity

Zur eindeutigen Identifikation existieren zwei aufeinander abgestimmte Identitäten:
1. **`city.id` (Geografische/Administrative Identität)**:
   - Format: `osm-relation-<OSM_RELATION_ID>` (z. B. `osm-relation-163179`).
   - Identifiziert das physische Hoheitsgebiet/die Gemeinde in OpenStreetMap.
   - Alle Kind-Objekte (`streets[].cityId`, `pois[].cityId`, `areas[].cityId`) referenzieren diesen Schlüssel.
2. **`package.id` (Veröffentlichungsidentität des Pakets)**:
   - Format: `[a-z0-9][a-z0-9-_.]*` (z. B. `de-nw-olpe` oder `de-oberasbach-fire-training`).
   - Identifiziert das distribuierte Trainingspaket.
   - Erlaubt spätere spezialisierte Varianten derselben Stadt (z. B. Feuerwehr-Einsatztraining).
3. **Kanonische Auflösung im DatasetProvider**:
   - `datasetId` entspricht primär `package.id`, mit Fallback auf `city.id`.

---

## 7. Dataset Kind

Das Feld `package.datasetKind` klassifiziert den Typ des Datensatzes:
- `"municipality"` (Standard): Vollständige politische Gemeinde / Stadt.
- `"city"`: Stadtgebiet / kreisfreie Stadt.
- `"district"`: Landkreis / Gemeindeverband (perspektivisch Phase 17).
- `"custom"`: Benutzerdefiniertes Übungsgebiet.
- `"curated"`: Spezialisiertes redaktionelles Trainingspaket.

---

## 8. Versionssemantik (5-Wege-Trennung)

Die Straßentrainer-Architektur unterscheidet strikt fünf verschiedene Versions- und Zeitbegriffe:

| Begriff | JSON-Feld | Bedeutung | Beispiel |
|---|---|---|---|
| **Schema-Version** | `schemaVersion` | Struktur und Spezifikation des JSON-Formats | `1` |
| **Dataset-Version** | `package.version` | Veröffentlichungsstand dieses konkreten Trainingspakets | `1.0.0` (Curated), `2026.09.05` (OSM) |
| **OSM-Datenstand** | `provenance.osmDataTimestamp` | Exakter Snapshot-Zeitpunkt der OSM-Rohdaten | `2026-09-05T20:22:06.000Z` |
| **Builder-Version** | `provenance.builderVersion` | Software-Version des Erzeugungswerkzeugs | `0.1.0` |
| **Generierungszeitpunkt** | `provenance.generatedAt` / `exportedAt` | Zeitpunkt, an dem die Datei gebaut wurde | `2026-09-06T12:00:00.000Z` |

### Regel für OSM-Dataset-Versionen
- Für automatisch erzeugte OSM-Pakete gilt das **CalVer-Format** basierend auf dem OSM-Snapshot-Datum: `YYYY.MM.DD` (z. B. `2026.09.05`).
- Bei mehreren Veröffentlichungen desselben Tages wird eine Revisionsnummer angehängt: `YYYY.MM.DD.R` (z. B. `2026.09.05.1`).
- Dieses Format ist maschinenlesbar, eindeutig sortierbar und mit der Update-Prüfung (`comparePackageVersions`) voll kompatibel.

---

## 9. Provenienz

Die Provenienz dokumentiert nachvollziehbar die Herkunft der Rohdaten:
- `source`: Kurzbeschreibung der Quelle (z. B. `"OpenStreetMap PBF"`, `"curated"`).
- `osmRelationId`: Die zugrundeliegende OSM-Relations-ID.
- `osmDataTimestamp`: Zeitstempel des PBF-Headers.
- `builderVersion`: Version des Builder-Tools.
- `generatedAt`: Build-Zeitpunkt.
- `sourcePbf`: **Nur relativer Dateiname** (z. B. `nordrhein-westfalen-latest.osm.pbf`).
- **Verbot**: Keine lokalen absoluten Dateipfade (wie `/Users/pedro/...`) in Paketen speichern.

---

## 10. Curation vs. Datenherkunft

Herkunft und Kurationsstatus sind zwei orthogonale Dimensionen:
- **`provenance.source`** beschreibt, *woher* die Geometrien stammen (`"OpenStreetMap PBF"`, `"Geofabrik"`, `"Vermessungsamt"`).
- **`package.type`** beschreibt den *Kurationsstatus*:
  - `"curated"`: Redaktionell oder fachlich (z. B. durch Feuerwehr-Instruktoren) geprüfter Datensatz.
  - `"osm"`: Vollautomatisch aus OSM erzeugter Datensatz.
  - `"imported"`: Durch Nutzer importierter Datensatz.
- Ein Datensatz mit `provenance.source = "OpenStreetMap PBF"` kann künftig redaktionell überarbeitet werden und damit `package.type = "curated"` erhalten.

---

## 11. Trust-Semantik

- **Integrität $\ne$ Authentizität**: Der `contentHash` (SHA-256) garantiert die **Integrität** (Schutz vor unbemerkter Dateibeschädigung oder Manipulation). Er stellt **keine digitale Signatur** einer Zertifizierungsstelle dar.
- **Redaktionelle Angaben**: Das Feld `package.verification` (`status: "verified"`, `maintainer`, `note`) dokumentiert redaktionelle Prüfmerkmale. Die UI stellt diese Angaben nüchtern und wahrheitsgemäß als Selbstdeklaration dar (kein "Kryptografisch beglaubigt").

---

## 12. Boundary Contract

Die Boundary definiert den geografischen Trainingsraum:
- **Pflichtfeld**: `boundary` muss auf Top-Level vorhanden sein (Fallback auf `city.boundary` wird aus Kompatibilitätsgründen akzeptiert).
- **Erlaubte GeoJSON-Typen**: `"Polygon"` oder `"MultiPolygon"`.
- **Koordinatensystem**: WGS-84 (EPSG:4326), Reihenfolge `[lon, lat] = [x, y]`.
- **Ringschluss**: Jeder Ring muss explizit geschlossen sein (`first == last`).
- **Mindestgröße**: Mindestens 4 Koordinaten pro Ring, mindestens 3 distinkte Punkte, nicht-leere Fläche ($> 10^{-14}$).
- **Kanonische Regel**: Siehe Abschnitt 19.

---

## 13. Street Contract

Jedes Element in `streets` repräsentiert eine spielbare Straßeneinheit:
- `id`: Eindeutiger String im Format `<cityId>:street-<slug>-<hash>`.
- `cityId`: Muss exakt mit `city.id` übereinstimmen.
- `name`: Vollständiger, nicht-leerer Anzeigename (z. B. `"In der Trift"`).
- `aliases`: Array alternativer Schreibweisen (deterministisch sortiert, keine Duplikate).
- `geometry`: GeoJSON `MultiLineString` mit mindestens einer Linie und $\ge 2$ Punkten pro Linie.
- `osmWayIds`: Array aufsteigend sortierter, positiver Integer der zusammengeführten OSM-Ways.

---

## 14. POI Contract

Jedes Element in `pois` repräsentiert einen einsatzrelevanten Ort:
- `id`: Eindeutiger String im Format `<cityId>:poi-<slug>-<hash>`.
- `cityId`: Muss exakt mit `city.id` übereinstimmen.
- `name`: Nicht-leerer POI-Name.
- `category`: Gültige Kategorie aus der Straßentrainer POI-Registry (z. B. `fire_station`, `hospital`, `school`, `kindergarten`, `supermarket`, `fuel`, `hotel`, `restaurant`, etc.).
- `position`: Punktkoordinate `{ lat: number, lon: number }` (Pflicht bei Node-POIs).
- `geometry`: GeoJSON `Polygon` oder `MultiPolygon` (bei Flächen-POIs) oder `null` (bei reinen Node-POIs).

---

## 15. Area Contract

Jedes Element in `areas` repräsentiert ein administratives Untergebiet:
- `id`: Eindeutige Gebiets-ID.
- `cityId`: Muss exakt mit `city.id` übereinstimmen.
- `name`: Name des Untergebiets / Ortsteils.
- `parentId`: ID des übergeordneten Gebiets oder `null` (keine Zyklen erlaubt).
- `tier`: Hierarchieebene (z. B. 1 für Hauptortsteile).
- `adminLevel`: OSM admin_level (z. B. 10).
- `geometry`: Valide Flächengeometrie (`Polygon` oder `MultiPolygon`).

---

## 16. contentHash Spezifikation

Der `contentHash` bildet den deterministischen Fingerabdruck des fachlichen Inhalts.

### Algorithmus
1. Das Paket wird über `buildCanonicalPackageData(packageData)` auf seine fachlichen Daten reduziert.
2. Das resultierende Objekt wird über `canonicalJsonStringify(canonical)` mit lexikografisch sortierten Schlüsseln ohne Whitespace serialisiert.
3. Der SHA-256-Hash des UTF-8-Strings wird berechnet.
4. Format: `"sha256:" + 64_hex_zeichen`.

### Einbezogene Daten
- `package`: `id`, `type`, `version`
- `city`: `id`, `name`, `displayName`, `osmType`, `osmId`, `bounds`, `center`
- `streets`: `id`, `cityId`, `name`, `aliases` (sortiert), `osmWayIds` (sortiert), `geometry` (sortiert nach `id`)
- `pois`: `id`, `cityId`, `name`, `category`, `position`, `geometry` (sortiert nach `id`)
- `areas`: `id`, `cityId`, `name`, `parentId`, `tier`, `adminLevel`, `bounds`, `geometry` (sortiert nach `id`)

### Ausgeschlossene volatile Daten
- `package.contentHash` (verhindert Rekursion)
- `package.title`, `package.createdAt`, `package.updatedAt`, `package.source`, `package.verification`
- `exportedAt`, `generatedAt`
- `provenance` (Builder-Version, PBF-Dateiname, OSM-Datenstand)
- `build.warnings` (Diagnosedaten)
- `categories` (UI-Beschriftungen)
- `city.defaultZoom`, `city.streetCount`, `city.poiCount`, `city.postalCodes`
- `boundary` (Außengrenze)

### Unterschied zu Datei-SHA-256
- **`contentHash`**: Fachliche Inhaltsidentität. Bleibt byte-identisch, selbst wenn Build-Metadaten oder JSON-Formatierungen abweichen.
- **Datei-SHA-256**: Hash der ausgelieferten physischen Datei (relevant für Transport-/CDN-Caches in Phase 16).

---

## 17. Kanonische Serialisierung

Damit der Hash absolut deterministisch ist:
1. **Streets / POIs / Areas**: Werden primär nach `id` aufsteigend sortiert (`localeCompare("de", { numeric: true })`).
2. **Aliases**: Werden dedupliziert und alphabetisch sortiert.
3. **osmWayIds**: Werden dedupliziert und numerisch aufsteigend sortiert (`(a, b) => a - b`).
4. **Objektschlüssel**: Werden auf allen Ebenen streng alphabetisch geordnet (`Object.keys().sort()`).

---

## 18. Build-Warnungen

Diagnoseinformationen aus dem Bauprozess werden optional unter `build.warnings` abgelegt:
- Format:
  ```json
  {
    "code": "POI_POSSIBLE_DUPLICATE",
    "severity": "warning",
    "message": "Ähnliche nahe POIs wurden nicht zusammengeführt.",
    "entityType": "poi",
    "entityIds": ["id1", "id2"]
  }
  ```
- **Semantik**: Warnungen machen das Paket nicht ungültig (`valid: true`).
- Sie fließen **nicht** in den `contentHash` ein.

---

## 19. Kanonische Geometrieregel: Polygon vs. MultiPolygon

- **Einteilige Flächen**: Wenn eine Gebietsgrenze aus genau einer zusammenhängenden Außenfläche (mit 0 oder mehr Innenlöchern) besteht, ist sie kanonisch als **`Polygon`** zu serialisieren.
- **Mehrteilige Flächen**: Wenn eine Gebietsgrenze aus mehreren getrennten Flächen (z. B. Exklaven oder Inseln) besteht, ist sie als **`MultiPolygon`** zu serialisieren.
- **Toleranz**: Der Runtime-Validator und die Spiel-Engine akzeptieren sowohl `Polygon` als auch `MultiPolygon` verlustfrei. Builder normalisieren einteilige MultiPolygone (`coordinates.length === 1`) automatisch zu `Polygon` (via `canonicalizeAreaGeometry`).

---

## 20. Forward Compatibility (Zukunftskompatibilität)

- **Top-Level & Core Entities**: Sind strukturell typisiert, um Fehleingaben und beschädigte Dateien sicher abzufangen.
- **Metadaten-Bereiche**: Zusätzliche Metadatenschlüssel in `provenance`, `build` oder `package` werden vom Validator toleriert, solange sie keine gefährlichen Prototyp-Schlüssel (`__proto__`, `constructor`) enthalten.

---

## 21. Backward Compatibility (Rückwärtskompatibilität)

- **Oberasbach Golden Dataset**: Bleibt in vollem Umfang gültig. Der geschützte Hash `sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95` wird garantiert.
- **Ältere User-Exporte**: Datensätze ohne explizites `package`-Objekt oder mit fehlendem Top-Level-`boundary` werden weiterhin geladen (mit informativer Warnung).
- **SemVer / CalVer**: Bestehende Pakete mit SemVer `1.0.0` oder `0.1.0` bleiben uneingeschränkt kompatibel.

---

## 22. Rollen und Verantwortlichkeiten

### Builder-Verantwortung
1. Extraktion und Assembly vollständiger administrativer Grenzen.
2. Begrenzung aller Straßen auf die Gemeindeaußengrenze (Clipping grenzüberschreitender Ways).
3. Filterung zulässiger Highway-Typen und Klassifikation von POIs über die definierte Registry.
4. Zusammenführung zusammengehöriger Ways zu deterministischen Straßenobjekten.
5. Berechnung des kanonischen `contentHash` vor Ausgabe.
6. Gewährleistung, dass keine absoluten lokalen Dateipfade in das Paket gelangen.

### Browser-Verantwortung
1. Überprüfung des Schemas und der strukturellen Integrität via `validateCityPackage()`.
2. Verifikation des `contentHash` via `verifyPackageHash()`.
3. Verlustfreie Speicherung in IndexedDB via `CityStorage`.
4. Aufbereitung spielbarer Targets (Polygon-/Point-in-Polygon-Auswertung) ohne Netzwerkzugriff.
5. Sachliche, unaufdringliche Darstellung von Kurations- und Prüfhinweisen in der UI.
