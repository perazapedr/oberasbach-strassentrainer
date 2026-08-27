# Entwicklungsplan: Vom Oberasbach-Straßentrainer zum universellen Gemeinde-Trainer

## 1. Zielbild

Der bestehende **Oberasbach-Straßentrainer** soll so erweitert werden, dass nicht mehr nur ein fest hinterlegter Ort spielbar ist, sondern grundsätzlich **jede geeignete deutsche Stadt oder Gemeinde**.

Das gewünschte Grundprinzip lautet:

```text
Stadt suchen
    ↓
Nominatim identifiziert die Gemeinde
    ↓
Overpass lädt einmalig Straßen + POIs + Geometrien
    ↓
OSM-Daten werden validiert und normalisiert
    ↓
Daten werden lokal in IndexedDB gespeichert
    ↓
Stadt ist installiert
    ↓
Spiel läuft ausschließlich mit lokalen Daten
```

Damit bleibt die Anwendung:

- vollständig browserbasiert
- ohne eigenen Backend-Server
- weiterhin für statisches Hosting wie GitHub Pages geeignet
- nach Installation einer Stadt weitgehend unabhängig von externen APIs
- für mehrere Städte nutzbar
- deutlich schneller bei der Auflösung von Straßen
- langfristig auch offlinefähig

Oberasbach wird dabei nicht entfernt, sondern zur **ersten bzw. mitgelieferten Stadt des neuen Systems**.

---

# 2. Ausgangslage des bestehenden Projekts

Der aktuelle Stand ist bereits eine gute Grundlage für die Erweiterung.

Vorhanden sind insbesondere:

```text
app.js
game-engine.js
geometry.js
targets.js
statistics.js
timer.js

data/
├── oberasbach-streets.js
└── oberasbach-pois.js

tests/
├── free-mode-integration-tests.js
├── game-engine-tests.js
├── geometry-tests.js
├── statistics-tests.js
├── targets-tests.js
└── timer-tests.js
```

Die Tests des aktuellen Projektstands laufen erfolgreich.

Das ist wichtig, weil wir dadurch nicht gleichzeitig das Spielprinzip umbauen müssen.

Bereits sauber getrennt sind:

- Game-Engine
- Timer
- Zielauswertung
- Geometrieberechnung
- Punkteberechnung
- Statistik
- POI-Auswertung

Der größte Umbau betrifft daher:

1. Datenhaltung
2. Datenbeschaffung
3. Datenvalidierung
4. aktive Stadt
5. Kartenkonfiguration
6. Stadtverwaltung
7. Statistikzuordnung

---

# 3. Zentrale Architekturentscheidung

## Bestehende JavaScript-Architektur zunächst beibehalten

Der aktuelle Trainer verwendet globale APIs wie:

```javascript
window.StreetGeometry
window.StrassentrainerTargets
window.StrassentrainerStatistics
window.StrassentrainerEngine
```

Nicht gleichzeitig mit der Multi-Stadt-Umstellung das komplette Projekt auf `import`/`export` umstellen.

Neue Dateien wie

```text
city-storage.js
osm-service.js
city-data-validator.js
city-manager-ui.js
```

sollen zunächst zum bestehenden Stil passen.

Beispielsweise:

```javascript
window.StrassentrainerCityStorage = ...
window.StrassentrainerOsmService = ...
window.StrassentrainerCityDataValidator = ...
window.StrassentrainerCityManager = ...
```

Eine spätere Umstellung auf ES-Module kann separat erfolgen.

---

# 4. Zukünftige Gesamtarchitektur

```text
                     ┌─────────────────┐
                     │   Nominatim     │
                     │  Gemeindesuche  │
                     └────────┬────────┘
                              │
                              ▼
                     Gemeinde auswählen
                              │
                              ▼
                     ┌─────────────────┐
                     │    Overpass     │
                     │ Straßen + POIs  │
                     └────────┬────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ Datenvalidierung │
                    │                   │
                    │ Gemeindegrenze   │
                    │ Namen prüfen     │
                    │ Duplikate        │
                    │ Geometrien       │
                    │ POIs plausibel   │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ Normalisierung   │
                    │                   │
                    │ Straßen bündeln  │
                    │ POIs vereinheitl.│
                    └─────────┬─────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │ IndexedDB   │
                       │             │
                       │ cities      │
                       │ streets     │
                       │ pois        │
                       └──────┬──────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Content Repo    │
                     │ aktive Stadt    │
                     └───────┬─────────┘
                             │
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
        Game Engine       Leaflet         Statistik
```

---

# Phase 0 – Sicherung und technische Vorbereitung

## Ziel

Den funktionierenden Oberasbach-Stand als Referenz erhalten.

### Aufgaben

- [ ] Git-Branch erstellen, z. B. `feature/multi-city`
- [ ] aktuellen funktionierenden Stand committen
- [ ] vorhandene Tests vollständig ausführen
- [ ] App über lokalen HTTP-Server starten
- [ ] Oberasbach als Referenz manuell testen

Beispiel:

```bash
git checkout -b feature/multi-city
python3 -m http.server 8000
```

Aufruf:

```text
http://localhost:8000
```

## Abschlusskriterium

- [ ] Git-Branch vorhanden
- [ ] aktueller Stand gesichert
- [ ] alle bisherigen Tests erfolgreich
- [ ] App läuft über HTTP
- [ ] Oberasbach funktioniert unverändert

---

# Phase 1 – Allgemeines Stadt-Datenmodell und IndexedDB

## Ziel

Die Anwendung darf ihre Inhalte nicht mehr direkt aus festen Oberasbach-Dateien beziehen.

Statt:

```javascript
window.OBERASBACH_STREETS
window.OBERASBACH_POIS
```

soll eine allgemeine lokale Datenbank verwendet werden.

## 1.1 Neue Datei `city-storage.js`

Die Datei übernimmt die vollständige Persistenz heruntergeladener Städte.

Vorgeschlagene Datenbank:

```text
strassentrainer-db
```

Version:

```text
1
```

Stores:

```text
cities
streets
pois
```

## 1.2 Store `cities`

Beispiel:

```javascript
{
  id: "osm-relation-123456",

  name: "Oberasbach",
  displayName: "Oberasbach",

  district: "Landkreis Fürth",
  state: "Bayern",
  country: "Deutschland",

  postalCodes: ["90522"],

  osmType: "relation",
  osmId: 123456,

  bounds: {
    south: 49.4017,
    west: 10.9384,
    north: 49.4454,
    east: 10.9987
  },

  center: {
    lat: 49.4356,
    lon: 10.9694
  },

  defaultZoom: 13,

  streetCount: 271,
  poiCount: 60,

  source: "openstreetmap",
  dataVersion: 1,

  createdAt: "...",
  updatedAt: "..."
}
```

## 1.3 Stadt-ID

Nicht nur den Stadtnamen als ID verwenden.

Bevorzugt:

```text
osm-relation-123456
```

oder langfristig ein stabiler amtlicher Gemeindeschlüssel, falls zuverlässig vorhanden.

## 1.4 Store `streets`

Ein Eintrag entspricht **einer spielbaren Straße**, nicht einem einzelnen OSM-Way.

```javascript
{
  id: "osm-relation-123456:street:rothenburger-strasse",

  cityId: "osm-relation-123456",

  name: "Rothenburger Straße",

  aliases: [
    "Rothenburger Str."
  ],

  geometry: {
    type: "MultiLineString",
    coordinates: [...]
  },

  osmWayIds: [
    123,
    456,
    789
  ]
}
```

Mehrere OSM-Ways mit demselben Straßennamen werden beim Import zusammengeführt.

## 1.5 Store `pois`

```javascript
{
  id: "osm-relation-123456:poi:node-987654",

  cityId: "osm-relation-123456",

  name: "Grundschule Beispielstadt",

  category: "school",
  categoryLabel: "Schule",

  aliases: [],

  position: {
    lat: 49.123,
    lon: 10.456
  },

  geometry: null,

  osmType: "node",
  osmId: 987654,

  tags: {
    amenity: "school"
  }
}
```

Bei Flächen:

```javascript
geometry: {
  type: "Polygon",
  coordinates: [...]
}
```

## 1.6 Storage-Funktionen

- [ ] `saveCity(city, streets, pois)`
- [ ] `getAllCities()`
- [ ] `getCity(cityId)`
- [ ] `getCityStreets(cityId)`
- [ ] `getCityPois(cityId)`
- [ ] `deleteCity(cityId)`
- [ ] `hasCity(cityId)`
- [ ] `getActiveCityId()`
- [ ] `setActiveCityId(cityId)`
- [ ] `getActiveCity()`
- [ ] `getActiveCityData()`
- [ ] `updateCityMetadata()`
- [ ] `clearDatabase()`

## 1.7 Aktive Stadt

Nur die aktive Stadt-ID kann in `localStorage` gespeichert werden:

```text
strassentrainer-active-city-v1
```

Die eigentlichen Daten bleiben in IndexedDB.

## 1.8 Transaktionssicherheit

Prinzip:

```text
Download
   ↓
Validierung
   ↓
IndexedDB schreiben
   ↓
erst danach Stadt als installiert behandeln
```

Keine halbfertigen Stadtpakete speichern.

## 1.9 Tests

Neue Datei:

```text
tests/city-storage-tests.js
```

Testfälle:

- [ ] leere Datenbank
- [ ] Stadt speichern
- [ ] Stadt laden
- [ ] mehrere Städte speichern
- [ ] Straßen nach `cityId`
- [ ] POIs nach `cityId`
- [ ] aktive Stadt setzen
- [ ] aktive Stadt wechseln
- [ ] Stadt löschen
- [ ] andere Städte bleiben erhalten
- [ ] fehlerhafte Datensätze ablehnen

## Abschlusskriterium

```javascript
await saveCity(cityA, streetsA, poisA);
await saveCity(cityB, streetsB, poisB);

await setActiveCityId(cityB.id);

const active = await getActiveCity();
```

`active` muss Stadt B ergeben.

---

# Phase 2 – Nominatim-Gemeindesuche

## Ziel

Eine beliebige deutsche Gemeinde eindeutig identifizieren.

Neue Datei:

```text
osm-service.js
```

## 2.1 Funktion

```javascript
searchMunicipalities(query)
```

Beispiel:

```text
Oberasbach
```

Ergebnis:

```javascript
[
  {
    name: "Oberasbach",
    district: "Landkreis Fürth",
    state: "Bayern",

    osmType: "relation",
    osmId: 123456,

    bounds: {...},
    center: {...}
  }
]
```

## 2.2 Ergebnisse filtern

Nicht jedes Nominatim-Ergebnis ist eine Gemeinde.

Prüfen:

- [ ] `type`
- [ ] `class`
- [ ] `addresstype`
- [ ] `osm_type`
- [ ] `address`
- [ ] Land = Deutschland
- [ ] plausibler Verwaltungstyp

## 2.3 Deutschland zunächst beschränken

Version 1:

```text
countrycodes=de
```

## 2.4 Rate Limiting und Timeout

- [ ] mindestens ca. 1 Sekunde zwischen Nominatim-Anfragen
- [ ] `AbortController`
- [ ] Timeout
- [ ] verständliche Fehlermeldung

## Abschlusskriterium

```javascript
const results =
  await StrassentrainerOsmService.searchMunicipalities("Oberasbach");
```

liefert eine plausible Liste deutscher Gemeinden.

---

# Phase 3 – Overpass-Downloader für Straßen, POIs und Geometrien

## Ziel

Nach Auswahl einer Gemeinde werden alle benötigten OSM-Daten einmalig heruntergeladen.

## 3.1 Gemeindegrenze

Die Bounding Box dient nur für:

- Kartenansicht
- Vorschau
- `fitBounds()`

Die eigentliche Datenabfrage soll über die reale administrative OSM-Grenze erfolgen.

Prinzip:

```text
relation(OSM_ID)->.boundary;
.boundary map_to_area -> .searchArea;
```

## 3.2 Funktion

```javascript
fetchCityData(municipality, options)
```

Ergebnis:

```javascript
{
  city: {...},
  streets: [...],
  pois: [...],
  validation: {...}
}
```

## 3.3 Straßentypen Version 1

Mindestens:

```text
residential
living_street
unclassified
tertiary
secondary
primary
```

Optional:

```text
pedestrian
```

Später gesondert prüfen:

```text
service
trunk
motorway
track
```

## 3.4 Nur benannte Straßen

Straßen ohne `name` werden nicht als Spielziel übernommen.

## 3.5 Namensfelder

Berücksichtigen:

```text
name
official_name
alt_name
short_name
loc_name
```

Diese werden in `aliases` normalisiert.

## 3.6 Straßen zusammenführen

Beispiel:

```text
Hauptstraße
Way 1

Hauptstraße
Way 2

Hauptstraße
Way 3
```

wird zu:

```text
Hauptstraße
└── MultiLineString mit allen Abschnitten
```

Vorhandene Funktionen aus `geometry.js` wiederverwenden.

## 3.7 POI-Kategorien Version 1

Mindestens:

```text
amenity=fire_station
amenity=school
amenity=kindergarten
shop=supermarket
```

Architektur aber direkt erweiterbar halten.

Später mögliche Kategorien:

```text
hospital
pharmacy
fuel
police
townhall
sports_centre
hotel
restaurant
nursing_home
company
```

## 3.8 Nodes, Ways und Relations

POIs mit `nwr` suchen.

Eine Schule kann sein:

- Node
- Way
- Relation

## 3.9 POI-Normalisierung

Node:

```javascript
position: {...}
geometry: null
```

Fläche:

```javascript
position: {...}
geometry: {
  type: "Polygon",
  coordinates: [...]
}
```

## 3.10 Fortschrittsmeldungen

Beispiele:

```text
Gemeindegrenze gefunden …
Straßendaten werden geladen …
Straßen werden verarbeitet …
POIs werden verarbeitet …
271 Straßen gefunden
42 Einrichtungen gefunden
Download abgeschlossen
```

Technisch z. B.:

```javascript
onProgress({
  stage: "processing-streets",
  message: "Straßen werden verarbeitet …",
  progress: 70
});
```

## 3.11 Fehlerfälle

- [ ] Nominatim nicht erreichbar
- [ ] Overpass nicht erreichbar
- [ ] HTTP 429
- [ ] HTTP 504
- [ ] Timeout
- [ ] fehlerhaftes JSON
- [ ] keine administrative Relation
- [ ] Gemeinde ohne Straßen
- [ ] extrem großer Datensatz

## 3.12 Große Städte

Version 1:

```text
eine Overpass-Abfrage
```

Späterer Fallback:

```text
1. Straßen
2. POIs
```

oder räumliche Segmentierung.

---

# Phase 4 – OSM-Datenvalidierung und Korrektheitsprüfung

## Ziel

OpenStreetMap wird als zentrale Datenquelle verwendet, aber die Daten werden **nicht blind übernommen**.

Die Anwendung soll erkennen, wenn OSM-Daten fehlen, widersprüchlich oder ungewöhnlich sind.

Neue Datei:

```text
city-data-validator.js
```

## 4.1 Grundprinzip

```text
Nominatim
   ↓
Gemeinde eindeutig bestimmen
   ↓
Overpass / OSM
   ↓
Straßen + POIs + Geometrien
   ↓
VALIDIERUNG
   ├─ innerhalb Gemeindegrenze?
   ├─ Name vorhanden?
   ├─ doppelte Straßen?
   ├─ plausible Geometrie?
   ├─ POI-Kategorie plausibel?
   ├─ Duplikate?
   └─ ungewöhnliche Daten melden
   ↓
Normalisierung
   ↓
IndexedDB
```

## 4.2 Straßen validieren

Für jede Straße prüfen:

- [ ] Name vorhanden
- [ ] Geometrie vorhanden
- [ ] Koordinaten plausibel
- [ ] wenigstens ein Straßenabschnitt innerhalb der Gemeinde
- [ ] keine leere Geometrie
- [ ] keine offensichtlichen Duplikate
- [ ] gleiche Namen sinnvoll zusammengeführt
- [ ] OSM-Way-IDs nachvollziehbar gespeichert

## 4.3 Straßennamen normalisieren

Für die Duplikaterkennung können Vergleichsnamen erzeugt werden.

Beispiele:

```text
Straße / Str.
Groß-/Kleinschreibung
mehrfache Leerzeichen
Unicode-Normalisierung
```

Wichtig:

Der Originalname aus OSM bleibt erhalten.

## 4.4 POIs validieren

Prüfen:

- [ ] Name vorhanden
- [ ] passende Kategorie vorhanden
- [ ] Position oder Geometrie vorhanden
- [ ] liegt im Gemeindegebiet
- [ ] keine doppelten OSM-Objekte
- [ ] keine offensichtlichen Doppelmeldungen als Node und Fläche
- [ ] OSM-ID und OSM-Typ vorhanden

## 4.5 Gebäude und POI-Flächen

Alle für das Spiel relevanten OSM-Gebäude bzw. Gelände sollen als Geometrie übernommen werden, wenn sie Teil eines ausgewählten POIs sind.

Beispiel:

```text
amenity=school
building=school
```

oder ein komplettes Schulgelände als Polygon.

**Nicht zwingend** jedes beliebige Wohngebäude der Gemeinde herunterladen.

Falls später Gebäudetraining benötigt wird, kann zusätzlich `building=*` geladen werden.

## 4.6 Validierungsbericht

Nach dem Download:

```javascript
{
  valid: true,

  streets: {
    totalRaw: 420,
    totalNormalized: 271,
    duplicatesMerged: 149,
    invalid: 0,
    warnings: []
  },

  pois: {
    totalRaw: 52,
    totalNormalized: 47,
    duplicatesMerged: 5,
    invalid: 0,
    warnings: []
  }
}
```

## 4.7 Warnungen anzeigen

Beispiele:

```text
3 Straßen besitzen ungewöhnliche Geometrien.
2 Einrichtungen wurden als mögliche Duplikate erkannt.
1 POI besitzt keinen Namen und wurde nicht übernommen.
```

## 4.8 Oberasbach-Sonderfall: OSM-Abgleich mit kuratierten Daten

Der bestehende Oberasbach-Datensatz ist manuell überprüft und soll nicht einfach überschrieben werden.

Stattdessen:

```text
kuratierter Oberasbach-Datensatz
              ↕
         OSM-Abgleich
```

Mögliche Ergebnisse:

```text
Straße nur im bestehenden Datensatz
Straße nur in OSM
abweichender Straßenname
POI nur im bestehenden Datensatz
POI nur in OSM
abweichende Adresse
abweichende Position
abweichende Kategorie
```

## 4.9 Abgleichsbericht Oberasbach

Beispiel:

```text
OSM-Abgleich Oberasbach

✓ 258 Straßen stimmen überein
⚠ 4 Straßen nur in OSM
⚠ 2 Straßen nur im lokalen Datensatz
⚠ 3 Namensabweichungen

✓ 51 POIs stimmen überein
⚠ 5 neue OSM-POIs
⚠ 2 Adressabweichungen
```

Die Anwendung soll **nicht automatisch entscheiden**, dass OSM immer richtig ist.

Bei Konflikten zwischen kuratierten Daten und OSM bleibt eine manuelle Prüfung möglich.

## Abschlusskriterium

Keine Stadt wird gespeichert, bevor:

- [ ] Pflichtfelder vorhanden sind
- [ ] Geometrien plausibel sind
- [ ] ungültige Objekte entfernt wurden
- [ ] ein Validierungsbericht erzeugt wurde

---

# Phase 5 – Stadtmanager und Benutzeroberfläche

## Ziel

Der Spieler kann Städte suchen, installieren, wechseln und löschen.

Neue Datei:

```text
city-manager-ui.js
```

## 5.1 Stadtanzeige

Beispiel:

```text
📍 Oberasbach ▾
```

Dropdown:

```text
Oberasbach        ✓
Zirndorf
Siegen
────────────────
+ Neue Stadt hinzufügen
```

## 5.2 Modal „Neue Stadt hinzufügen“

```text
┌────────────────────────────────────┐
│ Neue Stadt hinzufügen              │
│                                    │
│ [ Oberasbach________________ ] 🔍  │
│                                    │
│ Suchergebnisse                     │
│                                    │
│ Oberasbach                         │
│ Landkreis Fürth · Bayern           │
│                                    │
└────────────────────────────────────┘
```

## 5.3 Downloadbildschirm

```text
Oberasbach wird vorbereitet

[██████████████░░░░] 72 %

Straßen werden verarbeitet …

Gefunden:
245 Straßen
18 POIs
```

## 5.4 Validierung sichtbar machen

Nach dem Download:

```text
Datenprüfung abgeschlossen

✓ 271 spielbare Straßen
✓ 47 Einrichtungen
✓ Gemeindegrenze geprüft
✓ Straßengeometrien geprüft

⚠ 2 mögliche POI-Duplikate wurden zusammengeführt
```

## 5.5 Vorschau

```text
Oberasbach

271 Straßen
47 Einrichtungen
3 Feuerwehren

[Stadt speichern & starten]
```

## 5.6 Installation

```text
saveCity()
↓
setActiveCityId()
↓
loadActiveCity()
↓
Karte aktualisieren
↓
ContentRepository aktualisieren
↓
Spielbereit
```

## 5.7 Stadt löschen

Bestätigungsdialog:

```text
„Zirndorf wirklich löschen?

Die lokal gespeicherten Straßen- und POI-Daten
werden entfernt.“

[Abbrechen] [Stadt löschen]
```

Statistik zunächst getrennt behandeln.

## 5.8 Kein Stadtwechsel während aktiver Runde

Während:

```text
active
preparing
```

Stadtwechsel deaktivieren oder Spielabbruch verlangen.

## 5.9 Accessibility

- [ ] `aria-label`
- [ ] `role="dialog"`
- [ ] Fokusmanagement
- [ ] ESC zum Schließen
- [ ] `aria-live` für Fortschritt

## Abschlusskriterium

Benutzer kann:

1. Stadt suchen
2. Stadt herunterladen
3. Validierungsbericht sehen
4. Stadt speichern
5. zweite Stadt installieren
6. wechseln
7. löschen

---

# Phase 6 – `app.js` vollständig stadtdynamisch machen

## Ziel

Alle festen Oberasbach-Werte aus der Laufzeitlogik entfernen.

## 6.1 Feste Stadtwerte aus `CONFIG` entfernen

Beispiele:

```javascript
municipalityName
postalCode
initialCenter
geometryBbox
bounds
fireStations
geometryCacheKey
statisticsStorageKey
```

Globale App-Konfiguration soll nur echte App-Einstellungen enthalten.

## 6.2 Laufzeitzustand

```javascript
const cityContext = {
  metadata: null,
  streetTargets: [],
  poiTargets: []
};
```

## 6.3 Startup

```text
HTML laden
↓
IndexedDB öffnen
↓
aktive Stadt-ID lesen
↓
Stadt vorhanden?
```

Wenn ja:

```text
Stadtdaten laden
↓
Spiel initialisieren
```

Wenn nein:

```text
Oberasbach-Paket importieren
```

oder Stadt-Auswahl öffnen.

## 6.4 ContentRepository dynamisch

Statt:

```javascript
prepareStreetTargets(window.OBERASBACH_STREETS)
```

neu:

```javascript
contentRepository.streetTargets =
  targetApi.prepareStreetTargets(cityStreets, geometryApi);

contentRepository.poiTargets =
  targetApi.preparePoiTargets(cityPois, categories);
```

## 6.5 Karte dynamisch

Nach Stadtwechsel:

```javascript
map.fitBounds(...)
map.setMaxBounds(...)
```

## 6.6 Kartenbeschriftung

Dynamisch:

```text
Unbeschriftete Straßenkarte von Siegen
```

## 6.7 Feuerwehrmarker

Statt festem `CONFIG.fireStations`:

```javascript
activePois.filter(
  poi => poi.category === "fire_station"
)
```

## 6.8 Keine Geocoding-Abfrage während einer Runde

Alt:

```text
Alarm
↓
resolveStreetGeometry()
↓
Nominatim
↓
Wartezeit
↓
Runde
```

Neu:

```text
Alarm
↓
Straße enthält bereits geometry
↓
Runde startet sofort
```

## 6.9 Geometriecache entfernen

Der alte Oberasbach-Geometriecache wird nach erfolgreicher Migration nicht mehr benötigt.

## 6.10 `geocoderDelayMs` entfernen

Kein Geocoder mehr während des Spiels.

## 6.11 Integrationstests

Neue Datei:

```text
tests/multi-city-integration-tests.js
```

Testfälle:

- [ ] Stadt A aktiv
- [ ] nur Ziele aus Stadt A
- [ ] Stadt B aktivieren
- [ ] nur Ziele aus Stadt B
- [ ] Kartenbounds wechseln
- [ ] Feuerwehrmarker wechseln
- [ ] POIs wechseln
- [ ] kein Netzwerkzugriff während Spielrunde
- [ ] keine alten Oberasbach-Daten bleiben aktiv

## Abschlusskriterium

Mindestens Oberasbach und eine zweite Gemeinde funktionieren vollständig.

---

# Phase 7 – Statistik stadtbezogen speichern

## Ziel

Statistiken verschiedener Städte dürfen nicht vermischt werden.

## 7.1 Storage-Key

Beispiel:

```text
strassentrainer-statistik-osm-relation-12345-v2
```

## 7.2 Store beim Stadtwechsel

```javascript
createStatisticsStore(
  localStorage,
  getStatisticsStorageKey(activeCity.id)
)
```

## 7.3 Statistiküberschrift

```text
Statistik – Oberasbach
```

## 7.4 Export

Beispiel:

```text
strassentrainer-statistik-oberasbach-2026-08-27.json
```

Metadaten:

```javascript
{
  cityId,
  cityName,
  exportedAt,
  statistics
}
```

## 7.5 Import prüfen

Wenn Datei und aktive Stadt nicht zusammenpassen:

```text
Diese Statistik gehört zu Oberasbach.
Aktuelle Stadt: Siegen.
```

## Abschlusskriterium

Eine Runde in Stadt A verändert niemals Statistik B.

---

# Phase 8 – Oberasbach-Migration und Rückwärtskompatibilität

## Ziel

Die bestehenden kuratierten Oberasbach-Daten erhalten.

## 8.1 Bestehende Straßen migrieren

Vorhanden:

```text
data/oberasbach-streets.js
```

Für die neue Architektur werden vollständige lokale Geometrien benötigt.

## 8.2 Bestehende POIs erhalten

Der Oberasbach-Datensatz ist qualitativ reichhaltiger als eine einfache automatische OSM-Abfrage.

Grundregel:

```text
kuratierte, geprüfte Oberasbach-Daten
>
ungeprüfte automatische OSM-Daten
```

OSM wird zum Abgleich verwendet, nicht automatisch als Überschreibung.

## 8.3 Oberasbach als Default-Paket

Später sinnvoll:

```text
data/cities/oberasbach.json
```

Schema:

```javascript
{
  schemaVersion: 1,
  city: {...},
  streets: [...],
  pois: [...]
}
```

Beim ersten Start:

```text
Keine IndexedDB-Stadt vorhanden
↓
Oberasbach-Paket importieren
↓
Oberasbach aktivieren
```

## Abschlusskriterium

Der bisherige Oberasbach-Spielumfang bleibt mindestens vollständig erhalten.

---

# Phase 9 – Stadt-Export und Stadt-Import

## Ziel

Bereits heruntergeladene oder kuratierte Städte können weitergegeben werden.

## 9.1 Export

Beispiel:

```text
oberasbach-strassentrainer-v1.json
```

Inhalt:

```javascript
{
  schemaVersion: 1,
  exportedAt: "...",
  city: {...},
  streets: [...],
  pois: [...]
}
```

## 9.2 Import

Ablauf:

```text
Datei auswählen
↓
Schema prüfen
↓
Daten validieren
↓
Stadtinformationen anzeigen
↓
speichern
```

## 9.3 Validierung

Prüfen:

- [ ] `schemaVersion`
- [ ] `city.id`
- [ ] `city.name`
- [ ] Bounds
- [ ] Straßenarray
- [ ] eindeutige IDs
- [ ] Geometrietyp
- [ ] Koordinaten
- [ ] POI-Kategorien
- [ ] keine gefährlichen Objektkeys wie `__proto__`

---

# Phase 10 – Fehlerbehandlung und UX

## Ziel

API-Ausfälle dürfen installierte Städte nicht unspielbar machen.

## 10.1 Nominatim nicht erreichbar

```text
Die Stadtsuche ist momentan nicht erreichbar.

Bereits installierte Städte können weiterhin gespielt werden.
```

## 10.2 Overpass Timeout

```text
Die Daten für diese Stadt konnten momentan nicht vollständig geladen werden.

Bitte versuche den Download später erneut.
```

Keine unvollständige Stadt speichern.

## 10.3 Zu wenige Straßen

```text
Es wurden nur 4 spielbare Straßen gefunden.

Diese Gemeinde eignet sich derzeit nicht für den Straßentrainer.
```

## 10.4 Download abbrechen

Optional über `AbortController`.

---

# Phase 11 – Qualitätssicherung mit mehreren Stadtgrößen

## Kleine Gemeinde

Beispiel:

```text
Oberasbach
```

Prüfen:

- [ ] Gemeindesuche
- [ ] Gemeindegrenze
- [ ] Straßen
- [ ] POIs
- [ ] Geschwindigkeit
- [ ] OSM-Abgleich

## Mittelgroße Stadt

Beispiel:

```text
Siegen
```

Prüfen:

- [ ] Datenmenge
- [ ] IndexedDB-Größe
- [ ] Downloadzeit
- [ ] Kartenperformance
- [ ] MultiLineStrings

## Große Stadt

Beispiel:

```text
Nürnberg
```

später eventuell:

```text
München
```

Prüfen:

- [ ] Overpass-Limit
- [ ] JSON-Größe
- [ ] Speicherdauer
- [ ] Rendering
- [ ] Browser-RAM

---

# Phase 12 – Performanceoptimierung

## 12.1 Nicht alle Geometrien gleichzeitig zeichnen

IndexedDB enthält alle Straßen.

Leaflet zeichnet nur benötigte Ziele bzw. Ergebnisdarstellungen.

## 12.2 Daten beim Stadtwechsel einmal laden

```text
Stadt aktivieren
↓
Straßen + POIs einmal laden
↓
im Arbeitsspeicher halten
↓
gesamte Spielsitzung verwenden
```

## 12.3 Geometrie nicht unnötig duplizieren

Keine parallelen Kopien in mehreren Caches, wenn vermeidbar.

---

# Phase 13 – Offlinefähigkeit

## Bereits lokal möglich

Nach Stadtinstallation:

- Straßendaten
- POIs
- Geometrien
- Game-Engine
- Statistik

## Für vollständiges Offline-Spiel später nötig

- Leaflet lokal
- Turf lokal
- Service Worker
- Kartenkacheln oder alternative Offline-Karte

Nicht Teil der ersten Multi-Stadt-Version.

---

# Phase 14 – Spätere Erweiterungen

## Weitere POI-Kategorien

- Feuerwehr
- Polizei
- Krankenhaus
- Pflegeeinrichtungen
- Tankstellen
- Schulen
- Kitas
- Unternehmen
- Hotels
- Gaststätten
- Sportstätten
- öffentliche Gebäude

## Stadtpakete

Beispiel:

```text
„Feuerwehr Oberasbach – geprüftes Trainingspaket“
```

## Stadt aktualisieren

```text
Oberasbach

Datenstand:
12.08.2026

[Von OpenStreetMap aktualisieren]
```

## Versionsvergleich

```text
271 → 274 Straßen
60 → 63 POIs
```

## Erweiterte Trainingsgebiete

Später denkbar:

```text
Gemeinde
Landkreis
Feuerwehr-Einsatzgebiet
frei definierte Region
```

---

# 15. Empfohlene Entwicklungsreihenfolge

```text
0  Bestehenden Stand sichern
│
├─ 1  city-storage.js
│      ↓ testen
│
├─ 2  Nominatim-Suche
│      ↓ testen
│
├─ 3a Overpass-Straßen
│      ↓ testen
│
├─ 3b Overpass-POIs
│      ↓ testen
│
├─ 4  Datenvalidierung
│      ↓ testen
│
├─ 5  Stadtmanager-UI
│      ↓ testen
│
├─ 6a aktive Stadt in app.js
│      ↓ testen
│
├─ 6b dynamische Karte
│      ↓ testen
│
├─ 6c lokale Straßengeometrien
│      ↓ testen
│
├─ 7  stadtbezogene Statistik
│      ↓ testen
│
├─ 8  Oberasbach-Migration + OSM-Abgleich
│      ↓ testen
│
├─ 9  JSON Import/Export
│      ↓ testen
│
└─ 10 Gesamttest mit mehreren Städten
```

---

# 16. Was ausdrücklich nicht gleichzeitig verändert werden sollte

Während des Multi-Stadt-Umbaus möglichst unangetastet lassen:

```text
game-engine.js
timer.js
Punktekurven
Prüfungsmodus
Zeitmodus
Rangsystem
grundlegende Statistikberechnung
bestehende Zielauswertung
Kartendesign
```

Nur ihre **Datenzuführung** verändert sich.

---

# 17. Zentrale technische Leitregel

> **Externe Dienste werden ausschließlich zum Installieren, Prüfen oder Aktualisieren einer Stadt verwendet. Das eigentliche Spiel greift niemals auf Nominatim oder Overpass zu.**

```text
ONLINE-PHASE

Stadt suchen
↓
Stadt herunterladen
↓
OSM-Daten validieren
↓
Stadt speichern


SPIEL-PHASE

IndexedDB
↓
Game Engine
↓
Leaflet
```

---

# 18. Soll-Zustand der ersten Version

Ein Benutzer öffnet den Trainer.

Er sieht:

```text
Aktuelle Stadt: Oberasbach ▾
```

Er klickt:

```text
Neue Stadt hinzufügen
```

und sucht:

```text
Zirndorf
```

Die Anwendung findet:

```text
Zirndorf
Landkreis Fürth · Bayern
```

Nach Auswahl:

```text
Gemeindegrenze gefunden
Straßen werden geladen
POIs werden geladen
Daten werden geprüft
Daten werden normalisiert

318 Straßen
47 Einrichtungen
```

Danach:

```text
Datenprüfung abgeschlossen

✓ Gemeindegrenze geprüft
✓ Straßengeometrien geprüft
✓ 318 spielbare Straßen
✓ 47 Einrichtungen
⚠ 3 Duplikate zusammengeführt
```

Dann:

```text
[Stadt speichern & starten]
```

Die Karte springt auf Zirndorf.

Eine Runde startet ohne weitere API-Anfrage, da die vollständige Straßengeometrie bereits lokal vorhanden ist.

Beim Wechsel nach Oberasbach erscheinen wieder ausschließlich:

- Oberasbacher Straßen
- Oberasbacher POIs
- Oberasbacher Feuerwehren
- Oberasbacher Statistik
- Oberasbacher Kartenausschnitt

---

# 19. Prioritäten

## Muss für Version 1

- [ ] IndexedDB
- [ ] mehrere Städte
- [ ] Nominatim-Suche
- [ ] administrative Gemeindegrenze
- [ ] Overpass-Straßen
- [ ] vollständige Straßengeometrien
- [ ] grundlegende POIs
- [ ] OSM-Datenvalidierung
- [ ] Duplikaterkennung
- [ ] Stadtwechsel
- [ ] dynamische Karte
- [ ] lokale Rundenauflösung
- [ ] getrennte Statistik
- [ ] Oberasbach weiterhin vollständig funktionsfähig
- [ ] Fehlerbehandlung
- [ ] bestehende Tests weiterhin erfolgreich

## Sehr sinnvoll direkt danach

- [ ] Stadt JSON exportieren
- [ ] Stadt JSON importieren
- [ ] Oberasbach als fertiges Stadtpaket
- [ ] Oberasbach-vs.-OSM-Abgleich
- [ ] Aktualisierungsfunktion

## Später

- [ ] große Städte optimieren
- [ ] mehr POI-Typen
- [ ] automatische Datenvergleiche
- [ ] Landkreis-Modus
- [ ] vollständiger Offline-Modus
- [ ] Service Worker
- [ ] lokale Karten
- [ ] kuratierte Stadtpakete

---

# 20. Wichtigster Punkt für das bestehende Projekt

Der Umbau ist **kein Neubau des Straßentrainers**.

Im Wesentlichen werden folgende feste Oberasbach-Abhängigkeiten ersetzt:

```text
OBERASBACH_STREETS
OBERASBACH_POIS
CONFIG.bounds
CONFIG.initialCenter
CONFIG.fireStations
resolveStreetGeometry()
```

durch:

```text
activeCity
activeCity.streets
activeCity.pois
activeCity.bounds
activeCity.center
lokal gespeicherte geometry
```

Game-Engine, Timer, Zielauswertung und das eigentliche Spiel bleiben weitgehend unverändert.

---

# 21. Datenqualitäts-Grundsatz

OpenStreetMap ist die zentrale externe Datenquelle, aber **kein unfehlbares Wahrheitsregister**.

Deshalb gilt:

> **OSM liefert die Ausgangsdaten. Die Anwendung prüft, normalisiert und dokumentiert sie, bevor daraus ein spielbares Stadtpaket entsteht.**

Für kuratierte Daten wie Oberasbach gilt zusätzlich:

> **Bestehende geprüfte Daten werden nicht blind durch OSM überschrieben, sondern gegen OSM abgeglichen.**

Dadurch erhält der universelle Straßentrainer nicht nur Flexibilität, sondern auch eine nachvollziehbare und möglichst hohe Datenqualität.
