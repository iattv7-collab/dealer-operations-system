// public/js/ui/sort.js

function isWaiter(t) {
  return t?.customerWaiting === true;
}

function hasNeedBy(t) {
  if (isWaiter(t)) return false;
  return typeof t?.needByAtMs === "number" && t.needByAtMs > 0;
}

function isRewash(t) {
  return String(t?.priorityType || "").toLowerCase() === "rewash";
}

function arrivalMs(t) {
  if (typeof t?.washQueuedAtMs === "number" && t.washQueuedAtMs > 0) {
    return t.washQueuedAtMs;
  }

  return 0;
}

function finishTimes(rows, baysOpen, slotMs) {
  const out = new Map();
  const bayAvailable = Array.from({ length: baysOpen }, () => Date.now());

  rows.forEach((t) => {
    let bayIndex = 0;

    for (let i = 1; i < bayAvailable.length; i++) {
      if (bayAvailable[i] < bayAvailable[bayIndex]) bayIndex = i;
    }

    const start = bayAvailable[bayIndex];
    const finish = start + slotMs;

    bayAvailable[bayIndex] = finish;
    out.set(t.id, finish);
  });

  return out;
}

function needByStillProtected(rows, baysOpen, slotMs) {
  const finishes = finishTimes(rows, baysOpen, slotMs);

  return rows.every((t) => {
    if (!hasNeedBy(t)) return true;
    const finish = finishes.get(t.id);
    return finish && finish <= t.needByAtMs;
  });
}

function basePrioritySort(a, b) {
  const aNeed = hasNeedBy(a);
  const bNeed = hasNeedBy(b);

  if (aNeed !== bNeed) return aNeed ? -1 : 1;

  if (aNeed && bNeed) {
    return (a.needByAtMs || 0) - (b.needByAtMs || 0);
  }

  const aRe = isRewash(a);
  const bRe = isRewash(b);
  if (aRe !== bRe) return aRe ? -1 : 1;

  return arrivalMs(a) - arrivalMs(b);
}

export function buildSmartWashQueue(rows, opts = {}) {
  const baysOpen = Math.max(1, Math.floor(Number(opts.baysOpen) || 1));
  const minutesPerCar = Math.max(1, Number(opts.minutesPerCar) || 15);
  const slotMs = minutesPerCar * 60 * 1000;

  const active = Array.isArray(rows) ? rows.slice() : [];

  const washing = active
    .filter((t) => String(t.status || "").toLowerCase() === "washing")
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const queued = active
    .filter((t) => String(t.status || "").toLowerCase() !== "washing");

  const needBy = queued
    .filter(hasNeedBy)
    .sort((a, b) => (a.needByAtMs || 0) - (b.needByAtMs || 0));

  const waiter = queued
    .filter((t) => !hasNeedBy(t) && isWaiter(t))
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const rewash = queued
    .filter((t) => !hasNeedBy(t) && !isWaiter(t) && isRewash(t))
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const regular = queued
    .filter((t) => !hasNeedBy(t) && !isWaiter(t) && !isRewash(t))
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  let queue = [...washing, ...needBy];

  waiter.forEach((w) => {
    let inserted = false;

    for (let i = washing.length; i <= queue.length; i++) {
      const test = queue.slice();
      test.splice(i, 0, w);

      if (needByStillProtected(test, baysOpen, slotMs)) {
        queue = test;
        inserted = true;
        break;
      }
    }

    if (!inserted) queue.push(w);
  });

  queue.push(...rewash, ...regular);

  return queue;
}

// Keep old export for compatibility
export function sortActiveQueue(a, b) {
  return basePrioritySort(a, b);
}