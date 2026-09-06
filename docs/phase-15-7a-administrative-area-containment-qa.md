# Phase 15.7a: Administrative Area Containment & Hierarchy Fix

## 1. Ausgangslage und Problemstellung

In Phase 15.7 wurden die Datensätze für Wenden, Siegen und Köln aus dem regionalen PBF-Extrakt `nordrhein-westfalen-latest.osm.pbf` technisch fehlerfrei und regelkonform erzeugt. Bei der anschließenden fachlichen Abnahme vor Phase 15.8 wurde jedoch ein systematisches Datenqualitätsproblem bei den administrativen Teilgebieten (Areas) entdeckt:

1. **Siegen** enthielt als Trainingsgebiete:
   - 4 Nachbarkommunen (`Kreuztal`, `Freudenberg`, `Wilnsdorf`, `Netphen`), die jeweils denselben `admin_level=8` wie Siegen besitzen.
   - 2 Ortsteile benachbarter Kommunen (`Buschhütten` aus Kreuztal, `Dreis-Tiefenbach` aus Netphen).
2. **Köln** enthielt:
   - `Gemarkung Berzdorf`, ein Gebiet der Nachbarstadt Wesseling (Rhein-Erft-Kreis).

### Ursachenanalyse (Root Cause Analysis)

1. **Osmium Smart Extract Verhalten:**
   `osmium extract -s smart -S types=multipolygon,boundary` behält Relationen, deren Grenzlinien die Gemeindeaußengrenze berühren oder teilen. Dadurch landen Nachbarkommunen und angrenzende Fremdgebiete im Roh-PBF-Extrakt.
2. **Fehlende Hierarchieprüfung im Builder:**
   `collectRelevantFeatures` akzeptierte beliebige Relationen mit `admin_level in [8, 9, 10, 11]`, ohne das `admin_level` des Kandidaten mit dem `admin_level` der Zielkommune abzugleichen.
3. **Flächen-Overlap-Fehlbestrafung in `discoverTrainingAreas`:**
   In `osm-service.js` prüfte die Deduplizierung von Gebiets-Tiers lediglich die Bounding-Box-Überlappung (`inter / minA > 0.4`). Bei benachbarten, passgenau aneinanderliegenden Ortsteilen (Puzzle-Effekt) überschneiden sich deren achsenparallele Bounding Boxes stark (in Siegen 17 Überschneidungen). Dies führte zu einem Abzug von 170 Punkten (`-10` pro Overlap), wodurch die echten Ortsteile von Ebene 10 mit Score `-20` disqualifiziert wurden und versehentlich der Nachbar-Tier (Ebene 8) mit Score `+30` gewählt wurde.
4. **Fehlende Polygon-Containment-Prüfung:**
   Obwohl die Zielgrenze (`boundary`) an `discoverTrainingAreas` übergeben wurde, wurde sie für Kandidaten nicht zur Polygon-in-Polygon-Validierung herangezogen.

---

## 2. Umgesetzte Lösung (Generisch gemäß Rule 52)

Gemäß der Projektregeln (insb. Regel 52: Keine Namensprüfungen, keine stadtbezogenen Ausnahmelisten wie `if (name === "Kreuztal")`) wurde eine rein geometrische und hierarchische Lösung implementiert:

### 2.1 Striktes Hierarchie-Kriterium
Ein administratives Gebiet darf nur akzeptiert werden, wenn:
$$\text{candidate.adminLevel} > \text{municipality.adminLevel}$$
- Für Siegen (`admin_level=8`): Kandidaten mit `admin_level <= 8` (wie Kreuztal, Freudenberg, Wilnsdorf, Netphen) werden hart abgewiesen (`REJECTED_SAME_ADMIN_LEVEL` bzw. `REJECTED_HIGHER_ADMIN_LEVEL`).
- Für Köln (`admin_level=6`): Kandidaten mit `admin_level <= 6` werden hart abgewiesen.
- Erlaubte Ausnahmen: Nicht-administrative Gebiete mit `place in [borough, suburb, quarter]`.

### 2.2 Geometrische Containment-Prüfung
Jedes Kandidatenpolygon wird gegen das Zielpolygon der Kommune mit `@turf/intersect` und `@turf/booleanPointInPolygon` geprüft:
- $\text{ratioInside} = \frac{\text{Fläche}(\text{Kandidat} \cap \text{Boundary})}{\text{Fläche}(\text{Kandidat})}$
- **Regeln:**
  - $\text{ratioInside} \le 0$: Abweisung als `REJECTED_OUTSIDE`
  - $\text{ratioInside} < 0.05$: Abweisung als `REJECTED_TOUCHING_BOUNDARY`
  - $\text{ratioInside} < 0.85$ oder Mittelpunkt außerhalb: Abweisung als `REJECTED_PARTIAL_OVERLAP`
  - $\text{ratioInside} \ge 0.85$ und Mittelpunkt innerhalb: Annahme als `ACCEPTED_CHILD_ADMIN_AREA` bzw. `ACCEPTED_CONTAINED_PLACE`

### 2.3 Korrektur des Tier-Overlap-Scorings
In `discoverTrainingAreas` wurde die rein rechteckige Bounding-Box-Prüfung durch eine geometrische Zentroid-in-Polygon-Prüfung ersetzt: Nur wenn das Zentrum eines Gebiets tatsächlich im Polygon eines anderen Gebiets desselben Tiers liegt, wird eine echte hierarchische Überlappung gewertet. Benachbarte, disjunkte Puzzleteile werden nicht mehr bestraft.

### 2.4 Auditierbarer Klassifikationsbericht
Im Build-Report wird für jeden analysierten Gebietskandidaten ein strukturierter Eintrag hinterlegt:
- `id`, `name`, `adminLevel`, `boundaryType`, `placeType`
- `ratioInside`, `centerInside`, `contained`, `hierarchyMatch`
- `decision` (`accepted` / `rejected`) und `reason` (z. B. `REJECTED_SAME_ADMIN_LEVEL`, `REJECTED_OUTSIDE`, `ACCEPTED_CHILD_ADMIN_AREA`).

---

## 3. Verifikationsergebnisse

### 3.1 Datensatz-Vergleich

| Kommune | Admin-Level | Straßen | POIs | Areas (Phase 15.7) | Areas (Phase 15.7a) | Abgewiesene Fremdgebiete | Status |
|---|---:|---:|---:|---:|---:|---|---|
| **Oberasbach** | 8 | 271 | 60 | 0 | 0 | n/a (Curated Golden) | **UNVERÄNDERT** |
| **Olpe** | 8 | 461 | 114 | 2 | 2 | Keine | **BIT-IDENTISCH** |
| **Wenden** | 8 | 460 | 37 | 3 | 3 | Keine | **BIT-IDENTISCH** |
| **Siegen** | 8 | 1.176 | 426 | 6 (fehlerhaft) | **23** (valide) | Kreuztal, Freudenberg, Wilnsdorf, Netphen, Buschhütten, Dreis-Tiefenbach | **PASS** |
| **Köln** | 6 | 4.628 | 4.453 | 6 (unvollständig) | **101** (valide) | Gemarkung Berzdorf, Pulheim, Frechen, Hürth, Dormagen etc. | **PASS** |

### 3.2 Audit der 6 verbotenen Siegen-Gebiete

```json
[
  { "name": "Kreuztal", "reason": "REJECTED_SAME_ADMIN_LEVEL", "adminLevel": 8, "ratioInside": 0 },
  { "name": "Freudenberg", "reason": "REJECTED_SAME_ADMIN_LEVEL", "adminLevel": 8, "ratioInside": 0 },
  { "name": "Wilnsdorf", "reason": "REJECTED_SAME_ADMIN_LEVEL", "adminLevel": 8, "ratioInside": 0 },
  { "name": "Netphen", "reason": "REJECTED_SAME_ADMIN_LEVEL", "adminLevel": 8, "ratioInside": 0 },
  { "name": "Buschhütten", "reason": "REJECTED_OUTSIDE", "adminLevel": 10, "ratioInside": 0 },
  { "name": "Dreis-Tiefenbach", "reason": "REJECTED_OUTSIDE", "adminLevel": 10, "ratioInside": 0 }
]
```
Alle 6 unberechtigten Gebiete werden durch die generischen Regeln zuverlässig abgewiesen. Die resultierenden 23 Gebiete sind zu 100% echte Siegener Ortsteile auf Ebene 10 (u. a. Eiserfeld, Eisern, Weidenau, Geisweid, Kaan-Marienborn).

### 3.3 Audit der Köln-Gebiete
- `Gemarkung Berzdorf` (Relation 12189427, Wesseling): Abgewiesen mit `REJECTED_OUTSIDE` (`ratioInside: 0`).
- Externe Nachbarn wie Pulheim, Hürth, Frechen, Dormagen, Troisdorf: Abgewiesen mit `REJECTED_OUTSIDE`.
- Akzeptiert: Alle 9 Kölner Stadtbezirke (`admin_level 9`), alle 86 Veedel (`admin_level 10`) und 6 amtliche statistische Bezirke.

---

## 4. Testabdeckung & Regression

1. **Neue Containment-Unit-Tests (`tests/area-containment-tests.js`):**
   - 10/10 Tests PASS (Child Area innen, Nachbarkommune mit gleichem admin_level, Area vollständig außerhalb, partielle Überlappung, ungültige Typen, MultiPolygon-Behandlung, numerische Stabilität an Grenzberührungen, Target-Municipality-Ausschluss, osmService-Integration).
2. **NRW Multi-Dataset Tests (`tests/nrw-multi-dataset-tests.js`):**
   - 7/7 Tests PASS inklusive Hard Assertions gegen die 6 Siegener Nachbarn und Kölner Fremdgebiete.
3. **Gesamte Test-Suite (`node --test tests/*.js`):**
   - 34/34 Testdateien PASS, 97/97 Subtests PASS.
4. **Catalog-Update-Integrationstests (`tests/catalog-update-integration-tests.js`):**
   - 11/11 Subtests PASS (0 Nominatim, 0 Overpass).
5. **Headless Browser Smoke Tests (`scripts/browser-smoke-test.js`):**
   - Wenden, Siegen, Köln Installation & Gameplay: PASS (Nominatim: 0, Overpass: 0).
   - Baseline Offline Smoke (Olpe): PASS (Offline-Gameplay nach Reload fehlerfrei).

---

## 5. Fazit

Der Fehler wurde vollständig und ohne city-spezifische Sonderbehandlungen behoben. Das System gewährleistet für alle zukünftigen Städte in Phase 15.8 und darüber hinaus, dass Nachbargemeinden und fremde Ortsteile strukturell und geometrisch ausgeschlossen werden.

