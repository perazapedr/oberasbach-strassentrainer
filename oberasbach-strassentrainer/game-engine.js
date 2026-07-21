(function initializeGameEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGameEngineApi() {
  "use strict";

  const GAME_STATUS = Object.freeze({
    IDLE: "idle",
    PREPARING: "preparing",
    ACTIVE: "active",
    ANSWERED: "answered",
    FINISHED: "finished"
  });

  const MODE_CONFIGS = Object.freeze({
    free: Object.freeze({
      mode: "free",
      totalRounds: null,
      secondsPerRound: null,
      contentSelection: "streets",
      poiCategories: null,
      showTargetCategory: true,
      immediateResolution: true,
      autoAdvanceDelaySeconds: null
    }),
    timed: Object.freeze({
      mode: "timed",
      totalRounds: 10,
      secondsPerRound: 30,
      contentSelection: "streets",
      poiCategories: null,
      showTargetCategory: true,
      immediateResolution: true,
      autoAdvanceDelaySeconds: null
    }),
    exam: Object.freeze({
      mode: "exam",
      totalRounds: 10,
      secondsPerRound: 30,
      contentSelection: "streets",
      poiCategories: null,
      showTargetCategory: true,
      immediateResolution: false,
      autoAdvanceDelaySeconds: null
    })
  });

  // Für einen späteren Wechsel nur displayMode auf "medals" setzen.
  // Symbole sind bewusst neutrale Emojis und keine offiziellen Dienstgradabzeichen.
  const EXAM_AWARD_CONFIG = Object.freeze({
    displayMode: "ranks",
    schemes: Object.freeze({
      ranks: Object.freeze([
        Object.freeze({ minimumPercent: 0, key: "candidate", name: "Anwärter", symbol: "🔰", description: "Ein guter Anfang – mit jeder Runde wächst deine Ortskenntnis." }),
        Object.freeze({ minimumPercent: 65, key: "crew-member", name: "Truppmann", symbol: "🧭", description: "Du findest dich bereits sicher in vielen Einsatzlagen zurecht." }),
        Object.freeze({ minimumPercent: 75, key: "crew-leader", name: "Truppführer", symbol: "⭐", description: "Starke Orientierung – auch anspruchsvolle Ziele liegen dir." }),
        Object.freeze({ minimumPercent: 85, key: "group-leader", name: "Gruppenführer", symbol: "🏅", description: "Sehr überzeugend: Deine Ortskenntnis ist breit und zuverlässig." }),
        Object.freeze({ minimumPercent: 95, key: "incident-leader", name: "Einsatzleiter", symbol: "🏆", description: "Hervorragend – du behältst nahezu überall den Überblick." }),
        Object.freeze({ minimumPercent: 100, exactPercent: 100, key: "local-knowledge-master", name: "Ortskenntnis-Meister", symbol: "💎", description: "Perfekte Prüfung: Du hast die maximale Punktzahl erreicht." })
      ]),
      medals: Object.freeze([
        Object.freeze({ minimumPercent: 0, key: "bronze", name: "Bronze", symbol: "🥉", description: "Der Grundstein ist gelegt – bleib am Ball." }),
        Object.freeze({ minimumPercent: 65, key: "silver", name: "Silber", symbol: "🥈", description: "Eine sichere Leistung mit guter Ortskenntnis." }),
        Object.freeze({ minimumPercent: 85, key: "gold", name: "Gold", symbol: "🥇", description: "Eine sehr starke und zuverlässige Prüfungsleistung." }),
        Object.freeze({ minimumPercent: 95, key: "diamond", name: "Diamant", symbol: "💎", description: "Außergewöhnliche Ortskenntnis auf höchstem Niveau." })
      ])
    })
  });

  function calculateDefaultScore(distanceMeters) {
    if (distanceMeters <= 10) return 1000;
    return Math.max(0, Math.round(1000 * Math.exp(-distanceMeters / 500)));
  }

  function normalizeConfig(config = {}) {
    const baseConfig = MODE_CONFIGS[config.mode] || MODE_CONFIGS.free;
    return {
      mode: config.mode || baseConfig.mode,
      totalRounds: config.totalRounds ?? baseConfig.totalRounds,
      secondsPerRound: config.secondsPerRound ?? baseConfig.secondsPerRound,
      contentSelection: config.contentSelection ?? baseConfig.contentSelection,
      poiCategories: Array.isArray(config.poiCategories)
        ? [...new Set(config.poiCategories)]
        : baseConfig.poiCategories,
      showTargetCategory: config.showTargetCategory ?? baseConfig.showTargetCategory,
      immediateResolution: config.immediateResolution ?? baseConfig.immediateResolution,
      autoAdvanceDelaySeconds: config.autoAdvanceDelaySeconds
        ?? baseConfig.autoAdvanceDelaySeconds
    };
  }

  function normalizeGuessCoordinates(coordinates) {
    const lat = Number(coordinates?.lat);
    const lng = Number(coordinates?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Ungültige Tippkoordinaten.");
    }
    return { lat, lng };
  }

  function createGameEngine(options = {}) {
    const now = options.now || (() => Date.now());
    const scoreCalculator = options.scoreCalculator || calculateDefaultScore;
    const statisticsStore = options.statisticsStore || null;
    const hitThresholdsMeters = options.hitThresholdsMeters || { street: 100, poi: 100 };
    let generatedGameIdSequence = 0;
    const createGameId = options.createGameId || (() => {
      generatedGameIdSequence += 1;
      return `game-${now()}-${generatedGameIdSequence}-${Math.random().toString(36).slice(2, 10)}`;
    });

    const gameState = {
      status: GAME_STATUS.IDLE,
      config: normalizeConfig(MODE_CONFIGS.free),
      gameId: null,
      statisticsGameStarted: false,
      startedAt: null,
      finishedAt: null,
      currentRound: null,
      results: [],
      totalScore: 0,
      summary: null,
      statistics: statisticsStore?.getSnapshot?.() || null
    };

    function startGame(config = MODE_CONFIGS.free) {
      gameState.status = GAME_STATUS.IDLE;
      gameState.config = normalizeConfig(config);
      gameState.gameId = createGameId();
      gameState.statisticsGameStarted = false;
      gameState.startedAt = now();
      gameState.finishedAt = null;
      gameState.currentRound = null;
      gameState.results = [];
      gameState.totalScore = 0;
      gameState.summary = null;
      return gameState;
    }

    function ensureStatisticsGameStarted() {
      if (!statisticsStore || gameState.statisticsGameStarted) return;
      gameState.statistics = statisticsStore.recordGameStarted(gameState.config.mode, {
        gameId: gameState.gameId,
        contentSelection: gameState.config.contentSelection,
        timestamp: new Date(now()).toISOString()
      });
      gameState.statisticsGameStarted = true;
    }

    function startRound() {
      if (gameState.status === GAME_STATUS.PREPARING) {
        throw new Error("Eine Runde wird bereits vorbereitet.");
      }
      if (gameState.status === GAME_STATUS.FINISHED) {
        throw new Error("Das Spiel ist beendet.");
      }
      ensureStatisticsGameStarted();
      gameState.status = GAME_STATUS.PREPARING;
      gameState.currentRound = {
        roundNumber: gameState.results.length + 1,
        target: null,
        preparedAt: now(),
        startedAt: null,
        guess: null,
        result: null
      };
      return gameState.currentRound;
    }

    function activateRound(target) {
      if (gameState.status !== GAME_STATUS.PREPARING || !gameState.currentRound) {
        throw new Error("Keine vorbereitete Runde vorhanden.");
      }
      if (!target?.id || !target?.name) throw new Error("Ungültiges Rundenziel.");
      gameState.currentRound.target = {
        id: target.id,
        name: target.name,
        targetType: target.targetType || (target.category === "street" ? "street" : "poi"),
        category: target.category || "street",
        categoryLabel: target.categoryLabel || (target.category === "street" ? "Straße" : "Ort"),
        geometry: target.geometry || null
      };
      gameState.currentRound.startedAt = now();
      gameState.status = GAME_STATUS.ACTIVE;
      return gameState.currentRound;
    }

    function submitGuess(coordinates, options = {}) {
      if (gameState.status !== GAME_STATUS.ACTIVE || !gameState.currentRound) {
        throw new Error("Die Runde ist nicht aktiv.");
      }
      const submittedAt = now();
      const durationSeconds = Math.max(0,
        (submittedAt - gameState.currentRound.startedAt) / 1000
      );
      const configuredLimit = gameState.config.secondsPerRound;
      gameState.currentRound.guess = {
        coordinates: normalizeGuessCoordinates(coordinates),
        submittedAt,
        durationSeconds,
        timedOut: options.timedOut === undefined
          ? (Number.isFinite(configuredLimit) && durationSeconds > configuredLimit)
          : Boolean(options.timedOut)
      };
      return gameState.currentRound.guess;
    }

    function storeRoundResult(result) {
      gameState.currentRound.result = result;
      gameState.results.push(result);
      gameState.totalScore += result.points;
      gameState.status = GAME_STATUS.ANSWERED;
      if (statisticsStore && gameState.config.mode !== "exam") {
        gameState.statistics = statisticsStore.recordRound(result, {
          roundId: result.resultId
        });
      }
      return result;
    }

    function resolveRound(evaluation) {
      const round = gameState.currentRound;
      if (gameState.status !== GAME_STATUS.ACTIVE || !round?.guess || !round.target) {
        throw new Error("Die aktive Runde besitzt noch keinen Tipp.");
      }
      const distanceMeters = Number(evaluation?.distanceMeters);
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
        throw new Error("Ungültige Entfernungsauswertung.");
      }
      const points = Number.isFinite(evaluation?.points)
        ? Math.max(0, Math.round(evaluation.points))
        : Math.max(0, Math.round(scoreCalculator(
          distanceMeters,
          gameState.config,
          round.target
        )));
      const result = {
        mode: gameState.config.mode,
        targetId: round.target.id,
        targetName: round.target.name,
        targetType: round.target.targetType,
        targetCategory: round.target.category,
        targetCategoryLabel: round.target.categoryLabel,
        roundNumber: round.roundNumber,
        resultId: `${gameState.gameId}:round:${round.roundNumber}`,
        distanceMeters,
        points,
        durationSeconds: round.guess.durationSeconds,
        timedOut: round.guess.timedOut,
        guessCoordinates: { ...round.guess.coordinates },
        timestamp: new Date(round.guess.submittedAt).toISOString()
      };

      return storeRoundResult(result);
    }

    function expireRound() {
      const round = gameState.currentRound;
      if (gameState.status !== GAME_STATUS.ACTIVE || !round?.target) {
        throw new Error("Die Runde ist nicht aktiv.");
      }
      const expiredAt = Number.isFinite(gameState.config.secondsPerRound)
        ? round.startedAt + gameState.config.secondsPerRound * 1000
        : now();
      const durationSeconds = Number.isFinite(gameState.config.secondsPerRound)
        ? gameState.config.secondsPerRound
        : Math.max(0, (now() - round.startedAt) / 1000);
      const result = {
        mode: gameState.config.mode,
        targetId: round.target.id,
        targetName: round.target.name,
        targetType: round.target.targetType,
        targetCategory: round.target.category,
        targetCategoryLabel: round.target.categoryLabel,
        roundNumber: round.roundNumber,
        resultId: `${gameState.gameId}:round:${round.roundNumber}`,
        distanceMeters: null,
        points: 0,
        durationSeconds,
        timedOut: true,
        guessCoordinates: null,
        timestamp: new Date(expiredAt).toISOString()
      };
      round.guess = null;
      return storeRoundResult(result);
    }

    function cancelRound() {
      if (gameState.status === GAME_STATUS.PREPARING || gameState.status === GAME_STATUS.ACTIVE) {
        gameState.currentRound = null;
        gameState.status = GAME_STATUS.IDLE;
      }
      return gameState;
    }

    function finishGame(options = {}) {
      if (gameState.status === GAME_STATUS.FINISHED) return gameState;
      const aborted = Boolean(options.aborted);
      gameState.status = GAME_STATUS.FINISHED;
      gameState.finishedAt = now();
      gameState.summary = gameState.config.mode === "exam"
        ? calculateExamSummary(
          gameState.results,
          gameState.config.totalRounds,
          gameState.startedAt,
          gameState.finishedAt,
          1000,
          hitThresholdsMeters
        )
        : calculateGameSummary(
          gameState.results,
          gameState.startedAt,
          gameState.finishedAt,
          hitThresholdsMeters
        );
      gameState.summary.aborted = aborted;
      if (statisticsStore && gameState.statisticsGameStarted && !aborted) {
        gameState.statistics = statisticsStore.recordGameFinished(gameState.config.mode, {
          gameId: gameState.gameId,
          contentSelection: gameState.config.contentSelection,
          timestamp: new Date(gameState.finishedAt).toISOString(),
          summary: gameState.summary,
          results: gameState.config.mode === "exam" ? gameState.results : undefined
        });
      }
      return gameState;
    }

    function resetGame() {
      gameState.status = GAME_STATUS.IDLE;
      gameState.config = normalizeConfig(MODE_CONFIGS.free);
      gameState.gameId = null;
      gameState.statisticsGameStarted = false;
      gameState.startedAt = null;
      gameState.finishedAt = null;
      gameState.currentRound = null;
      gameState.results = [];
      gameState.totalScore = 0;
      gameState.summary = null;
      gameState.statistics = statisticsStore?.getSnapshot?.() || gameState.statistics;
      return gameState;
    }

    return {
      gameState,
      startGame,
      startRound,
      activateRound,
      submitGuess,
      resolveRound,
      expireRound,
      cancelRound,
      finishGame,
      resetGame
    };
  }

  function calculateGameSummary(
    results,
    startedAt,
    finishedAt,
    hitThresholdsMeters = { street: 100, poi: 100 }
  ) {
    const rounds = Array.isArray(results) ? results : [];
    const isHit = result => Number.isFinite(result.distanceMeters)
      && result.distanceMeters <= hitThresholdsMeters[result.targetType || "street"];
    const completedWithDistance = rounds.filter(result => Number.isFinite(result.distanceMeters));
    const totalPoints = rounds.reduce((sum, result) => sum + result.points, 0);
    const totalDistance = completedWithDistance.reduce(
      (sum, result) => sum + result.distanceMeters, 0
    );
    const totalDuration = rounds.reduce((sum, result) => sum + result.durationSeconds, 0);
    const timeoutCount = rounds.filter(result => result.timedOut).length;
    const hitCount = rounds.filter(isHit).length;
    const bestRound = rounds.length === 0 ? null : [...rounds].sort((first, second) =>
      second.points - first.points
      || (first.distanceMeters ?? Infinity) - (second.distanceMeters ?? Infinity)
    )[0];
    const worstRound = rounds.length === 0 ? null : [...rounds].sort((first, second) =>
      first.points - second.points
      || (second.distanceMeters ?? Infinity) - (first.distanceMeters ?? Infinity)
    )[0];

    function summarizeTargetType(targetType) {
      const selected = rounds.filter(result => (result.targetType || "street") === targetType);
      const withDistance = selected.filter(result => Number.isFinite(result.distanceMeters));
      const points = selected.reduce((sum, result) => sum + result.points, 0);
      const distance = withDistance.reduce((sum, result) => sum + result.distanceMeters, 0);
      const hits = selected.filter(isHit).length;
      return {
        roundCount: selected.length,
        totalPoints: points,
        averagePoints: selected.length ? points / selected.length : 0,
        averageDistanceMeters: withDistance.length ? distance / withDistance.length : null,
        hitCount: hits,
        hitRatePercent: selected.length ? hits / selected.length * 100 : 0,
        timeoutCount: selected.filter(result => result.timedOut).length
      };
    }

    return {
      totalPoints,
      averagePoints: rounds.length ? totalPoints / rounds.length : 0,
      averageDistanceMeters: completedWithDistance.length
        ? totalDistance / completedWithDistance.length
        : null,
      bestRound,
      worstRound,
      averageDurationSeconds: rounds.length ? totalDuration / rounds.length : 0,
      timeoutCount,
      hitCount,
      hitRatePercent: rounds.length ? hitCount / rounds.length * 100 : 0,
      totalDurationSeconds: Number.isFinite(startedAt) && Number.isFinite(finishedAt)
        ? Math.max(0, (finishedAt - startedAt) / 1000)
        : 0,
      roundCount: rounds.length,
      hitThresholdMeters: hitThresholdsMeters.street,
      hitThresholds: { ...hitThresholdsMeters },
      byTargetType: {
        street: summarizeTargetType("street"),
        poi: summarizeTargetType("poi")
      }
    };
  }

  function calculateExamSummary(
    results,
    totalRounds,
    startedAt,
    finishedAt,
    maximumPointsPerRound = 1000,
    hitThresholdsMeters = { street: 100, poi: 100 }
  ) {
    const summary = calculateGameSummary(results, startedAt, finishedAt, hitThresholdsMeters);
    const configuredRounds = Math.max(0, Number(totalRounds) || 0);
    const maximumPossiblePoints = configuredRounds * maximumPointsPerRound;
    const percentage = maximumPossiblePoints > 0
      ? summary.totalPoints / maximumPossiblePoints * 100
      : 0;
    return {
      ...summary,
      maximumPossiblePoints,
      percentage,
      award: calculateExamAward(summary.totalPoints, maximumPossiblePoints),
      unansweredCount: summary.timeoutCount
    };
  }

  function calculateExamAward(
    totalPoints,
    maximumPossiblePoints,
    config = EXAM_AWARD_CONFIG
  ) {
    const earned = Math.max(0, Math.round(Number(totalPoints) || 0));
    const maximum = Math.max(0, Math.round(Number(maximumPossiblePoints) || 0));
    const perfect = maximum > 0 && earned === maximum;
    const percentageBasisPoints = maximum > 0
      ? Math.min(10000, Math.round(earned * 10000 / maximum))
      : 0;
    const mode = config.schemes?.[config.displayMode] ? config.displayMode : "ranks";
    const levels = config.schemes?.[mode] || EXAM_AWARD_CONFIG.schemes.ranks;
    let selected = levels[0];

    for (const level of levels) {
      const thresholdReached = level.minimumPercent === 0
        || (maximum > 0 && earned * 100 >= level.minimumPercent * maximum);
      const exactReached = level.exactPercent === undefined
        || (level.exactPercent === 100 && perfect);
      if (thresholdReached && exactReached) selected = level;
    }

    return Object.freeze({
      scheme: mode,
      key: selected.key,
      name: selected.name,
      symbol: selected.symbol,
      description: selected.description,
      percentage: maximum > 0 ? earned / maximum * 100 : 0,
      percentageBasisPoints,
      perfect
    });
  }

  return {
    GAME_STATUS,
    MODE_CONFIGS,
    EXAM_AWARD_CONFIG,
    calculateDefaultScore,
    calculateGameSummary,
    calculateExamSummary,
    calculateExamAward,
    createGameEngine
  };
});
