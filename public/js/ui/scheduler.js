// public/js/ui/scheduler.js

/**
 * UI ETA map:
 *
 * Priority:
 *
 * 1. If wash day CLOSED → show NO ETA
 * 2. If server scheduler fields exist → use scheduledEndAtMs
 * 3. Otherwise → fallback UI scheduler using effectiveBays
 *
 */

const DEFAULT_MINUTES_PER_CAR = 15;


/* -------------------------------------------------
   ETA MAP
-------------------------------------------------- */

export function computeEtaMap(activeSorted, opts = {}) {

  const map = new Map();


  /* ---------------------------------------------
     Determine how many bays are open
  ---------------------------------------------- */

  const baysOpen =
    Number.isFinite(opts.baysOpen)
      ? Math.floor(opts.baysOpen)
      : null;


  /* ---------------------------------------------
     If wash day CLOSED → NO ETA
  ---------------------------------------------- */

  if (baysOpen !== null && baysOpen <= 0) {

    return map;

  }


  /* ---------------------------------------------
     Use SERVER scheduler ETA if present
  ---------------------------------------------- */

  let sawAnySchedulerEta = false;

  (activeSorted || []).forEach((t) => {

    if (
      typeof t?.scheduledEndAtMs === "number" &&
      t.scheduledEndAtMs > 0
    ) {

      map.set(t.id, t.scheduledEndAtMs);

      sawAnySchedulerEta = true;

    }

  });

  if (sawAnySchedulerEta) return map;


  /* ---------------------------------------------
     FALLBACK — UI scheduler
  ---------------------------------------------- */

  const minutesPerCar =
    Number.isFinite(opts.minutesPerCar) &&
    opts.minutesPerCar > 0
      ? opts.minutesPerCar
      : DEFAULT_MINUTES_PER_CAR;


  if (!baysOpen || baysOpen <= 0) {

    return map;

  }


  const slotMs = minutesPerCar * 60 * 1000;

  const now = Date.now();


  (activeSorted || []).forEach((t, i) => {

    const finishMs =
      now +
      (Math.floor(i / baysOpen) + 1) * slotMs;

    map.set(t.id, finishMs);

  });


  return map;

}



/* -------------------------------------------------
   RISK MAP
-------------------------------------------------- */

export function computeRiskMap(activeSorted, etaMap) {

  const risk = new Map();


  (activeSorted || []).forEach((t) => {

    const needByMs =
      typeof t?.needByAtMs === "number" &&
      t.needByAtMs > 0
        ? t.needByAtMs
        : null;


    if (!needByMs) return;


    const etaMs = etaMap?.get(t.id) || null;


    if (!etaMs) return;


    const lateMs = etaMs - needByMs;


    const lateByMin =
      lateMs > 0
        ? Math.ceil(lateMs / 60000)
        : 0;


    risk.set(t.id, {

      lateByMin,

      etaMs,

      needByMs

    });

  });


  return risk;

}