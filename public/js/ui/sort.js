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

function waiterPriorityMs(t) {
  if (typeof t?.washWaiterAtMs === "number" && t.washWaiterAtMs > 0) {
    return t.washWaiterAtMs;
  }

  if (typeof t?.washQueuedAtMs === "number" && t.washQueuedAtMs > 0) {
    return t.washQueuedAtMs;
  }

  return Number.MAX_SAFE_INTEGER;
}

function arrivalMs(t) {
  if (typeof t?.washQueuedAtMs === "number" && t.washQueuedAtMs > 0) {
    return t.washQueuedAtMs;
  }

  return 0;
}

function parseHHMM(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ""));
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

function windowForDay(d, opts = {}) {
  const day = d.getDay();

  let openStr = opts.mfOpen || "07:30";
  let closeStr = opts.mfClose || "19:00";

  if (day === 6) {
    openStr = opts.satOpen || "08:00";
    closeStr = opts.satClose || "15:00";
  }

  if (day === 0) {
    openStr = opts.sunOpen || "00:00";
    closeStr = opts.sunClose || "00:00";
  }

  const open = parseHHMM(openStr);
  const close = parseHHMM(closeStr);
  if (!open || !close) return null;

  const openMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), open.h, open.m, 0, 0).getTime();
  const closeMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), close.h, close.m, 0, 0).getTime();

  if (closeMs <= openMs) return null;

  return { openMs, closeMs };
}

function baysForDay(d, opts = {}, fallbackBays = 1) {
  const day = d.getDay();

  if (day === 0) return Math.max(0, Math.floor(Number(opts.sunBays || fallbackBays || 0)));
  if (day === 6) return Math.max(0, Math.floor(Number(opts.satBays || fallbackBays || 0)));

  return Math.max(0, Math.floor(Number(opts.mfBays || fallbackBays || 0)));
}

function buildCompletionSlots(count, opts = {}) {
  const slots = [];
  const minutesPerCar = Math.max(1, Number(opts.minutesPerCar) || 15);
  const slotMs = minutesPerCar * 60 * 1000;
  const fallbackBays = Math.max(1, Math.floor(Number(opts.baysOpen || opts.effectiveBays || 1)));

  let dayCursor = new Date();

  for (let dayLoop = 0; dayLoop < 14 && slots.length < count; dayLoop++) {
    const win = windowForDay(dayCursor, opts);
    const bays = baysForDay(dayCursor, opts, fallbackBays);

    if (win && bays > 0) {
      for (
        let completionMs = win.openMs + slotMs;
        completionMs <= win.closeMs && slots.length < count;
        completionMs += slotMs
      ) {
        if (completionMs <= Date.now()) continue;

        for (let b = 0; b < bays && slots.length < count; b++) {
          slots.push({
            completionMs,
            ticket: null
          });
        }
      }
    }

    dayCursor = new Date(
      dayCursor.getFullYear(),
      dayCursor.getMonth(),
      dayCursor.getDate() + 1,
      0,
      0,
      0,
      0
    );
  }

  return slots;
}

function placeLatestBefore(slots, ticket, targetMs) {
  for (let i = slots.length - 1; i >= 0; i--) {
    if (!slots[i].ticket && slots[i].completionMs <= targetMs) {
      slots[i].ticket = ticket;
      return true;
    }
  }

  return false;
}

function placeEarliest(slots, ticket) {
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i].ticket) {
      slots[i].ticket = ticket;
      return true;
    }
  }

  return false;
}

function placeEarliestFromIndex(slots, ticket, startIndex = 0) {
  for (let i = startIndex; i < slots.length; i++) {
    const current = slots[i].ticket;

    if (!current) {
      slots[i].ticket = ticket;
      return true;
    }

    if (hasNeedBy(current) || isWaiter(current)) {
      continue;
    }

    slots[i].ticket = ticket;
    return pushTicketForward(slots, current, i + 1);
  }

  slots.push({
    completionMs: slots.length
      ? slots[slots.length - 1].completionMs
      : Date.now(),
    ticket
  });

  return true;
}

function pushTicketForward(slots, ticket, startIndex = 0) {
  for (let i = startIndex; i < slots.length; i++) {
    const current = slots[i].ticket;

    if (!current) {
      slots[i].ticket = ticket;
      return true;
    }

    if (hasNeedBy(current) || isWaiter(current)) {
      continue;
    }

    slots[i].ticket = ticket;
    return pushTicketForward(slots, current, i + 1);
  }

  slots.push({
    completionMs: slots.length
      ? slots[slots.length - 1].completionMs
      : Date.now(),
    ticket
  });

  return true;
}

function basePrioritySort(a, b) {
  const aNeed = hasNeedBy(a);
  const bNeed = hasNeedBy(b);

  if (aNeed !== bNeed) return aNeed ? -1 : 1;

  if (aNeed && bNeed) {
    return (a.needByAtMs || 0) - (b.needByAtMs || 0);
  }

  const aWait = isWaiter(a);
  const bWait = isWaiter(b);

  if (aWait !== bWait) return aWait ? -1 : 1;

  if (aWait && bWait) {
    return waiterPriorityMs(a) - waiterPriorityMs(b);
  }

  const aRe = isRewash(a);
  const bRe = isRewash(b);

  if (aRe !== bRe) return aRe ? -1 : 1;

  return arrivalMs(a) - arrivalMs(b);
}

export function buildSmartWashQueue(rows, opts = {}) {
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
    .sort((a, b) => waiterPriorityMs(a) - waiterPriorityMs(b));

  const rewash = queued
    .filter((t) => !hasNeedBy(t) && !isWaiter(t) && isRewash(t))
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const regular = queued
    .filter((t) => !hasNeedBy(t) && !isWaiter(t) && !isRewash(t))
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const slots = buildCompletionSlots(queued.length, opts);

  needBy.forEach((t) => {
    placeLatestBefore(slots, t, t.needByAtMs);
  });

  waiter.forEach((t) => {
    const olderWaiterSlots = slots
      .map((slot, index) => ({ slot, index }))
      .filter((item) => item.slot.ticket && isWaiter(item.slot.ticket));

    const startIndex = olderWaiterSlots.length
      ? olderWaiterSlots[olderWaiterSlots.length - 1].index + 1
      : 0;

    placeEarliestFromIndex(slots, t, startIndex);
  });


  rewash.forEach((t) => {
    placeEarliest(slots, t);
  });

  regular.forEach((t) => {
    placeEarliest(slots, t);
  });

  return [
    ...washing,
    ...slots.map((s) => s.ticket).filter(Boolean)
  ];
}

// Keep old export for compatibility
export function sortActiveQueue(a, b) {
  return basePrioritySort(a, b);
}