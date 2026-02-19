// public/js/ui/scheduler.js

const DEFAULT_MINUTES_PER_CAR = 15;

/**
 * Compute ETA map for the *displayed* active list.
 * This version assumes the list is already sorted correctly (NeedBy first, then arrival order),
 * which is handled by sortActiveQueue().
 *
 * NOTE: baysOpen will come from settings later. For now it's 1 bay by default.
 */
export function computeEtaMap(activeSorted, opts = {}) {
  const minutesPerCar =
    Number.isFinite(opts.minutesPerCar) && opts.minutesPerCar > 0
      ? opts.minutesPerCar
      : DEFAULT_MINUTES_PER_CAR;

  const baysOpen =
    Number.isFinite(opts.baysOpen) && opts.baysOpen > 0
      ? Math.floor(opts.baysOpen)
      : 1;

  const slotMs = minutesPerCar * 60 * 1000;
  const now = Date.now();

  const map = new Map();

  // With multiple bays:
  // index 0..bays-1 finish at 1 slot
  // index bays..2*bays-1 finish at 2 slots
  // finishMs = now + (floor(i/baysOpen)+1)*slotMs
  (activeSorted || []).forEach((t, i) => {
    const finishMs = now + (Math.floor(i / baysOpen) + 1) * slotMs;
    map.set(t.id, finishMs);
  });

  return map;
}

/**
 * OPTIONAL (not used yet): risk map for NeedBy tickets.
 * Returns Map(ticketId -> { lateByMin, etaMs, needByMs })
 *
 * lateByMin = 0 means safe.
 */
export function computeRiskMap(activeSorted, etaMap) {
  const risk = new Map();

  (activeSorted || []).forEach((t) => {
    const needByMs =
      typeof t?.needByAtMs === "number" && t.needByAtMs > 0 ? t.needByAtMs : null;

    if (!needByMs) return;

    const etaMs = etaMap?.get(t.id) || null;
    if (!etaMs) return;

    const lateMs = etaMs - needByMs;
    const lateByMin = lateMs > 0 ? Math.ceil(lateMs / 60000) : 0;

    risk.set(t.id, { lateByMin, etaMs, needByMs });
  });

  return risk;
}
