// public/js/ui/scheduler.js

const DEFAULT_MINUTES_PER_CAR = 15;

function statusOf(t) {
  return String(t?.status || t?.washStatus || "").toLowerCase();
}

function startedAtMs(t) {
  if (typeof t?.washingStartedAtMs === "number" && t.washingStartedAtMs > 0) {
    return t.washingStartedAtMs;
  }

  if (typeof t?.washingStartedAt?.toMillis === "function") {
    return t.washingStartedAt.toMillis();
  }

  if (typeof t?.washingStartedAt?.seconds === "number") {
    return t.washingStartedAt.seconds * 1000;
  }

  return null;
}

export function computeEtaMap(activeSorted, opts = {}) {
  const map = new Map();

  const baysOpen = Number.isFinite(opts.baysOpen)
    ? Math.floor(opts.baysOpen)
    : 0;

  if (baysOpen <= 0) return map;

  const minutesPerCar =
    Number.isFinite(opts.minutesPerCar) && opts.minutesPerCar > 0
      ? opts.minutesPerCar
      : DEFAULT_MINUTES_PER_CAR;

  const slotMs = minutesPerCar * 60 * 1000;
  const now = Date.now();

  const bayAvailableAt = Array.from({ length: baysOpen }, () => now);

  const rows = Array.isArray(activeSorted) ? activeSorted : [];

  rows.forEach((t) => {
    const status = statusOf(t);

    let bayIndex = 0;

    for (let i = 1; i < bayAvailableAt.length; i++) {
      if (bayAvailableAt[i] < bayAvailableAt[bayIndex]) {
        bayIndex = i;
      }
    }

    let finishMs;

    if (status === "washing") {
      const started = startedAtMs(t);

      finishMs = started
        ? Math.max(now, started + slotMs)
        : now + slotMs;
    } else {
      const startMs = Math.max(now, bayAvailableAt[bayIndex]);
      finishMs = startMs + slotMs;
    }

    bayAvailableAt[bayIndex] = finishMs;
    map.set(t.id, finishMs);
  });

  return map;
}

export function computeRiskMap(activeSorted, etaMap) {
  const risk = new Map();

  (activeSorted || []).forEach((t) => {
    const needByMs =
      typeof t?.needByAtMs === "number" && t.needByAtMs > 0
        ? t.needByAtMs
        : null;

    if (!needByMs) return;

    const etaMs = etaMap?.get(t.id) || null;
    if (!etaMs) return;

    const lateMs = etaMs - needByMs;
    const lateByMin = lateMs > 0 ? Math.ceil(lateMs / 60000) : 0;

    risk.set(t.id, {
      lateByMin,
      etaMs,
      needByMs
    });
  });

  return risk;
}