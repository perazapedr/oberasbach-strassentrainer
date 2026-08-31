# Phase 11 – QA mit realen Stadtgrößen

Messdatum: 30. August 2026. Alle Live-Abfragen liefen sequenziell gegen die in
`osm-service.js` konfigurierten öffentlichen Nominatim- und Overpass-Endpunkte.
Die Rohantworten und temporären Stadtpakete wurden nicht im Repository abgelegt.

## Live-Downloadvergleich

| Metrik | Oberasbach | Siegen | Nürnberg | Köln |
|---|---:|---:|---:|---:|
| Bounds-Fläche | 21,27 km² | 225,69 km² | 495,69 km² | 773,86 km² |
| Strategie | Single | Chunked | Chunked | Chunked |
| Initiale Chunks | 1 | 4 | 16 | 16 |
| Overpass-Versuche | 2 | 6 | 20 | Versuch 1: nicht vollständig protokolliert; Versuch 2: 2 |
| Retries | 0 | 1 | 3 | Versuch 1: mehrfach; Versuch 2: 1 |
| Adaptive Splits | 0 | 0 | 0 | Versuch 1: 3; Versuch 2: 0 |
| Ergebnis | PASS | PASS | PASS | FAIL (externe Netzwerkfehler) |
| Downloadzeit | 2,671 s | 47,356 s | 110,019 s | Versuch 1: ca. 171 s bis Abbruch; Versuch 2: 2,043 s bis Abbruch |
| Raw Objects | 557 | 4.037 | 10.888 | nicht verfügbar |
| Nach Deduplizierung | 557 | 3.943 | 10.656 | nicht verfügbar |
| Entfernte Duplikate | 0 | 94 | 232 | nicht verfügbar |
| Validierte Straßen | 262 | 1.176 | 2.967 | nicht verfügbar |
| Validierte POIs | 25 | 144 | 696 | nicht verfügbar |
| Validatorfehler | 0 | 0 | 0 | nicht ausgeführt |
| Validatorhinweise beim ersten Lauf | 16 | 31 | 59 | nicht ausgeführt |
| Serialisierte Paketgröße | 171.653 B | 1.052.692 B | 2.922.256 B | nicht verfügbar |

Die Paketgröße ist die UTF-8-Größe einer kompakten JSON-Serialisierung inklusive
Boundary. Sie ist keine exakte IndexedDB-Plattenbelegung. Eine reale per-city
IndexedDB-Belegung war in dieser Sitzung nicht messbar.

## Zeitmessungen

| Phase | Oberasbach | Siegen | Nürnberg |
|---|---:|---:|---:|
| Nominatim-Suche | 550 ms | 285 ms | 543 ms |
| Boundary-Netzwerk | 924 ms | 14.018 ms | 10.626 ms |
| Daten-Netzwerk | 1.526 ms | 31.102 ms | 93.981 ms |
| Merge/Normalisierung (kombinierte Schätzung) | 221 ms | 2.236 ms | 5.413 ms |
| Validator, erster Lauf | 70 ms | 829 ms | 4.745 ms |
| Validator, Median aus drei Folgeläufen | 50 ms | 757 ms | 4.926 ms |
| Target-Aufbereitung, Median | 0,4 ms | 1,6 ms | 3,7 ms |

Die kombinierte Merge-/Normalisierungszeit ist die Restzeit zwischen Netzwerk
und Rückgabe von `fetchCityData()`; die beiden Anteile sind mit der vorhandenen
öffentlichen API nicht getrennt messbar. Save-, vollständige Aktivierungs-,
Leaflet- und RAM-Messungen waren mangels verfügbarer Browserinstanz nicht
seriös möglich.

## Datenqualität und Stichproben

- Keine der drei erfolgreich geladenen Städte enthält doppelte Street- oder
  POI-IDs; `cityId`, Boundary, Straßen- und POI-Geometrien bestanden den Validator.
- Siegen enthält 581 Straßen mit mehr als einem Segment, maximal 134 Segmente.
  89 Straßen berühren mehrere initiale Chunks. Stichproben: Sandstraße (3 Chunks,
  25 Ways), Freudenberger Straße (2 Chunks, 134 Ways), Weidenauer Straße
  (2 Chunks, 97 Ways).
- Nürnberg enthält 1.399 Straßen mit mehr als einem Segment, maximal 130
  Segmente. 192 Straßen berühren mehrere initiale Chunks. Stichproben:
  Regensburger Straße (3 Chunks, 130 Ways), Rothenburger Straße (3 Chunks,
  111 Ways), Fürther Straße (2 Chunks, 96 Ways). Jede Stichprobe ist genau eine
  Street mit vollständiger Way-ID- und Segmentmenge.
- Schulen, Kindergärten, Supermärkte und Feuerwehren waren in allen drei
  erfolgreichen Live-Paketen vorhanden. Bekannte zentrale Straßen in Siegen
  und Nürnberg wurden stichprobenartig gefunden.

## Oberasbach: kuratiert gegen Live-OSM

Das gebündelte Produktionspaket bleibt unverändert bei 271 Straßen, 60 POIs und
271/271 gültigen lokalen Straßengeometrien. Der Live-Downloader fand 262 Straßen
und 25 POIs.

- Straßen: 258 Matches, 13 nur kuratiert, 4 nur OSM, keine Namensabweichung bei
  den Matches.
- Vergleichbare POIs: 21 Matches, 4 nur kuratiert, 4 nur OSM; 35 kuratierte POIs
  gehören nicht zu den vier generischen OSM-Downloadkategorien.
- Bei gematchten POIs wurden 17 Namens-, 4 Adress- und 1 Positionsabweichung
  gemeldet; keine Kategorieabweichung.

## Externe Fehler und Köln-Regression

Nominatim 403 und Overpass 406 wurden nicht reproduziert. Die erfolgreichen
Requests belegen, dass GET, POST-Formularencoding, Content-Type und Accept im
QA-Transport grundsätzlich akzeptiert werden. Beobachtet wurden dagegen HTTP
429 (Siegen und Nürnberg), HTTP 504 (Nürnberg) und Transportfehler (Köln).

Der erste Köln-Versuch erreichte 15 erfolgreich abgeschlossene Bereiche und
führte drei adaptive Splits aus, bevor ein erneut ausgeschöpfter Netzwerkfehler
den Download beendete. Der zweite und letzte Versuch scheiterte nach genau einem
Boundary-Retry an zwei Transportfehlern. Damit ist die adaptive Architektur real
angesprungen, ein vollständiger Köln-Smoke-Test ist aber nicht belegt. Es wurde
keine Teilinstallation erzeugt.

## Nicht visuell geprüfte Punkte

In der Sitzung war keine steuerbare Browserinstanz verfügbar. Stadtmanager,
Live-Downloadfortschritt, reale IndexedDB-Speicherdauer, vollständige
Aktivierungsdauer, Leaflet-Rendering, Labels, UI-Freezes, Reload und Browser-RAM
sind daher **NICHT VISUELL GETESTET**. DOM-, Leaflet-Mock- und Multi-City-
Integrationstests waren vollständig grün. Der Export-/Import-Roundtrip des real
geladenen Siegen-Pakets war für 1.176 Straßen und 144 POIs deep-identisch.

## Phase-12-Kandidat

Die synchrone Validierung des Nürnberger Pakets benötigt reproduzierbar rund
4,9 Sekunden. Wahrscheinliche Auswirkung im Browser ist eine merkbare
Main-Thread-Blockade nach dem Download. Priorität: hoch. Vor einer Umsetzung ist
die Long-Task-Dauer in einem steuerbaren Browser zu bestätigen; Phase 11 nimmt
keine Performancearchitektur vorweg.

## Phase 12 – Vorher/Nachher

Die Benchmarks verwenden dieselben unter `/tmp` gehaltenen Phase-11-Pakete und
dieselbe Node-Laufzeit. Reguläre Tests enthalten bewusst keine Millisekunden-
Grenzwerte. `scripts/benchmark-phase12.js` führt reproduzierbare Medianmessungen
und vollständige semantische SHA-256-Vergleiche aus.

### Validator

| Stadt | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| Oberasbach | 51,1 ms | 8,3 ms | −83,8 % |
| Siegen | 775,1 ms | 54,5 ms | −93,0 % |
| Nürnberg | 5.105,3 ms | 176,6 ms | −96,5 % |

Für alle drei Pakete sind der vollständige Validatoroutput, Street-/POI-IDs,
Counts, Way-ID-Mengen, Geometrien, Fehler und Warnungen byte-semantisch
identisch. Die SHA-256-Snapshots vor und nach der Optimierung stimmen überein.

Der größte ursprüngliche Anteil war keine allgemeine Street-Duplikatsuche,
sondern die wiederholte Prüfung von 67.923 Nürnberger Straßenpunkten gegen
3.950 Boundary-Kanten. Ein pro Lauf vorbereiteter, nach Breitengrad gebucketeter
Kantenindex reduziert den Kandidatenraum von theoretisch 268.295.850 auf
4.128.690 exakte Kantenprüfungen (−98,5 %). Segment-/Boundary-Schnittprüfungen
werden semantisch äquivalent nur noch benötigt, wenn sämtliche Segmentendpunkte
außerhalb liegen.

Die POI-Duplikaterkennung bereitet Namen, Aliase, Position, Adresse und
Flächenstatus einmal pro POI vor. Der Kategorie-/Namensindex reduziert den
Nürnberger Paarraum von 241.860 Vollpaaren auf 1.411 fachlich kompatible
Kandidaten (−99,4 %). Die Schwellenwerte und Merge-Regeln blieben unverändert.

Nürnbergs nachher getrennt gemessene Validatoranteile lagen repräsentativ bei:

- Boundary-Vorbereitung: 0,2 ms
- Street-Boundary-Prüfung: rund 75 ms
- Street-Clones: rund 25 ms
- Street-Gruppierung: rund 10 ms
- POI-Boundary-Prüfung: rund 6 ms
- POI-Normalformen und Kandidatenindex: zusammen rund 6 ms

### OSM-Merge und Normalisierung

Der Phase-11-Restwert von 5.413 ms enthielt auch das Lesen und Decodieren des
Overpass-Response-Bodys, weil die damalige Netzwerkmessung bereits bei Erhalt
des `Response`-Objekts endete. Er war daher keine reine Merge-CPU-Zeit.

Ein identischer synthetischer Nürnberg-Größenbenchmark mit 10.200 Rohobjekten,
9.000 Street-Ways, 700 POIs und 500 Duplikaten ergibt:

| Verarbeitung | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| kompletter lokaler OSM-Pfad | 54,1 ms | 33,2 ms | −38,6 % |

Der vollständige OSM-Ergebnishash ist identisch. Die größten Nachher-Anteile
sind Street-Geometrie-Erzeugung (rund 16 ms), ID-/Alias-Aufbereitung (rund
6 ms), Deduplizierung (rund 4 ms) und Street-Normalisierung (rund 4 ms).
Deterministische Sortierung verwendet wiederverwendete `Intl.Collator`-Instanzen.
Die letzte redundante tiefe Kopie der bereits lokal erzeugten Street-Koordinaten
wurde entfernt.

Als zusammengesetzter lokaler CPU-Benchmark ergeben OSM-Verarbeitung plus
Nürnberg-Validator 5.159,4 ms vorher und 209,8 ms nachher (−95,9 %). Beide
Teilwerte beruhen jeweils auf identischem Vorher-/Nachher-Input; sie sind keine
Behauptung über Netzwerk- oder JSON-Transferzeit.

### Runtime und Speicherstruktur

- Eine Stadt wird über eine einzige `getCityData()`-Transaktion pro Aktivierung
  geladen. Mehrere Runden verursachen keine weiteren Street-/POI-Loads.
- Nur die aktive Stadt besitzt einen vollständigen Runtime-Context; der
  Stadtmanager hält für andere Städte Metadaten.
- Nach der Target-Aufbereitung hält `CityContext` nicht mehr zusätzlich die
  vollständigen Raw-Street-/POI-Objektgraphen. Die Geometrie-Koordinatenlinien
  werden immutable zwischen IndexedDB-Ergebnis und Target-Adapter geteilt.
- Leaflet erstellt keine Layer für sämtliche Straßen. Sichtbar sind nur das
  aktuelle Ziel/Ergebnis sowie die Feuerwehrmarker der aktiven Stadt.
- Runden- und Stadtwechseltests bestätigen, dass alte Ziel-/Ergebnislayer
  entfernt werden.

`saveCity()`, `getCityData()` und die Aktivierungsphasen besitzen nun optionale
monotone Diagnosemetriken. Reale Browserwerte wurden mangels steuerbarer
Browserinstanz weiterhin nicht erhoben; eine Storagearchitekturänderung erfolgte
deshalb nicht.
