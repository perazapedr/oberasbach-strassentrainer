# Olpe: OSM-PBF vs. Legacy Overpass

Der Vergleich ist ein einmaliger Diagnose-Lauf und kein netzabhängiger Regressionstest. Der PBF-Zeitpunkt stammt aus dem Dateiheader; der Legacy-Zeitpunkt ist der Abrufzeitpunkt, weil Overpass in diesem Pfad keinen äquivalenten Snapshot-Zeitpunkt liefert.

## Datenstände

- PBF: `2026-09-05T20:22:06.000Z`
- Legacy-Abruf: `2026-09-06T09:57:22.387Z`
- PBF-Relation: `163179`
- Legacy-Relation: `163179`

## Übersicht

| Merkmal | PBF | Legacy |
|---|---:|---:|
| Straßen vor Validator | 461 | 461 |
| Straßen nach Validator | 461 | 461 |
| normalisierte Straßennamen | 461 | 461 |
| POIs vor Validator | 117 | 115 |
| POIs nach Validator | 114 | 114 |
| Boundary-Typ | MultiPolygon | Polygon |
| Boundary-Koordinaten | 557 | 557 |
| Areas nach Validator | 2 | 2 |
| Duplikate zusammengeführt | 1 | 1 |
| Validator-Fehler | 0 | 0 |
| Validator-Warnungen | 3 | 12 |
| vor Package-Bildung verworfene Kandidaten | 2 | 0 |

Boundary kanonisch identisch: **JA**

## Straßen

- Gemeinsam: 461
- Nur PBF: 0
- Nur Legacy: 0

### Nur PBF

- keine

### Nur Legacy

- keine

### Auffällige Längenabweichungen

| Straße | PBF m | Legacy m | Abweichung |
|---|---:|---:|---:|
| Am Birkendrust | 633 | 1488 | 57.5 % |
| Biggeseestraße | 868 | 1316 | 34.1 % |
| Alte Landstraße | 1324 | 1688 | 21.5 % |

## POIs nach Kategorie

| Kategorie | PBF | Legacy |
|---|---:|---:|
| company | 5 | 5 |
| fire_station | 2 | 2 |
| fuel | 6 | 6 |
| hospital | 3 | 3 |
| hotel | 13 | 13 |
| kindergarten | 10 | 10 |
| nursing_care | 3 | 3 |
| police | 1 | 1 |
| public_building | 11 | 11 |
| restaurant | 23 | 23 |
| school | 15 | 15 |
| sports_facility | 13 | 13 |
| supermarket | 9 | 9 |

- Gemeinsame Kategorie/Name-Kombinationen: 107
- Nur PBF: 0
- Nur Legacy: 0

### POIs nur PBF

- keine

### POIs nur Legacy

- keine

## Administrative Areas

- PBF: Olpe, Unterneger
- Legacy: Olpe, Unterneger

## Warnungen

### PBF

- POI_POSSIBLE_DUPLICATE: osm-relation-163179:poi:way-157756257
- POI_POSSIBLE_DUPLICATE: osm-relation-163179:poi:way-157756260
- POI_POSSIBLE_DUPLICATE: osm-relation-163179:poi:way-345260907

### Legacy

- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-alte-landstrasse-qbgbzb
- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-am-birkendrust-b6qpkq
- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-biebergstrasse-1ilrldg
- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-biggeseestrasse-1rta05r
- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-hueppcherhammer-5pd33b
- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-koblenzer-strasse-3z6xuo
- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-thieringhauser-strasse-1fu625y
- STREET_PARTLY_OUTSIDE_BOUNDARY: osm-relation-163179:street-woermge-vvxhn9
- POI_DUPLICATE_MERGED: osm-relation-163179:poi:way-683196123
- POI_POSSIBLE_DUPLICATE: osm-relation-163179:poi:way-157756257
- POI_POSSIBLE_DUPLICATE: osm-relation-163179:poi:way-157756260
- POI_POSSIBLE_DUPLICATE: osm-relation-163179:poi:way-345260907

### Vom PBF-Builder vor dem Package verworfen

- POI_OUTSIDE_BOUNDARY: osm-relation-163179:poi:way-783059840
- POI_OUTSIDE_BOUNDARY: osm-relation-163179:poi:way-73880676

## Live-Dienstdiagnose

- Nominatim: FAIL (Nominatim returned HTTP 403.); validierte PBF-Metadaten als Fallback
- Overpass-Endpunkt: https://maps.mail.ru/osm/tools/overpass/api/interpreter
- Overpass-Requests/Retry/Splits: 12 / 2 / 1

## Einordnung

- Zeitbedingt: Unterschiede können durch den nicht atomar identischen Datenstand entstehen; der Legacy-Abrufzeitpunkt ist nur eine Obergrenze für den Live-Datenstand.
- Abfragesemantik: Der PBF-Builder clippt grenzschneidende Straßen an der echten Municipality-Boundary. Der Legacy-Pfad behält vollständige Overpass-Way-Geometrien und meldet teilweise außerhalb liegende Straßen nur als Warnung.
- Normalisierung: Beide Pfade verwenden dieselbe Highway-Liste, POI-Registry, Straßen-Normalisierung und denselben Validator.
- Ungeklärt: keine namensbasierten Bestandsunterschiede.

## Fazit

Beide Datensätze werden vom bestehenden City-Validator akzeptiert. Abweichungen sind anhand der obigen Einzelwerte prüfbar.
