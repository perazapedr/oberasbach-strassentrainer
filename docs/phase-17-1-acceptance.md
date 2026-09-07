# Abnahme: PRE-GATE 16.2, Phase 17 und Phase 17.1

Stand: 7. September 2026

## 1. PRE-GATE 16.2

- Canonical Package ID: `de-oberasbach-fire-training` stammt ausschließlich aus `package.id`. Catalog, Repository-Verzeichnis, Delivery Manifest und Package verwenden exakt diese ID.
- Immutable URL: `datasets/<package.id>/<version>/<canonical-byte-sha256>/package.json`.
- History: vorhandene immutable Package-Stände werden beim erneuten Publish übernommen. Eine bereits belegte URL mit anderen Bytes wird abgewiesen.
- Publisher- und Catalog-Determinismus: gleicher Input erzeugt byte-identische Artefakte und einen deterministischen Katalogzeitpunkt.
- Realer Update-Test: Olpe `2026.09.05 → 2026.09.06`; Diff `+1/-1` Straße und `+1/-1` POI; die bestehende reale Statistik blieb erhalten.
- Stale Cache: V1 und V2 werden über verschiedene URLs geladen. Query-String-Zufalls-Caches werden nicht verwendet.
- Subpath: relative immutable Pfade werden vom `CatalogDatasetProvider` auch unter einem Repository-Unterpfad korrekt aufgelöst.
- Ergebnis: alle PRE-GATE-Punkte PASS.

## 2. Phase-17-Discovery

Quelle war der lokale `nordrhein-westfalen-latest.osm.pbf`, OSM-Stand `2026-09-05T20:22:06Z`.

Kreis Olpe:

- Relation: `1891506`
- `boundary=administrative`, `admin_level=6`
- amtlicher Kreisschlüssel: `05966`
- Geometrie: Polygon
- PBF-Rohname: `Kreis Olpe`; Osmiums `%…%`-Codepoint-Escaping wird vom Builder korrekt dekodiert. Relation, Verwaltungsebene, Schlüssel und Name sind konsistent.

Automatisch entdeckte und vollständig enthaltene Gemeinden:

| Name | Relation | adminLevel | AGS |
|---|---:|---:|---|
| Attendorn | 163178 | 8 | 05966004 |
| Drolshagen | 163174 | 8 | 05966008 |
| Finnentrop | 163177 | 8 | 05966012 |
| Kirchhundem | 163175 | 8 | 05966016 |
| Lennestadt | 1891508 | 8 | 05966020 |
| Olpe | 163179 | 8 | 05966024 |
| Wenden | 160880 | 8 | 05966028 |

Alle sieben Boundary-Geometrien sind fachliche Child Areas und geometrisch innerhalb der Kreisgrenze. Gleichrangige Nachbarkommunen wurden verworfen.

## 3. District-Build

- Dataset ID: `de-nw-kreis-olpe`
- City ID: `osm-relation-1891506`
- `datasetKind`: `district`
- Version: `2026.09.07`
- semantischer Content Hash: `sha256:1c076dc3988e06c6019b982a6521196b83830d2b7ab0b110f438aa1352be7455`
- Straßen: 2.756
- POIs: 623
- Municipalities/Areas: 7/7
- Pipeline gesamt: 118,81 s
- Builder: 116,47 s
- Child Peak RSS: 644.366.336 Bytes (614,5 MiB)
- Raw: 8.865.919 Bytes
- gzip Level 9: 873.063 Bytes
- Brotli Quality 11: 579.878 Bytes

Ein unabhängiger zweiter Build aus demselben PBF, Manifest, Builder und derselben Version war byte-identisch und hatte denselben semantischen Hash.

## 4. Street Identity

Municipality-Datasets behalten ihre bisherige Identität. Im District lautet der Scope `dataset + municipality + normalisierte Straßenidentität`.

- 277 normalisierte Namen kommen in mehreren Gemeinden vor; der QA-Report enthält dafür 739 Municipality-Zeilen.
- Beispiel: `Agathastraße` besitzt getrennte IDs für Attendorn, Finnentrop, Lennestadt, Olpe und Wenden.
- District-Anzeige bei Mehrdeutigkeit: `Agathastraße · Olpe`.
- Municipality-Anzeige, wenn dort eindeutig: `Agathastraße`.
- 17 OSM-Ways überschreiten Municipality-Grenzen und ergeben 32 geclippte Municipality-Straßeneinträge.
- Null nicht zugeordnete Street-Ways.
- Numerische Split-Artefakte bis einschließlich 1 mm werden verworfen; der finale Build enthält null Nullsegmente und null Segmentmittelpunkte außerhalb ihrer Municipality.

## 5. Package, Pipeline und Publisher

- Schema-1-Package-Contract: PASS
- `verifyPackageHash()`: PASS
- `validateCityPackage()`: PASS
- `validateCityData()`: PASS
- Region-aware Pipeline: PASS, beim finalen Wiederholungslauf deterministisch `UNCHANGED`
- Source Catalog: PASS
- gehärteter Publisher: 7/7 Pakete PASS, inklusive gzip und Brotli
- immutable Package-URL: `datasets/de-nw-kreis-olpe/2026.09.07/37e03fb632601f520634758113f8431665993839f2326bbaa48a3ed25786f152/package.json`
- Delivery Manifest und Package liegen im selben immutable Verzeichnis.

## 6. Browser Phase 17

Echter Headless Google Chrome wurde über CDP gesteuert. Der sichtbare Benutzerpfad suchte `Kreis Olpe`, prüfte die Kennzeichnung `Typ Landkreis`, lud das immutable Publisher-Paket, validierte Hash und Package, speicherte es in IndexedDB und aktivierte es.

Eine freie Runde enthielt eine nichtleere Frage, ein vorhandenes Ziel und valide Geometrie. Ein nativer CDP-Mausklick auf die Karte erzeugte endliche Distanz und Punkte. Nach CDP-Offline-Schaltung und Reload wurde der District aus IndexedDB geladen und erneut mit echter Frage, Geometrie, Karteninteraktion, Distanz und Score gespielt.

- Nominatim: 0
- Overpass: 0
- Offline-Runde Catalog Requests: 0
- Offline-Runde Package Requests: 0

## 7. Exit Gate Phase 17

Jeder Punkt ist einzeln PASS:

- PASS — Kreis-Olpe-Relation eindeutig
- PASS — District Boundary valide
- PASS — Mitgliedskommunen automatisch entdeckt
- PASS — alle Mitgliedskommunen plausibel vertreten
- PASS — keine Nachbarkommune aufgenommen
- PASS — Dataset-ID eindeutig
- PASS — `datasetKind=district`
- PASS — bestehender Builder generalisiert
- PASS — kein zweiter District Builder
- PASS — Street Identity municipality-aware
- PASS — gleiche Namen über Gemeinden getrennt
- PASS — Street-IDs deterministisch
- PASS — Grenzstraßen deterministisch
- PASS — Municipality Membership vorhanden
- PASS — Display Names disambiguiert
- PASS — POIs district-wide
- PASS — POI Municipality Membership
- PASS — Package Contract
- PASS — Package Hash
- PASS — beide Validatoren
- PASS — Doppelbuild-Determinismus
- PASS — Performance gemessen
- PASS — region-aware Pipeline
- PASS — gehärteter Publisher
- PASS — immutable URL
- PASS — Catalog und typisierte Suche
- PASS — normaler Installationspfad
- PASS — IndexedDB
- PASS — CityContext
- PASS — Street-/POI-Targets
- PASS — echter Chrome-Browserlauf
- PASS — echte nichtleere Frage
- PASS — nativer Kartenklick, endliche Distanz und Score
- PASS — Offline-Reload und Offline-Runde
- PASS — Statistik von Municipality Olpe getrennt
- PASS — Nominatim 0
- PASS — Overpass 0
- PASS — Municipality-Regression
- PASS — Oberasbach Golden Master
- PASS — vollständige Tests
- PASS — JavaScript-Syntax
- PASS — `git diff --check`
- PASS — Game Engine unverändert
- PASS — TA-POLYGON-001 weiterhin DEFERRED
- PASS — Phase 17.2 nicht begonnen

Ergebnis: **PHASE 17 COMPLETE**.

## 8. Phase-17.1-Areas

| Name | Area ID | Parent | Straßen | POIs |
|---|---|---|---:|---:|
| Attendorn | `osm-relation-163178` | `osm-relation-1891506` | 434 | 137 |
| Drolshagen | `osm-relation-163174` | `osm-relation-1891506` | 329 | 60 |
| Finnentrop | `osm-relation-163177` | `osm-relation-1891506` | 332 | 110 |
| Kirchhundem | `osm-relation-163175` | `osm-relation-1891506` | 241 | 43 |
| Lennestadt | `osm-relation-1891508` | `osm-relation-1891506` | 521 | 122 |
| Olpe | `osm-relation-163179` | `osm-relation-1891506` | 470 | 114 |
| Wenden | `osm-relation-160880` | `osm-relation-1891506` | 463 | 37 |

Die Areas sind amtliche Dataset-Areas (`kind=administrative`, `areaType=municipality`, `official=true`, `source=osm`) mit stabiler OSM-Relations-ID. Es gibt keine künstliche Root Area; `activeArea=null` bleibt der Whole-Dataset-Modus.

## 9. Hierarchie

```text
Kreis Olpe (osm-relation-1891506)
├── Attendorn
├── Drolshagen
├── Finnentrop
├── Kirchhundem
├── Lennestadt
├── Olpe
└── Wenden
```

## 10. Browser TrainingAreas

Der echte Chrome-Test deckt ab:

- Whole District: echte Online-Runde, danach erneute echte Runde nach der Switching-Matrix
- Olpe: 470 Straßen/114 POIs, echte Runde
- Wenden: 463 Straßen/37 POIs, echte Runde
- weitere Municipality: Attendorn mit 434 Straßen/137 POIs, echte Runde
- Switching ohne Reload: Whole → Olpe → Wenden → Attendorn → Whole
- Online-Reload: aktive Area Olpe wurde wiederhergestellt und gespielt
- Offline-Reload: District und Area Olpe wurden aus lokalem Speicher wiederhergestellt und gespielt

Jede Browserrunde prüft nichtleere Frage, vorhandenes Ziel, valide Zielgeometrie, tatsächliche Area-Membership, nativen Kartenklick sowie endliche Distanz und Punkte.

## 11. Membership und Update Safety

- Street: ausschließlich lokale Filterung über `areaIds`; keine API und kein Rebuild
- POI: analog; alle 623 Referenzpunkte liegen in ihrer Municipality
- Boundary: Phase-17-Clipping wird unverändert verwendet
- Duplicate Names: District-Label disambiguiert, Municipality-Label datengetrieben verkürzt
- Statistik: bleibt eine Statistik pro Dataset und wuchs in der Browser-Switching-Matrix von 1 auf 5 ausgewertete Runden
- Update: offizielle Areas werden ersetzt; lokale `custom`-/`response_area`-Areas bleiben erhalten

Der Browser-Test deckte zusätzlich einen alten Rundenschlüssel-Fehler nach Area-Wechseln auf. Der App-Layer startet nun eine neue Free-Game-Identität, sodass jede Runde einen eindeutigen Statistikschlüssel erhält. Die Game Engine wurde nicht verändert.

### Exit Gate Phase 17.1

- PASS — alle sieben Kreisgemeinden als Areas
- PASS — keine fremden Gemeinden
- PASS — District→Municipality-Hierarchie
- PASS — stabile Area-IDs
- PASS — Geometry Containment
- PASS — Street Membership
- PASS — POI Membership
- PASS — Boundary Streets
- PASS — Whole-District-Modus
- PASS — Olpe-Modus
- PASS — Wenden-Modus
- PASS — weitere Municipality (Attendorn)
- PASS — UI-Auswahl
- PASS — Switching ohne Reload
- PASS — Targets tatsächlich in aktiver Area
- PASS — Duplicate-Name-UX
- PASS — Online-Reload
- PASS — Offline-Reload und Offline-Gameplay
- PASS — Datasetstatistik erhalten
- PASS — Custom Areas erhalten
- PASS — Update-Regression
- PASS — Publisher-Regression
- PASS — Pipeline-Regression
- PASS — Municipality-Dataset-Regression
- PASS — echte Browserfragen
- PASS — native Browser-Klicks
- PASS — endliche Browser-Scores
- PASS — Nominatim 0
- PASS — Overpass 0
- PASS — Performance praktikabel
- PASS — vollständige Tests
- PASS — JavaScript-Syntax
- PASS — `git diff --check`
- PASS — Game Engine unverändert
- PASS — TA-POLYGON-001 weiterhin DEFERRED
- PASS — Phase 17.2 nicht begonnen
- PASS — Phase 17.3 nicht begonnen
- PASS — Phase 18 nicht begonnen

## 12. Performance

Reale Chrome-Messungen eines repräsentativen Laufs:

- District Download, Validierung, IndexedDB-Speicherung und Aktivierung: ca. 1,31 s
- Municipality Switch: 4,1–8,5 ms (Reload-No-op 0 ms)
- Target Filter: 1,7–2,5 ms (Reload-Messung 6,3 ms)
- Time to first question: 14,7–22,9 ms

Node-Messung des finalen Pakets:

- JSON parse: ca. 21,6 ms
- vollständige Validierung: ca. 247,5 ms
- Mock-IDB save/load: ca. 38,9/34,0 ms
- Target Preparation: ca. 4,5 ms

Die Werte sind praktikabel; es wurde keine vorzeitige Optimierung vorgenommen.

## 13. Regression

- vollständige Node-Test-Suite: PASS
- Pipeline: PASS
- Publisher: PASS
- Catalog und CatalogProvider: PASS
- realer V1→V2-Updatepfad: PASS
- Wenden, Köln, Zirndorf und Kreis Olpe im echten Browser: PASS
- Online-/Offline-Reload: PASS
- alle Nicht-Vendor-JavaScriptdateien: Syntax PASS
- `git diff --check`: PASS

## 14. Golden Master

Oberasbach blieb exakt unverändert:

- ID: `de-oberasbach-fire-training`
- 271 Straßen
- 60 POIs
- 0 Areas
- Hash: `sha256:1a0854340fa6519d7a3947b0726767e45aca323dfeaadaefff999801bb921b95`
- Status: PASS

## 15. Scope

- Game Engine geändert: NEIN
- Phase 17.2 implementiert: NEIN
- Phase 17.3 implementiert: NEIN
- Phase 18 implementiert: NEIN
- Polygoneditor geändert: NEIN
- kuratierte Feuerwehrpakete ergänzt: NEIN

## 16. Known Issues

- TA-POLYGON-001: DEFERRED
- Der zuvor falsch dekodierte OPL-Rohname (`Kreis %Olpe`) wurde als Builderfehler identifiziert, behoben und mit Unicode-/Escape-Regressionstest abgesichert.

## 17. Fazit

**PRE-GATE 16.2 HARDENING COMPLETE**  
**PHASE 17 COMPLETE**  
**PHASE 17.1 COMPLETE**

READY FOR NEXT COMBINED PHASE.

## 18. Nächster Schritt (nicht implementiert)

Phase 17.2 Feuerwehr-Einsatzgebiete, Phase 17.3 Polygoneditor finalisieren und Phase 18 kuratierte Feuerwehr-Pakete.
