(function initializeOberasbachPois(root) {
  "use strict";

  const checkedAt = "2026-07-21";
  const cityFacilitiesUrl = "https://www.oberasbach.de/buergerservice-politik/einrichtungen-adressen/staedtische-einrichtungen";
  const cityChildcareUrl = "https://www.oberasbach.de/leben-erleben/kinderbetreuung/kinderbetreuung-foerderung";
  const cityLeisureUrl = "https://www.oberasbach.de/leben-erleben/freizeit-sport-naherholung/freizeitangebote";
  const cityFoodUrl = "https://www.oberasbach.de/leben-erleben/freizeit-sport-naherholung/essen-trinken";
  const osmCopyrightUrl = "https://www.openstreetmap.org/copyright";
  const geometryCheckedAt = "2026-07-27";

  const categories = Object.freeze([
    { id: "school", label: "Schule" },
    { id: "childcare", label: "Kindertagesstätte" },
    { id: "senior-care", label: "Senioren-/Pflegeeinrichtung" },
    { id: "fuel", label: "Tankstelle" },
    { id: "supermarket", label: "Supermarkt/Einkaufsmarkt" },
    { id: "health", label: "Gesundheit" },
    { id: "public-facility", label: "Öffentliche Einrichtung" },
    { id: "sports-leisure", label: "Sport/Freizeit" },
    { id: "hospitality", label: "Gastronomie/Beherbergung" },
    { id: "company", label: "Unternehmen" },
    { id: "other-relevant", label: "Sonstiger einsatzrelevanter Ort" }
  ]);
  const categoryLabels = Object.fromEntries(categories.map(item => [item.id, item.label]));

  function poi(data) {
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    return Object.freeze({
      id: data.id,
      displayName: data.displayName,
      category: data.category,
      categoryLabel: categoryLabels[data.category],
      subcategory: data.subcategory || null,
      latitude,
      longitude,
      address: data.address || null,
      aliases: Object.freeze(data.aliases || []),
      active: data.active !== false,
      quizEligible: data.quizEligible !== false,
      geometry: Object.freeze(data.geometry || {
        type: "Point",
        coordinates: [longitude, latitude]
      }),
      geometryScope: data.geometryScope || "point",
      geometrySource: data.geometrySource || null,
      geometrySourceUrl: data.geometrySourceUrl || null,
      geometryCheckedAt: data.geometryCheckedAt || null,
      source: data.source || "OpenStreetMap",
      sourceUrl: data.sourceUrl || osmCopyrightUrl,
      positionSource: data.positionSource || "OpenStreetMap/Nominatim",
      checkedAt,
      needsReview: Boolean(data.needsReview),
      reviewNote: data.reviewNote || null
    });
  }

  function siteGeometry(osmWayId, outerRing) {
    return Object.freeze({
      geometryScope: "site",
      geometrySource: "OpenStreetMap",
      geometrySourceUrl: `https://www.openstreetmap.org/way/${osmWayId}`,
      geometryCheckedAt,
      geometry: Object.freeze({
        type: "Polygon",
        coordinates: [outerRing]
      })
    });
  }

  // Ausschließlich OSM-Flächen, die das gesamte Einrichtungsgelände abbilden.
  // Reine Gebäudeumrisse (building=*) werden bewusst nicht als Gelände verwendet.
  const siteGeometryByPoiId = Object.freeze({
    "poi-school-grundschule-altenberg": siteGeometry(22811978, [[10.9751552, 49.4314153], [10.9762704, 49.4315816], [10.976855, 49.4301437], [10.9761492, 49.4300901], [10.9759437, 49.4306442], [10.9755027, 49.4305713], [10.9751552, 49.4314153]]),
    "poi-school-pestalozzi-grundschule": siteGeometry(391891536, [[10.9702712, 49.4281516], [10.9702056, 49.4272787], [10.9708627, 49.4272411], [10.9708397, 49.4270542], [10.9709321, 49.4270484], [10.9709231, 49.4268593], [10.9722274, 49.4266949], [10.9723025, 49.4279548], [10.9708546, 49.4279808], [10.9708306, 49.428127], [10.9702712, 49.4281516]]),
    "poi-school-dbg": siteGeometry(190252898, [[10.9639062, 49.4338813], [10.965482, 49.4336301], [10.9648812, 49.4329786], [10.9645231, 49.4323533], [10.96238, 49.431803], [10.9617846, 49.4319353], [10.9622246, 49.4328493], [10.9625091, 49.4341259], [10.9639062, 49.4338813]]),
    "poi-school-elisabeth-krauss": siteGeometry(393625780, [[10.953541, 49.4311616], [10.9532684, 49.4319311], [10.9542082, 49.4320852], [10.9539843, 49.4327309], [10.9547006, 49.4328418], [10.9549693, 49.4321051], [10.9542968, 49.4319994], [10.9545959, 49.4310236], [10.9542047, 49.4310302], [10.9540182, 49.4311081], [10.953541, 49.4311616]]),
    "poi-childcare-st-stephanus": siteGeometry(347141315, [[10.9848713, 49.4214087], [10.9848728, 49.4213916], [10.9848764, 49.4213519], [10.985396, 49.4213603], [10.9856542, 49.421424], [10.9856598, 49.4210418], [10.985037, 49.4210225], [10.984987, 49.4211141], [10.9845614, 49.4210076], [10.9843339, 49.4214044], [10.9848713, 49.4214087]]),
    "poi-childcare-st-johannes": siteGeometry(391888962, [[10.9721005, 49.4285281], [10.9721017, 49.4284264], [10.9721597, 49.4284248], [10.9721588, 49.428377], [10.972216, 49.4283691], [10.9722144, 49.4282682], [10.9721936, 49.4282693], [10.9721881, 49.4282004], [10.9721597, 49.4282013], [10.9721558, 49.4281413], [10.9722967, 49.4281368], [10.9722958, 49.4280528], [10.9715957, 49.4280584], [10.9716034, 49.4285316], [10.9721005, 49.4285281]]),
    "poi-childcare-storchennest": siteGeometry(393152608, [[10.9488591, 49.4149023], [10.9493247, 49.4143432], [10.9497475, 49.4144764], [10.9496107, 49.4146358], [10.9494397, 49.4148422], [10.9492864, 49.4149655], [10.9491827, 49.4149605], [10.9488591, 49.4149023]]),
    "poi-leisure-hans-reif": siteGeometry(198101249, [[10.9661642, 49.4189672], [10.9660701, 49.4199859], [10.9662866, 49.4200033], [10.9680502, 49.4205129], [10.9685603, 49.4206187], [10.969617, 49.4206826], [10.973349, 49.4209083], [10.973559, 49.4204646], [10.9736044, 49.420132], [10.9735979, 49.4196633], [10.9740154, 49.4186853], [10.9737056, 49.4186546], [10.9737606, 49.4184086], [10.9724709, 49.4183319], [10.9716759, 49.4181336], [10.9718188, 49.4179299], [10.9701632, 49.4180351], [10.9699239, 49.4188941], [10.9669767, 49.4185996], [10.9661642, 49.4189672]]),
    "poi-leisure-schuetzengesellschaft": siteGeometry(1239437297, [[10.9688485, 49.4199276], [10.9687765, 49.4202438], [10.9687565, 49.4203318], [10.9687494, 49.4203627], [10.9685158, 49.4203512], [10.9685455, 49.4202286], [10.9686256, 49.4198977], [10.9688485, 49.4199276]])
  });

  const pois = [
    // Schulen
    poi({ id: "poi-school-grundschule-altenberg", displayName: "Grundschule Oberasbach-Altenberg", category: "school", subcategory: "Grundschule", latitude: 49.4308358, longitude: 10.9760051, address: "Kirchenweg 47, 90522 Oberasbach", aliases: ["Grundschule Altenberg", "GS Altenberg"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: "https://www.oberasbach.de/leben-erleben/bildung-schulen/grundschule-altenberg", ...siteGeometryByPoiId["poi-school-grundschule-altenberg"] }),
    poi({ id: "poi-school-pestalozzi-grundschule", displayName: "Pestalozzi-Grundschule Kreutles", category: "school", subcategory: "Grundschule", latitude: 49.4274233, longitude: 10.971254, address: "Schulstraße 2, 90522 Oberasbach", aliases: ["Pestalozzi-Grundschule", "Pestalozzischule"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: "https://www.oberasbach.de/leben-erleben/bildung-schulen/pestalozzi-grundschule-kreutles", ...siteGeometryByPoiId["poi-school-pestalozzi-grundschule"] }),
    poi({ id: "poi-school-dbg", displayName: "Dietrich-Bonhoeffer-Gymnasium Oberasbach", category: "school", subcategory: "Gymnasium", latitude: 49.432914, longitude: 10.9635416, address: "Albrecht-Dürer-Straße 9–11, 90522 Oberasbach", aliases: ["Dietrich-Bonhoeffer-Gymnasium", "DBG"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: "https://www.oberasbach.de/fileadmin/Gemeinde/Dateien/20241107_Konzept_2025_bis_2032_Stadtbuecherei_Oberasbach.pdf", ...siteGeometryByPoiId["poi-school-dbg"] }),
    poi({ id: "poi-school-elisabeth-krauss", displayName: "Elisabeth-Krauß-Schule", category: "school", subcategory: "Förderschule", latitude: 49.4319653, longitude: 10.953892, address: "Ohlauer Straße 20, 90522 Oberasbach", aliases: ["Elisabeth-Krauss-Förderschule", "Elisabeth-Krauss-Schule"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: "https://www.oberasbach.de/fileadmin/Gemeinde/Dateien/20241107_Konzept_2025_bis_2032_Stadtbuecherei_Oberasbach.pdf", needsReview: true, reviewNote: "Offizielle Schreibweise der Schule und Hausnummer vor produktivem Einsatz noch einmal direkt bei der Einrichtung bestätigen.", ...siteGeometryByPoiId["poi-school-elisabeth-krauss"] }),

    // Kindertagesstätten, Kinderkrippen und Horte
    poi({ id: "poi-childcare-awo-kindergarten", displayName: "AWO-Kindergarten Oberasbach", category: "childcare", subcategory: "Kindergarten", latitude: 49.4323521, longitude: 10.9815344, address: "Kulmbacher Straße 5, 90522 Oberasbach", aliases: ["AWO-Kindergarten"], source: "Stadt Oberasbach; Position aus OpenStreetMap/Nominatim", sourceUrl: cityChildcareUrl, needsReview: true, reviewNote: "Die offizielle Anschrift ist bestätigt; der OSM-Treffer besitzt aktuell keine eindeutige Hausnummernbezeichnung." }),
    poi({ id: "poi-childcare-champini", displayName: "Champini Oberasbach Sport-Kita", category: "childcare", subcategory: "Sport-Kita", latitude: 49.4303731, longitude: 10.9469598, address: "Zwickauer Straße 6, 90522 Oberasbach", aliases: ["Champini", "Champini Sport-Kita"], source: "Stadt Oberasbach; Position aus OpenStreetMap/Nominatim", sourceUrl: cityChildcareUrl, needsReview: true, reviewNote: "Position liegt auf dem adressierten Gebäude; Gebäudeeingang bitte manuell prüfen." }),
    poi({ id: "poi-childcare-st-stephanus", displayName: "Evangelische Kindertagesstätte St. Stephanus", category: "childcare", subcategory: "Kindergarten", latitude: 49.4212158, longitude: 10.9849968, address: "St.-Stephanus-Straße 2 a, 90522 Oberasbach", aliases: ["Kindergarten St. Stephanus", "Kita St. Stephanus"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityChildcareUrl, ...siteGeometryByPoiId["poi-childcare-st-stephanus"] }),
    poi({ id: "poi-childcare-st-lorenz", displayName: "Evangelischer Kindergarten St. Lorenz", category: "childcare", subcategory: "Kindergarten", latitude: 49.4216573, longitude: 10.958521, address: "Kirchenplatz 2, 90522 Oberasbach", aliases: ["Kindergarten St. Lorenz"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityChildcareUrl }),
    poi({ id: "poi-childcare-regenbogen", displayName: "Evangelischer Kindergarten Regenbogen", category: "childcare", subcategory: "Kindergarten", latitude: 49.4201562, longitude: 10.9757343, address: "Schwabacher Straße 1, 90522 Oberasbach", aliases: ["Kindergarten Regenbogen"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityChildcareUrl }),
    poi({ id: "poi-childcare-st-markus", displayName: "Evangelischer Kindergarten St. Markus", category: "childcare", subcategory: "Kindergarten", latitude: 49.4331487, longitude: 10.9707731, address: "Eichenfeldstraße 36, 90522 Oberasbach", aliases: ["Kindergarten St. Markus"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityChildcareUrl }),
    poi({ id: "poi-childcare-pusteblume", displayName: "Johanniter-Kinderkrippe Pusteblume", category: "childcare", subcategory: "Kinderkrippe", latitude: 49.4182373, longitude: 10.9805287, address: "Sommerstraße 2 a, 90522 Oberasbach", aliases: ["Kinderkrippe Pusteblume", "Pusteblume"], source: "Stadt Oberasbach und OpenStreetMap/Nominatim", sourceUrl: cityChildcareUrl }),
    poi({ id: "poi-childcare-weltentdecker", displayName: "Kleine Weltentdecker", category: "childcare", subcategory: "Kinderkrippe", latitude: 49.4327486, longitude: 10.9709034, address: "Kurt-Schumacher-Straße 8, 90522 Oberasbach", aliases: ["Evangelische Kinderkrippe St. Markus"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityChildcareUrl }),
    poi({ id: "poi-childcare-st-johannes", displayName: "St. Johannes – Katholische Krippe und Kindergarten", category: "childcare", subcategory: "Krippe und Kindergarten", latitude: 49.4282922, longitude: 10.9719462, address: "St.-Johannes-Straße 6, 90522 Oberasbach", aliases: ["Kindergarten St. Johannes", "Haus für Kinder Mutter Teresa"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityChildcareUrl, ...siteGeometryByPoiId["poi-childcare-st-johannes"] }),
    poi({ id: "poi-childcare-storchennest", displayName: "Städtische Kindertagesstätte Storchennest", category: "childcare", subcategory: "Kindertagesstätte", latitude: 49.4146543, longitude: 10.9493033, address: "Fröbelstraße 9, 90522 Oberasbach", aliases: ["Storchennest", "Kita Storchennest"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityChildcareUrl, needsReview: true, reviewNote: "Stadt nennt Hausnummer 9, der OSM-Gebäudeumriss war zuletzt mit Hausnummer 7 verknüpft; Mittelpunkt und Eingang manuell prüfen.", ...siteGeometryByPoiId["poi-childcare-storchennest"] }),
    poi({ id: "poi-childcare-wilhelm-loehe", displayName: "Wilhelm-Löhe-Kindergarten Oberasbach", category: "childcare", subcategory: "Kindergarten", latitude: 49.4183798, longitude: 10.9595873, address: "Banater Straße 1 a, 90522 Oberasbach", aliases: ["Wilhelm-Löhe-Kindergarten", "KiGa Wilhelm-Löhe"], source: "Stadt Oberasbach und OpenStreetMap/Nominatim", sourceUrl: cityChildcareUrl }),
    poi({ id: "poi-childcare-hort-asbachgrund", displayName: "Städtischer Kinderhort am Asbachgrund", category: "childcare", subcategory: "Kinderhort", latitude: 49.4270682, longitude: 10.9705481, address: "Schulstraße 6, 90522 Oberasbach", aliases: ["Kinderhort am Asbachgrund", "Hort an der Schule"], source: "Stadt Oberasbach; Position aus OpenStreetMap", sourceUrl: cityFacilitiesUrl, needsReview: true, reviewNote: "OSM führt am Standort mehrere Betreuungseinträge; Gebäudeeingang und genaue Punktposition manuell bestätigen." }),

    // Senioren- und Pflegeeinrichtungen
    poi({ id: "poi-senior-sonnenbogen", displayName: "Seniorenpflegehaus Sonnenbogen", category: "senior-care", subcategory: "Pflegeheim", latitude: 49.4343004, longitude: 10.966109, address: "Saalfelder Straße 22 a, 90522 Oberasbach", aliases: ["Sonnenbogen", "Seniorenpflegehaus Sonnebogen"], source: "OpenStreetMap/Nominatim und Stadt Oberasbach", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "OSM führte zuletzt die Schreibweise „Sonnebogen“; offiziellen aktuellen Namen direkt bei der Einrichtung bestätigen." }),
    poi({ id: "poi-senior-willi-buehner", displayName: "BRK-Seniorenheim Willy Bühner", category: "senior-care", subcategory: "Seniorenheim", latitude: 49.4307229, longitude: 10.9693989, address: "Stiftsstraße 12, 90522 Oberasbach", aliases: ["Seniorenheim Willi Bühner", "Willi-Bühner-Heim", "Willy-Bühner-Heim"], source: "OpenStreetMap/Nominatim", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Eingang vor produktivem Einsatz manuell bei der Einrichtung bestätigen." }),

    // Tankstellen
    poi({ id: "poi-fuel-agip", displayName: "Enilive Tankstelle", category: "fuel", subcategory: "Tankstelle", latitude: 49.435988, longitude: 10.9770977, address: "Rothenburger Straße 32, 90522 Oberasbach", aliases: ["Agip", "Agip Tankstelle"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betreibername und Betriebsstatus regelmäßig manuell prüfen." }),
    poi({ id: "poi-fuel-supol", displayName: "SUPOL Tankstelle", category: "fuel", subcategory: "Tankstelle", latitude: 49.4366531, longitude: 10.9809922, address: "Rothenburger Straße 1 a, 90522 Oberasbach", aliases: ["Supol"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betreibername und Betriebsstatus regelmäßig manuell prüfen." }),
    poi({ id: "poi-fuel-jet", displayName: "JET Tankstelle", category: "fuel", subcategory: "Tankstelle", latitude: 49.434922, longitude: 10.9732482, address: "Rothenburger Straße 33, 90522 Oberasbach", aliases: ["Jet"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betreibername und Betriebsstatus regelmäßig manuell prüfen." }),
    poi({ id: "poi-fuel-avia", displayName: "AVIA Tankstelle", category: "fuel", subcategory: "Tankstelle", latitude: 49.4261703, longitude: 10.9806671, address: "Langenäckerstraße 1, 90522 Oberasbach", aliases: ["Avia"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betreibername und Betriebsstatus regelmäßig manuell prüfen." }),

    // Lebensmittelmärkte
    poi({ id: "poi-market-kaufland", displayName: "Kaufland Oberasbach", category: "supermarket", subcategory: "Verbrauchermarkt", latitude: 49.4359516, longitude: 10.9667644, address: "Rothenburger Straße 70, 90522 Oberasbach", aliases: ["Kaufland"], source: "Kaufland-Filialseite und OpenStreetMap", sourceUrl: "https://filiale.kaufland.de/service/filiale/oberasbach-6320.html" }),
    poi({ id: "poi-market-lidl", displayName: "Lidl Oberasbach", category: "supermarket", subcategory: "Discounter", latitude: 49.4306186, longitude: 10.9793864, address: "Hainbergstraße 20, 90522 Oberasbach", aliases: ["Lidl"], source: "Lidl-Filialseite und OpenStreetMap", sourceUrl: "https://www.lidl.de/s/de-DE/filialen/oberasbach/hainbergstr-20/" }),
    poi({ id: "poi-market-aldi", displayName: "ALDI SÜD Oberasbach", category: "supermarket", subcategory: "Discounter", latitude: 49.4345857, longitude: 10.9706693, address: "Kurt-Schumacher-Straße 2, 90522 Oberasbach", aliases: ["Aldi", "ALDI Süd"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Adresse und Filialstatus zusätzlich im offiziellen ALDI-Filialfinder prüfen." }),
    poi({ id: "poi-market-e-center", displayName: "E center Schuler", category: "supermarket", subcategory: "Supermarkt", latitude: 49.434898, longitude: 10.9583793, address: "Rothenburger Straße 28, 90513 Zirndorf", aliases: ["E-Center Schuler", "EDEKA Schuler"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, quizEligible: false, needsReview: true, reviewNote: "Liegt postalisch in Zirndorf und ist deshalb nicht als Oberasbacher Quizaufgabe freigegeben; Filialstatus regelmäßig prüfen." }),
    poi({ id: "poi-market-norma", displayName: "NORMA Zirndorf", category: "supermarket", subcategory: "Discounter", latitude: 49.4350877, longitude: 10.9608245, address: "Rothenburger Straße 16, 90513 Zirndorf", aliases: ["Norma", "NORMA Oberasbach"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, quizEligible: false, needsReview: true, reviewNote: "Liegt postalisch in Zirndorf und ist deshalb nicht als Oberasbacher Quizaufgabe freigegeben; Filialstatus regelmäßig prüfen." }),
    poi({ id: "poi-market-netto", displayName: "Netto Marken-Discount", category: "supermarket", subcategory: "Discounter", latitude: 49.431412, longitude: 10.9710255, address: "Am Rathaus 14, 90522 Oberasbach", aliases: ["Netto"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Adresse und Filialstatus zusätzlich im offiziellen Filialfinder prüfen." }),

    // Gesundheit
    poi({ id: "poi-health-rathaus-apotheke", displayName: "Rathaus-Apotheke", category: "health", subcategory: "Apotheke", latitude: 49.4316332, longitude: 10.9690007, address: "Am Rathaus 1, 90522 Oberasbach", aliases: [], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und Eingang manuell prüfen." }),
    poi({ id: "poi-health-martin-behaim", displayName: "Martin-Behaim-Apotheke", category: "health", subcategory: "Apotheke", latitude: 49.4303993, longitude: 10.9566359, address: "Meißener Straße 49, 90522 Oberasbach", aliases: ["Behaim-Apotheke"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und Eingang manuell prüfen." }),
    poi({ id: "poi-health-medicon", displayName: "Medicon Apotheke", category: "health", subcategory: "Apotheke", latitude: 49.4313168, longitude: 10.9706012, address: "Am Rathaus 14, 90522 Oberasbach", aliases: ["Medicon"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und Eingang manuell prüfen." }),
    poi({ id: "poi-health-radiologis", displayName: "Radiologis Oberasbach", category: "health", subcategory: "Radiologie", latitude: 49.434891, longitude: 10.9630095, address: "Albrecht-Dürer-Straße 3, 90522 Oberasbach", aliases: ["Radiologie Oberasbach"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Offiziellen Praxisnamen, Betriebsstatus und Eingang manuell prüfen." }),
    poi({ id: "poi-health-zahnarzt-schneider", displayName: "Praxis für Zahnheilkunde Dr. Detlef Schneider", category: "health", subcategory: "Zahnarztpraxis", latitude: 49.4375051, longitude: 10.9718186, address: "Bergstraße 26, 90522 Oberasbach", aliases: ["Praxis für Zahnheilkunde Dr. Schneider", "Zahnarztpraxis Dr. Detlef Schneider"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und Eingang manuell prüfen." }),

    // Öffentliche Einrichtungen
    poi({ id: "poi-public-rathaus", displayName: "Rathaus Oberasbach", category: "public-facility", subcategory: "Rathaus", latitude: 49.4312864, longitude: 10.9698942, address: "Rathausplatz 1, 90522 Oberasbach", aliases: ["Stadtverwaltung Oberasbach"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityFacilitiesUrl }),
    poi({ id: "poi-public-bauhof", displayName: "Städtischer Bauhof Oberasbach", category: "public-facility", subcategory: "Bauhof", latitude: 49.4179095, longitude: 10.9580397, address: "Roßtaler Straße 14, 90522 Oberasbach", aliases: ["Bauhof", "Stadtgärtnerei"], source: "Stadt Oberasbach und OpenStreetMap/Nominatim", sourceUrl: "https://www.oberasbach.de/buergerservice-politik/rathaus/organisationseinheiten/detail/bauhof-3670" }),
    poi({ id: "poi-public-jugendhaus-oasis", displayName: "Jugendhaus OASIS", category: "public-facility", subcategory: "Jugendhaus", latitude: 49.4280079, longitude: 10.9724003, address: "St.-Johannes-Straße 8, 90522 Oberasbach", aliases: ["OASIS", "Jugendhaus Oberasbach"], source: "Stadt Oberasbach und OpenStreetMap/Nominatim", sourceUrl: cityFacilitiesUrl }),
    poi({ id: "poi-public-quartiersmanagement", displayName: "Quartiersmanagement Oberasbach", category: "public-facility", subcategory: "Beratungsstelle", latitude: 49.4311202, longitude: 10.9691889, address: "Am Rathaus 6, 90522 Oberasbach", aliases: ["Treffpunkt für Seniorinnen und Senioren"], source: "Stadt Oberasbach und OpenStreetMap/Nominatim", sourceUrl: "https://www.oberasbach.de/fileadmin/user_upload/20251215_Jahresbericht_2025_FINAL.pdf" }),
    poi({ id: "poi-public-library", displayName: "Stadtbücherei Oberasbach", category: "public-facility", subcategory: "Bücherei", latitude: 49.4312864, longitude: 10.9698942, address: "Rathausplatz 1, 90522 Oberasbach", aliases: ["Stadtbibliothek Oberasbach"], source: "Stadt Oberasbach", sourceUrl: cityFacilitiesUrl, quizEligible: false, reviewNote: "Bewusst nicht als Aufgabe wählbar, da sie sich im selben Gebäude und am selben Punkt wie das Rathaus befindet." }),
    poi({ id: "poi-public-friedhof-unterasbach", displayName: "Städtischer Friedhof Unterasbach", category: "public-facility", subcategory: "Friedhof", latitude: 49.4219, longitude: 10.9852, address: "St.-Stephanus-Straße 1, 90522 Oberasbach", aliases: ["Friedhof Unterasbach"], source: "Stadt Oberasbach", sourceUrl: cityFacilitiesUrl, active: false, quizEligible: false, needsReview: true, reviewNote: "Offizielle Anschrift ist bestätigt; repräsentativen Kartenpunkt oder späteres Polygon vor Aktivierung manuell festlegen." }),

    // Sport und Freizeit
    poi({ id: "poi-leisure-hans-reif", displayName: "Hans-Reif-Sportzentrum", category: "sports-leisure", subcategory: "Sportzentrum mit Jahnhalle und Asbachhalle", latitude: 49.4193152, longitude: 10.9699393, address: "Jahnstraße 16–18, 90522 Oberasbach", aliases: ["Hans-Reif-Sportanlage", "Jahnhalle", "Asbachhalle"], source: "Stadt Oberasbach und OpenStreetMap/Nominatim", sourceUrl: cityFacilitiesUrl, ...siteGeometryByPoiId["poi-leisure-hans-reif"] }),
    poi({ id: "poi-leisure-schuetzengesellschaft", displayName: "Schützengesellschaft Oberasbach", category: "sports-leisure", subcategory: "Schießsportanlage", latitude: 49.4201302, longitude: 10.9686821, address: "Jahnstraße 14, 90522 Oberasbach", aliases: ["SG Oberasbach"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Vereinsbezeichnung und Eingang manuell prüfen.", ...siteGeometryByPoiId["poi-leisure-schuetzengesellschaft"] }),
    poi({ id: "poi-leisure-playmobil", displayName: "PLAYMOBIL-FunPark", category: "sports-leisure", subcategory: "Freizeitpark", latitude: 49.4306755, longitude: 10.9435037, address: "Brandstätterstraße 2–10, 90513 Zirndorf", aliases: ["Playmobil Funpark", "FunPark"], source: "OpenStreetMap und Betreiberangabe", sourceUrl: "https://www.playmobil-funpark.de/", active: false, quizEligible: false, needsReview: true, reviewNote: "Bewusst deaktiviert: Die grenznahe Einrichtung liegt postalisch in Zirndorf. Nur nach fachlicher Freigabe als Oberasbacher Trainingsziel aktivieren." }),
    poi({ id: "poi-leisure-hainberg", displayName: "Naturschutzgebiet Hainberg", category: "sports-leisure", subcategory: "Naherholungsgebiet", latitude: 49.4193648, longitude: 10.997525, address: null, aliases: ["Hainberg", "DBU-Naturerbe Hainberg"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityLeisureUrl, needsReview: true, reviewNote: "Sehr großes Gebiet: Punkt markiert nur einen Zugang; später vorzugsweise Polygon hinterlegen." }),

    // Gastronomie und Beherbergung
    poi({ id: "poi-hospitality-montana", displayName: "Montana Hotel Nürnberg-West", category: "hospitality", subcategory: "Hotel", latitude: 49.4315634, longitude: 10.9703621, address: "Am Rathaus 5–7, 90522 Oberasbach", aliases: ["Montana Hotel"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und offizielle Eigenschreibweise manuell prüfen." }),
    poi({ id: "poi-hospitality-bomonti", displayName: "hotel bomonti Nürnberg West", category: "hospitality", subcategory: "Hotel", latitude: 49.4319901, longitude: 10.9561029, address: "Stollberger Straße 1, 90522 Oberasbach", aliases: ["Hotel Bomonti"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und offizielle Eigenschreibweise manuell prüfen." }),
    poi({ id: "poi-hospitality-brauhaus", displayName: "1. Altenberger Brauhaus", category: "hospitality", subcategory: "Restaurant", latitude: 49.4369487, longitude: 10.9686875, address: "Zirndorfer Straße 18, 90522 Oberasbach", aliases: ["Altenberger Brauhaus"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityFoodUrl, needsReview: true, reviewNote: "Betriebsstatus regelmäßig manuell prüfen." }),
    poi({ id: "poi-hospitality-kettler", displayName: "Gasthof Kettler", category: "hospitality", subcategory: "Gasthof", latitude: 49.4224024, longitude: 10.9578246, address: "Milbenweg 2, 90522 Oberasbach", aliases: ["Kettler"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityFoodUrl, needsReview: true, reviewNote: "Anschrift, Betriebsstatus und Eingang manuell prüfen." }),
    poi({ id: "poi-hospitality-asbacher-hof", displayName: "Ehemaliger Asbacher Hof / Unterkunft", category: "hospitality", subcategory: "Ehemaliger Gastronomiebetrieb / Unterkunft", latitude: 49.4203536, longitude: 10.9689638, address: "Jahnstraße 16 a, 90522 Oberasbach", aliases: ["Asbacher Hof"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityFoodUrl, active: false, quizEligible: false, needsReview: true, reviewNote: "Nicht mehr als aktueller Gastronomie- oder Beherbergungsbetrieb führen; heutige Nutzung vor einer möglichen Reaktivierung prüfen." }),

    // Unternehmen
    poi({ id: "poi-company-geobra", displayName: "geobra Brandstätter Stiftung & Co. KG", category: "company", subcategory: "Spielwarenhersteller", latitude: 49.4293921, longitude: 10.940057, address: "Brandstätterstraße 2–10, 90513 Zirndorf", aliases: ["geobra Brandstätter", "PLAYMOBIL"], source: "OpenStreetMap und Unternehmenswebsite", sourceUrl: "https://www.horst-brandstaetter-group.com/", active: false, quizEligible: false, needsReview: true, reviewNote: "Bewusst deaktiviert: Der grenznahe Standort liegt postalisch in Zirndorf. Nur nach fachlicher Freigabe als Oberasbacher Trainingsziel aktivieren." }),
    poi({ id: "poi-company-gaertnerei-ascher", displayName: "Gärtnerei Ascher", category: "company", subcategory: "Gärtnerei", latitude: 49.4198673, longitude: 10.9653841, address: "Jahnstraße 10, 90522 Oberasbach", aliases: [], source: "OpenStreetMap und Stadt Oberasbach", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und Eingang manuell prüfen." }),
    poi({ id: "poi-company-autohof-heinrich", displayName: "Autohaus Heinrich", category: "company", subcategory: "Autohaus", latitude: 49.4260019, longitude: 10.9772653, address: "Langenäckerstraße 15, 90522 Oberasbach", aliases: [], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und offizielle Eigenschreibweise manuell prüfen." }),
    poi({ id: "poi-company-infotrans", displayName: "Infotrans-InterNetServices", category: "company", subcategory: "IT-Unternehmen", latitude: 49.4346805, longitude: 10.9760024, address: "Windsheimer Straße 32, 90522 Oberasbach", aliases: ["InfoTrans", "InfoTrans GmbH"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und Eingang manuell prüfen." }),
    poi({ id: "poi-company-roest-kaffee", displayName: "röst kaffee", category: "company", subcategory: "Kaffeerösterei", latitude: 49.4320477, longitude: 10.948194, address: "Zwickauer Straße 8, 90522 Oberasbach", aliases: ["roest kaffee"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl, needsReview: true, reviewNote: "Betriebsstatus und offizielle Eigenschreibweise manuell prüfen." }),

    // Sonstige einsatzrelevante Orte
    poi({ id: "poi-relevant-st-lorenz", displayName: "St.-Lorenz-Kirche", category: "other-relevant", subcategory: "Kirche", latitude: 49.4218034, longitude: 10.9583399, address: "Kirchenplatz 1, 90522 Oberasbach", aliases: ["St. Lorenz"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl }),
    poi({ id: "poi-relevant-st-stephanus", displayName: "St.-Stephanus-Kirche", category: "other-relevant", subcategory: "Kirche", latitude: 49.4215949, longitude: 10.9854395, address: "St.-Stephanus-Straße 2, 90522 Oberasbach", aliases: ["St. Stephanus"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl }),
    poi({ id: "poi-relevant-st-johannes", displayName: "St. Johannes der Täufer", category: "other-relevant", subcategory: "Kirche", latitude: 49.4283546, longitude: 10.9727279, address: "St.-Johannes-Straße 4, 90522 Oberasbach", aliases: ["St. Johannes"], source: "OpenStreetMap", sourceUrl: osmCopyrightUrl }),
    poi({ id: "poi-relevant-brk", displayName: "BRK-Bereitschaft Oberasbach", category: "other-relevant", subcategory: "Hilfsorganisation", latitude: 49.430699, longitude: 10.9684701, address: "Stiftsstraße 12, 90522 Oberasbach", aliases: ["Bayerisches Rotes Kreuz Oberasbach", "BRK Oberasbach"], source: "OpenStreetMap und Stadt Oberasbach", sourceUrl: "https://www.oberasbach.de/leben-erleben/ehrenamt-vereine/ehrenamtsportraits", needsReview: true, reviewNote: "Genauen Zugang und aktuelle Nutzung der Räume manuell prüfen." }),

    // Gerätehäuser bleiben als Orientierung sichtbar, sind aber bewusst keine Quizaufgaben.
    poi({ id: "poi-orientation-fire-oberasbach", displayName: "Freiwillige Feuerwehr Oberasbach", category: "other-relevant", subcategory: "Feuerwehrgerätehaus", latitude: 49.4193202, longitude: 10.9594029, address: "Roßtaler Straße 10, 90522 Oberasbach", aliases: ["Feuerwehr Oberasbach"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityFacilitiesUrl, quizEligible: false }),
    poi({ id: "poi-orientation-fire-rehdorf", displayName: "Freiwillige Feuerwehr Rehdorf", category: "other-relevant", subcategory: "Feuerwehrgerätehaus", latitude: 49.4132163, longitude: 10.9510362, address: "Rehdorfer Straße 10, 90522 Oberasbach", aliases: ["Feuerwehr Rehdorf"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityFacilitiesUrl, quizEligible: false, needsReview: true, reviewNote: "OSM-Punkt war zuletzt mit Hausnummer 25 erfasst, die Stadt nennt Hausnummer 10; Gebäudepunkt und Anschrift manuell abgleichen." }),
    poi({ id: "poi-orientation-fire-altenberg", displayName: "Freiwillige Feuerwehr Altenberg", category: "other-relevant", subcategory: "Feuerwehrgerätehaus", latitude: 49.4337566, longitude: 10.9716011, address: "Schillerstraße 2, 90522 Oberasbach", aliases: ["Feuerwehr Altenberg", "FFW Altenberg"], source: "Stadt Oberasbach und OpenStreetMap", sourceUrl: cityFacilitiesUrl, quizEligible: false })
  ];

  root.OBERASBACH_POI_CATEGORIES = categories;
  root.OBERASBACH_POIS = Object.freeze(pois);
})(typeof globalThis !== "undefined" ? globalThis : this);
