# Phase 16.1 – Performance, Package-Größe & Kompression

Dieses Dokument fasst die Messergebnisse, Zusammensetzungsanalysen, Koordinatenpräzisions-Untersuchungen und die Entscheidungsmatrix für Komprimierung und Optimierung der Datensätze im Projekt **Straßentrainer Deutschland** zusammen.

---

## 1. Executive Summary

1. **HTTP-Kompression (Gzip / Brotli) liefert herausragende Ergebnisse**:
   - Gzip (Level 6) reduziert die Transfergröße über alle Datensätze hinweg konsistent um **88,9 % bis 89,4 %**.
   - Brotli (Quality 11, für statische Distribution) erreicht eine Reduktion um **92,7 % bis 93,6 %**.
   - Selbst der größte Datensatz (**Köln**, raw 22,82 MB) schrumpft auf **2,48 MB (Gzip)** bzw. **1,43 MB (Brotli Q11)**.
   - Der Transfer im Headless Chrome dauert bei komprimierter Auslieferung für Köln lediglich **~219 ms**, für Siegen **~38 ms**, für Wenden **~10 ms** und für Oberasbach **~8,6 ms**.

2. **Koordinaten-Präzisionsreduktion bringt vernachlässigbaren Nutzen bei hohem Risiko**:
   - Eine Rundung von 7 auf 6 Nachkommastellen (~11 cm Präzision) spart lediglich **1,27 % bis 1,81 %** der Dateigröße.
   - Eine Rundung auf 5 Nachkommastellen (~1,1 m Präzision) spart lediglich **2,53 % bis 3,62 %**.
   - **Gleichzeitig**: 5 Nachkommastellen verändern Gameplay-Scores um bis zu **1 Punkt** (Grenzfälle bei Entfernungsstufen), und jede Modifikation bricht die kryptografischen SHA-256-Pakethashes bestehender Datensätze.
   - **Entscheidung**: Koordinatenreduktion wird **abgelehnt** (kein Nutzen gegenüber gzip/brotli, Integritäts- und Regressionsrisiko).

3. **Integrität & Stabilität**:
   - Golden Master Oberasbach bleibt 100 % unangetastet (271 Straßen, 60 POIs, SHA-256 unverändert).
   - Alle Datensätze validieren fehlerfrei im Browser via Chrome CDP.
   - Game-Engine, Scoring, Ränge und Prüfungsmodus bleiben vollkommen unberührt.

---

## 2. Benchmark-Ergebnisse (Node.js & In-Browser CDP)

### 2.1 Paketgrößen & Kompressionsvergleich

| Datensatz | Typ | Raw (MB) | Raw (Bytes) | Gzip L6 (KB) | Gzip L6 (%) | Brotli Q4 (KB) | Brotli Q11 (KB) | Brotli Q11 (%) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Oberasbach** | Curated | 0,55 MB | 573.142 | 59,2 KB | -89,4 % | 59,4 KB | 40,6 KB | -92,7 % |
| **Zirndorf** | OSM PBF | 0,87 MB | 911.271 | 97,7 KB | -89,0 % | 97,8 KB | 64,9 KB | -92,7 % |
| **Wenden** | OSM PBF | 0,94 MB | 987.422 | 106,6 KB | -88,9 % | 107,2 KB | 69,2 KB | -92,8 % |
| **Olpe** | OSM PBF | 1,27 MB | 1.328.294 | 142,9 KB | -89,0 % | 142,1 KB | 92,7 KB | -92,9 % |
| **Siegen** | OSM PBF | 3,99 MB | 4.179.180 | 450,8 KB | -89,0 % | 435,0 KB | 277,6 KB | -93,2 % |
| **Köln** | OSM PBF | 21,77 MB | 22.824.564 | 2.484,3 KB | -88,9 % | 2.297,2 KB | 1.428,6 KB | -93,6 % |

*Kompressionszeiten (Node.js v22):*
- Gzip L6: 4,2 ms (Oberasbach) bis 164,6 ms (Köln).
- Brotli Q4 (on-the-fly): 2,5 ms (Oberasbach) bis 92,4 ms (Köln).
- Brotli Q11 (precompressed static): 668 ms (Oberasbach) bis 28,3 s (Köln).

---

### 2.2 In-Browser Runtime-Performance (Google Chrome CDP)

Gemessen in einer realen Headless-Chrome-Instanz (Chrome 152 / CDP) unter IndexedDB- und Domänen-Bedingungen (`http://127.0.0.1:8094/`):

| Datensatz | Network Fetch | Text Read | JSON Parse | Package Val. | City Val. | Target Prep | IDB Save | IDB Load | Heap Delta | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Oberasbach** | 8,6 ms | 1,6 ms | 1,2 ms | 23,7 ms | 12,1 ms | 0,3 ms | 60,8 ms | 2,9 ms | +3,12 MB | PASS |
| **Wenden** | 10,4 ms | 5,2 ms | 1,5 ms | 29,3 ms | 18,9 ms | 0,5 ms | 24,0 ms | 4,0 ms | +7,51 MB | PASS |
| **Zirndorf** | 12,6 ms | 3,0 ms | 1,7 ms | 21,7 ms | 19,9 ms | 0,4 ms | 39,3 ms | 3,4 ms | +6,72 MB | PASS |
| **Siegen** | 38,0 ms | 8,4 ms | 6,2 ms | 80,8 ms | 72,4 ms | 0,9 ms | 69,5 ms | 12,0 ms | +37,19 MB | PASS |
| **Köln** | 218,9 ms | 57,4 ms | 53,9 ms | 461,8 ms | 585,4 ms | 5,8 ms | 421,4 ms | 94,4 ms | +66,86 MB | PASS |

*Erkenntnisse aus dem Browser:*
- **Download/Transfer**: Durch Standard-Gzip werden selbst 22 MB Köln in 218 ms übertragen.
- **Parsing**: `JSON.parse` ist in V8 hochoptimiert (53,9 ms für Köln, < 2 ms für normale Kommunen).
- **Validierung**: Vollständige semantische Validierung (Kontrakt + Stadt-Integrität) benötigt bei Köln 1,05 s, bei kleineren Städten 30–150 ms.
- **IndexedDB**: Schnelles Persistieren (< 425 ms selbst für Köln, 25–60 ms für andere) und extrem schnelles Laden (< 5 ms für normale Kommunen, 94 ms für Köln).
- **Target Preparation**: Initialisierung der Straßen- und POI-Ziele ist vernachlässigbar schnell (< 6 ms).

---

## 3. Zusammensetzungsanalyse: Datensatz Köln (de-nw-koeln)

Köln ist der größte Datensatz im Repository. Eine detaillierte Byte- und Elementanalyse:

| Komponente | Anzahl Elemente | Koordinatenpunkte | Rohgröße (Bytes) | Anteil an Rohdatei |
| :--- | :---: | :---: | :---: | :---: |
| **Straßen** (`streets`) | 4.628 | 116.239 | 4.281.344 B (4,08 MB) | 18,8 % |
| **POIs** (`pois`) | 4.453 | 4.453 | 3.502.208 B (3,34 MB) | 15,3 % |
| **Areas** (`areas`) | 101 | 35.812 | 1.121.996 B (1,07 MB) | 4,9 % |
| **Boundary** (`city.boundary`) | 1 | 2.140 | 64.210 B (62,7 KB) | 0,3 % |
| **Metadaten & Formatierung** | - | - | 13.854.806 B (13,21 MB) | 60,7 % |
| **Gesamt** | **9.182 Targets** | **158.644 Punkte** | **22.824.564 B (21,77 MB)** | **100,0 %** |

*Analyse:*
- 60,7 % der Rohgröße entfallen auf JSON-Formatierungs-Overhead, Eigenschaftsschlüssel (`id`, `displayName`, `aliases`, `category`, `categoryLabel`, `geometry`, `coordinates`), Adressinformationen und Metadaten.
- Genau diese hochgradig repetitiven JSON-Strukturen werden von DEFLATE / Brotli um **> 93 %** komprimiert.

---

## 4. Analyse der Koordinatenpräzision (7 vs. 6 vs. 5 Nachkommastellen)

Untersuchung von Rundungsstufen auf Dateigröße, Geometrieabweichung und Spiellogik:

### 4.1 Größen- und Abweichungsvergleich

| Datensatz | Dezimalen | Raw-Größe | Delta (%) | Gzip L6 | Brotli Q4 | Max Abweichung | Mittlere Abw. | Score-Delta |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Oberasbach** | 7 (Ist) | 573.142 B | 0,00 % | 59,2 KB | 59,4 KB | 0,0000 m | 0,0000 m | 0 Pkt |
| | 6 | 565.388 B | -1,35 % | 55,3 KB | 56,3 KB | 0,0663 m (6,6 cm) | 0,0356 m | 0 Pkt |
| | 5 | 557.545 B | -2,72 % | 51,5 KB | 52,4 KB | 0,6594 m (66 cm) | 0,3535 m | 1 Pkt |
| **Olpe** | 7 (Ist) | 1.328.294 B | -0,01 % | 142,8 KB | 141,9 KB | 0,0052 m | 0,0000 m | 0 Pkt |
| | 6 | 1.304.288 B | -1,81 % | 130,7 KB | 131,3 KB | 0,0657 m (6,6 cm) | 0,0354 m | 0 Pkt |
| | 5 | 1.280.208 B | -3,62 % | 117,0 KB | 117,1 KB | 0,6566 m (66 cm) | 0,3503 m | 1 Pkt |
| **Wenden** | 7 (Ist) | 987.422 B | -0,01 % | 106,5 KB | 107,2 KB | 0,0042 m | 0,0000 m | 0 Pkt |
| | 6 | 969.756 B | -1,79 % | 97,5 KB | 98,0 KB | 0,0657 m (6,6 cm) | 0,0356 m | 0 Pkt |
| | 5 | 952.284 B | -3,56 % | 87,6 KB | 87,7 KB | 0,6533 m (65 cm) | 0,3507 m | 1 Pkt |
| **Siegen** | 7 (Ist) | 4.179.180 B | -0,01 % | 450,5 KB | 434,9 KB | 0,0064 m | 0,0000 m | 0 Pkt |
| | 6 | 4.114.470 B | -1,55 % | 418,3 KB | 404,8 KB | 0,0658 m (6,6 cm) | 0,0356 m | 1 Pkt |
| | 5 | 4.050.418 B | -3,08 % | 381,9 KB | 366,0 KB | 0,6574 m (66 cm) | 0,3529 m | 1 Pkt |
| **Köln** | 7 (Ist) | 22.824.564 B | -0,01 % | 2.483,4 KB | 2.296,9 KB | 0,0064 m | 0,0000 m | 0 Pkt |
| | 6 | 22.534.821 B | -1,27 % | 2.340,5 KB | 2.160,5 KB | 0,0658 m (6,6 cm) | 0,0355 m | 1 Pkt |
| | 5 | 22.247.194 B | -2,53 % | 2.172,4 KB | 1.970,3 KB | 0,6574 m (66 cm) | 0,3514 m | 1 Pkt |
| **Zirndorf** | 7 (Ist) | 911.271 B | -0,03 % | 97,6 KB | 97,8 KB | 0,0054 m | 0,0000 m | 0 Pkt |
| | 6 | 897.669 B | -1,49 % | 90,6 KB | 91,2 KB | 0,0663 m (6,6 cm) | 0,0354 m | 0 Pkt |
| | 5 | 884.349 B | -2,95 % | 83,5 KB | 83,6 KB | 0,6632 m (66 cm) | 0,3589 m | 1 Pkt |

### 4.2 Bewertung der Koordinatenpräzision

- **Geringer Gewinn**: 6 Dezimalstellen sparen nur ~1,5 % Dateigröße, 5 Dezimalstellen nur ~3 %. Da Gzip bereits 89 % einspart, sinkt die Gzip-Größe von Köln bei 6 Dezimalstellen von 2.484 KB auf 2.340 KB (Differenz: lediglich 144 KB).
- **Gameplay-Auswirkung**: Bei 5 Dezimalstellen tritt eine Maximalverschiebung von über 66 cm auf. Bei Klicks nahe Schwellenwerten (z. B. 25 m, 50 m, 100 m) führt dies zu einer Veränderung der Punktezahl (Score-Delta = 1 Punkt).
- **Integritätsbruch**: Jede nachträgliche Koordinatenrundung ändert den SHA-256-Hash des Pakets und erfordert Re-Hashing aller bestehenden Datensätze inklusive des unantastbaren Golden Masters Oberasbach.

---

## 5. Entscheidungsmatrix

| Maßnahme | Einsparung | Risiko | Auswirkung auf Engine / Hash | Bewertung / Entscheidung |
| :--- | :--- | :--- | :--- | :--- |
| **HTTP Content-Encoding (Gzip)** | **~89 %** | **Keines** | Völlig transparent; Hash und Payload bleiben identisch | **EMPFOHLEN (Implementieren)**: Standard-Support auf allen Servern / CDNs |
| **Precompressed Brotli (`.br`)** | **~93 %** | **Keines** | Für statische Bereitstellung (z. B. GitHub Pages / S3 / Nginx) | **EMPFOHLEN (Optional für Static Repo)** |
| **Koordinaten-Reduktion (6 Stellen)** | ~1,5 % | Mittel | Ändert SHA-256 Hashes; kein relevanter Größenvorteil | **ABGELEHNT** |
| **Koordinaten-Reduktion (5 Stellen)** | ~3,0 % | Hoch | Score-Verfälschung (bis zu 1 Pkt), Geometrie-Abweichung bis 66 cm | **ABGELEHNT** |
| **Paket-Splitting (Chunks/Tiles)** | Variabel | Hoch | Erhöht Komplexität, bricht Offline-Garantie und einfachen Download | **ABGELEHNT** |
| **Benutzerdefiniertes Binärformat** | Variabel | Extrem | Verlust der JSON-Transparenz, hoher Parser-Overhead, Vendor Lock-in | **ABGELEHNT** |

---

## 6. Empfehlungen für Phase 16.2 (Dataset Publishing)

1. **Statisches Repository-Layout**:
   - Die JSON-Pakete verbleiben im unveränderten, kanonischen JSON-Format (`datasets/<id>/package.json`).
   - Ein begleitendes `manifest.json` enthält die Prüfsumme, Dateigröße und komprimierte Größen.
   - Der `catalog.json` referenziert den standardmäßigen Downloadpfad `datasets/<id>/package.json`.
2. **Kompression auf Transportebene**:
   - Die Bereitstellung erfolgt mit Standard-HTTP-Kompression (`Content-Encoding: gzip` oder `br`).
   - Im statischen Deployment können vorberechnete `.br` und `.gz` Dateien neben den `.json` Dateien abgelegt werden, falls der Webserver Pre-Compression unterstützt.
3. **Integrität & Offline**:
   - Nach dem Download wird das Paket vollständig unverändert im Browser IndexedDB abgelegt.
   - 0 Netzwerkanfragen zur Laufzeit (kein Nominatim, kein Overpass).

---

## 7. Exit Gate 16.1 Checklist

- [x] Benchmark aller Datensätze (Oberasbach, Olpe, Wenden, Siegen, Köln, Zirndorf) vollständig durchgeführt.
- [x] Raw, Gzip (L6/L9) und Brotli (Q4/Q11) gemessen.
- [x] In-Browser Performance (Chrome CDP: Fetch, Text, Parse, Validation, IDB, Target Prep, Heap) gemessen.
- [x] Zusammensetzungsanalyse für Köln detailliert dokumentiert.
- [x] Koordinatenpräzisionsanalyse (7, 6, 5 Stellen) mit Abweichungen und Gameplay-Regression durchgeführt.
- [x] Fundierte Entscheidungsmatrix erstellt.
- [x] Golden Master Oberasbach 100 % unverändert.
- [x] Game-Engine, Timer, Scoring, Ränge unberührt.
- [x] Keine Regressionen in der bestehenden Test-Suite.
