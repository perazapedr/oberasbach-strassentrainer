# Masterplan 2.0 – Straßentrainer Deutschland

> **OpenStreetMap bleibt die Datenquelle, aber Overpass verschwindet aus dem produktiven Datenpfad.**

Das ist kein Neubau des Straßentrainers. Die vorhandene Architektur wird weiterverwendet; geändert wird vor allem, **wie neue Stadt-/Gebietsdaten entstehen und zur Anwendung gelangen**. Das entspricht auch dem bisherigen Grundsatz, Game Engine, Timer, Punkteberechnung und grundlegende Statistik beim Datenumbau möglichst unangetastet zu lassen.

**Stand:** September 2026
**Strategische Änderung:** OSM-Nutzung ohne produktive Overpass-Abhängigkeit

---

# 1. Zielbild

Aus dem ursprünglichen Oberasbach-Straßentrainer soll ein **allgemeiner, zuverlässiger, offlinefähiger Straßentrainer für deutsche Gemeinden, Städte und später Landkreise bzw. Feuerwehr-Einsatzgebiete** werden.

Ein Nutzer soll perspektivisch:

```text
Straßentrainer öffnen
        ↓
Ort / Landkreis suchen
        ↓
verfügbares Dataset auswählen
        ↓
fertiges Datenpaket herunterladen
        ↓
Validierung
        ↓
IndexedDB
        ↓
Gebiet ist installiert
        ↓
komplett lokales Training
```

können.

Während einer Spielrunde finden **keine OSM-, Overpass-, Nominatim- oder sonstigen Geodatenabfragen** statt.

Dieses lokale Spielprinzip war bereits Kern des bisherigen Masterplans: Nach der Installation sollten Straßen, POIs und Geometrien lokal vorliegen und von dort während der Spielsitzung verwendet werden.

---

# 2. Neue zentrale Architektur

## Bisher

```text
Browser
  │
  ├── Nominatim
  │
  └── Overpass
        │
        ▼
Straßen / POIs / Grenze
        │
        ▼
Validator
        │
        ▼
IndexedDB
        │
        ▼
Spiel
```

## Ziel

```text
                    OpenStreetMap
                         │
                         ▼
                 regionale OSM-PBFs
                         │
                         ▼
                 Dataset Builder
                 außerhalb Browser
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
         Städte       Gemeinden     Landkreise
           │             │             │
           └─────────────┬─────────────┘
                         ▼
               Straßentrainer Package
                         │
                         ▼
                Dataset Repository/CDN
                         │
                         ▼
                      Browser
                         │
                         ▼
                     Validator
                         │
                         ▼
                     IndexedDB
                         │
                         ▼
                 vollständig lokales
                       Training
```

Der entscheidende Architekturpunkt lautet:

> **Der Browser verarbeitet keine großen OSM-Rohdaten.**

Die aufwendige Verarbeitung passiert einmal zentral oder automatisiert.

---

# 3. Was weiterhin erhalten bleibt

Der Architekturwechsel soll ausdrücklich **nicht** bedeuten, dass wir die bisherige Arbeit wegwerfen.

Weiterverwendet werden insbesondere:

- IndexedDB
- `cities`
- `streets`
- `pois`
- `areas`
- CityContext
- Geometrie-Engine
- Targets
- Game Engine
- Timer
- Punkteberechnung
- Statistik
- Stadtwechsel
- TrainingAreas
- lokale Offlinekarte
- Service Worker
- Package-Import/Export
- Package-Versionen
- `contentHash`
- Update-Diff
- POI-Registry
- kuratiertes Oberasbach-Paket
- bestehende Tests

Der bisherige Masterplan sah ohnehin vor, hauptsächlich die Datenzuführung dynamisch zu machen, während das eigentliche Spiel weitgehend unverändert bleibt.

---

# 4. Was langfristig ersetzt wird

Diese Komponenten verlieren ihre zentrale Rolle:

```text
Nominatim-Suche
Overpass Boundary Download
Overpass Straßen Download
Overpass POI Download
Overpass Chunking im Browser
Overpass Retry
Overpass Failover
```

Sie werden zunächst **nicht sofort gelöscht**.

Die Migration erfolgt nach dem Prinzip:

```text
Neue Architektur bauen
↓
testen
↓
parallel mit alter Architektur vergleichen
↓
neue Architektur freigeben
↓
erst dann Overpass entfernen
```

Das verhindert einen Big-Bang-Umbau.

---

# 5. Datenqualitäts-Grundsatz

OpenStreetMap bleibt die Ausgangsdatenquelle.

Aber:

> **OSM-Rohdaten werden niemals ungeprüft direkt als Trainingsdaten verwendet.**

Der bisherige Masterplan formuliert bereits denselben Grundsatz: OSM liefert Ausgangsdaten, die Anwendung prüft und normalisiert sie, bevor daraus ein spielbares Paket entsteht.

Die neue Pipeline wird deshalb:

```text
OSM
↓
extrahieren
↓
normalisieren
↓
deduplizieren
↓
klassifizieren
↓
validieren
↓
Paket erzeugen
↓
Hash erzeugen
↓
veröffentlichen
```

---

# 6. Status der bisherigen Entwicklung

## Phasen 0–10.5 – Multi-City-Grundsystem

**Status: ✅ abgeschlossen**

Enthalten:

- Ausgangszustand abgesichert
- IndexedDB
- Stadtverwaltung
- dynamische CityContext-Struktur
- Straßen
- POIs
- Validierung
- Stadtwechsel
- lokale Geometrien
- getrennte Statistik
- Oberasbach-Defaultpaket
- Import/Export
- Fehlerarchitektur
- große Städte / Chunking

Diese Arbeit bleibt vollständig relevant.

---

# 7. Phase 11 – QA und reale Städte

**Status: ✅ abgeschlossen**

Getestet wurden unterschiedliche Größenordnungen und reale OSM-Daten.

Ziel war insbesondere sicherzustellen:

- kleine Gemeinden funktionieren
- mittlere Städte funktionieren
- größere Städte funktionieren
- MultiLineStrings
- Datenmengen
- Performance
- Persistenz

---

# 8. Phase 12 – Performance

**Status: ✅ abgeschlossen**

Grundprinzip:

```text
Stadt aktivieren
↓
relevante Daten einmal laden
↓
im Arbeitsspeicher halten
↓
während der Spielsitzung verwenden
```

Der ursprüngliche Masterplan sieht genau dieses Verhalten vor.

---

# 9. Phase 12.5 – TrainingAreas

**Status: ✅ Grundarchitektur abgeschlossen**

Vorhanden:

- administrative Gebiete
- `areas`-Store
- Hierarchie
- Straßen können mehreren Gebieten angehören
- POI-Zuordnung
- lokale Filterung
- aktive TrainingArea
- keine getrennte Statistik pro Area

Die Grundarchitektur bleibt bestehen.

---

# 10. Phase 13 – Offlinefähigkeit

## 13.1 Offline-Grundsystem

**Status: ✅**

- Leaflet lokal
- Turf lokal
- Service Worker
- App Shell
- installierte Städte offline spielbar

## 13.2 Offline-Basemap

**Status: ✅**

Auch ohne externe Kartenkacheln kann aus den lokal gespeicherten Geometrien eine einfache Karte erzeugt werden.

Damit ist das Spiel nach einer Dataset-Installation weitgehend unabhängig von externen Diensten.

---

# 11. Phase 14 – Erweiterungen

## 14.1 Stadtupdate und Versionsvergleich

**Status: ✅**

Vorhanden:

```text
alte Version
↓
neues Dataset
↓
deterministischer Diff
↓
Straßen hinzugefügt
Straßen entfernt
POIs hinzugefügt
POIs entfernt
↓
atomisches Update
```

Für die neue Architektur ist das sogar besonders wertvoll.

---

## 14.2 Erweiterte POI-Kategorien

**Status: ✅**

Vorhandene Registry u. a.:

- Feuerwehr
- Polizei
- Krankenhaus
- Pflege
- Tankstellen
- Schulen
- Kitas
- Unternehmen
- Hotels
- Gastronomie
- Sportstätten
- öffentliche Gebäude

Der alte Masterplan sah diese Erweiterung ausdrücklich vor.

---

## 14.3 Paketmodell

**Status: ✅**

Vorhanden:

- Package-ID
- Package-Typ
- Version
- Metadaten
- Hash
- Update-Regeln
- curated / OSM
- Oberasbach-Paket

Dieses System wird zum **zentralen Übergabepunkt der neuen OSM-Pipeline**.

---

## 14.3a Trust-Semantik

**Status: ✅**

Wichtige Trennung:

```text
Kuratiert
≠
kryptografisch verifiziert
```

SHA-256 bestätigt Datenintegrität, aber keine Identität des Herausgebers.

---

# 12. Phase 14.4a – lokale Trainingsgebiete

**Status: 🟡 teilweise fertig / eingefroren**

Funktionierend:

- Datenmodell
- Response Areas
- Custom Areas
- Zeicheneditor
- Persistenz
- Pan/Zoom
- Membership-Architektur
- Update-Erhaltung

Bekannter Fehler:

> Ein eindeutig innerhalb Oberasbachs gezeichnetes Polygon wird im realen Browser teilweise weiterhin als außerhalb erkannt.

### Entscheidung

Der Fehler wird **nicht gelöscht oder ignoriert**, aber momentan zurückgestellt.

Status:

```text
KNOWN ISSUE
Deferred
kein Blocker für Dataset-Pipeline
```

In der normalen UI kann die Funktion gegebenenfalls als **Beta** markiert oder temporär ausgeblendet werden.

Der ursprüngliche Masterplan klassifiziert frei definierte Regionen und Feuerwehr-Einsatzgebiete ohnehin als erweiterte Trainingsgebiete für einen späteren Ausbau.

---

# 13. Neue Phase 15 – Overpass-freie Dataset-Architektur

Das ist ab jetzt der **zentrale Entwicklungsstrang**.

---

# Phase 15.0 – Architektur einfrieren und Ausgangspunkt sichern

### Ziel

Bevor die neue Pipeline beginnt:

- Git-Stand sichern
- sämtliche Tests ausführen
- bekannten Polygonfehler dokumentieren
- Overpass-Code unangetastet lassen
- keine Game-Engine-Änderungen

### Ergebnis

Ein klar reproduzierbarer Ausgangspunkt.

### Exit Gate

```text
bestehende Regression     PASS
Oberasbach 271 / 60       PASS
Spielmodi                 PASS
Statistik                 PASS
Offline                   PASS
Known Issues dokumentiert PASS
```

---

# Phase 15.1 – Dataset Source Abstraction

**Priorität: 🔴 jetzt**

### Ziel

Der Straßentrainer darf intern nicht mehr voraussetzen:

> „Eine Stadt kommt von Overpass.“

Stattdessen wird eine neutrale Datenquelle eingeführt.

Konzeptionell:

```text
DatasetProvider
```

mit Aufgaben wie:

```text
searchDatasets()
getDatasetMetadata()
downloadDataset()
checkForUpdate()
```

### Wichtig

Noch:

- kein PBF
- kein Geofabrik-Parser
- kein PostGIS
- kein Deutschland-Download

Zunächst ausschließlich **Entkopplung**.

### Zielarchitektur

```text
City Manager
     ↓
DatasetProvider
     ↓
Dataset
     ↓
Validator
     ↓
IndexedDB
```

Der City Manager weiß nicht, woher das Dataset kommt.

### Exit Gate

Ein Test-Dataset kann vollständig installiert werden, **ohne dass Overpass aufgerufen wird**.

---

# Phase 15.2 – OSM-PBF Dataset Builder – Proof of Concept Olpe

**Priorität: 🔴**

Das ist die wichtigste technische Proof-of-Concept-Phase.

### Eingabe

Ein regionaler OSM-PBF-Extrakt.

Zunächst nur:

> **Nordrhein-Westfalen → Olpe**

### Builder

Separates Werkzeug:

```text
tools/
└── dataset-builder/
```

Nicht in die Browser-Anwendung integrieren.

### Aufgabe

Aus OSM-Rohdaten:

1. Gemeindegrenze bestimmen
2. Straßen innerhalb der Grenze bestimmen
3. Straßengeometrien rekonstruieren
4. Namen normalisieren
5. Duplikate sinnvoll zusammenführen
6. POIs anhand der bestehenden Registry bestimmen
7. administrative Areas bestimmen
8. Metadaten erzeugen
9. validieren
10. Package schreiben
11. SHA-256 erzeugen

### Ausgabe

Zum Beispiel:

```text
de-nw-olpe.json
```

### Vergleichstest

Sehr wichtig:

```text
Olpe bisher über Overpass
        VS
Olpe über PBF Builder
```

Verglichen werden:

- Straßenanzahl
- Namen
- Geometrien
- POI-Anzahl
- POI-Kategorien
- Boundary
- Areas
- Duplikate
- ungültige Objekte

### Exit Gate

Olpe lässt sich aus PBF erzeugen und im bestehenden Straßentrainer spielen.

---

# Phase 15.3 – Package Contract stabilisieren

**Priorität: 🔴**

Jetzt wird exakt festgelegt, was ein offizielles Straßentrainer-Dataset enthält.

Beispiel:

```text
package
dataset
boundary
streets
pois
areas
metadata
```

Metadaten mindestens:

```text
datasetId
datasetKind
name
state
country
osmRelationId
version
generatedAt
osmDataTimestamp
contentHash
builderVersion
```

### Ziel

Builder und Browser kommunizieren über **einen stabilen Vertrag**.

Der Builder darf später komplett neu geschrieben werden, solange das Package-Schema gleich bleibt.

---

# Phase 15.4 – Dataset-Katalog

**Priorität: 🔴**

Der Benutzer soll nicht mehr direkt Nominatim fragen müssen.

Stattdessen entsteht ein eigener Katalog.

Beispiel:

```text
Olpe
Nordrhein-Westfalen
Gemeinde
Version 2026.09.06

Siegen
Nordrhein-Westfalen
Stadt
Version 2026.09.06
```

Technisch beispielsweise:

```text
catalog.json
```

mit:

```json
{
  "datasets": [
    {
      "id": "de-nw-olpe",
      "name": "Olpe",
      "type": "municipality",
      "state": "Nordrhein-Westfalen",
      "version": "2026.09.06"
    }
  ]
}
```

### Suche

```text
"Olpe"
↓
lokaler / eigener Katalog
↓
Olpe
↓
Package laden
```

Damit verschwindet langfristig auch die Nominatim-Abhängigkeit aus dem normalen Installationspfad.

---

# Phase 15.5 – Installation vollständig ohne Overpass

**Priorität: 🔴**

Jetzt wird der echte Nutzerworkflow umgestellt.

```text
Neue Stadt hinzufügen
↓
Dataset-Katalog durchsuchen
↓
Dataset auswählen
↓
Package herunterladen
↓
Hash prüfen
↓
Validator
↓
IndexedDB
↓
Stadt aktivieren
```

### Kritischer Test

Im Browser werden Netzwerkaufrufe überwacht.

Erwartung:

```text
Nominatim: 0
Overpass: 0
```

und trotzdem lässt sich Olpe komplett installieren.

---

# Phase 15.6 – Updates ohne Overpass

**Priorität: 🔴**

Bestehende Update-Architektur wird an Dataset-Versionen angeschlossen.

Beispiel:

```text
Installiert:
Olpe 2026.09.05

Katalog:
Olpe 2026.09.08
```

UI:

```text
Update verfügbar
```

Dann:

```text
neues Package
↓
Hash
↓
Validator
↓
bestehender Diff
↓
+ Straßen
- Straßen
+ POIs
- POIs
↓
Bestätigung
↓
atomisches Update
```

Keine Live-OSM-Abfrage durch den Browser.

---

# Phase 15.7 – mehrere Städte aus NRW

**Priorität: 🟠**

Nach Olpe:

- Siegen
- Oberasbach nicht, da Bayern
- weitere kleine Gemeinde
- mittelgroße Stadt
- Großstadt

Sinnvolle Testmatrix:

```text
klein
mittel
groß
```

Prüfen:

- Package-Größe
- Buildzeit
- Speicher
- Download
- IndexedDB
- Rendering
- Startzeit
- POI-Dichte
- Straßenduplikate

---

# Phase 15.8 – automatisierte Dataset-Pipeline

**Priorität: 🟠**

Bis dahin können Packages lokal erzeugt werden.

Jetzt Automatisierung:

```text
neuer OSM-PBF
↓
Builder
↓
Datasets erzeugen
↓
Tests
↓
Hashes
↓
Katalog aktualisieren
↓
veröffentlichen
```

Wichtig:

> Kein fehlerhaftes Dataset wird automatisch veröffentlicht.

Pipeline:

```text
BUILD
↓
VALIDATE
↓
QA
↓
PUBLISH
```

---

# 14. Phase 16 – Deutschlandweite Dataset-Infrastruktur

Erst wenn NRW stabil funktioniert.

### Ziel

Deutschland nicht als gigantisches Browser-Dataset, sondern als Build-Quelle.

Pipeline kann nach Bundesländern arbeiten:

```text
Bayern
NRW
Hessen
Niedersachsen
...
```

Der Nutzer lädt weiterhin nur:

> **sein konkretes Trainingsgebiet**

herunter.

---

# 15. Phase 16.1 – Speicher- und Downloadoptimierung

Dann erst untersuchen:

- JSON
- komprimiertes JSON
- Streaming
- kleinere Geometrien
- Precision Reduction
- Package Split
- Delta Updates

Keine vorzeitige Optimierung.

Zuerst messen.

---

# 16. Phase 16.2 – Dataset-Veröffentlichung

Zielstruktur konzeptionell:

```text
/catalog.json

/datasets/
    de-nw-olpe/
        manifest.json
        package.json

    de-nw-siegen/
        manifest.json
        package.json
```

Später ggf. CDN.

Der Browser braucht lediglich normale HTTP-Downloads.

---

# 17. Phase 17 – Landkreis-Datasets

Das ist die bisher geplante **14.4b**, aber jetzt auf der richtigen Datenarchitektur.

### Beispiel

> Kreis Olpe

Ein Dataset enthält:

```text
Kreis Olpe
│
├── Olpe
├── Wenden
├── Drolshagen
├── Attendorn
└── ...
```

### Wichtigstes Datenproblem

Gleiche Straßennamen.

Beispiel:

```text
Hauptstraße · Olpe
Hauptstraße · Wenden
```

dürfen nicht zu einer einzigen Straße verschmelzen.

Identität muss deshalb berücksichtigen:

```text
dataset
+
municipality
+
street identity
```

Keine rein namensbasierte Zusammenführung über Gemeindegrenzen.

---

# 18. Phase 17.1 – administrative Untergebiete

Ein Landkreis-Dataset soll automatisch enthalten:

- Landkreisgrenze
- Gemeinden
- Städte
- ggf. geeignete administrative Untereinheiten

Diese werden normale TrainingAreas.

Damit kann der Benutzer wählen:

```text
Gesamter Kreis Olpe
Olpe
Wenden
Attendorn
...
```

---

# 19. Phase 17.2 – Feuerwehr-Einsatzgebiete

Dann kommen die wirklich feuerwehrspezifischen Gebiete.

```text
Landkreis
↓
Gemeinde
↓
Feuerwehr-Einsatzgebiet
```

Einsatzgebiete können:

- manuell definiert
- importiert
- kuratiert
- später zentral verteilt

werden.

---

# 20. Phase 17.3 – Polygoneditor reparieren

Spätestens hier wird das momentan offene 14.4a-Problem wieder aufgenommen.

Dann existiert eine deutlich bessere Grundlage:

```text
Municipality Boundary
District Boundary
Response Areas
Custom Areas
```

Der Polygoneditor bekommt anschließend eine eigene fokussierte QA-Phase.

### Exit Gate

Reale Browser-Smokes:

- Polygon vollständig innen → akzeptiert
- teilweise außen → abgelehnt
- vollständig außen → abgelehnt
- Grenzfall → definiertes Verhalten
- Reload → erhalten
- Update → erhalten
- Landkreisübergreifend nur erlaubt, wenn Dataset es enthält

---

# 21. Phase 18 – kuratierte Feuerwehr-Pakete

Langfristig sehr wichtig.

Beispiel:

```text
Feuerwehr Olpe
Trainingspaket v2.3
```

kann enthalten:

- geprüfte Straßen
- korrigierte Namen
- relevante POIs
- Feuerwachen
- Einsatzgebiete
- lokale Besonderheiten

OSM bleibt Ausgangspunkt.

Aber kuratierte Änderungen können darüberliegen:

```text
OSM Dataset
    +
lokale Korrekturen
    =
kuratierte Feuerwehr-Version
```

Dabei gilt weiterhin:

> **Curated > automatisch erzeugtes OSM**, wenn bewusst lokale Korrekturen vorgenommen wurden.

---

# 22. Phase 19 – Produktionsreife

Erst danach geht es um echte Produktreife.

Prüfen:

### Zuverlässigkeit

- fehlendes Dataset
- defekter Download
- Hash falsch
- Package beschädigt
- Update abgebrochen
- IndexedDB voll
- Offline
- Service Worker Update

### Performance

- kleine Gemeinde
- Großstadt
- Landkreis
- Smartphone
- Tablet
- Desktop

### Datenqualität

- Straßenanzahl
- gleiche Namen
- MultiLineStrings
- Grenzstraßen
- POIs
- nicht benannte Straßen
- Duplikate

---

# 23. Phase 20 – Release Candidate

Erst jetzt würde ich von einer stabilen Version sprechen.

Minimum:

```text
Oberasbach     ✅
Olpe           ✅
Siegen         ✅
Großstadt      ✅
Landkreis      ✅

Installation ohne Overpass ✅
Updates ohne Overpass      ✅
Offline-Spiel              ✅
Statistik                  ✅
TrainingAreas              ✅
Packages                   ✅
Regression                 ✅
Mobile                     ✅
```

---

# 24. Neue Entwicklungsreihenfolge auf einen Blick

```text
BISHER
────────────────────────────────────

0–10.5  Multi-City-Grundarchitektur
         ✅

11       QA
         ✅

12       Performance
         ✅

12.5     TrainingAreas
         ✅

13.1     Offline Foundation
         ✅

13.2     Offline Basemap
         ✅

14.1     Updates / Diff
         ✅

14.2     POI-Kategorien
         ✅

14.3     Package-System
         ✅

14.3a    Trust-Semantik
         ✅

14.4a    Custom TrainingAreas
         🟡 Polygon Known Issue


NEUER HAUPTPFAD
────────────────────────────────────

15.0     Baseline sichern
         ↓
15.1     DatasetProvider
         ↓
15.2     PBF → Olpe Proof of Concept
         ↓
15.3     Package Contract
         ↓
15.4     Dataset-Katalog
         ↓
15.5     Installation ohne Overpass
         ↓
15.6     Updates ohne Overpass
         ↓
15.7     mehrere NRW-Datasets
         ↓
15.8     automatisierte Pipeline
         ↓
16       Deutschland-Skalierung
         ↓
16.1     Performance / Kompression
         ↓
16.2     Dataset Publishing
         ↓
17       Landkreis-Datasets
         ↓
17.1     Gemeinden als TrainingAreas
         ↓
17.2     Feuerwehr-Einsatzgebiete
         ↓
17.3     Polygoneditor finalisieren
         ↓
18       kuratierte Feuerwehr-Pakete
         ↓
19       Produktionshärtung
         ↓
20       Release Candidate
```

---

# 25. Strikte Architekturregeln

Diese Regeln werden ab jetzt in **jeden Coding-Prompt** aufgenommen.

### Regel 1 – Game Engine schützen

Nicht ohne zwingenden Grund verändern:

```text
game-engine.js
timer.js
Scoring
Prüfungsmodus
Zeitmodus
Ränge
Kernstatistik
```

Das entspricht auch der bisherigen Masterplan-Regel.

### Regel 2 – Gameplay ist lokal

Nach Installation:

```text
IndexedDB
↓
Game
```

Keine externe Geodaten-API.

### Regel 3 – Browser verarbeitet keine PBF-Dateien

PBF-Verarbeitung ist Build-/Server-Tooling.

### Regel 4 – Builder und Web-App getrennt

```text
Web-App ≠ Dataset Builder
```

Verbindung ausschließlich über das Package-Schema.

### Regel 5 – keine automatische Qualitätsannahme

Jedes generierte Package:

```text
Build
↓
Normalize
↓
Validate
↓
Hash
↓
Publish
```

### Regel 6 – Oberasbach bleibt Referenz

Das kuratierte Oberasbach-Paket darf durch automatisierte OSM-Daten **nicht still überschrieben werden**.

### Regel 7 – keine parallele Komplettmodernisierung

Jetzt nicht gleichzeitig:

- ES Modules
- Framework-Wechsel
- React
- TypeScript-Migration
- komplett neues UI
- neue Game Engine

Der bisherige Masterplan hat ebenfalls ausdrücklich vorgesehen, die bestehende globale JS-Architektur während des Datenumbaus zunächst beizubehalten.

---

# 26. Teststrategie

Jede größere Phase bekommt vier Ebenen.

## Ebene A – Unit Tests

Beispielsweise:

```text
Package Parser
Validator
Normalizer
Street Identity
POI Registry
Hash
Diff
```

## Ebene B – Integration

```text
Dataset
↓
Validator
↓
IndexedDB
↓
CityContext
```

## Ebene C – Regression

Nach jeder Phase alle bisherigen Tests.

## Ebene D – echter Browser-Smoke

Der darf künftig **nicht mehr durch Unit Tests ersetzt werden**.

Das haben wir gerade beim Polygon sehr deutlich gesehen.

Eine Phase darf bei Browserfunktionalität nur `PASS` melden, wenn tatsächlich getestet wurde.

---

# 27. Referenzgebiete für QA

Es werden dauerhaft feste Referenzen verwendet:

### Referenz A – Oberasbach

```text
271 Straßen
60 POIs
```

Kuratiertes Golden Dataset.

### Referenz B – Olpe

Erstes Dataset der neuen PBF-Pipeline.

### Referenz C – Siegen

Mittelgroße Stadt.

### Referenz D – Nürnberg/Köln

Große Stadt.

### Referenz E – Kreis Olpe

Landkreis-Test.

Dadurch können wir jede neue Architektur gegen dieselben Gebiete testen.

---

# 28. Definition of Done einer Phase

Eine Phase ist künftig nur abgeschlossen, wenn:

```text
[ ] Funktion implementiert
[ ] Unit Tests
[ ] Integration Tests
[ ] komplette Regression
[ ] git diff --check
[ ] Oberasbach Regression
[ ] keine unbeabsichtigte Game-Engine-Änderung
[ ] Browser-Smoke, wenn UI betroffen
[ ] Known Issues dokumentiert
[ ] keine zukünftige Phase vorweggebaut
```

Das wird strikt eingehalten.

---

# 29. Umgang mit dem Polygonfehler

Damit wir ihn nicht vergessen:

**Known Issue ID**

```text
TA-POLYGON-001
```

Beschreibung:

> Eindeutig innerhalb der Stadtgrenze gezeichnete Custom Region wird im realen Oberasbach-Browserpfad teilweise als außerhalb erkannt.

Status:

```text
DEFERRED
```

Blockiert:

- ❌ nicht Phase 15
- ❌ nicht Dataset Builder
- ❌ nicht Installationsarchitektur
- ❌ nicht Updates

Blockiert später:

- ✅ finale Custom Areas
- ✅ Feuerwehr-Einsatzgebiete
- ✅ finale 14.4/17.3-Abnahme

Damit ist das Problem **bewusst verschoben**, nicht verloren.

---

# 30. Wichtigste strategische Entscheidung des neuen Masterplans

Der Straßentrainer wird nicht mehr davon abhängig sein, dass irgendein kostenloser Overpass-Server genau in dem Moment erreichbar ist, in dem ein Feuerwehrmitglied eine Stadt installieren möchte.

Statt:

```text
Benutzer
↓
öffentlicher OSM-Abfrageserver
↓
hoffentlich verfügbar
```

haben wir später:

```text
OSM
↓
kontrollierter Build
↓
validiertes Straßentrainer-Dataset
↓
statische Auslieferung
↓
Benutzer
```

Und gerade weil wir bereits **Package-System, Hashes, IndexedDB, Updates, Offlinebetrieb, POI-Registry und CityContext** gebaut haben, ist der Zeitpunkt für diesen Wechsel sehr günstig.

## Unmittelbar nächster Schritt

Damit ist jetzt eindeutig:

> **Phase 15.0 kurz abschließen → danach Phase 15.1 „Dataset Source Abstraction“.**

Noch **kein Geofabrik/PBF-Umbau im ersten Prompt**.

15.1 schafft zunächst ausschließlich die saubere Schnittstelle, sodass der Straßentrainer nicht mehr wissen muss, ob ein Dataset aus Overpass, einer JSON-Datei oder später unserem PBF-Builder stammt.

**Danach** kommt mit 15.2 der erste echte Test:

> **NRW-PBF → Olpe → Straßentrainer-Paket → Installation → Runde spielen.**

Wenn das funktioniert, haben wir den entscheidenden Beweis, dass der Straßentrainer **Overpass grundsätzlich nicht mehr benötigt**.
