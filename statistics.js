(function initializeStatistics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerStatistics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStatisticsApi() {
  "use strict";

  const STATISTICS_SCHEMA_VERSION = 2;
  const MODES = Object.freeze(["free", "timed", "exam"]);
  const TARGET_TYPES = Object.freeze(["street", "poi"]);
  const HIT_THRESHOLDS_METERS = Object.freeze({ street: 100, poi: 100 });
  const MAX_TARGETS = 5000;
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const MAX_RECENT_ROUND_IDS = 250;
  const MAX_RECENT_GAME_IDS = 100;

  function createBucket() {
    return {
      gamesStarted: 0,
      gamesCompleted: 0,
      roundsEvaluated: 0,
      totalPoints: 0,
      bestPoints: null,
      distanceCount: 0,
      totalDistanceMeters: 0,
      bestDistanceMeters: null,
      worstDistanceMeters: null,
      durationCount: 0,
      totalDurationSeconds: 0,
      timeoutCount: 0,
      hitCount: 0
    };
  }

  function createModeBuckets() {
    return Object.fromEntries(MODES.map(mode => [mode, createBucket()]));
  }

  function createTargetTypeBuckets() {
    return Object.fromEntries(TARGET_TYPES.map(type => [type, createBucket()]));
  }

  function createModeTargetTypeBuckets() {
    return Object.fromEntries(MODES.map(mode => [mode, createTargetTypeBuckets()]));
  }

  function createEmptyStatistics() {
    return {
      schemaVersion: STATISTICS_SCHEMA_VERSION,
      createdAt: null,
      updatedAt: null,
      lastPlayedAt: null,
      overall: createBucket(),
      modes: createModeBuckets(),
      targetTypes: createTargetTypeBuckets(),
      modeTargetTypes: createModeTargetTypeBuckets(),
      targets: {},
      exam: {
        highestPercentageBasisPoints: 0,
        highestAward: null
      },
      deduplication: {
        recentRoundIds: [],
        recentStartedGameIds: [],
        recentCompletedGameIds: []
      }
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finiteNonNegative(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function nullableNonNegative(value) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function normalizeBucket(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      gamesStarted: Math.floor(finiteNonNegative(source.gamesStarted)),
      gamesCompleted: Math.floor(finiteNonNegative(source.gamesCompleted)),
      roundsEvaluated: Math.floor(finiteNonNegative(source.roundsEvaluated)),
      totalPoints: finiteNonNegative(source.totalPoints),
      bestPoints: nullableNonNegative(source.bestPoints),
      distanceCount: Math.floor(finiteNonNegative(source.distanceCount)),
      totalDistanceMeters: finiteNonNegative(source.totalDistanceMeters),
      bestDistanceMeters: nullableNonNegative(source.bestDistanceMeters),
      worstDistanceMeters: nullableNonNegative(source.worstDistanceMeters),
      durationCount: Math.floor(finiteNonNegative(source.durationCount)),
      totalDurationSeconds: finiteNonNegative(source.totalDurationSeconds),
      timeoutCount: Math.floor(finiteNonNegative(source.timeoutCount)),
      hitCount: Math.floor(finiteNonNegative(source.hitCount))
    };
  }

  function normalizeIsoDate(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
    return new Date(value).toISOString();
  }

  function normalizeAward(value) {
    if (!value || typeof value !== "object") return null;
    return {
      scheme: String(value.scheme || "ranks").slice(0, 30),
      key: String(value.key || "").slice(0, 80),
      name: String(value.name || "").slice(0, 120),
      symbol: String(value.symbol || "").slice(0, 20),
      description: String(value.description || "").slice(0, 300),
      percentage: finiteNonNegative(value.percentage),
      percentageBasisPoints: Math.min(10000,
        Math.floor(finiteNonNegative(value.percentageBasisPoints))
      ),
      perfect: Boolean(value.perfect)
    };
  }

  function isUnsafeKey(key) {
    return ["__proto__", "prototype", "constructor"].includes(key);
  }

  function normalizeTarget(value, fallbackId) {
    const source = value && typeof value === "object" ? value : {};
    const id = String(source.id || fallbackId || "").slice(0, 180);
    const type = TARGET_TYPES.includes(source.targetType) ? source.targetType : "street";
    return {
      id,
      name: String(source.name || source.targetName || id).slice(0, 240),
      targetType: type,
      category: String(source.category || "").slice(0, 120),
      lastPlayedAt: normalizeIsoDate(source.lastPlayedAt),
      overall: normalizeBucket(source.overall),
      modes: Object.fromEntries(MODES.map(mode => [
        mode,
        normalizeBucket(source.modes?.[mode])
      ]))
    };
  }

  function limitIds(value, maximum) {
    return [...new Set(Array.isArray(value)
      ? value.filter(id => typeof id === "string" && id.length <= 220)
      : [])].slice(-maximum);
  }

  function normalizeStatistics(value) {
    const source = value && typeof value === "object" ? value : {};
    const targets = {};
    Object.entries(source.targets || {}).slice(0, MAX_TARGETS).forEach(([id, target]) => {
      if (!id || isUnsafeKey(id)) return;
      targets[id] = normalizeTarget(target, id);
    });
    return {
      schemaVersion: STATISTICS_SCHEMA_VERSION,
      createdAt: normalizeIsoDate(source.createdAt),
      updatedAt: normalizeIsoDate(source.updatedAt),
      lastPlayedAt: normalizeIsoDate(source.lastPlayedAt),
      overall: normalizeBucket(source.overall),
      modes: Object.fromEntries(MODES.map(mode => [
        mode,
        normalizeBucket(source.modes?.[mode])
      ])),
      targetTypes: Object.fromEntries(TARGET_TYPES.map(type => [
        type,
        normalizeBucket(source.targetTypes?.[type])
      ])),
      modeTargetTypes: Object.fromEntries(MODES.map(mode => [mode,
        Object.fromEntries(TARGET_TYPES.map(type => [
          type,
          normalizeBucket(source.modeTargetTypes?.[mode]?.[type])
        ]))
      ])),
      targets,
      exam: {
        highestPercentageBasisPoints: Math.min(10000,
          Math.floor(finiteNonNegative(source.exam?.highestPercentageBasisPoints))
        ),
        highestAward: normalizeAward(source.exam?.highestAward)
      },
      deduplication: {
        recentRoundIds: limitIds(
          source.deduplication?.recentRoundIds,
          MAX_RECENT_ROUND_IDS
        ),
        recentStartedGameIds: limitIds(
          source.deduplication?.recentStartedGameIds,
          MAX_RECENT_GAME_IDS
        ),
        recentCompletedGameIds: limitIds(
          source.deduplication?.recentCompletedGameIds,
          MAX_RECENT_GAME_IDS
        )
      }
    };
  }

  function migrateVersionOne(value) {
    const migrated = createEmptyStatistics();
    const copyLegacyBucket = legacy => normalizeBucket({
      gamesStarted: legacy?.gamesStarted,
      gamesCompleted: legacy?.gamesFinished,
      roundsEvaluated: legacy?.roundsAnswered,
      totalPoints: legacy?.totalPoints,
      bestPoints: legacy?.bestPoints,
      bestDistanceMeters: legacy?.bestDistanceMeters
    });
    migrated.overall = copyLegacyBucket(value);
    for (const mode of MODES) migrated.modes[mode] = copyLegacyBucket(value.modes?.[mode]);
    for (const type of TARGET_TYPES) {
      migrated.targetTypes[type] = copyLegacyBucket(value.targetTypes?.[type]);
    }
    migrated.lastPlayedAt = normalizeIsoDate(value.lastPlayedAt);
    migrated.updatedAt = migrated.lastPlayedAt;
    return migrated;
  }

  function migrateStatistics(value) {
    if (!value || typeof value !== "object") {
      throw new Error("Die Datei enthält kein Statistikobjekt.");
    }
    if (value.schemaVersion === STATISTICS_SCHEMA_VERSION) {
      return normalizeStatistics(value);
    }
    if (value.version === 1 || value.schemaVersion === 1) {
      return normalizeStatistics(migrateVersionOne(value));
    }
    throw new Error(`Nicht unterstützte schemaVersion: ${String(value.schemaVersion ?? value.version ?? "fehlt")}.`);
  }

  function validateBucket(bucket, path) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
      throw new Error(`${path} fehlt oder ist ungültig.`);
    }
    const countFields = [
      "gamesStarted", "gamesCompleted", "roundsEvaluated", "distanceCount",
      "durationCount", "timeoutCount", "hitCount"
    ];
    for (const field of countFields) {
      if (!Number.isInteger(bucket[field]) || bucket[field] < 0) {
        throw new Error(`${path}.${field} muss eine nichtnegative ganze Zahl sein.`);
      }
    }
    for (const field of ["totalPoints", "totalDistanceMeters", "totalDurationSeconds"]) {
      if (!Number.isFinite(bucket[field]) || bucket[field] < 0) {
        throw new Error(`${path}.${field} muss eine nichtnegative Zahl sein.`);
      }
    }
    for (const field of ["bestPoints", "bestDistanceMeters", "worstDistanceMeters"]) {
      if (bucket[field] !== null
        && (!Number.isFinite(bucket[field]) || bucket[field] < 0)) {
        throw new Error(`${path}.${field} ist ungültig.`);
      }
    }
    if (bucket.gamesCompleted > bucket.gamesStarted) {
      throw new Error(`${path}.gamesCompleted darf gamesStarted nicht überschreiten.`);
    }
    for (const field of ["distanceCount", "durationCount", "timeoutCount", "hitCount"]) {
      if (bucket[field] > bucket.roundsEvaluated) {
        throw new Error(`${path}.${field} darf roundsEvaluated nicht überschreiten.`);
      }
    }
  }

  function validateLegacyStatistics(value) {
    const numericFields = [
      "gamesStarted", "gamesFinished", "roundsAnswered", "totalPoints", "bestPoints"
    ];
    for (const field of numericFields) {
      if (value[field] !== undefined
        && (!Number.isFinite(value[field]) || value[field] < 0)) {
        throw new Error(`Veraltete Statistik: ${field} ist ungültig.`);
      }
    }
    if (value.gamesFinished > value.gamesStarted) {
      throw new Error("Veraltete Statistik: gamesFinished ist größer als gamesStarted.");
    }
    return true;
  }

  function validateStatistics(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Die Datei enthält kein gültiges Statistikobjekt.");
    }
    if (value.schemaVersion !== STATISTICS_SCHEMA_VERSION) {
      if (value.version === 1 || value.schemaVersion === 1) {
        return validateLegacyStatistics(value);
      }
      throw new Error(`Erwartete schemaVersion ${STATISTICS_SCHEMA_VERSION}.`);
    }
    validateBucket(value.overall, "overall");
    for (const mode of MODES) validateBucket(value.modes?.[mode], `modes.${mode}`);
    for (const type of TARGET_TYPES) {
      validateBucket(value.targetTypes?.[type], `targetTypes.${type}`);
      for (const mode of MODES) {
        validateBucket(
          value.modeTargetTypes?.[mode]?.[type],
          `modeTargetTypes.${mode}.${type}`
        );
      }
    }
    const targetEntries = Object.entries(value.targets || {});
    if (targetEntries.length > MAX_TARGETS) {
      throw new Error(`Die Datei enthält mehr als ${MAX_TARGETS} Ziele.`);
    }
    for (const [id, target] of targetEntries) {
      if (!id || isUnsafeKey(id)) throw new Error(`Ungültige Ziel-ID: ${id}.`);
      if (!target || typeof target !== "object") throw new Error(`Ziel ${id} ist ungültig.`);
      if (!TARGET_TYPES.includes(target.targetType)) {
        throw new Error(`Ziel ${id} besitzt einen unbekannten Zieltyp.`);
      }
      validateBucket(target.overall, `targets.${id}.overall`);
      for (const mode of MODES) validateBucket(target.modes?.[mode], `targets.${id}.modes.${mode}`);
    }
    if (!value.exam || typeof value.exam !== "object"
      || !Number.isFinite(value.exam.highestPercentageBasisPoints)
      || value.exam.highestPercentageBasisPoints < 0
      || value.exam.highestPercentageBasisPoints > 10000) {
      throw new Error("exam.highestPercentageBasisPoints ist ungültig.");
    }
    for (const field of ["recentRoundIds", "recentStartedGameIds", "recentCompletedGameIds"]) {
      if (!Array.isArray(value.deduplication?.[field])) {
        throw new Error(`deduplication.${field} ist ungültig.`);
      }
      if (value.deduplication[field].some(id => typeof id !== "string" || id.length > 220)) {
        throw new Error(`deduplication.${field} enthält ungültige IDs.`);
      }
    }
    for (const field of ["createdAt", "updatedAt", "lastPlayedAt"]) {
      if (value[field] !== null
        && (typeof value[field] !== "string" || !Number.isFinite(Date.parse(value[field])))) {
        throw new Error(`${field} ist kein gültiges Datum.`);
      }
    }
    return true;
  }

  function parseStatisticsJson(jsonText) {
    if (typeof jsonText !== "string" || jsonText.length === 0) {
      throw new Error("Die ausgewählte Datei ist leer.");
    }
    if (jsonText.length > MAX_IMPORT_BYTES) {
      throw new Error("Die Statistikdatei ist größer als 5 MB.");
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (_) {
      throw new Error("Die Datei enthält kein gültiges JSON.");
    }
    validateStatistics(parsed);
    return migrateStatistics(parsed);
  }

  function targetTypesForSelection(contentSelection) {
    if (contentSelection === "pois") return ["poi"];
    if (contentSelection === "mixed") return ["street", "poi"];
    return ["street"];
  }

  function updateDateFields(statistics, timestamp) {
    const date = normalizeIsoDate(timestamp) || new Date().toISOString();
    if (!statistics.createdAt) statistics.createdAt = date;
    statistics.updatedAt = date;
    statistics.lastPlayedAt = date;
  }

  function appendRecentId(list, id, maximum) {
    if (!id || list.includes(id)) return false;
    list.push(id);
    if (list.length > maximum) list.splice(0, list.length - maximum);
    return true;
  }

  function updateGameBucket(bucket, field) {
    bucket[field] += 1;
  }

  function updateRoundBucket(bucket, result) {
    const points = finiteNonNegative(result.points);
    const duration = finiteNonNegative(result.durationSeconds);
    bucket.roundsEvaluated += 1;
    bucket.totalPoints += points;
    bucket.bestPoints = bucket.bestPoints === null ? points : Math.max(bucket.bestPoints, points);
    bucket.durationCount += 1;
    bucket.totalDurationSeconds += duration;
    if (result.timedOut) bucket.timeoutCount += 1;
    if (Number.isFinite(result.distanceMeters) && result.distanceMeters >= 0) {
      const distance = Number(result.distanceMeters);
      bucket.distanceCount += 1;
      bucket.totalDistanceMeters += distance;
      bucket.bestDistanceMeters = bucket.bestDistanceMeters === null
        ? distance
        : Math.min(bucket.bestDistanceMeters, distance);
      bucket.worstDistanceMeters = bucket.worstDistanceMeters === null
        ? distance
        : Math.max(bucket.worstDistanceMeters, distance);
      const targetType = TARGET_TYPES.includes(result.targetType) ? result.targetType : "street";
      if (distance <= HIT_THRESHOLDS_METERS[targetType]) bucket.hitCount += 1;
    }
  }

  function createTargetStatistics(result) {
    return {
      id: String(result.targetId),
      name: String(result.targetName || result.targetId).slice(0, 240),
      targetType: TARGET_TYPES.includes(result.targetType) ? result.targetType : "street",
      category: String(result.targetCategoryLabel || result.targetCategory || "").slice(0, 120),
      lastPlayedAt: normalizeIsoDate(result.timestamp),
      overall: createBucket(),
      modes: createModeBuckets()
    };
  }

  function deriveBucket(bucket) {
    const normalized = normalizeBucket(bucket);
    return {
      ...normalized,
      averagePoints: normalized.roundsEvaluated > 0
        ? normalized.totalPoints / normalized.roundsEvaluated
        : 0,
      averageDistanceMeters: normalized.distanceCount > 0
        ? normalized.totalDistanceMeters / normalized.distanceCount
        : null,
      averageDurationSeconds: normalized.durationCount > 0
        ? normalized.totalDurationSeconds / normalized.durationCount
        : 0,
      hitRatePercent: normalized.roundsEvaluated > 0
        ? normalized.hitCount / normalized.roundsEvaluated * 100
        : 0
    };
  }

  function compareTargetIds(first, second) {
    return String(first.id).localeCompare(String(second.id), "de");
  }

  function selectTargetHighlights(targets) {
    if (targets.length === 0) return { best: null, worst: null, mostPlayed: null };
    const average = target => target.statistics.averagePoints;
    const best = [...targets].sort((first, second) =>
      average(second) - average(first)
      || second.statistics.roundsEvaluated - first.statistics.roundsEvaluated
      || compareTargetIds(first, second)
    )[0];
    const worst = [...targets].sort((first, second) =>
      average(first) - average(second)
      || second.statistics.roundsEvaluated - first.statistics.roundsEvaluated
      || compareTargetIds(first, second)
    )[0];
    const mostPlayed = [...targets].sort((first, second) =>
      second.statistics.roundsEvaluated - first.statistics.roundsEvaluated
      || average(second) - average(first)
      || compareTargetIds(first, second)
    )[0];
    return { best, worst, mostPlayed };
  }

  function mergeBucket(first, second) {
    const a = normalizeBucket(first);
    const b = normalizeBucket(second);
    const minimum = (one, two) => one === null ? two : (two === null ? one : Math.min(one, two));
    const maximum = (one, two) => one === null ? two : (two === null ? one : Math.max(one, two));
    return {
      gamesStarted: a.gamesStarted + b.gamesStarted,
      gamesCompleted: a.gamesCompleted + b.gamesCompleted,
      roundsEvaluated: a.roundsEvaluated + b.roundsEvaluated,
      totalPoints: a.totalPoints + b.totalPoints,
      bestPoints: maximum(a.bestPoints, b.bestPoints),
      distanceCount: a.distanceCount + b.distanceCount,
      totalDistanceMeters: a.totalDistanceMeters + b.totalDistanceMeters,
      bestDistanceMeters: minimum(a.bestDistanceMeters, b.bestDistanceMeters),
      worstDistanceMeters: maximum(a.worstDistanceMeters, b.worstDistanceMeters),
      durationCount: a.durationCount + b.durationCount,
      totalDurationSeconds: a.totalDurationSeconds + b.totalDurationSeconds,
      timeoutCount: a.timeoutCount + b.timeoutCount,
      hitCount: a.hitCount + b.hitCount
    };
  }

  function latestDate(first, second) {
    const values = [normalizeIsoDate(first), normalizeIsoDate(second)].filter(Boolean);
    return values.sort().at(-1) || null;
  }

  function earliestDate(first, second) {
    const values = [normalizeIsoDate(first), normalizeIsoDate(second)].filter(Boolean);
    return values.sort()[0] || null;
  }

  function mergeStatistics(firstValue, secondValue) {
    const first = normalizeStatistics(firstValue);
    const second = normalizeStatistics(secondValue);
    const merged = createEmptyStatistics();
    merged.createdAt = earliestDate(first.createdAt, second.createdAt);
    merged.updatedAt = latestDate(first.updatedAt, second.updatedAt);
    merged.lastPlayedAt = latestDate(first.lastPlayedAt, second.lastPlayedAt);
    merged.overall = mergeBucket(first.overall, second.overall);
    for (const mode of MODES) merged.modes[mode] = mergeBucket(first.modes[mode], second.modes[mode]);
    for (const type of TARGET_TYPES) {
      merged.targetTypes[type] = mergeBucket(first.targetTypes[type], second.targetTypes[type]);
      for (const mode of MODES) {
        merged.modeTargetTypes[mode][type] = mergeBucket(
          first.modeTargetTypes[mode][type],
          second.modeTargetTypes[mode][type]
        );
      }
    }
    const targetIds = [...new Set([
      ...Object.keys(first.targets), ...Object.keys(second.targets)
    ])].sort().slice(0, MAX_TARGETS);
    for (const id of targetIds) {
      const a = first.targets[id];
      const b = second.targets[id];
      if (!a) { merged.targets[id] = clone(b); continue; }
      if (!b) { merged.targets[id] = clone(a); continue; }
      const target = normalizeTarget({
        ...a,
        name: b.name || a.name,
        category: b.category || a.category,
        lastPlayedAt: latestDate(a.lastPlayedAt, b.lastPlayedAt)
      }, id);
      target.overall = mergeBucket(a.overall, b.overall);
      for (const mode of MODES) target.modes[mode] = mergeBucket(a.modes[mode], b.modes[mode]);
      merged.targets[id] = target;
    }
    const firstExam = first.exam.highestPercentageBasisPoints;
    const secondExam = second.exam.highestPercentageBasisPoints;
    if (secondExam > firstExam) {
      merged.exam = clone(second.exam);
    } else {
      merged.exam = clone(first.exam);
    }
    merged.deduplication.recentRoundIds = limitIds([
      ...first.deduplication.recentRoundIds,
      ...second.deduplication.recentRoundIds
    ], MAX_RECENT_ROUND_IDS);
    merged.deduplication.recentStartedGameIds = limitIds([
      ...first.deduplication.recentStartedGameIds,
      ...second.deduplication.recentStartedGameIds
    ], MAX_RECENT_GAME_IDS);
    merged.deduplication.recentCompletedGameIds = limitIds([
      ...first.deduplication.recentCompletedGameIds,
      ...second.deduplication.recentCompletedGameIds
    ], MAX_RECENT_GAME_IDS);
    return merged;
  }

  function createStatisticsStore(storage, storageKey) {
    let statistics = createEmptyStatistics();
    let loadWarning = null;

    try {
      const storedText = storage?.getItem(storageKey);
      if (storedText) {
        const parsed = JSON.parse(storedText);
        validateStatistics(parsed);
        statistics = migrateStatistics(parsed);
      }
    } catch (error) {
      statistics = createEmptyStatistics();
      loadWarning = `Gespeicherte Statistik konnte nicht geladen werden: ${error.message}`;
    }

    function persist() {
      try {
        storage?.setItem(storageKey, JSON.stringify(statistics));
      } catch (_) {
        // Die App bleibt auch bei blockiertem oder vollem localStorage spielbar.
      }
    }

    function recordGameStarted(mode, options = {}) {
      const normalizedMode = MODES.includes(mode) ? mode : "free";
      const gameId = String(options.gameId || "");
      if (gameId && !appendRecentId(
        statistics.deduplication.recentStartedGameIds,
        gameId,
        MAX_RECENT_GAME_IDS
      )) return clone(statistics);
      const types = targetTypesForSelection(options.contentSelection);
      updateGameBucket(statistics.overall, "gamesStarted");
      updateGameBucket(statistics.modes[normalizedMode], "gamesStarted");
      for (const type of types) {
        updateGameBucket(statistics.targetTypes[type], "gamesStarted");
        updateGameBucket(statistics.modeTargetTypes[normalizedMode][type], "gamesStarted");
      }
      updateDateFields(statistics, options.timestamp);
      persist();
      return clone(statistics);
    }

    function recordRound(result, options = {}) {
      if (!result || typeof result !== "object") return clone(statistics);
      const roundId = String(options.roundId || result.resultId || "");
      if (roundId && !appendRecentId(
        statistics.deduplication.recentRoundIds,
        roundId,
        MAX_RECENT_ROUND_IDS
      )) return clone(statistics);
      const mode = MODES.includes(result.mode) ? result.mode : "free";
      const type = TARGET_TYPES.includes(result.targetType) ? result.targetType : "street";
      updateRoundBucket(statistics.overall, result);
      updateRoundBucket(statistics.modes[mode], result);
      updateRoundBucket(statistics.targetTypes[type], result);
      updateRoundBucket(statistics.modeTargetTypes[mode][type], result);
      const targetId = String(result.targetId || "unknown-target").slice(0, 180);
      if (!isUnsafeKey(targetId)) {
        if (!statistics.targets[targetId]) statistics.targets[targetId] = createTargetStatistics(result);
        const target = statistics.targets[targetId];
        target.name = String(result.targetName || target.name).slice(0, 240);
        target.targetType = type;
        target.category = String(
          result.targetCategoryLabel || result.targetCategory || target.category
        ).slice(0, 120);
        target.lastPlayedAt = normalizeIsoDate(result.timestamp) || target.lastPlayedAt;
        updateRoundBucket(target.overall, result);
        updateRoundBucket(target.modes[mode], result);
      }
      updateDateFields(statistics, result.timestamp);
      persist();
      return clone(statistics);
    }

    function recordGameFinished(mode, options = {}) {
      const normalizedMode = MODES.includes(mode) ? mode : "free";
      const gameId = String(options.gameId || "");
      if (gameId && statistics.deduplication.recentCompletedGameIds.includes(gameId)) {
        return clone(statistics);
      }
      if (normalizedMode === "exam" && Array.isArray(options.results)) {
        options.results.forEach((result, index) => recordRound(result, {
          roundId: result.resultId || `${gameId || "exam"}:round:${index + 1}`
        }));
      }
      const types = targetTypesForSelection(options.contentSelection);
      updateGameBucket(statistics.overall, "gamesCompleted");
      updateGameBucket(statistics.modes[normalizedMode], "gamesCompleted");
      for (const type of types) {
        updateGameBucket(statistics.targetTypes[type], "gamesCompleted");
        updateGameBucket(statistics.modeTargetTypes[normalizedMode][type], "gamesCompleted");
      }
      const award = options.summary?.award;
      if (normalizedMode === "exam" && award) {
        const basisPoints = Math.min(10000,
          Math.floor(finiteNonNegative(award.percentageBasisPoints))
        );
        if (basisPoints > statistics.exam.highestPercentageBasisPoints
          || (basisPoints === statistics.exam.highestPercentageBasisPoints
            && !statistics.exam.highestAward)) {
          statistics.exam.highestPercentageBasisPoints = basisPoints;
          statistics.exam.highestAward = normalizeAward(award);
        }
      }
      if (gameId) appendRecentId(
        statistics.deduplication.recentCompletedGameIds,
        gameId,
        MAX_RECENT_GAME_IDS
      );
      updateDateFields(statistics, options.timestamp);
      persist();
      return clone(statistics);
    }

    function getView(filters = {}) {
      const mode = MODES.includes(filters.mode) ? filters.mode : "all";
      const targetType = TARGET_TYPES.includes(filters.targetType)
        ? filters.targetType
        : "all";
      let bucket = statistics.overall;
      if (mode !== "all" && targetType === "all") bucket = statistics.modes[mode];
      else if (mode === "all" && targetType !== "all") bucket = statistics.targetTypes[targetType];
      else if (mode !== "all" && targetType !== "all") {
        bucket = statistics.modeTargetTypes[mode][targetType];
      }
      const targets = Object.values(statistics.targets)
        .filter(target => targetType === "all" || target.targetType === targetType)
        .map(target => ({
          id: target.id,
          name: target.name,
          targetType: target.targetType,
          category: target.category,
          statistics: deriveBucket(mode === "all" ? target.overall : target.modes[mode])
        }))
        .filter(target => target.statistics.roundsEvaluated > 0);
      return {
        filters: { mode, targetType },
        statistics: deriveBucket(bucket),
        targets: selectTargetHighlights(targets),
        highestExam: (mode === "all" || mode === "exam")
          ? clone(statistics.exam)
          : null,
        lastPlayedAt: statistics.lastPlayedAt,
        hitThresholdsMeters: { ...HIT_THRESHOLDS_METERS }
      };
    }

    function exportJson() {
      return JSON.stringify(statistics, null, 2);
    }

    function importJson(jsonText, strategy = "replace") {
      const imported = parseStatisticsJson(jsonText);
      if (strategy === "merge") {
        const duplicateRound = imported.deduplication.recentRoundIds.some(id =>
          statistics.deduplication.recentRoundIds.includes(id)
        );
        const duplicateGame = imported.deduplication.recentCompletedGameIds.some(id =>
          statistics.deduplication.recentCompletedGameIds.includes(id)
        );
        if (duplicateRound || duplicateGame) {
          throw new Error(
            "Die Datei überschneidet sich mit bereits gespeicherten Spielen oder Aufgaben. Bitte nicht zusammenführen; zum Wiederherstellen stattdessen ‚Ersetzen‘ wählen."
          );
        }
      }
      statistics = strategy === "merge"
        ? mergeStatistics(statistics, imported)
        : imported;
      statistics.updatedAt = new Date().toISOString();
      persist();
      loadWarning = null;
      return clone(statistics);
    }

    function reset() {
      statistics = createEmptyStatistics();
      statistics.updatedAt = new Date().toISOString();
      persist();
      loadWarning = null;
      return clone(statistics);
    }

    return {
      getSnapshot: () => clone(statistics),
      getView,
      getLoadWarning: () => loadWarning,
      recordGameStarted,
      recordRound,
      recordGameFinished,
      exportJson,
      importJson,
      reset
    };
  }

  return {
    STATISTICS_SCHEMA_VERSION,
    HIT_THRESHOLDS_METERS,
    createEmptyStatistics,
    validateStatistics,
    migrateStatistics,
    parseStatisticsJson,
    mergeStatistics,
    createStatisticsStore
  };
});
