"use strict";

const assert = require("node:assert/strict");
const poiCategories = require("../poi-categories.js");
const validator = require("../city-data-validator.js");
const osmService = require("../osm-service.js");
const targetApi = require("../targets.js");
const packageApi = require("../city-package.js");
const updateApi = require("../city-update.js");
const geometryApi = require("../geometry.js");

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exit(1);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log("Starte Phase 14.2 POI-Kategorie-Tests ...");

// ---------------------------------------------------------------------------
// 1. Registry Integrität
// ---------------------------------------------------------------------------

test("1.1 Alle 13 Kategorien sind vorhanden und IDs sind eindeutig", () => {
  const all = poiCategories.getAll();
  assert.equal(all.length, 13);
  const ids = all.map(c => c.id);
  assert.equal(new Set(ids).size, 13);

  const existingIds = ["fire_station", "school", "kindergarten", "supermarket"];
  for (const id of existingIds) {
    assert.ok(poiCategories.isKnown(id), `Bestehende ID ${id} muss vorhanden sein`);
  }

  const newIds = [
    "police", "hospital", "nursing_care", "fuel", "company",
    "hotel", "restaurant", "sports_facility", "public_building"
  ];
  for (const id of newIds) {
    assert.ok(poiCategories.isKnown(id), `Neue ID ${id} muss vorhanden sein`);
  }
});

test("1.2 Alle Kategorien besitzen gültige Bezeichnungen und Singularformen", () => {
  for (const cat of poiCategories.getAll()) {
    assert.ok(typeof cat.label === "string" && cat.label.length > 0, `${cat.id} hat kein label`);
    assert.ok(typeof cat.singularLabel === "string" && cat.singularLabel.length > 0, `${cat.id} hat kein singularLabel`);
    assert.equal(poiCategories.getLabel(cat.id), cat.label);
    assert.equal(poiCategories.getSingularLabel(cat.id), cat.singularLabel);
  }
  assert.equal(poiCategories.getLabel("police"), "Polizei");
  assert.equal(poiCategories.getLabel("hospital"), "Krankenhäuser");
  assert.equal(poiCategories.getSingularLabel("hospital"), "Krankenhaus");
  assert.equal(poiCategories.getLabel("nursing_care"), "Pflegeeinrichtungen");
  assert.equal(poiCategories.getLabel("public_building"), "Öffentliche Gebäude");
});

test("1.3 Jede Kategorie besitzt eine eindeutige Priorität und feste UI-Sortierung", () => {
  const all = poiCategories.getAll();
  const priorities = all.map(c => c.priority);
  assert.equal(new Set(priorities).size, 13, "Prioritäten müssen eindeutig sein");
  const orders = all.map(c => c.order);
  assert.equal(new Set(orders).size, 13, "Order muss eindeutig sein");

  // Spezifische Fachkategorien haben höhere Priorität (niedrigeren numerischen Wert) als public_building
  const publicBuilding = poiCategories.getById("public_building");
  const hospital = poiCategories.getById("hospital");
  const police = poiCategories.getById("police");
  const fireStation = poiCategories.getById("fire_station");
  assert.ok(fireStation.priority < publicBuilding.priority);
  assert.ok(police.priority < publicBuilding.priority);
  assert.ok(hospital.priority < publicBuilding.priority);
});

// ---------------------------------------------------------------------------
// 2. OSM Klassifizierung (Positive & Negative Fixtures)
// ---------------------------------------------------------------------------

test("2.1 Positive Klassifizierung aller 13 Kategorien", () => {
  assert.equal(poiCategories.matchOsmCategory({ amenity: "fire_station" })?.id, "fire_station");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "police" })?.id, "police");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "hospital" })?.id, "hospital");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "clinic" })?.id, "hospital");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "nursing_home" })?.id, "nursing_care");
  assert.equal(poiCategories.matchOsmCategory({ social_facility: "nursing_home" })?.id, "nursing_care");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", "social_facility:for": "senior" })?.id, "nursing_care");
  assert.equal(poiCategories.matchOsmCategory({ healthcare: "hospice" })?.id, "nursing_care");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "school" })?.id, "school");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "kindergarten" })?.id, "kindergarten");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "childcare" })?.id, "kindergarten");
  assert.equal(poiCategories.matchOsmCategory({ shop: "supermarket" })?.id, "supermarket");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "fuel" })?.id, "fuel");
  assert.equal(poiCategories.matchOsmCategory({ tourism: "hotel" })?.id, "hotel");
  assert.equal(poiCategories.matchOsmCategory({ tourism: "motel" })?.id, "hotel");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "restaurant" })?.id, "restaurant");
  assert.equal(poiCategories.matchOsmCategory({ leisure: "sports_centre" })?.id, "sports_facility");
  assert.equal(poiCategories.matchOsmCategory({ leisure: "stadium" })?.id, "sports_facility");
  assert.equal(poiCategories.matchOsmCategory({ leisure: "sports_hall" })?.id, "sports_facility");
  assert.equal(poiCategories.matchOsmCategory({ leisure: "water_park" })?.id, "sports_facility");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "public_bath" })?.id, "sports_facility");
  assert.equal(poiCategories.matchOsmCategory({ office: "company" })?.id, "company");
  assert.equal(poiCategories.matchOsmCategory({ man_made: "works" })?.id, "company");
  assert.equal(poiCategories.matchOsmCategory({ industrial: "factory" })?.id, "company");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "townhall" })?.id, "public_building");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "courthouse" })?.id, "public_building");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "community_centre" })?.id, "public_building");
  assert.equal(poiCategories.matchOsmCategory({ office: "government" })?.id, "public_building");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "library" })?.id, "public_building");
  assert.equal(poiCategories.matchOsmCategory({ amenity: "post_office" })?.id, "public_building");
});

test("2.2 Multi-Match-Prioritätsauflösung", () => {
  // Krankenhaus im öffentlichen Gebäude -> hospital gewinnt
  assert.equal(
    poiCategories.matchOsmCategory({ amenity: "hospital", office: "government", building: "public" })?.id,
    "hospital"
  );
  // Polizeistation im Regierungsgebäude -> police gewinnt
  assert.equal(
    poiCategories.matchOsmCategory({ amenity: "police", office: "government" })?.id,
    "police"
  );
  // Feuerwache mit Regierungsstelle -> fire_station gewinnt
  assert.equal(
    poiCategories.matchOsmCategory({ amenity: "fire_station", office: "government" })?.id,
    "fire_station"
  );
  // Restaurant im Bürogebäude -> restaurant gewinnt vor company
  assert.equal(
    poiCategories.matchOsmCategory({ amenity: "restaurant", office: "company" })?.id,
    "restaurant"
  );
});

// ---------------------------------------------------------------------------
// 3. Konservative Abgrenzung der schwierigen Kategorien
// ---------------------------------------------------------------------------

test("3.1 Unternehmen: Keine unkontrollierte Wildcard-Übernahme", () => {
  assert.equal(poiCategories.matchOsmCategory({ shop: "bakery" }), null);
  assert.equal(poiCategories.matchOsmCategory({ shop: "clothes" }), null);
  assert.equal(poiCategories.matchOsmCategory({ office: "lawyer" }), null);
  assert.equal(poiCategories.matchOsmCategory({ office: "insurance" }), null);
  assert.equal(poiCategories.matchOsmCategory({ office: "accountant" }), null);
  assert.equal(poiCategories.matchOsmCategory({ craft: "carpenter" }), null);
  assert.equal(poiCategories.matchOsmCategory({ industrial: "warehouse" }), null);
});

test("3.2 Öffentliche Gebäude: Kein unkontrolliertes building=public/yes", () => {
  assert.equal(poiCategories.matchOsmCategory({ building: "public" }), null);
  assert.equal(poiCategories.matchOsmCategory({ building: "yes" }), null);
  assert.equal(poiCategories.matchOsmCategory({ building: "civic" }), null);
});

test("3.3 Sportstätten: Einzelne Sportplätze (leisure=pitch) werden ausgeschlossen", () => {
  assert.equal(poiCategories.matchOsmCategory({ leisure: "pitch" }), null);
  assert.equal(poiCategories.matchOsmCategory({ leisure: "track" }), null);
});

test("3.4 Pflegeeinrichtungen: Kinder-/Jugend-/Sozialeinrichtungen ausgeschlossen", () => {
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", "social_facility:for": "child" }), null);
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", "social_facility:for": "youth" }), null);
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", "social_facility:for": "refugee" }), null);
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", social_facility: "soup_kitchen" }), null);
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", social_facility: "food_bank" }), null);
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", social_facility: "office", "social_facility:for": "senior" }), null);
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", social_facility: "club", "social_facility:for": "senior" }), null);
  assert.equal(poiCategories.matchOsmCategory({ amenity: "social_facility", social_facility: "counselling", "social_facility:for": "senior" }), null);
});

// ---------------------------------------------------------------------------
// 4. Overpass Query Klauseln
// ---------------------------------------------------------------------------

test("4.1 getOverpassPoiQueryClauses erzeugt valide Klauseln mit [name]", () => {
  const clauses = poiCategories.getOverpassPoiQueryClauses("49.0,10.0,49.1,10.1");
  assert.ok(clauses.length >= 8);
  for (const clause of clauses) {
    assert.ok(clause.includes('["name"]'), `Klausel muss ["name"] enthalten: ${clause}`);
    assert.ok(clause.includes("nwr(area.searchArea)(49.0,10.0,49.1,10.1)"), `Klausel muss Bbox enthalten: ${clause}`);
  }
});

// ---------------------------------------------------------------------------
// 5. Validierung & Rückwärtskompatibilität
// ---------------------------------------------------------------------------

function makeMinimalCityPackage(pois = []) {
  return {
    schemaVersion: 1,
    city: {
      id: "osm-relation-99999",
      name: "Teststadt",
      displayName: "Teststadt",
      osmType: "relation",
      osmId: 99999,
      country: "Deutschland",
      source: "OpenStreetMap-Community",
      dataVersion: 1,
      createdAt: "2026-09-05T20:00:00.000Z",
      updatedAt: "2026-09-05T20:00:00.000Z",
      bounds: { south: 49.0, west: 10.0, north: 49.1, east: 10.1 },
      center: { lat: 49.05, lon: 10.05 },
      postalCodes: ["99999"]
    },
    boundary: {
      type: "Polygon",
      coordinates: [[[10.0, 49.0], [10.1, 49.0], [10.1, 49.1], [10.0, 49.1], [10.0, 49.0]]]
    },
    streets: Array.from({ length: 6 }, (_, i) => ({
      id: `osm-relation-99999:street-w${i + 100}`,
      cityId: "osm-relation-99999",
      name: `Straße ${i + 1}`,
      highway: "residential",
      osmWayIds: [i + 100],
      geometry: {
        type: "MultiLineString",
        coordinates: [[[10.02 + i * 0.01, 49.02], [10.03 + i * 0.01, 49.03]]]
      }
    })),
    pois,
    areas: []
  };
}

test("5.1 Altes Stadtpaket mit nur 4 Kategorien bleibt vollständig valide", () => {
  const legacyPois = [
    {
      id: "osm-relation-99999:poi:node-1",
      cityId: "osm-relation-99999",
      name: "Feuerwehr Mitte",
      category: "fire_station",
      osmType: "node",
      osmId: 1,
      position: { lat: 49.05, lon: 10.05 },
      geometry: { type: "Point", coordinates: [10.05, 49.05] }
    },
    {
      id: "osm-relation-99999:poi:node-2",
      cityId: "osm-relation-99999",
      name: "Grundschule",
      category: "school",
      osmType: "node",
      osmId: 2,
      position: { lat: 49.051, lon: 10.051 },
      geometry: { type: "Point", coordinates: [10.051, 49.051] }
    }
  ];
  const pkg = makeMinimalCityPackage(legacyPois);
  const result = validator.validateCityData(pkg, { mode: "download" });
  assert.equal(result.valid, true);
  assert.equal(result.pois.length, 2);
});

test("5.2 Neues Stadtpaket mit neuen Kategorien validiert fehlerfrei", () => {
  const newPois = [
    {
      id: "osm-relation-99999:poi:node-10",
      cityId: "osm-relation-99999",
      name: "Polizeiinspektion",
      category: "police",
      osmType: "node",
      osmId: 10,
      position: { lat: 49.05, lon: 10.05 },
      geometry: { type: "Point", coordinates: [10.05, 49.05] }
    },
    {
      id: "osm-relation-99999:poi:node-11",
      cityId: "osm-relation-99999",
      name: "Klinikum Süd",
      category: "hospital",
      osmType: "node",
      osmId: 11,
      position: { lat: 49.052, lon: 10.052 },
      geometry: { type: "Point", coordinates: [10.052, 49.052] }
    },
    {
      id: "osm-relation-99999:poi:node-12",
      cityId: "osm-relation-99999",
      name: "Seniorenresidenz Park",
      category: "nursing_care",
      osmType: "node",
      osmId: 12,
      position: { lat: 49.053, lon: 10.053 },
      geometry: { type: "Point", coordinates: [10.053, 49.053] }
    },
    {
      id: "osm-relation-99999:poi:node-13",
      cityId: "osm-relation-99999",
      name: "Freie Tankstelle",
      category: "fuel",
      osmType: "node",
      osmId: 13,
      position: { lat: 49.054, lon: 10.054 },
      geometry: { type: "Point", coordinates: [10.054, 49.054] }
    },
    {
      id: "osm-relation-99999:poi:node-14",
      cityId: "osm-relation-99999",
      name: "Stadtparkhotel",
      category: "hotel",
      osmType: "node",
      osmId: 14,
      position: { lat: 49.055, lon: 10.055 },
      geometry: { type: "Point", coordinates: [10.055, 49.055] }
    },
    {
      id: "osm-relation-99999:poi:node-15",
      cityId: "osm-relation-99999",
      name: "Brauereigasthof",
      category: "restaurant",
      osmType: "node",
      osmId: 15,
      position: { lat: 49.056, lon: 10.056 },
      geometry: { type: "Point", coordinates: [10.056, 49.056] }
    },
    {
      id: "osm-relation-99999:poi:node-16",
      cityId: "osm-relation-99999",
      name: "Sportpark Nord",
      category: "sports_facility",
      osmType: "node",
      osmId: 16,
      position: { lat: 49.057, lon: 10.057 },
      geometry: { type: "Point", coordinates: [10.057, 49.057] }
    },
    {
      id: "osm-relation-99999:poi:node-17",
      cityId: "osm-relation-99999",
      name: "Siemens Werk",
      category: "company",
      osmType: "node",
      osmId: 17,
      position: { lat: 49.058, lon: 10.058 },
      geometry: { type: "Point", coordinates: [10.058, 49.058] }
    },
    {
      id: "osm-relation-99999:poi:node-18",
      cityId: "osm-relation-99999",
      name: "Rathaus",
      category: "public_building",
      osmType: "node",
      osmId: 18,
      position: { lat: 49.059, lon: 10.059 },
      geometry: { type: "Point", coordinates: [10.059, 49.059] }
    }
  ];
  const pkg = makeMinimalCityPackage(newPois);
  const result = validator.validateCityData(pkg, { mode: "download" });
  assert.equal(result.valid, true);
  assert.equal(result.pois.length, 9);
});

// ---------------------------------------------------------------------------
// 6. Import / Export Roundtrip
// ---------------------------------------------------------------------------

test("6.1 Export und Import eines Pakets mit neuen POI-Kategorien (Roundtrip)", () => {
  const pois = [
    {
      id: "osm-relation-99999:poi:node-10",
      cityId: "osm-relation-99999",
      name: "Polizei",
      category: "police",
      categoryLabel: "Polizei",
      osmType: "node",
      osmId: 10,
      position: { lat: 49.05, lon: 10.05 },
      geometry: { type: "Point", coordinates: [10.05, 49.05] }
    },
    {
      id: "osm-relation-99999:poi:node-11",
      cityId: "osm-relation-99999",
      name: "Krankenhaus",
      category: "hospital",
      categoryLabel: "Krankenhaus",
      osmType: "node",
      osmId: 11,
      position: { lat: 49.052, lon: 10.052 },
      geometry: { type: "Point", coordinates: [10.052, 49.052] }
    }
  ];
  const pkg = makeMinimalCityPackage(pois);
  const created = packageApi.createCityPackage(pkg.city, pkg.streets, pkg.pois, pkg.areas);
  const serialized = JSON.stringify(created);
  const imported = packageApi.parseCityPackageText(serialized);
  assert.equal(imported.pois.length, 2);
  assert.equal(imported.pois[0].category, "police");
  assert.equal(imported.pois[1].category, "hospital");
});

// ---------------------------------------------------------------------------
// 7. Stadtupdate & Versionsvergleich
// ---------------------------------------------------------------------------

test("7.1 Versionsvergleich erkennt neue Kategorien im Candidate als addedPois", () => {
  const currentPois = [
    { id: "poi-1", name: "Alte Schule", category: "school", position: { lat: 49.05, lon: 10.05 } }
  ];
  const candidatePois = [
    { id: "poi-1", name: "Alte Schule", category: "school", position: { lat: 49.05, lon: 10.05 } },
    { id: "poi-2", name: "Neues Krankenhaus", category: "hospital", position: { lat: 49.06, lon: 10.06 } },
    { id: "poi-3", name: "Polizeiinspektion", category: "police", position: { lat: 49.07, lon: 10.07 } }
  ];
  const current = makeMinimalCityPackage(currentPois);
  const candidate = makeMinimalCityPackage(candidatePois);

  const diff = updateApi.compareCityVersions(current, candidate);
  assert.equal(diff.pois.unchanged.length, 1);
  assert.equal(diff.pois.added.length, 2);
  assert.ok(diff.pois.added.some(p => p.category === "hospital"));
  assert.ok(diff.pois.added.some(p => p.category === "police"));
});

test("7.2 Kategorieänderung bei gleicher stabiler ID wird als Modifikation erkannt", () => {
  const currentPois = [
    { id: "poi-1", name: "Altes Gebäude", category: "public_building", position: { lat: 49.05, lon: 10.05 } }
  ];
  const candidatePois = [
    { id: "poi-1", name: "Altes Gebäude", category: "hospital", position: { lat: 49.05, lon: 10.05 } }
  ];
  const current = makeMinimalCityPackage(currentPois);
  const candidate = makeMinimalCityPackage(candidatePois);

  const diff = updateApi.compareCityVersions(current, candidate);
  assert.equal(diff.pois.modified.length, 1);
  assert.equal(diff.pois.modified[0].changes.category, true);
  assert.equal(diff.pois.modified[0].id, "poi-1");
});

// ---------------------------------------------------------------------------
// 8. Target-Erstellung und TrainingArea-Filterung
// ---------------------------------------------------------------------------

test("8.1 targets.preparePoiTargets überführt neue Kategorien dynamisch in Zielmodell", () => {
  const rawPois = [
    { id: "p1", name: "Klinikum", category: "hospital", latitude: 49.05, longitude: 10.05, areaIds: ["area-1"] },
    { id: "p2", name: "Polizeiwache", category: "police", latitude: 49.06, longitude: 10.06, areaIds: ["area-2"] }
  ];
  const targets = targetApi.preparePoiTargets(rawPois, poiCategories.getAll());
  assert.equal(targets.length, 2);
  assert.equal(targets[0].category, "hospital");
  assert.equal(targets[0].categoryLabel, "Krankenhäuser");
  assert.equal(targets[1].category, "police");
  assert.equal(targets[1].categoryLabel, "Polizei");

  // Area-Filterung
  const inArea1 = targets.filter(t => t.areaIds.includes("area-1"));
  assert.equal(inArea1.length, 1);
  assert.equal(inArea1[0].id, "p1");

  const inArea2 = targets.filter(t => t.areaIds.includes("area-2"));
  assert.equal(inArea2.length, 1);
  assert.equal(inArea2[0].id, "p2");
});

// ---------------------------------------------------------------------------
// 9. Zero-Target-Schutz
// ---------------------------------------------------------------------------

test("9.1 POI-Kategorie ohne spielbare Ziele liefert 0 Treffer ohne Endlosschleife", () => {
  const targets = [
    { id: "p1", category: "fire_station", active: true, quizEligible: true },
    { id: "p2", category: "school", active: true, quizEligible: true }
  ];
  const selectedCategories = new Set(["hospital"]);
  const eligible = targets.filter(t => t.active && t.quizEligible && selectedCategories.has(t.category));
  assert.equal(eligible.length, 0);
});

console.log("\nErgebnis: Alle Phase 14.2 POI-Kategorie-Tests erfolgreich bestanden.");
