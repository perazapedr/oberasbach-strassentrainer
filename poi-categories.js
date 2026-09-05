(function initializePoiCategories(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerPoiCategories = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPoiCategoriesApi() {
  "use strict";

  /**
   * Zentrale Definition aller unterstützten POI-Kategorien.
   * Priority: Niedrigerer Wert = höhere Priorität bei Mehrfachtreffern (Multi-Match).
   * Order: Feste UI-Sortierreihenfolge.
   */
  const DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "fire_station",
      label: "Feuerwehr",
      pluralLabel: "Feuerwehren",
      singularLabel: "Feuerwehr",
      order: 1,
      priority: 1,
      match: tags => tags.amenity === "fire_station"
    }),
    Object.freeze({
      id: "police",
      label: "Polizei",
      pluralLabel: "Polizei",
      singularLabel: "Polizei",
      order: 2,
      priority: 2,
      match: tags => tags.amenity === "police"
    }),
    Object.freeze({
      id: "hospital",
      label: "Krankenhäuser",
      pluralLabel: "Krankenhäuser",
      singularLabel: "Krankenhaus",
      order: 3,
      priority: 3,
      match: tags => tags.amenity === "hospital" || tags.amenity === "clinic"
    }),
    Object.freeze({
      id: "nursing_care",
      label: "Pflegeeinrichtungen",
      pluralLabel: "Pflegeeinrichtungen",
      singularLabel: "Pflegeeinrichtung",
      order: 4,
      priority: 4,
      match: tags => {
        if (tags.amenity === "nursing_home") return true;
        if (tags.social_facility === "nursing_home" || tags.social_facility === "assisted_living") {
          return true;
        }
        if (tags.healthcare === "hospice") return true;
        if (tags.amenity === "social_facility") {
          const facility = typeof tags.social_facility === "string" ? tags.social_facility : "";
          const nonCareFacilities = new Set(["office", "club", "community_centre", "workshop", "food_bank", "counselling"]);
          if (nonCareFacilities.has(facility)) return false;
          const forTag = typeof tags["social_facility:for"] === "string" ? tags["social_facility:for"] : "";
          if (/^(senior|older_people)/.test(forTag)) {
            const forbiddenValues = new Set(["child", "youth", "migrant", "refugee", "homeless"]);
            return !forbiddenValues.has(forTag);
          }
        }
        return false;
      }
    }),
    Object.freeze({
      id: "school",
      label: "Schulen",
      pluralLabel: "Schulen",
      singularLabel: "Schule",
      order: 5,
      priority: 5,
      match: tags => tags.amenity === "school"
    }),
    Object.freeze({
      id: "kindergarten",
      label: "Kindergärten",
      pluralLabel: "Kindergärten",
      singularLabel: "Kindergarten",
      order: 6,
      priority: 6,
      match: tags => tags.amenity === "kindergarten" || tags.amenity === "childcare"
    }),
    Object.freeze({
      id: "public_building",
      label: "Öffentliche Gebäude",
      pluralLabel: "Öffentliche Gebäude",
      singularLabel: "Öffentliches Gebäude",
      order: 7,
      priority: 13,
      match: tags => {
        const publicAmenities = new Set([
          "townhall", "courthouse", "community_centre", "library", "post_office"
        ]);
        if (publicAmenities.has(tags.amenity)) return true;
        if (tags.office === "government") return true;
        return false;
      }
    }),
    Object.freeze({
      id: "supermarket",
      label: "Supermärkte",
      pluralLabel: "Supermärkte",
      singularLabel: "Supermarkt",
      order: 8,
      priority: 7,
      match: tags => tags.shop === "supermarket"
    }),
    Object.freeze({
      id: "fuel",
      label: "Tankstellen",
      pluralLabel: "Tankstellen",
      singularLabel: "Tankstelle",
      order: 9,
      priority: 8,
      match: tags => tags.amenity === "fuel"
    }),
    Object.freeze({
      id: "hotel",
      label: "Hotels",
      pluralLabel: "Hotels",
      singularLabel: "Hotel",
      order: 10,
      priority: 9,
      match: tags => tags.tourism === "hotel" || tags.tourism === "motel"
    }),
    Object.freeze({
      id: "restaurant",
      label: "Gaststätten",
      pluralLabel: "Gaststätten",
      singularLabel: "Gaststätte",
      order: 11,
      priority: 10,
      match: tags => tags.amenity === "restaurant"
    }),
    Object.freeze({
      id: "sports_facility",
      label: "Sportstätten",
      pluralLabel: "Sportstätten",
      singularLabel: "Sportstätte",
      order: 12,
      priority: 11,
      match: tags => {
        const sportsLeisure = new Set(["sports_centre", "stadium", "sports_hall", "water_park"]);
        if (sportsLeisure.has(tags.leisure)) return true;
        if (tags.amenity === "public_bath") return true;
        return false;
      }
    }),
    Object.freeze({
      id: "company",
      label: "Unternehmen",
      pluralLabel: "Unternehmen",
      singularLabel: "Unternehmen",
      order: 13,
      priority: 12,
      match: tags => {
        if (tags.office === "company") return true;
        if (tags.man_made === "works") return true;
        if (tags.industrial === "factory") return true;
        return false;
      }
    })
  ]);

  const BY_ID = new Map(DEFINITIONS.map(def => [def.id, def]));
  const SORTED_BY_ORDER = [...DEFINITIONS].sort((a, b) => a.order - b.order);
  const SORTED_BY_PRIORITY = [...DEFINITIONS].sort((a, b) => a.priority - b.priority);
  const ALL_IDS = Object.freeze(SORTED_BY_ORDER.map(def => def.id));

  function getAll() {
    return SORTED_BY_ORDER;
  }

  function getAllCategoryIds() {
    return ALL_IDS;
  }

  function getById(id) {
    if (typeof id !== "string") return null;
    return BY_ID.get(id.trim()) || null;
  }

  function isKnown(id) {
    if (typeof id !== "string") return false;
    return BY_ID.has(id.trim());
  }

  function getLabel(id) {
    const def = getById(id);
    return def ? def.label : "";
  }

  function getSingularLabel(id) {
    const def = getById(id);
    return def ? def.singularLabel : "";
  }

  /**
   * Ordnet ein OSM-Tag-Objekt deterministisch einer Kategorie zu.
   * Bei mehreren Treffern entscheidet die strikte Priorität.
   * @param {Object} tags
   * @returns {Object|null} Definition der zutreffenden Kategorie oder null
   */
  function matchOsmCategory(tags) {
    if (!tags || typeof tags !== "object") return null;
    for (const def of SORTED_BY_PRIORITY) {
      if (def.match(tags)) return def;
    }
    return null;
  }

  /**
   * Erzeugt strukturierte Overpass-Query-Zeilen für alle definierten Kategorien.
   * @param {string} bbox
   * @returns {string[]} Array von Overpass-Filterzeilen
   */
  function getOverpassPoiQueryClauses(bbox) {
    return [
      `  nwr(area.searchArea)(${bbox})["amenity"~"^(fire_station|police|hospital|clinic|nursing_home|school|kindergarten|childcare|fuel|restaurant|townhall|courthouse|community_centre|library|post_office|public_bath)$"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["amenity"="social_facility"]["social_facility:for"~"^(senior|older_people)"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["social_facility"~"^(nursing_home|assisted_living)$"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["healthcare"="hospice"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["shop"="supermarket"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["tourism"~"^(hotel|motel)$"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["leisure"~"^(sports_centre|stadium|sports_hall|water_park)$"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["office"~"^(company|government)$"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["man_made"="works"]["name"];`,
      `  nwr(area.searchArea)(${bbox})["industrial"="factory"]["name"];`
    ];
  }

  return {
    getAll,
    getAllCategoryIds,
    getById,
    isKnown,
    getLabel,
    getSingularLabel,
    matchOsmCategory,
    getOverpassPoiQueryClauses
  };
});

