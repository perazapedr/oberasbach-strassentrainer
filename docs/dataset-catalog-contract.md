# Straßentrainer – Offizieller Dataset Catalog Contract (Schema 1)

Dieser Vertrag definiert die verbindliche Schnittstelle für den **Straßentrainer-Dataset-Katalog** (`catalog.json`) zwischen Veröffentlichungswerkzeugen (Catalog Builder) und der Anwendung (CatalogDatasetProvider, City Manager).

---

## 1. Zweck

Der Dataset-Katalog dient als **Such-, Auswahl- und Download-Index** für installierbare Trainingsdatenpakete:
- **Unabhängigkeit von Drittanbieter-APIs**: Benutzer und City Manager können verfügbare offizielle Datensätze durchsuchen und auswählen, ohne dafür Nominatim oder Overpass kontaktieren zu müssen.
- **Entkopplung**: Die Anwendung benötigt für die Dataset-Suche keine Verbindung zur OSM-API und muss keine PBF-Dateien parsen.
- **Kompaktheit**: Der Katalog ist ein leichtgewichtiger Index, der die Metadaten bündelt, die für Suche, Versionsprüfung und Download-Planung nötig sind.

---

## 2. Katalog vs. Package (Rollenverteilung)

Es gilt die fundamentale Architekturregel:

```text
Package = Normative Dataset-Wahrheit (vollständige Geometrien, Straßen, POIs, Gebiete)
Catalog = Such-, Versions- und Download-Index (Metadaten-Index)
```

- Das **Package** (Schema 1, siehe [docs/dataset-package-contract.md](dataset-package-contract.md)) ist die alleinige normative Quelle der Wahrheit für alle Geodaten (Grenzen, Straßennetz, POIs, Gebiete).
- Der **Katalog** dupliziert **keine** Geometrien, Straßenlisten oder Detaildaten. Er fasst lediglich die für Auffindbarkeit, Metadatenanzeige und Downloadentscheidung notwendigen Deskriptoren zusammen.

---

## 3. Schema-Version

- Das aktuelle normative Schema ist **`schemaVersion: 1`**.
- Spezifikation: Maschinenlesbar unter [schemas/strassentrainer-catalog.schema.json](../schemas/strassentrainer-catalog.schema.json).
- **Stabilität**: Wie beim Package Contract sind Feldänderungen innerhalb von `schemaVersion: 1` strikt abwärtskompatibel zu halten (rein additive neue optionale Felder).

---

## 4. Vollständiges Referenz-Beispiel

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-06T12:00:00.000Z",
  "datasets": [
    {
      "id": "de-nw-olpe",
      "name": "Olpe",
      "displayName": "Olpe",
      "datasetKind": "municipality",
      "state": "Nordrhein-Westfalen",
      "district": null,
      "country": "Deutschland",
      "postalCodes": [],
      "cityId": "osm-relation-163179",
      "osmType": "relation",
      "osmRelationId": 163179,
      "packageType": "osm",
      "version": "2026.09.05",
      "contentHash": "sha256:6c89d676e575f2d69301715c3be5e8e66b5a798afc21b73495671fa33d996269",
      "streetCount": 461,
      "poiCount": 114,
      "areaCount": 2,
      "center": {
        "lat": 51.0395968,
        "lon": 7.8863866
      },
      "bounds": {
        "south": 50.98689,
        "west": 7.8040829,
        "north": 51.0878047,
        "east": 7.9741967
      },
      "downloadPath": "cities/de-nw-olpe.json",
      "fileSize": 1328294,
      "title": "Olpe – OpenStreetMap-PBF-Dataset",
      "source": "osm-pbf"
    }
  ]
}
```

---

## 5. Dataset Identity

Jeder Katalogeintrag besitzt zwei eindeutige, aufeinander abgestimmte Identitäten:
1. **`id` (Paket-Identität)**:
   - Entspricht exakt `package.id` des offiziellen Datenpakets (z. B. `"de-nw-olpe"` oder `"de-oberasbach-fire-training"`).
   - Dient als primärer Schlüssel im `CatalogDatasetProvider` und im Katalog.
   - Muss innerhalb des gesamten Katalogs **strikt eindeutig** sein (Duplikate führen zum Build-Fehler).
2. **`cityId` (Geografische Identität)**:
   - Entspricht `city.id` des Datenpakets (Format: `"osm-relation-<ID>"`).
   - Repräsentiert die zugrundeliegende OpenStreetMap-Körperschaft.
   - Ermöglicht dem City Manager die Verknüpfung mit bereits lokal installierten Städten.

---

## 6. Fachliche Verwendung von datasetKind

Das Feld `datasetKind` beschreibt ausschließlich die **geografische/administrative Art des Trainingsgebiets**:
- `"municipality"`: Politische Gemeinde / Stadtgebiet (Standard für Oberasbach und Olpe).
- `"city"`: Kreisfreie Stadt oder Großstadt.
- `"district"`: Landkreis / Gemeindeverband.
- `"custom"`: Benutzerdefiniertes Übungsgebiet.

> [!IMPORTANT]
> Curation bzw. redaktionelle Herkunft gehört **nicht** in `datasetKind`. Die Datenherkunft und Kurationsstufe wird ausschließlich über `packageType` bzw. `source` dargestellt. `"curated"` wird aus Gründen der Rückwärtskompatibilität im Schema als Fallback toleriert, darf aber für neu erzeugte Katalogeinträge nicht als Standard verwendet werden.

---

## 7. Curation vs. Datenherkunft

- **`packageType`**: Beschreibt den redaktionellen Prüf- und Erzeugungsstatus (`"curated"`, `"osm"`, `"imported"`).
- **`source`**: Beschreibt die technische Quelle der Geometrien (z. B. `"osm-pbf"`, `"curated"`).

---

## 8. Versionssemantik

- Das Feld `version` übernimmt exakt den Stand `package.version` des indizierten Pakets.
- Unterstützt werden **SemVer** (`MAJOR.MINOR.PATCH`, z. B. `"1.0.0"`) und **CalVer** (`YYYY.MM.DD` bzw. `YYYY.MM.DD.R`, z. B. `"2026.09.05"`).
- Für den Vergleich installierter Versionen mit Katalogeinträgen nutzt der Provider die normative Vergleichsfunktion `comparePackageVersions()`.

---

## 9. contentHash im Katalog

- Der Katalog übernimmt unverändert den `contentHash` (`sha256:...`) aus dem offiziellen Datenpaket.
- **Bedeutung**: Erwartete semantische Inhaltsidentität des Datensatzes.
- **Integritätsprüfung**: Beim Download eines Pakets über den Katalog prüft der `CatalogDatasetProvider`, dass der `contentHash` des heruntergeladenen Pakets exakt mit dem im Katalog deklarierten Hash übereinstimmt.
- **Keine digitale Signatur**: Der Hash garantiert Dateiintaktheit (Integrität), stellt jedoch keine kryptografische Beglaubigung durch eine Public-Key-Infrastruktur dar.

---

## 10. Dateigröße (fileSize)

- Das Feld `fileSize` enthält die Dateigröße des Package-JSON-Artefakts in Bytes als positive Ganzzahl.
- Es dient ausschließlich der Download-Planung und der Anzeige im UI (z. B. "1,3 MB").

---

## 11. Downloadpfade (downloadPath)

- Alle `downloadPath`-Angaben sind **relativ, portabel und statisch hostbar** (z. B. `"cities/de-nw-olpe.json"`).
- Verboten sind:
  - Absolute Pfade (wie `"/Users/pedro/..."`, `"C:\\..."`).
  - URL-Schemata (`"file:///"`, `"http://localhost/"`).
  - Host-spezifische Pfadangaben.
- Der Basispfad wird vom Konsumenten (z. B. Browser via `new URL(downloadPath, catalogUrl)`) aufgelöst.

---

## 12. Pfadsicherheit

Der Catalog Builder und der CatalogDatasetProvider erzwingen strikte Pfadsicherheit:
- **Directory Traversal** (`..` oder `.` Segmente) ist unzulässig und wird hart abgewiesen.
- **Backslashes** (`\`) sind verboten (nur POSIX-Slashes `/`).
- Pfade müssen auf `.json` enden.
- Bei Verletzung bricht der Katalog-Build ab.

---

## 13. Forward Compatibility

- Unbekannte zusätzliche Eigenschaften in zukünftigen Schemaversionen dürfen bestehende Clients nicht zum Absturz bringen.
- Der Katalog-Konsument ignoriert nicht bekannte Zusatzfelder, solange die Pflichtfelder vorhanden sind.

---

## 14. Determinismus

Bei identischen Quellpaketen muss der Catalog Builder ein **vollständig deterministisches Ergebnis** liefern:
- **Stabile Sortierung**: Die `datasets`-Einträge werden streng deterministisch nach folgenden Kriterien sortiert:
  1. `country` (aufsteigend)
  2. `state` (aufsteigend)
  3. `name` (aufsteigend, deutsche Sortierung)
  4. `id` (aufsteigend)
- **Stabile JSON-Formatierung**: 2 Leerzeichen Einrückung, konsistenter Zeilenumbruch.
- `generatedAt` reflektiert den Generierungszeitpunkt.

