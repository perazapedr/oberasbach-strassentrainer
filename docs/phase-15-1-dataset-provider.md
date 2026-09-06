# Phase 15.1 – Dataset Source Abstraction

## Zweck

Der City Manager kennt nicht mehr die konkrete Herkunft eines installierbaren Datasets. Die neue, interne Phase-15.1-Schnittstelle trennt Suche und Beschaffung von Validierung, Installation und Speicherung. Sie ist ausdrücklich noch kein stabiler öffentlicher Package Contract.

## Provider Contract

`dataset-provider.js` stellt vier Methoden bereit:

- `searchDatasets(query, options)` liefert normalisierte Kandidatenmetadaten.
- `getDatasetMetadata(datasetId, options)` liefert die Metadaten eines Kandidaten.
- `downloadDataset(datasetId, options)` liefert `{ datasetId, metadata, dataset }`.
- `checkForUpdate(installedDataset, options)` liefert das aktuelle Provider-Dataset für den bestehenden Versionsvergleich.

`signal` und `onProgress` werden an den vorhandenen Datenpfad weitergereicht. Provider können mit `requiresNetwork(operation)` angeben, ob der jeweilige Vorgang Netzwerkzugriff benötigt.

## Default- und Testprovider

Der Default bleibt `LegacyOsmDatasetProvider`. Er delegiert an den unveränderten OSM-Service: Die Suche verwendet weiterhin Nominatim, der Download weiterhin Overpass. OSM-Abfrage-, Chunking-, Retry-, Failover-, Timeout- und Abortlogik wurden nicht dupliziert.

`StaticDatasetProvider` nimmt bereits vorhandene Datensätze entgegen und benötigt kein Netzwerk. Er dient in Phase 15.1 dem Architektur- und Integrationstest; es wurde kein Produktionskatalog und kein neues Stadt-Dataset eingeführt.

## Datenfluss

Vor Phase 15.1:

```text
City Manager -> Nominatim / Overpass -> CityDataValidator -> CityStorage -> IndexedDB
```

Seit Phase 15.1:

```text
City Manager -> DatasetProvider -> Dataset -> CityDataValidator -> CityStorage -> IndexedDB -> CityContext
```

Der Provider ist per `createCityManager({ datasetProvider })` austauschbar. Das bestehende Package-System bleibt für Dateiimport und -export zuständig; der bestehende Validator und der bestehende IndexedDB-Speicher werden unverändert wiederverwendet.

## Scope-Grenze

Nicht Bestandteil dieser Phase sind PBF-Verarbeitung, Geofabrik, Dataset Builder, `catalog.json`, CDN/Repository, ein neues Package-Schema oder die Entfernung von Nominatim/Overpass. `TA-POLYGON-001` bleibt `DEFERRED`. `P15-BASELINE-OFFLINE-SMOKE` bleibt offen, bis ein echter Browser-Offline-Smoke durchgeführt wurde.

Die nächste Phase ist 15.2: PBF-Proof-of-Concept für Olpe.
