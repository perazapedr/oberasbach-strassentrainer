# Phase 15.2 – OSM-PBF Dataset Builder: Proof of Concept Olpe

## 1. Ausgangszustand

```text
Branch:       feature/multi-city
Commit:       753a9fe71303e105b4b863b478ce3ecd98aefc43
Working Tree: DIRTY (erwartete, uncommittete Phase-15.1-Arbeit vorhanden)
git diff --check: PASS
```

Zu Beginn vorhandene Änderungen: `README.md`, `city-manager-ui.js`, `index.html`, `sw.js`, `tests/city-manager-ui-tests.js`, `tests/offline-tests.js` sowie die neuen Phase-15.0/15.1-Dateien einschließlich `dataset-provider.js`. Keine dieser Änderungen wurde zurückgesetzt. Der produktive Default bleibt `LegacyOsmDatasetProvider`.

## 2. Technologieentscheidung

- Builder: Node.js, getestet mit 22.20.0
- PBF-/OSM-Werkzeug: `osmium-tool` 1.19.1 mit libosmium 2.23.1
- Geometrie: vorhandenes lokales Turf-Bundle
- Fachlogik: vorhandene Module `geometry.js`, `poi-categories.js`, `osm-service.js` und `city-data-validator.js`
- zusätzliche Browser-Dependencies: keine
- zusätzliche Builder-npm-Dependencies: keine

Osmium ist das etablierte, streaming-/mehrpassfähige Systemwerkzeug für PBF, Referenzauflösung und Multipolygon-Assembly. JavaScript verarbeitet erst den kleinen Municipality-Extrakt. Das PBF-Binärformat wird nicht selbst implementiert, und der Browser-Build erhält keine PBF-Abhängigkeit.

## 3. Builder-Architektur

```text
lokales NRW-PBF
→ Headerzeitpunkt lesen
→ administrative Relation nach Name/admin_level/optionaler ID wählen
→ Relation samt Way-/Node-Referenzen auflösen
→ Boundary mit Osmium als Polygon/MultiPolygon assemblieren
→ Municipality-Extrakt (smart, vollständige Ways und Flächenrelationen)
→ Way-Referenzen prüfen
→ GeoJSON Text Sequence exportieren
→ bestehende Highway-Liste / POI-Registry anwenden
→ grenzschneidende Straßen am echten Polygon clippen
→ bestehende Normalisierung und Deduplizierung
→ bestehender City-Validator
→ aktuelles Schema-1-Package
→ bestehender kanonischer SHA-256-contentHash
→ bestehender Package-Validator
→ fertiges JSON für StaticDatasetProvider
```

Der große regionale PBF wird nie in JSON oder vollständig in den Node-Prozess geladen. Osmium arbeitet streaming-/indexbasiert. Nur der ausgeschnittene Olpe-GeoJSON-Stream wird fachlich ausgewertet.

## 4. Geänderte Dateien

| Datei | Änderung | Begründung |
|---|---|---|
| `.gitignore` | PBF-, Work-, Output- und JSON-Report-Artefakte ignoriert; Mini-Fixture ausgenommen | keine großen Rohdaten im Repository |
| `README.md` | Builder-Verweis und zwei Tests ergänzt | Projekteinstieg |
| `tools/dataset-builder/index.js` | CLI und Osmium-Orchestrierung | PBF-Verarbeitung außerhalb der App |
| `tools/dataset-builder/lib/core.js` | Auswahl, Clipping, Normalisierung, Entity-Build, Validator/Hash | fachlicher Builder-Kern |
| `tools/dataset-builder/download-legacy.js` | einmaliger Live-Legacy-Abruf | reproduzierbarer Diagnosevergleich |
| `tools/dataset-builder/compare.js` | PBF-/Legacy-Vergleich und Markdown-Bericht | nachvollziehbare Abweichungsanalyse |
| `tools/dataset-builder/package.json` | isolierte Tool-Metadaten/Scripts | keine Browser-Abhängigkeit |
| `tools/dataset-builder/README.md` | Installation, CLI, Pipeline und Aufräumen | reproduzierbarer Betrieb |
| `tools/dataset-builder/test/fixtures/mini-olpe.osm(.pbf)` | synthetische OSM-/PBF-Fixture | schnelle Offline-Tests |
| `tests/dataset-builder-tests.js` | neun Builder-Unit-/Integrationstests | Builder-Regeln und Fixture-Pipeline |
| `tests/olpe-pbf-integration-tests.js` | reales Package bis Spielrunde | End-to-End-Beweis ohne Netz |
| `data/cities/de-nw-olpe.json` | reales Olpe-Package | Phase-15.2-Artefakt |
| `tools/dataset-builder/reports/olpe-comparison.md` | realer Vergleich | Diagnose-Nachweis |

Game Engine, Timer, Scoring, Oberasbach-Daten, Legacy-OSM-Service, Validator und Storage wurden nicht verändert.

## 5. Olpe Boundary

```text
Relation:               163179
boundary:               administrative
admin_level:            8
Gemeindeschlüssel:      05966024
Regionalschlüssel:      059660024024
Geometry Type:          MultiPolygon (1 Polygon)
Koordinaten:            557
Bounds:                 50.9868900, 7.8040829, 51.0878047, 7.9741967
Osmium Assembly:        PASS
bestehender Validator:  PASS
Topologie vs. Overpass: identisch
```

Die automatische Auswahl sucht exakt `boundary=administrative`, `admin_level=8` und den normalisierten Gemeindenamen. Mehrdeutigkeit führt zum Fehler; `--relation-id` dient als expliziter Fallback. Die Testfixture prüft richtige Auswahl, falsche Ebene/Relation und fehlende Boundary.

## 6. Realer PBF-Build

```text
PBF:             nordrhein-westfalen-latest.osm.pbf (Geofabrik)
PBF-Größe:       911,709,706 Bytes
lokale MD5:      e7245c3f27789e964276d3cc0dc1b8f8
OSM Timestamp:   2026-09-05T20:22:06.000Z
Buildzeit:       15.26 s (/usr/bin/time; Builder-Report 14.09 s)
Peak RSS:        1,534,607,360 Bytes (ca. 1.43 GiB)
Output:          data/cities/de-nw-olpe.json
Package-Größe:   1,331,685 Bytes
Datei-SHA-256:   9a9c53a650dd41743baac660b7ceac09007919158818b664ad18eebda3903efd
contentHash:     sha256:c89cfea3b32c819997bca03cc71e3037cbb3bddaab00e0fb61db7622b7c3a1bd
```

Ein zweiter Lauf mit demselben PBF erzeugte byte-identische JSON-Dateien und denselben `contentHash`.

## 7. Straßen

```text
Highway-Ways (zulässige Typen, inkl. unbenannt): 1,526
benannt + geometrisch geeignet:                  1,208
finale Straßen:                                  461
zusammengeführte zusätzliche Ways:               747
an Municipality geclippte Ways:                  9
vollständig außerhalb:                           0
vom Validator entfernt:                          0
```

Zulässig sind unverändert `residential`, `living_street`, `unclassified`, `tertiary`, `secondary` und `primary`. Gruppiert wird wie im Legacy-Pfad zunächst nach Originalname. `official_name`, `alt_name`, `short_name` und `loc_name` werden als Aliases übernommen. Der bestehende Validator führt anschließend nur normalisierte Varianten mit sicherer räumlicher Evidenz zusammen. IDs stammen unverändert aus `geometryApi.createStreetId`; Way-IDs und Aliaslisten sind stabil sortiert.

Bei grenzschneidenden Ways werden nur die innerhalb des echten Polygons liegenden Abschnitte ins Package übernommen. Genau diese Semantik erklärt die drei größeren Längenabweichungen zum Legacy-Pfad.

## 8. POIs

```text
Osmium-Feature-Repräsentationen mit Registry-Treffer: 195
eindeutige rohe OSM-Objekte:                          117
Node:                                                 38
Way:                                                  79
Relation:                                              0
sicher dedupliziert:                                   1
außerhalb verworfen:                                   2
final:                                                114
```

Die reale Momentaufnahme enthält keinen relevanten, benannten POI als Multipolygon-Relation. Relation-POIs sind dennoch implementiert und werden durch die echte PBF-Fixture (`Hotel Testblick`) end-to-end geprüft. Flächen werden als Polygon/MultiPolygon übernommen, Nodes als Position mit `geometry: null`. Die bestehende Registry klassifiziert alle 13 Kategorien.

Finale Kategorien:

| Kategorie | Anzahl |
|---|---:|
| company | 5 |
| fire_station | 2 |
| fuel | 6 |
| hospital | 3 |
| hotel | 13 |
| kindergarten | 10 |
| nursing_care | 3 |
| police | 1 |
| public_building | 11 |
| restaurant | 23 |
| school | 15 |
| sports_facility | 13 |
| supermarket | 9 |

Verworfen wurden `VSV Wenden` (Way 783059840) und `Wasserwerk Erbscheid (Olpe Trinkwasser)` (Way 73880676). Osmiums Referenzvervollständigung hatte beide Kandidaten in den Stadt-Extrakt aufgenommen; der vorhandene Polygon-Validator stellte fest, dass sie vollständig außerhalb liegen. Drei mögliche POI-Duplikatpaare bleiben bewusst nur als Warnung bestehen.

## 9. Areas

```text
geometrische Kandidaten: 15 (einschließlich Municipality/alternativer Tiers)
übernommen:              2
verworfen/nicht gewählt: 13
```

Übernommen wurden ausschließlich mit der bestehenden TrainingArea-Heuristik kompatible administrative Untergebiete:

- `osm-way-554337580`, Olpe, `admin_level=10`, 188 Straßen
- `osm-relation-8008406`, Unterneger, `admin_level=10`, 11 Straßen

Es wurden keine Custom Areas oder Feuerwehr-Einsatzgebiete erfunden.

## 10. Package Validation

```text
Schema:                       1
bestehender City-Validator:   PASS
bestehender Package-Validator: PASS
Package-Validator Errors:     0
Package-Validator Warnings:   0
contentHash-Verifikation:     PASS
```

Der City-Validator entfernte vor Package-Bildung zwei vollständig außerhalb liegende POI-Kandidaten und führte eine sichere Node-/Way-Doppelrepräsentation zusammen. Das finale Package hat keine ungültigen Objekte; drei mögliche, nicht sicher auflösbare POI-Duplikate werden als Warnung gemeldet.

## 11. Installationstest

```text
Package
→ StaticDatasetProvider
→ bestehender Validator
→ CityStorage
→ Mock IndexedDB
→ aktive Stadt
→ CityContext

Status: PASS
```

Die aktive Stadt ist `osm-relation-163179` / Olpe; geladen werden 461 Straßen, 114 POIs und 2 Areas.

## 12. Gameplay-Kompatibilität

```text
Street Targets:          461, alle Geometrien gültig – PASS
POI Targets:             114, alle Geometrien gültig – PASS
Rundenziel auswählbar:   PASS
Geometrieauswertung:     PASS
freie Runde auswertbar:  PASS
Overpass Calls:          0
Nominatim Calls:         0
sonstige Geo-API Calls:  0
PBF im Spielpfad:        0
Browser-Smoke:           NOT VERIFIED
```

Der automatisierte Test verwendet die echte Game Engine für Start, Rundenaktivierung, Tipp und Auswertung. Der in-app Browser konnte in dieser Umgebung nicht verbunden werden; deshalb wird kein manueller UI-Smoke behauptet.

## 13. PBF-vs.-Legacy-Vergleich

Der vollständige Bericht liegt unter [`tools/dataset-builder/reports/olpe-comparison.md`](../tools/dataset-builder/reports/olpe-comparison.md).

| Merkmal | PBF | Legacy |
|---|---:|---:|
| Straßen nach Validator | 461 | 461 |
| normalisierte Straßennamen | 461 | 461 |
| POIs nach Validator | 114 | 114 |
| Boundary-Koordinaten | 557 | 557 |
| Areas | 2 | 2 |
| Validator-Warnungen | 3 | 12 |

```text
gemeinsame Straßen:                  461
nur PBF:                               0
nur Legacy:                            0
gemeinsame POI-Kategorie/Namen:       107 eindeutige Kombinationen
nur PBF:                               0
nur Legacy:                            0
auffällige Geometrieunterschiede:      3
ungeklärte Bestandsunterschiede:       0
```

Die Boundary ist trotz `MultiPolygon` (Osmium) versus `Polygon` (Legacy) nach ringrichtungs-/startpunktunabhängiger Kanonisierung identisch. Die auffälligen Straßen sind `Am Birkendrust`, `Biggeseestraße` und `Alte Landstraße`; ihre PBF-Längen sind kleiner, weil der Builder die außerhalb Olpes liegenden Way-Abschnitte entfernt. Der Legacy-Validator meldet dieselben Grenzfälle als `STREET_PARTLY_OUTSIDE_BOUNDARY` und behält den vollständigen Way.

Der PBF-Datenstand ist `2026-09-05T20:22:06Z`, der Legacy-Abruf erfolgte am `2026-09-06T09:57:22Z`. Nominatim lieferte in der Build-Umgebung HTTP 403; für den zulässigen einmaligen Overpass-Vergleich wurden deshalb Relation, Bounds und Center aus dem validierten PBF-Package verwendet. Der erste Overpass-Endpunkt lieferte 406, der zweite 429; der bereits konfigurierte Mail.ru-Failover lieferte mit bestehendem Chunking/Retry nach 12 Requests, 2 Retries und 1 Split den vollständigen Datensatz. Kein automatischer Test hängt von diesen Diensten ab.

## 14. Tests

```text
Builder Unit/Fixture Tests: 9/9 PASS
Builder Integration:        PASS
Real-PBF-Smoke:              PASS
Olpe Package Integration:   PASS
bestehende Regression:      24/24 PASS
gesamt mit neuen Suiten:    26/26 PASS
```

Die Mini-PBF-Fixture enthält eine mehrteilige Municipality-Boundary, mehrere Ways derselben Straße, einen grenzschneidenden Way, verworfene Highway-Typen, Aliases, Node-POI, Way-POI, Multipolygon-Relation-POI sowie administrative Untergebiete.

## 15. Oberasbach Regression

```text
Straßen:      271
POIs:          60
contentHash:  sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95
Datei geändert: NEIN
Status:       PASS
```

## 16. Scope-Kontrolle

```text
Browser-PBF-Verarbeitung:       NEIN
Game Engine verändert:          NEIN
Timer verändert:                NEIN
Scoring verändert:              NEIN
Legacy Overpass entfernt:       NEIN
Nominatim entfernt:             NEIN
Package Contract finalisiert:   NEIN
catalog.json implementiert:     NEIN
Deutschland-Pipeline gebaut:    NEIN
Polygonfehler repariert:        NEIN
```

## 17. Known Issues

```text
TA-POLYGON-001                  DEFERRED (unverändert)
P15-BASELINE-OFFLINE-SMOKE     NOT VERIFIED (unverändert)
Browser Olpe Smoke             NOT VERIFIED
```

Neue, nicht blockierende Beobachtungen:

- Die reale Olpe-Momentaufnahme besitzt keinen POI-Registry-Treffer als Relation; der Relation-Pfad ist über echte PBF-Testdaten verifiziert.
- Der Live-Nominatim-Aufruf wurde extern mit 403 abgelehnt; dies betrifft weder Builder noch Package-/Spielpfad.
- Drei POI-Paare bleiben als mögliche Duplikate markiert, weil der vorhandene Validator keine sichere Merge-Evidenz findet.

## 18. Kandidaten für Phase 15.3

- Builder-Provenienz (`sourcePbf`, `osmDataTimestamp`, `builderVersion`, Municipality-Key) als optionalen, dokumentierten Contract-Bestandteil entscheiden.
- Festlegen, ob `Polygon` und ein einteiliges `MultiPolygon` kanonisch gleich serialisiert werden sollen.
- Einen expliziten Package-Platz für Builder-Warnungen/verworfene Kandidaten erwägen; aktuell bleiben diese im externen Build-Report.
- Klären, ob das aktuelle `package.version` bei OSM-Paketen Builder- oder Dataset-Version ausdrücken soll.

Diese Punkte wurden in Phase 15.2 nicht als Schemaänderung umgesetzt.

## 19. Exit Gate

| Kriterium | Status |
|---|---|
| Dataset Builder außerhalb Browser vorhanden | PASS |
| reales NRW-PBF erfolgreich gelesen | PASS |
| Olpe Municipality Boundary korrekt bestimmt | PASS |
| Boundary Polygon/MultiPolygon gültig | PASS |
| Straßen aus PBF extrahiert | PASS |
| Straßen auf Municipality begrenzt | PASS |
| Straßen normalisiert | PASS |
| mehrere Ways sinnvoll zusammengeführt | PASS |
| POIs über bestehende Registry klassifiziert | PASS |
| Node-/Way-/Relation-POIs berücksichtigt | PASS |
| administrative Areas verarbeitet | PASS |
| aktuelles Package-Schema verwendet | PASS |
| Package validiert | PASS |
| contentHash erzeugt | PASS |
| reales Olpe-Package erzeugt | PASS |
| Olpe-Package über DatasetProvider installierbar | PASS |
| IndexedDB-Installation | PASS |
| CityContext für Olpe | PASS |
| Street Targets | PASS |
| POI Targets | PASS |
| Game-Kompatibilität automatisiert | PASS |
| während Spielpfad Overpass 0 | PASS |
| während Spielpfad Nominatim 0 | PASS |
| PBF-vs.-Legacy-Vergleich durchgeführt | PASS |
| Unterschiede analysiert/dokumentiert | PASS |
| Builder Unit Tests | PASS |
| Builder Integration Tests | PASS |
| Real-PBF-Smoke | PASS |
| komplette bestehende Regression | PASS (24/24) |
| Oberasbach 271 / 60 unverändert | PASS |
| Oberasbach Hash unverändert | PASS |
| git diff --check | PASS |
| Game Engine unverändert | PASS |
| Legacy Overpass weiterhin vorhanden | PASS |
| TA-POLYGON-001 weiterhin DEFERRED | PASS |
| kein Dataset-Katalog implementiert | PASS |
| kein endgültiges Package Contract implementiert | PASS |
| keine Deutschland-Massenpipeline implementiert | PASS |

```text
Browser Olpe Smoke: NOT VERIFIED
```

## 20. Fazit

Der technische End-to-End-Beweis vom echten regionalen OSM-PBF bis zu validierten, installierten und spielbaren Olpe-Targets ist erbracht. Alle 24 bestehenden und beide neuen Testsuiten sind grün; der Browser-Smoke bleibt separat `NOT VERIFIED` und ist kein Builderfehler.

```text
PHASE 15.2 COMPLETE
READY FOR PHASE 15.3
```
