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

function parseHHMM(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ""));
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

function dayConfig(d, opts = {}) {
  const day = d.getDay(); // 0 Sun, 6 Sat

  if (day === 0) {
    return {
      open: opts.sunOpen || "00:00",
      close: opts.sunClose || "00:00",
      bays: Number(opts.sunBays || 0),
    };
  }

  if (day === 6) {
    return {
      open: opts.satOpen || "08:00",
      close: opts.satClose || "15:00",
      bays: Number(opts.satBays || 0),
    };
  }

  return {
    open: opts.mfOpen || "07:30",
    close: opts.mfClose || "19:00",
    bays: Number(opts.mfBays || 0),
  };
}

function windowForDate(d, opts = {}) {
  const cfg = dayConfig(d, opts);
  const open = parseHHMM(cfg.open);
  const close = parseHHMM(cfg.close);

  if (!open || !close || cfg.bays <= 0) return null;

  const openMs = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    open.h,
    open.m,
    0,
    0
  ).getTime();

  const closeMs = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    close.h,
    close.m,
    0,
    0
  ).getTime();

  if (closeMs <= openMs) return null;

  return { openMs, closeMs };
}

function nextValidStartMs(fromMs, slotMs, opts = {}) {
  let cursor = fromMs;

  for (let i = 0; i < 14; i++) {
    const d = new Date(cursor);
    const win = windowForDate(d, opts);

    if (win) {
      const start = Math.max(cursor, win.openMs);

      if (start + slotMs <= win.closeMs) {
        return start;
      }
    }

    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
    cursor = next.getTime();
  }

  return null;
}

function finishFrom(startMs, slotMs, opts = {}) {
  const validStart = nextValidStartMs(startMs, slotMs, opts);
  return validStart ? validStart + slotMs : null;
}

export function computeEtaMap(activeSorted, opts = {}) {
  const map = new Map();

  if (opts.isOpen === false) return map;

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

  const firstStart = nextValidStartMs(now, slotMs, opts);
  if (!firstStart) return map;

  const bayAvailableAt = Array.from({ length: baysOpen }, () => firstStart);

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
        : finishFrom(bayAvailableAt[bayIndex], slotMs, opts);
    } else {
      finishMs = finishFrom(bayAvailableAt[bayIndex], slotMs, opts);
    }

    if (!finishMs) return;

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