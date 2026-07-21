# Straßentrainer Oberasbach – GitHub-Pages-Version

Eine statische Web-App nach dem GeoGuessr-Prinzip für das Feuerwehrtraining in Oberasbach. Als Aufgaben stehen Straßen sowie lokal mitgelieferte Orte, Firmen und wichtige Einrichtungen zur Verfügung.

## Straßen, Orte und Einrichtungen

Über die gemeinsame Inhaltsauswahl sind drei Varianten spielbar:

- nur Straßen
- nur Orte und Einrichtungen
- Straßen und Orte gemischt

Im gemischten Modus werden beide Zieltypen möglichst abwechselnd ausgewählt. Ein Ziel wird nicht unmittelbar zweimal hintereinander angezeigt; innerhalb einer laufenden Auswahl werden zunächst noch nicht verwendete Ziele bevorzugt. Die Kategorien der POIs lassen sich einzeln ein- und ausschalten. Die Inhaltsauswahl, Kategorien und die Einstellung „Kategorie beim Alarm anzeigen“ werden unter `oberasbach-strassentrainer-inhalt-v1` in `localStorage` gespeichert und beim nächsten Besuch wiederhergestellt.

Die POIs liegen vollständig in `data/oberasbach-pois.js`. Während einer Spielrunde wird dafür **kein externer POI-Dienst** aufgerufen. Der Datenstand trägt je Eintrag ein Prüfdatum, eine Quelle und gegebenenfalls `needsReview: true` samt `reviewNote`. Gerätehäuser bleiben als Orientierung auf der Karte sichtbar, besitzen in der POI-Datei aber `quizEligible: false` und werden deshalb nie automatisch zur Aufgabe.

Unterstützte POI-Kategorien sind Schule, Kindertagesstätte, Senioren-/Pflegeeinrichtung, Tankstelle, Supermarkt/Einkaufsmarkt, Gesundheit, öffentliche Einrichtung, Sport/Freizeit, Gastronomie/Beherbergung, Unternehmen und sonstiger einsatzrelevanter Ort.

## Vollständige Straßengeometrien

Diese Version benötigt **keinen Python-Server** und ruft **nicht die Overpass API** auf.

- Die Liste mit 271 Oberasbacher Straßen liegt direkt in `data/oberasbach-streets.js`.
- Die unbeschriftete Grundkarte wird als Kartenkachel geladen.
- Ab Zoomstufe 15 verstärkt eine transparente, ebenfalls unbeschriftete Kartenebene dezent die Straßenkanten. Die normale helle Kartenansicht bleibt dadurch erhalten.
- Jede Straße erhält beim Laden eine stabile ID, einen Anzeigenamen und ihre expliziten Namensvarianten.
- Pro neuem Alarm werden über den OpenStreetMap-Geocoder alle streng namensgleichen Linien-Ways in Oberasbach eingesammelt.
- Die Abschnitte werden dedupliziert und als `MultiLineString`-ähnliche Liste gespeichert. Punktantworten gelten nicht als vollständige Straße.
- Bei der Auswertung wird der Tipp gegen jeden Abschnitt geprüft; ausschließlich der kleinste Abstand zählt.
- Bei der Auflösung werden alle Abschnitte markiert.
- Erfolgreich ermittelte vollständige Straßengeometrien werden in einem neuen Browsercache gespeichert.
- Die helle, kontrastreiche Grundkarte ist bewusst beschriftungsfrei und hebt Spielmarkierungen sowie Gerätehäuser deutlich hervor.
- Die drei Gerätehäuser in Oberasbach, Rehdorf und Altenberg sind als unbeschriftete Feuerwehrsymbole dauerhaft erkennbar.
- Die App besteht nur aus HTML, CSS und JavaScript und ist deshalb für GitHub Pages geeignet.

## Architektur

- `index.html` enthält ausschließlich die statische und barrierearm beschriftete Oberfläche und lädt Leaflet, Turf sowie die lokalen Projektdateien über relative Pfade.
- `styles.css` enthält das responsive Zwei-Spalten- beziehungsweise Mobil-Layout und die zentralen Oberflächenfarben.
- `geometry.js` enthält Normalisierung, eindeutige IDs, Abschnittsaggregation, Rand-Clipping und die Minimumsauswahl.
- `targets.js` stellt das gemeinsame Ziel-Interface bereit und wertet Straßen als Linien/Mehrfachlinien sowie POIs als Punkte oder vorbereitete Polygone aus.
- `statistics.js` kapselt die dauerhafte, aggregierte Statistik in `localStorage`.
- `game-engine.js` enthält ausschließlich Moduskonfiguration, `gameState`, Zustandsübergänge und Rundenergebnisse.
- `timer.js` stellt einen deadline-basierten Rundentimer bereit, der auch nach einem inaktiven Browser-Tab die korrekte Restzeit berechnet.
- `app.js` verbindet Engine, Zielauswahl, Geocoding, Kartenansicht und Ergebnisdarstellung. Es enthält keinen parallelen Legacy-Spielzustand mehr.
- `data/oberasbach-streets.js` stellt die lokale Straßenliste über `window.OBERASBACH_STREETS` bereit.
- `data/oberasbach-pois.js` stellt Kategorien und den geprüften lokalen POI-Datenstand über `window.OBERASBACH_POI_CATEGORIES` und `window.OBERASBACH_POIS` bereit.

Der verwendete CARTO-Kachelstil endet auf `_nolabels`; Straßennamen und andere Kartenbeschriftungen werden deshalb nicht geladen.

### Gemeinsame Game-Engine

Der zentrale `gameState` besitzt genau die Statuswerte:

```text
idle → preparing → active → answered
  ↑                              │
  └──────── nächste Runde ───────┘

active → preparing     (Alarm überspringen)
active → answered      (Zeit abgelaufen, ohne Tippkoordinate)
preparing → idle       (Ziel konnte nicht vorbereitet werden)
beliebiger Spielstand → finished → resetGame() → idle
```

Freier Modus, Zeitmodus und Prüfungsmodus verwenden denselben Ablauf und dieselben Auswertungsfunktionen. Zeit- und Prüfungsmodus sind in der Oberfläche auswählbar:

```javascript
{
  mode,
  totalRounds,
  secondsPerRound,
  contentSelection,
  poiCategories,
  showTargetCategory,
  immediateResolution,
  autoAdvanceDelaySeconds
}
```

Die Engine stellt `startGame()`, `startRound()`, `submitGuess()`, `resolveRound()`, `finishGame()` und `resetGame()` bereit. Verantwortlichkeiten bleiben getrennt:

- Kartendarstellung: `mapView` und `renderRoundSolutionOnMap()` in `app.js`
- Aufgaben-/Zielauswahl: `contentRepository` und `selectRoundTarget()`
- Nutzertipp: `submitGuess()`
- Entfernung: `evaluateDistanceToTarget()`, `targets.js` und `geometry.js`
- Punkte: die zieltypabhängige Funktion `calculateTargetScore()` in `targets.js`
- Rundenzustand und Ergebnisobjekt: `game-engine.js`
- Ergebnisdarstellung: `renderRoundResult()`
- dauerhafte Statistik: `statistics.js`

### Zeitmodus

Vor dem Start lassen sich 15, 30 oder 45 Sekunden, 10, 25 oder 50 Aufgaben und die gewünschte Inhaltsauswahl wählen.

- Die Rundenuhr startet erst nach erfolgreicher Auswahl und vollständiger Geometrievorbereitung der Zielstraße.
- Der Timer speichert einen festen Endzeitpunkt. Ein Hintergrund-Tab kann den Countdown deshalb nicht anhalten oder verlängern.
- Ein gültiger Kartenklick stoppt die Uhr sofort und verhindert weitere Eingaben.
- Nach Ablauf werden 0 Punkte, `distanceMeters: null` und `guessCoordinates: null` gespeichert; anschließend wird die vollständige Lösung angezeigt.
- Nach Tipp oder Zeitablauf bleibt die Lösung sichtbar. Die nächste Aufgabe beginnt ausschließlich nach einem Klick auf „Nächste Aufgabe“ beziehungsweise nach der letzten Runde auf „Auswertung anzeigen“.
- Die Uhr wird bei Tipp, Timeout, Abbruch, Moduswechsel, `pagehide` und Verlassen der Seite gestoppt.
- Nach der letzten oder einer vorzeitig beendeten Runde erscheinen Gesamt- und Durchschnittswerte, beste/schlechteste Aufgabe, Trefferquote, Zeitüberschreitungen und Gesamtspieldauer.
- „Noch einmal mit denselben Einstellungen“ übernimmt Zeit und Aufgabenanzahl unverändert.

Die Trefferquote verwendet die zentrale Konfiguration `HIT_THRESHOLDS_METERS` in `statistics.js`. Aktuell gelten höchstens 100 Meter sowohl für Straßen als auch für POIs. Die Punktekurven bleiben davon unabhängig und dürfen die unterschiedlichen Zielgeometrien weiterhin unterschiedlich streng bewerten.

### Prüfungsmodus

Der Prüfungsmodus bietet ebenfalls 15, 30 oder 45 Sekunden sowie 10, 25 oder 50 Aufgaben aus der gewählten Inhaltsauswahl. Er unterscheidet sich bei der Darstellung strikt vom Zeitmodus:

- Während der Prüfung werden weder Zielgeometrie, Tippmarkierung, Verbindung, Entfernung, Punkte, Bewertung noch Gesamtpunktestand angezeigt.
- Antwort und Entfernung werden intern gespeichert; sämtliche Rundenlayer werden anschließend entfernt und die nächste Aufgabe beginnt.
- Bei Zeitablauf werden 0 Punkte, `distanceMeters: null` und `guessCoordinates: null` gespeichert.
- Noch nicht verwendete Ziele werden bevorzugt. Falls eine sehr kleine Kategorienauswahl weniger Ziele als Prüfungsaufgaben enthält, darf ein Ziel später erneut vorkommen, aber niemals unmittelbar hintereinander.
- Erst nach der letzten Aufgabe berechnet die Engine Gesamtpunkte, maximal mögliche Punkte, Prozentwert, Durchschnittswerte, Trefferquote, unbeantwortete Aufgaben sowie beste und schlechteste Aufgabe.
- Ebenfalls erst nach der letzten Aufgabe wird aus der Gesamtpunktzahl eine spielerische Auszeichnung berechnet und als Snapshot unter `gameState.summary.award` in das abgeschlossene Prüfungsergebnis aufgenommen.
- Die Aufgabenliste enthält pro Aufgabe Ziel, Entfernung, Punkte, Zeit und Status. „Auf Karte ansehen“ zeigt erst nach Prüfungsende den eigenen Tipp, die vollständige Straße und die kürzeste Verbindung.
- Prüfungsantworten und Prüfungsergebnisse werden ausschließlich im Arbeitsspeicher gehalten. Ein bestätigtes Neuladen verwirft die laufende Prüfung und kann daher kein abgeschlossenes Ergebnis erzeugen.
- Vor Abbruch, Moduswechsel, Neuladen und Zurücknavigation erscheint eine Sicherheitsabfrage. Browser können den genauen Text ihrer systemeigenen Navigationswarnung selbst festlegen.
- Während einer laufenden Prüfung werden keine Aufgaben dauerhaft aggregiert. Erst der echte Prüfungsabschluss übernimmt sämtliche Rundenergebnisse genau einmal in den getrennten Prüfungsbereich der lokalen Gesamtstatistik. Ein Abbruch speichert weder unvollständige Prüfungsrunden noch einen Abschluss.
- Während einer laufenden Prüfung blendet auch die Debugschnittstelle Ergebnisse, Punkte und Tippkoordinaten aus.

#### Spielerische Ränge und Medaillen

Die zentrale Konfiguration `EXAM_AWARD_CONFIG` steht in `game-engine.js`. Sie enthält Darstellungsart, Prozentgrenzen, Namen, Symbole und Beschreibungen an genau einer Stelle. Standardmäßig ist `displayMode: "ranks"` aktiv:

- unter 65 %: Anwärter
- ab 65 %: Truppmann
- ab 75 %: Truppführer
- ab 85 %: Gruppenführer
- ab 95 %: Einsatzleiter
- exakt 100 %: Ortskenntnis-Meister

Die alternative Einstellung `displayMode: "medals"` verwendet Bronze, Silber, Gold und Diamant. Für einen späteren Wechsel reicht diese eine Konfigurationsänderung; die Auswertungs- und Darstellungslogik bleibt unverändert. Exakte 100 % werden nicht über einen gerundeten Fließkommawert, sondern über die ganzzahlige Gleichheit von Gesamtpunkten und maximal möglichen Punkten erkannt.

Die angezeigten Abzeichen sind neutrale Emojis und eigene CSS-Elemente. Sie bilden keine offiziellen Dienstgradabzeichen nach. In der Oberfläche steht deshalb ausdrücklich: „Die Bezeichnungen dienen ausschließlich der spielerischen Motivation und stellen keine echten Feuerwehrdienstgrade oder Qualifikationen dar.“

Ein abgeschlossenes Prüfungsergebnis enthält zusätzlich:

```javascript
summary.award = {
  scheme,
  key,
  name,
  symbol,
  description,
  percentage,
  percentageBasisPoints,
  perfect
}
```

## Dauerhafte lokale Gesamtstatistik

Der aufklappbare Bereich „Statistik“ arbeitet ausschließlich mit `localStorage`; es gibt weder Benutzerkonto noch Backend. Das Datenmodell verwendet `schemaVersion: 2`. Beim Laden werden alle bekannten Zähler, Dimensionen und Zielaggregate validiert. Beschädigte Daten werden verworfen, ohne den Spielstart zu verhindern, und in der Oberfläche erscheint ein verständlicher Hinweis. Die Funktion `migrateStatistics()` übernimmt noch vorhandene Daten des bisherigen Schemas 1 soweit möglich.

Die Filter bilden folgende Bereiche ab:

- Gesamt
- Freier Modus
- Zeitmodus
- Prüfungsmodus
- Straßen
- POIs beziehungsweise Einrichtungen
- zusätzlich jede Kombination aus Modus und Zieltyp

Gespeichert werden ungerundete Summen und Zähler. Durchschnittliche Punkte, Entfernung und Zeit werden erst bei der Anzeige daraus berechnet. Dadurch entstehen auch nach vielen Runden keine fortgeschriebenen Rundungsfehler. Zeitüberschreitungen zählen als ausgewertete Aufgabe mit 0 Punkten und benötigter Rundenzeit, besitzen aber ohne Tipp keine Entfernung und keinen Treffer.

Eine freie Sitzung gilt nach mindestens einer ausgewerteten Aufgabe beim Moduswechsel oder Verlassen der Seite als abgeschlossen. Ein Zeittraining beziehungsweise eine Prüfung gilt nur bei regulärem Ende als abgeschlossen. Bereits ausgewertete freie oder Zeitaufgaben eines später abgebrochenen Spiels bleiben in den Aufgabenaggregaten erhalten; unvollständige Prüfungsaufgaben werden nicht übernommen.

Für jedes Ziel wird nur ein begrenztes Aggregat nach stabiler Ziel-ID gespeichert: Name, Zieltyp, Kategorie, Aufgabenzahl, Punkte-, Entfernungs- und Zeit-Summen sowie Extremwerte. Tippkoordinaten, vollständige Rundenergebnisse und andere personenbezogene Angaben werden nicht gespeichert. Eine begrenzte Liste technischer Runden- und Spiel-IDs verhindert Doppelzählungen, ohne eine unbegrenzte Historie aufzubauen.

Zielrangfolgen sind deterministisch definiert:

- bestes Ziel: höchster Punktedurchschnitt, danach mehr Aufgaben, danach Ziel-ID
- schlechtestes Ziel: niedrigster Punktedurchschnitt, danach mehr Aufgaben, danach Ziel-ID
- häufigstes Ziel: höchste Aufgabenzahl, danach höherer Punktedurchschnitt, danach Ziel-ID

Export und Import verwenden JSON mit `schemaVersion`. Beim Import kann zwischen „Zusammenführen“ und „Ersetzen“ gewählt werden. Überschneidungen anhand der begrenzten Deduplizierungs-IDs werden beim Zusammenführen abgelehnt, damit dieselben bekannten Runden nicht doppelt eingehen. „Statistik zurücksetzen“ und ein ersetzender Import verlangen vorher eine Sicherheitsbestätigung.

Ein Rundenergebnis enthält immer:

```javascript
{
  mode,
  targetId,
  targetName,
  targetType,
  targetCategory,
  targetCategoryLabel,
  roundNumber,
  resultId,
  distanceMeters,
  points,
  durationSeconds,
  timedOut,
  guessCoordinates,
  timestamp
}
```

## POI-Daten pflegen

Alle Einträge stehen in `data/oberasbach-pois.js` innerhalb des Arrays `pois`. Für neue Daten bitte zunächst den offiziellen Namen, den aktuellen Betrieb und die Position über eine verlässliche Primärquelle prüfen. Die erste Version wurde unter anderem mit den Einrichtungs-, Kinderbetreuungs-, Freizeit- und Gastronomieseiten der Stadt Oberasbach sowie offiziellen Betreiberseiten abgeglichen; die Kartenpositionen stammen, soweit angegeben, aus OpenStreetMap/Nominatim. Der jeweilige Stand und verbleibende Zweifel sind direkt am Datensatz dokumentiert.

Ein neuer Eintrag folgt diesem Muster:

```javascript
poi({
  id: "poi-public-beispiel",
  displayName: "Offizieller Name der Einrichtung",
  category: "public-facility",
  subcategory: "Beispiel-Unterkategorie",
  latitude: 49.430000,
  longitude: 10.970000,
  address: "Musterstraße 1, 90522 Oberasbach",
  aliases: ["Gebräuchlicher Kurzname"],
  source: "Name der geprüften Quelle",
  sourceUrl: "https://…"
})
```

Dabei gelten folgende Regeln:

1. `id` bleibt dauerhaft stabil, beginnt mit `poi-` und darf nur einmal vorkommen.
2. `category` verwendet eine vorhandene Kategorien-ID: `school`, `childcare`, `senior-care`, `fuel`, `supermarket`, `health`, `public-facility`, `sports-leisure`, `hospitality`, `company` oder `other-relevant`.
3. GeoJSON speichert Koordinaten immer als `[Längengrad, Breitengrad]`. Die separaten Felder `latitude` und `longitude` bleiben für Pflege und Prüfung erhalten.
4. Bei einer noch nicht zweifelsfrei bestätigten Bezeichnung oder Position werden `needsReview: true` und eine konkrete `reviewNote` gesetzt. Unklare Einträge sollten zusätzlich mit `quizEligible: false` von Aufgaben ausgeschlossen werden.
5. Für einen vorübergehend geschlossenen, doppelten, außerhalb Oberasbachs liegenden oder offensichtlich irrelevanten Eintrag werden `active: false` und `quizEligible: false` gesetzt, statt seine ID zu recyceln.
6. Ein Orientierungspunkt wie ein Gerätehaus bleibt `active: true`, erhält aber `quizEligible: false`.

Große Einrichtungen können später statt des Standardpunkts eine echte Fläche erhalten. Das Datenmodell akzeptiert bereits GeoJSON `Polygon` und `MultiPolygon`:

```javascript
geometry: {
  type: "Polygon",
  coordinates: [[
    [10.9690, 49.4300],
    [10.9700, 49.4300],
    [10.9700, 49.4310],
    [10.9690, 49.4300]
  ]]
}
```

Nach jeder Datenänderung `node tests/targets-tests.js` ausführen. Der Test prüft unter anderem eindeutige IDs, bekannte Kategorien, Pflichtfelder, Koordinaten, Prüfhinweise und den Ausschluss inaktiver Einträge sowie der Gerätehäuser.

## Lokal testen

Du kannst `index.html` direkt öffnen. Zuverlässiger ist ein kleiner lokaler Entwicklungsserver:

```bash
cd oberasbach-strassentrainer
python3 -m http.server 8080
```

Anschließend `http://localhost:8080` öffnen.

### Automatische Tests

Node.js wird nur für den optionalen Entwicklungstest verwendet und ist für die Web-App nicht erforderlich:

```bash
node tests/geometry-tests.js
node tests/targets-tests.js
node tests/statistics-tests.js
node tests/game-engine-tests.js
node tests/timer-tests.js
node tests/free-mode-integration-tests.js
```

Die Tests decken Straßen- und POI-Geometrien, den lokalen Datenbestand, alle Engine-Zustände, Ergebnisfelder, Moduskonfigurationen, dauerhafte Statistik und den vollständigen Freien Modus ab. Die Integration prüft außerdem ausgeblendete Kategorien, gespeicherte Inhaltswahl und die Balance des gemischten Modus. Für den Zeitmodus werden insbesondere Tipp in der ersten Sekunde, Tipp kurz vor Ablauf, Ablauf ohne Tipp, ein simulierter Hintergrund-Zeitsprung, genau ein aktiver Timer, zehn aufeinanderfolgende Runden, Wiederholung und vorzeitiger Abbruch geprüft. Der Prüfungsmodus wird mit zehn vollständigen Aufgaben, einem Timeout, unterdrückter Zwischenauflösung, Abschlussliste, Karten-Nachprüfung, Statistiktrennung sowie Warnungen bei Reload, Zurücknavigation und Abbruch getestet. Separate Grenzwerttests prüfen 64,99 %, 65 %, 75 %, 85 %, 95 %, 99,99 % und exakt 100 % sowie die alternative Medaillendarstellung.

### POIs manuell testen

1. Im Freien Modus „Nur Orte und Einrichtungen“ wählen, mehrere Kategorien einzeln deaktivieren und einen Alarm starten. Es dürfen nur aktive, quizberechtigte Einträge aus den verbleibenden Kategorien erscheinen.
2. „Kategorie beim Alarm anzeigen“ ausschalten. Beim nächsten und beim aktuell laufenden Alarm darf die Kategorie nicht mehr sichtbar sein; der Zielname bleibt erhalten.
3. Möglichst genau auf eine bekannte Einrichtung tippen. Der blaue Tipp, der rote Zielpunkt und die gestrichelte kürzeste Verbindung müssen sichtbar und klar unterscheidbar sein.
4. „Straßen und Orte gemischt“ wählen und mindestens zehn Runden spielen. Straßen und POIs sollen annähernd gleich oft vorkommen und dasselbe Ziel darf nicht unmittelbar erneut erscheinen.
5. Die Seite neu laden. Inhaltswahl, Kategorien und Kategorieanzeige müssen aus `localStorage` wiederhergestellt werden.
6. Ein Zeittraining und eine Prüfung mit gemischtem Inhalt abschließen. Die Abschlussstatistik muss Straßen und Orte getrennt ausweisen; in der Prüfung darf die POI-Lösung weiterhin erst am Ende sichtbar werden.
7. Die Auswahl auf einem Smartphone oder in den mobilen Browser-Entwicklertools bedienen. Auswahlfelder, Kategoriezeilen und Checkboxen besitzen mindestens 44 Pixel hohe Touch-Ziele.

### Debugmodus und lange Straßen manuell prüfen

Die Seite mit `?debug=1` öffnen, beispielsweise:

```text
https://DEIN-BENUTZERNAME.github.io/REPOSITORY-NAME/?debug=1
```

In der Browserkonsole erscheinen dann Straßen-ID, Anzeigename, Geometrietyp, Abschnittsanzahl, OSM-IDs und nach einem Tipp die minimale Entfernung. Eine bestimmte Straße lässt sich ohne Änderung des normalen Spielablaufs vorbereiten:

```javascript
await STRASSENTRAINER_DEBUG.prepareStreet("Rothenburger Straße")
await STRASSENTRAINER_DEBUG.prepareStreet("Albrecht-Dürer-Straße")
await STRASSENTRAINER_DEBUG.prepareStreet("Hochstraße")
STRASSENTRAINER_DEBUG.getCurrentGeometry()
STRASSENTRAINER_DEBUG.getGameState()
STRASSENTRAINER_DEBUG.getStatistics()
```

Danach jeweils auf Anfang, Mitte und Ende der sichtbaren Straße klicken. Bei der Auflösung müssen sämtliche roten Teilstücke erscheinen.

## Auf GitHub Pages veröffentlichen

1. Ein neues GitHub-Repository erstellen.
2. Den **Inhalt dieses Ordners** in die oberste Ebene des Repositorys hochladen. `index.html` muss im Hauptverzeichnis liegen.
3. Im Repository `Settings` → `Pages` öffnen.
4. Unter `Build and deployment` als Quelle **Deploy from a branch** wählen.
5. Branch `main`, Ordner `/ (root)` auswählen und speichern.

Nach der Bereitstellung ist die Seite normalerweise unter folgender Struktur erreichbar:

```text
https://DEIN-BENUTZERNAME.github.io/REPOSITORY-NAME/
```

Alle Dateipfade sind relativ aufgebaut und funktionieren deshalb auch in einem Projekt-Unterverzeichnis von GitHub Pages.

## Dateien

- `index.html`: Seitenaufbau und externe Bibliotheken
- `styles.css`: Gestaltung und mobile Darstellung
- `geometry.js`: Straßenmodell und vollständige Mehrfachgeometrien
- `targets.js`: gemeinsames Zielmodell, Distanz- und Punkteauswertung für Straßen und POIs
- `statistics.js`: persistente aggregierte Statistik
- `game-engine.js`: gemeinsame Modus- und Runden-Engine
- `timer.js`: deadline-basierter Countdown
- `app.js`: Controller, Geocoding, Karte, Darstellung und Diagnose
- `data/oberasbach-streets.js`: lokale Straßenliste
- `data/oberasbach-pois.js`: lokale Kategorien und POIs mit Quellen- und Prüfstatus
- `tests/geometry-tests.js`: ausführbare Geometrie-Testfälle
- `tests/targets-tests.js`: POI-Datenintegrität, Punkt-/Polygonauswertung und Zieltypen
- `tests/statistics-tests.js`: Schema, Filter, Aggregate, Deduplizierung, Migration sowie Export/Import
- `tests/game-engine-tests.js`: Zustands-, Ergebnis- und Statistiktests
- `tests/timer-tests.js`: Uhr-, Deadline-, Hintergrund- und Abbruchtests
- `tests/free-mode-integration-tests.js`: vollständige Abläufe von Freiem Modus, Zeitmodus und Prüfungsmodus
- `.nojekyll`: verhindert eine unnötige Jekyll-Verarbeitung bei GitHub Pages

## Externe Dienste

Die Anwendung verwendet OpenStreetMap-Daten, einen beschriftungsfreien CARTO-Kartenstil sowie sparsame Nominatim-Abfragen ausschließlich zur bestehenden Vorbereitung vollständiger Straßenlinien. Eine Straßenabfrage kann bis zu 50 getrennte OSM-Ergebnisse desselben Namens liefern. Die Anwendung erzwingt zwischen externen Straßenabfragen eine Pause und speichert vollständige Ergebnisse lokal. POI-Aufgaben werden dagegen immer direkt aus `data/oberasbach-pois.js` geladen und lösen keine externe POI- oder Geocoding-Abfrage aus.

Kartendaten © OpenStreetMap-Mitwirkende, ODbL. Kartenstil © CARTO.
