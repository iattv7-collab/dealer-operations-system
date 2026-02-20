// public/js/ui/scheduler.js

/**
 * UI ETA map:
 * ✅ Prefer server scheduler fields (scheduledEndAtMs)
 * ✅ Fallback to old UI calculation ONLY if scheduler fields are missing
 *
 * NOTE: With Option A, this file should be “mostly fallback”.
 */

const DEFAULT_MINUTES_PER_CAR = 15;

export function computeEtaMap(activeSorted, opts = {}) {
  const map = new Map();

  // ✅ FIRST: if scheduler fields exist, use them
  let sawAnySchedulerEta = false;

  (activeSorted || []).forEach((t) => {
    if (typeof t?.scheduledEndAtMs === "number" && t.scheduledEndAtMs > 0) {
      map.set(t.id, t.scheduledEndAtMs);
      sawAnySchedulerEta = true;
    }
  });

  // If at least one ticket has scheduler ETA, we assume scheduler is active.
  // For tickets missing it, leave blank (or fallback per-ticket if you want later).
  if (sawAnySchedulerEta) return map;

  // -----------------------------
  // FALLBACK (legacy UI scheduler)
  // -----------------------------
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

  (activeSorted || []).forEach((t, i) => {
    const finishMs = now + (Math.floor(i / baysOpen) + 1) * slotMs;
    map.set(t.id, finishMs);
  });

  return map;
}

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
