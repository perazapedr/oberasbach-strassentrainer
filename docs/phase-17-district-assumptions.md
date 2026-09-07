# Phase 17 – analysierte Annahmen vor der District-Generalisation

Stand der Analyse: PBF `nordrhein-westfalen-latest.osm.pbf`, OSM-Zeitstempel `2026-09-05T20:22:06Z`.

## Bestehende Architektur

- Der PBF-Builder wählt genau eine administrative Relation, extrahiert deren Polygon und verwendet dieselbe Normalize/Validate/Hash-Kette für alle Pakete.
- Straßen-Ways werden an der Zielgrenze geclippt. `buildStreets()` gruppiert bislang datasetweit allein nach dem exakten Straßennamen; IDs bestehen aus `cityId + createStreetId(name)`.
- Mehrere OSM-Ways gleichen Namens werden zu einer `MultiLineString` mit sortierten `osmWayIds` zusammengeführt. Eingabe- und Object-Iteration dürfen die Ausgabe nicht beeinflussen.
- Der Validator ordnet vorhandene `areas` geometrisch den Straßen und POIs über `areaIds` zu. Der Browser filtert offizielle Areas bereits rein lokal über diese Membership.
- Areas verwenden stabile OSM-IDs (`osm-relation-<id>`), `kind=administrative`, `source=osm`, `parentId` und Polygongeometrie. Benutzer-Areas verwenden dieselbe Storage-Tabelle, sind aber durch `source=user` und `kind=custom|response_area` getrennt.
- POI-Identität ist OSM-Typ plus OSM-ID im Dataset-Kontext. Die bestehende POI-Kategorieregistry wird nicht verändert.
- `datasetKind=district` ist im Package- und Catalog-Schema bereits zulässig. `CityContext`, IndexedDB und Statistik sind historisch benannt, aber technisch über die Dataset-/City-ID isoliert.
- Whole-Dataset-Modus ist `activeArea=null`; es wird keine künstliche Root-Area benötigt.

## Minimale Generalisation

- Der bestehende Builder erhält `targetType=municipality|district`; es entsteht kein zweiter District-Builder.
- District-Straßen werden zuerst gegen jede automatisch entdeckte, enthaltene Municipality-Grenze geclippt. Dedupe/Merge gilt danach innerhalb des Schlüssels `municipality area ID + normalized street identity`.
- District-Straßen-ID: `district cityId + municipality relation ID + stabiler Straßen-Slug`. Damit bleiben gleichnamige Straßen verschiedener Gemeinden getrennt und unabhängig von Array- oder Build-Reihenfolge.
- Ein grenzüberschreitender Way erzeugt deterministische, municipality-spezifisch geclippte Segmente. Der Way darf deshalb in mehreren Street Records mit verschiedener Municipality-ID vorkommen.
- Der kanonische Name bleibt unverändert. `displayName` wird nur bei einer districtweiten Namenskollision mit `· <Municipality>` ergänzt.
- Municipality-Areas sind offizielle Dataset-Areas. Ihre Relation, AGS, Geometrie und Containment-Evidenz bleiben im Paket/Buildreport nachvollziehbar.
- District-City-ID und Package-ID sind beide eigenständig (`osm-relation-1891506` bzw. `de-nw-kreis-olpe`) und können Municipality Olpe (`osm-relation-163179`, `de-nw-olpe`) nicht überschreiben.

## Discovery-Finding

Die eindeutige Kreisrelation ist `1891506`, `admin_level=6`, AGS und Regionalschlüssel `05966`, Geometrietyp Polygon. Der durch Osmiums OPL-Codepoint-Escaping kodierte Rohwert wird korrekt als `Kreis Olpe` dekodiert. Relation, Admin-Level, amtlicher Schlüssel und Name sind damit konsistent; der Rohwert wird im Buildreport erhalten.

Nicht Teil dieser Phase sind Game-Engine-Änderungen, ein eigener District-Validator, der Polygoneditor, Einsatzgebiete oder kuratierte Feuerwehrdaten.
