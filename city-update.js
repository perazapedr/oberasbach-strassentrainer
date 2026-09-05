(function initializeCityUpdate(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerCityUpdate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCityUpdateApi() {
  "use strict";

  function trimmedString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function roundCoord(val) {
    const num = Number(val);
    return Number.isFinite(num) ? num.toFixed(6) : "0.000000";
  }

  function normalizeGeometrySignature(geometry) {
    if (!geometry || typeof geometry !== "object") return "";
    const type = geometry.type;
    const coords = geometry.coordinates;
    if (!coords) return "";
    if (type === "Point") {
      return `P:${roundCoord(coords[0])},${roundCoord(coords[1])}`;
    }
    if (type === "LineString") {
      return "LS:" + coords.map(c => `${roundCoord(c[0])},${roundCoord(c[1])}`).join(";");
    }
    if (type === "MultiLineString") {
      return "MLS:" + coords.map(line => (Array.isArray(line) ? line : []).map(c => `${roundCoord(c[0])},${roundCoord(c[1])}`).join(";")).join("|");
    }
    if (type === "Polygon") {
      return "POLY:" + coords.map(ring => (Array.isArray(ring) ? ring : []).map(c => `${roundCoord(c[0])},${roundCoord(c[1])}`).join(";")).join("|");
    }
    if (type === "MultiPolygon") {
      return "MPOLY:" + coords.map(poly => (Array.isArray(poly) ? poly : []).map(ring => (Array.isArray(ring) ? ring : []).map(c => `${roundCoord(c[0])},${roundCoord(c[1])}`).join(";")).join("|")).join("#");
    }
    return JSON.stringify(coords);
  }

  function areStringArraysEqual(first, second) {
    const arr1 = Array.isArray(first) ? [...new Set(first.map(trimmedString).filter(Boolean))].sort() : [];
    const arr2 = Array.isArray(second) ? [...new Set(second.map(trimmedString).filter(Boolean))].sort() : [];
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i += 1) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
  }

  function areNumberArraysEqual(first, second) {
    const arr1 = Array.isArray(first)
      ? [...new Set(first.map(Number).filter(Number.isFinite))].sort((a, b) => a - b)
      : [];
    const arr2 = Array.isArray(second)
      ? [...new Set(second.map(Number).filter(Number.isFinite))].sort((a, b) => a - b)
      : [];
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i += 1) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
  }

  function areAddressesEqual(first, second) {
    if (!first && !second) return true;
    if (!first || !second) return false;
    if (typeof first === "string" && typeof second === "string") {
      return trimmedString(first) === trimmedString(second);
    }
    const f = typeof first === "object" ? first : { address: String(first) };
    const s = typeof second === "object" ? second : { address: String(second) };
    const keys = new Set([...Object.keys(f), ...Object.keys(s)]);
    for (const k of keys) {
      if (trimmedString(String(f[k] || "")) !== trimmedString(String(s[k] || ""))) {
        return false;
      }
    }
    return true;
  }

  function arePositionsEqual(p1, p2, epsilon = 1e-6) {
    if (!p1 && !p2) return true;
    if (!p1 || !p2) return false;
    const lat1 = Number(p1.lat !== undefined ? p1.lat : p1[1]);
    const lon1 = Number(p1.lon !== undefined ? p1.lon : p1[0]);
    const lat2 = Number(p2.lat !== undefined ? p2.lat : p2[1]);
    const lon2 = Number(p2.lon !== undefined ? p2.lon : p2[0]);
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
      return false;
    }
    return Math.abs(lat1 - lat2) <= epsilon && Math.abs(lon1 - lon2) <= epsilon;
  }

  function areBoundsEqual(b1, b2, epsilon = 1e-5) {
    if (!b1 && !b2) return true;
    if (!b1 || !b2) return false;
    return Math.abs(Number(b1.south) - Number(b2.south)) <= epsilon
      && Math.abs(Number(b1.west) - Number(b2.west)) <= epsilon
      && Math.abs(Number(b1.north) - Number(b2.north)) <= epsilon
      && Math.abs(Number(b1.east) - Number(b2.east)) <= epsilon;
  }

  function compareById(a, b) {
    const idA = String(a?.id || "");
    const idB = String(b?.id || "");
    return idA.localeCompare(idB, "de", { numeric: true });
  }

  function compareByNameAndId(a, b) {
    const nameA = String(a?.name || a?.displayName || "");
    const nameB = String(b?.name || b?.displayName || "");
    const nameCmp = nameA.localeCompare(nameB, "de", { sensitivity: "base" });
    if (nameCmp !== 0) return nameCmp;
    return compareById(a, b);
  }

  function compareCityMetadata(currentCity, candidateCity) {
    if (!currentCity || !candidateCity) return false;
    const nameChanged = trimmedString(currentCity.name) !== trimmedString(candidateCity.name);
    const displayNameChanged = trimmedString(currentCity.displayName) !== trimmedString(candidateCity.displayName);
    const districtChanged = trimmedString(currentCity.district) !== trimmedString(candidateCity.district);
    const stateChanged = trimmedString(currentCity.state) !== trimmedString(candidateCity.state);
    const countryChanged = trimmedString(currentCity.country) !== trimmedString(candidateCity.country);
    const postalCodesChanged = !areStringArraysEqual(currentCity.postalCodes, candidateCity.postalCodes);
    const boundsChanged = !areBoundsEqual(currentCity.bounds, candidateCity.bounds);
    const centerChanged = !arePositionsEqual(currentCity.center, candidateCity.center);

    return nameChanged || displayNameChanged || districtChanged || stateChanged
      || countryChanged || postalCodesChanged || boundsChanged || centerChanged;
  }

  function detectPossibleRenames(removedStreets, addedStreets) {
    const wayIdToRemovedMap = new Map();
    for (const rem of (removedStreets || [])) {
      const wayIds = Array.isArray(rem?.osmWayIds) ? rem.osmWayIds : [];
      for (const wayId of wayIds) {
        if (!wayIdToRemovedMap.has(wayId)) wayIdToRemovedMap.set(wayId, []);
        wayIdToRemovedMap.get(wayId).push(rem);
      }
    }

    const possibleRenames = [];
    for (const added of (addedStreets || [])) {
      const wayIds = Array.isArray(added?.osmWayIds) ? added.osmWayIds : [];
      const matchedRemoved = new Map();
      for (const wayId of wayIds) {
        if (wayIdToRemovedMap.has(wayId)) {
          for (const rem of wayIdToRemovedMap.get(wayId)) {
            if (!matchedRemoved.has(rem.id)) {
              matchedRemoved.set(rem.id, { removedStreet: rem, sharedWayIds: [] });
            }
            matchedRemoved.get(rem.id).sharedWayIds.push(wayId);
          }
        }
      }
      for (const match of matchedRemoved.values()) {
        possibleRenames.push({
          oldStreetId: match.removedStreet.id,
          oldName: match.removedStreet.name,
          removedStreet: match.removedStreet,
          newStreetId: added.id,
          newName: added.name,
          addedStreet: added,
          sharedWayCount: match.sharedWayIds.length,
          sharedWayIds: match.sharedWayIds.sort((a, b) => a - b)
        });
      }
    }
    possibleRenames.sort((a, b) => a.newStreetId.localeCompare(b.newStreetId) || a.oldStreetId.localeCompare(b.oldStreetId));
    return possibleRenames;
  }

  function compareCityVersions(currentData, candidateData, options = {}) {
    if (!currentData || typeof currentData !== "object" || Array.isArray(currentData)) {
      throw new TypeError("currentData must be an object containing city, streets, and pois.");
    }
    if (!candidateData || typeof candidateData !== "object" || Array.isArray(candidateData)) {
      throw new TypeError("candidateData must be an object containing city, streets, and pois.");
    }

    const currentCity = currentData.city || {};
    const candidateCity = candidateData.city || {};

    // Validate matching OSM entity and municipality to prevent wrong updates
    const currentOsmId = Number(currentCity.osmId);
    const candidateOsmId = Number(candidateCity.osmId);
    if (Number.isSafeInteger(currentOsmId) && Number.isSafeInteger(candidateOsmId) && currentOsmId !== candidateOsmId) {
      throw new Error(
        `Gemeinde-Konflikt / City identity mismatch: Aktuelle Stadt (${currentOsmId}) und Update-Kandidat (${candidateOsmId}) haben unterschiedliche OSM-IDs.`
      );
    }
    if (currentCity.id && candidateCity.id && currentCity.id !== candidateCity.id) {
      throw new Error(
        `Stadt-Identitätskonflikt / City identity mismatch: Aktuelle Stadt-ID "${currentCity.id}" stimmt nicht mit Update-Kandidat "${candidateCity.id}" überein.`
      );
    }

    const currentStreets = Array.isArray(currentData.streets) ? currentData.streets : [];
    const candidateStreets = Array.isArray(candidateData.streets) ? candidateData.streets : [];
    const currentPois = Array.isArray(currentData.pois) ? currentData.pois : [];
    const candidatePois = Array.isArray(candidateData.pois) ? candidateData.pois : [];
    // Lokale Benutzergebiete gehören nicht zum fachlichen Paket-Diff.
    const currentAreas = Array.isArray(currentData.areas)
      ? currentData.areas.filter(area => !area || area.source !== "user")
      : [];
    const candidateAreas = Array.isArray(candidateData.areas)
      ? candidateData.areas.filter(area => !area || area.source !== "user")
      : [];

    // 1. Street comparison
    const currentStreetMap = new Map();
    for (const street of currentStreets) {
      if (street && street.id) currentStreetMap.set(street.id, street);
    }
    const candidateStreetMap = new Map();
    for (const street of candidateStreets) {
      if (street && street.id) candidateStreetMap.set(street.id, street);
    }

    const unchangedStreets = [];
    const addedStreets = [];
    const removedStreets = [];
    const modifiedStreets = [];

    for (const candidateStreet of candidateStreets) {
      if (!candidateStreet || !candidateStreet.id) continue;
      const cur = currentStreetMap.get(candidateStreet.id);
      if (cur) {
        const nameChanged = trimmedString(cur.name) !== trimmedString(candidateStreet.name);
        const aliasesChanged = !areStringArraysEqual(cur.aliases, candidateStreet.aliases);
        const osmWayIdsChanged = !areNumberArraysEqual(cur.osmWayIds, candidateStreet.osmWayIds);
        const geometryChanged = normalizeGeometrySignature(cur.geometry) !== normalizeGeometrySignature(candidateStreet.geometry);

        if (nameChanged || aliasesChanged || osmWayIdsChanged || geometryChanged) {
          const reasons = [
            nameChanged && "name",
            aliasesChanged && "aliases",
            osmWayIdsChanged && "osmWayIds",
            geometryChanged && "geometry"
          ].filter(Boolean);

          modifiedStreets.push({
            id: candidateStreet.id,
            name: candidateStreet.name,
            previousName: cur.name,
            changes: {
              name: nameChanged,
              aliases: aliasesChanged,
              osmWayIds: osmWayIdsChanged,
              geometry: geometryChanged
            },
            reasons,
            current: cur,
            candidate: candidateStreet
          });
        } else {
          unchangedStreets.push(candidateStreet);
        }
      } else {
        addedStreets.push(candidateStreet);
      }
    }

    for (const curStreet of currentStreets) {
      if (curStreet && curStreet.id && !candidateStreetMap.has(curStreet.id)) {
        removedStreets.push(curStreet);
      }
    }

    // Possible street renames: check way overlap between removed and added streets
    const possibleRenames = detectPossibleRenames(removedStreets, addedStreets);

    // 2. POI comparison
    const currentPoiMap = new Map();
    for (const poi of currentPois) {
      if (poi && poi.id) currentPoiMap.set(poi.id, poi);
    }
    const candidatePoiMap = new Map();
    for (const poi of candidatePois) {
      if (poi && poi.id) candidatePoiMap.set(poi.id, poi);
    }

    const unchangedPois = [];
    const addedPois = [];
    const removedPois = [];
    const modifiedPois = [];

    for (const candidatePoi of candidatePois) {
      if (!candidatePoi || !candidatePoi.id) continue;
      const cur = currentPoiMap.get(candidatePoi.id);
      if (cur) {
        const nameChanged = trimmedString(cur.name) !== trimmedString(candidatePoi.name);
        const categoryChanged = trimmedString(cur.category) !== trimmedString(candidatePoi.category);
        const positionChanged = !arePositionsEqual(cur.position, candidatePoi.position);
        const addressChanged = !areAddressesEqual(cur.address, candidatePoi.address);
        const geometryChanged = normalizeGeometrySignature(cur.geometry) !== normalizeGeometrySignature(candidatePoi.geometry);

        if (nameChanged || categoryChanged || positionChanged || addressChanged || geometryChanged) {
          const reasons = [
            nameChanged && "name",
            categoryChanged && "category",
            positionChanged && "position",
            addressChanged && "address",
            geometryChanged && "geometry"
          ].filter(Boolean);

          modifiedPois.push({
            id: candidatePoi.id,
            name: candidatePoi.name,
            previousName: cur.name,
            changes: {
              name: nameChanged,
              category: categoryChanged,
              position: positionChanged,
              address: addressChanged,
              geometry: geometryChanged
            },
            reasons,
            current: cur,
            candidate: candidatePoi
          });
        } else {
          unchangedPois.push(candidatePoi);
        }
      } else {
        addedPois.push(candidatePoi);
      }
    }

    for (const curPoi of currentPois) {
      if (curPoi && curPoi.id && !candidatePoiMap.has(curPoi.id)) {
        removedPois.push(curPoi);
      }
    }

    // 3. TrainingArea comparison
    const currentAreaMap = new Map();
    for (const area of currentAreas) {
      if (area && area.id) currentAreaMap.set(area.id, area);
    }
    const candidateAreaMap = new Map();
    for (const area of candidateAreas) {
      if (area && area.id) candidateAreaMap.set(area.id, area);
    }

    const unchangedAreas = [];
    const addedAreas = [];
    const removedAreas = [];
    const modifiedAreas = [];

    for (const candidateArea of candidateAreas) {
      if (!candidateArea || !candidateArea.id) continue;
      const cur = currentAreaMap.get(candidateArea.id);
      if (cur) {
        const nameChanged = trimmedString(cur.name) !== trimmedString(candidateArea.name);
        const parentIdChanged = String(cur.parentId || "") !== String(candidateArea.parentId || "");
        const tierChanged = cur.tier !== candidateArea.tier;
        const adminLevelChanged = cur.adminLevel !== candidateArea.adminLevel;
        const boundsChanged = !areBoundsEqual(cur.bounds, candidateArea.bounds);
        const boundaryChanged = normalizeGeometrySignature(cur.boundary || cur.geometry)
          !== normalizeGeometrySignature(candidateArea.boundary || candidateArea.geometry);

        if (nameChanged || parentIdChanged || tierChanged || adminLevelChanged || boundsChanged || boundaryChanged) {
          const reasons = [
            nameChanged && "name",
            parentIdChanged && "parentId",
            tierChanged && "tier",
            adminLevelChanged && "adminLevel",
            boundsChanged && "bounds",
            boundaryChanged && "boundary"
          ].filter(Boolean);

          modifiedAreas.push({
            id: candidateArea.id,
            name: candidateArea.name,
            previousName: cur.name,
            changes: {
              name: nameChanged,
              parentId: parentIdChanged,
              tier: tierChanged,
              adminLevel: adminLevelChanged,
              bounds: boundsChanged,
              boundary: boundaryChanged
            },
            reasons,
            current: cur,
            candidate: candidateArea
          });
        } else {
          unchangedAreas.push(candidateArea);
        }
      } else {
        addedAreas.push(candidateArea);
      }
    }

    for (const curArea of currentAreas) {
      if (curArea && curArea.id && !candidateAreaMap.has(curArea.id)) {
        removedAreas.push(curArea);
      }
    }

    // Sort all arrays deterministically
    unchangedStreets.sort(compareByNameAndId);
    addedStreets.sort(compareByNameAndId);
    removedStreets.sort(compareByNameAndId);
    modifiedStreets.sort(compareByNameAndId);
    possibleRenames.sort((a, b) => a.newStreetId.localeCompare(b.newStreetId) || a.oldStreetId.localeCompare(b.oldStreetId));

    unchangedPois.sort(compareByNameAndId);
    addedPois.sort(compareByNameAndId);
    removedPois.sort(compareByNameAndId);
    modifiedPois.sort(compareByNameAndId);

    unchangedAreas.sort(compareByNameAndId);
    addedAreas.sort(compareByNameAndId);
    removedAreas.sort(compareByNameAndId);
    modifiedAreas.sort(compareByNameAndId);

    const metadataChanged = compareCityMetadata(currentCity, candidateCity);

    const hasChanges = addedStreets.length > 0
      || removedStreets.length > 0
      || modifiedStreets.length > 0
      || addedPois.length > 0
      || removedPois.length > 0
      || modifiedPois.length > 0
      || addedAreas.length > 0
      || removedAreas.length > 0
      || modifiedAreas.length > 0
      || metadataChanged;

    const summary = {
      hasChanges,
      streets: {
        totalCurrent: currentStreets.length,
        totalCandidate: candidateStreets.length,
        unchanged: unchangedStreets.length,
        added: addedStreets.length,
        removed: removedStreets.length,
        modified: modifiedStreets.length,
        possibleRenames: possibleRenames.length
      },
      pois: {
        totalCurrent: currentPois.length,
        totalCandidate: candidatePois.length,
        unchanged: unchangedPois.length,
        added: addedPois.length,
        removed: removedPois.length,
        modified: modifiedPois.length
      },
      areas: {
        totalCurrent: currentAreas.length,
        totalCandidate: candidateAreas.length,
        unchanged: unchangedAreas.length,
        added: addedAreas.length,
        removed: removedAreas.length,
        modified: modifiedAreas.length
      },
      metadataChanged
    };

    return {
      cityId: String(candidateCity.id || currentCity.id || ""),
      cityName: String(candidateCity.name || currentCity.name || ""),
      hasChanges,
      streets: {
        unchanged: unchangedStreets,
        added: addedStreets,
        removed: removedStreets,
        modified: modifiedStreets,
        possibleRenames
      },
      possibleRenames,
      pois: {
        unchanged: unchangedPois,
        added: addedPois,
        removed: removedPois,
        modified: modifiedPois
      },
      areas: {
        unchanged: unchangedAreas,
        added: addedAreas,
        removed: removedAreas,
        modified: modifiedAreas
      },
      metadata: {
        hasChanges: metadataChanged
      },
      summary
    };
  }

  return Object.freeze({
    compareCityVersions,
    detectPossibleRenames,
    normalizeGeometrySignature,
    areStringArraysEqual,
    areNumberArraysEqual,
    arePositionsEqual,
    areAddressesEqual,
    areBoundsEqual
  });
});
