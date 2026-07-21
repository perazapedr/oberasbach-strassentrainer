(function initializeDeadlineTimer(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StrassentrainerTimer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTimerApi() {
  "use strict";

  function createDeadlineTimer(options = {}) {
    const now = options.now || (() => Date.now());
    const scheduleInterval = options.setInterval || globalThis.setInterval;
    const cancelInterval = options.clearInterval || globalThis.clearInterval;
    const onTick = options.onTick || (() => {});
    const onExpire = options.onExpire || (() => {});
    const intervalMs = options.intervalMs || 200;
    let intervalId = null;
    let startedAt = null;
    let deadline = null;

    function isRunning() {
      return intervalId !== null;
    }

    function createSnapshot() {
      if (!Number.isFinite(deadline)) return null;
      const remainingMs = Math.max(0, deadline - now());
      return {
        startedAt,
        deadline,
        remainingMs,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        urgent: remainingMs > 0 && remainingMs <= 5000
      };
    }

    function stop() {
      if (intervalId !== null) cancelInterval(intervalId);
      intervalId = null;
      startedAt = null;
      deadline = null;
    }

    function checkNow() {
      if (!isRunning()) return null;
      const snapshot = createSnapshot();
      onTick(snapshot);
      if (snapshot.remainingMs <= 0) {
        if (intervalId !== null) cancelInterval(intervalId);
        intervalId = null;
        startedAt = null;
        deadline = null;
        onExpire(snapshot);
      }
      return snapshot;
    }

    function start(seconds) {
      const durationSeconds = Number(seconds);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error("Die Rundendauer muss größer als null sein.");
      }
      stop();
      startedAt = now();
      deadline = startedAt + durationSeconds * 1000;
      intervalId = scheduleInterval(checkNow, intervalMs);
      checkNow();
      return deadline;
    }

    return {
      start,
      stop,
      checkNow,
      isRunning,
      getDeadline: () => deadline
    };
  }

  return { createDeadlineTimer };
});
