"use strict";

/**
 * functions/index.js
 * Dealer Wash System — Auth callables + Scheduler triggers (v1 style)
 *
 * Uses settings/system keys (Option 2):
 * - autoStart (boolean)
 * - isOpen (boolean)  // only when autoStart=false
 * - mfBays, satBays, sunBays
 * - mfOpen, mfClose, satOpen, satClose, sunOpen, sunClose  (HH:MM)
 *
 * Keeps legacy openBays as "today override" (optional).
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();

const ALLOWED_ROLES = ["admin", "manager", "advisor", "wash", "staff", "booker", "qc", "pending"];

// ---------- helpers ----------
function requireAuth(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }
}

function callerEmail(context) {
  return context.auth?.token?.email || "";
}

function callerRole(context) {
  return context.auth?.token?.role || "pending";
}

function callerActive(context) {
  return context.auth?.token?.active === true;
}

function requireActive(context) {
  if (!callerActive(context)) {
    throw new functions.https.HttpsError("permission-denied", "Account disabled.");
  }
}

function requireRole(context, allowed) {
  const r = callerRole(context);
  if (!allowed.includes(r)) {
    throw new functions.https.HttpsError("permission-denied", "Not allowed.");
  }
}

async function countActiveAdmins() {
  const snap = await admin.firestore()
    .collection("users")
    .where("role", "==", "admin")
    .where("active", "==", true)
    .get();
  return snap.size;
}

async function getUserClaims(uid) {
  const user = await admin.auth().getUser(uid);
  return { user, claims: user.customClaims || {} };
}

async function setClaims(uid, claims) {
  await admin.auth().setCustomUserClaims(uid, claims);
}

// ---------- One-time bootstrap (SAFE) ----------
exports.bootstrapAdmin = functions.https.onCall(async (data, context) => {
  requireAuth(context);

  const targetEmail = "777mlvl@gmail.com";
  if (callerEmail(context) !== targetEmail) {
    throw new functions.https.HttpsError("permission-denied", "Not allowed.");
  }

  const adminCount = await countActiveAdmins();
  if (adminCount > 0) {
    throw new functions.https.HttpsError("failed-precondition", "Admin already exists.");
  }

  const user = await admin.auth().getUserByEmail(targetEmail);

  await setClaims(user.uid, { role: "admin", active: true });

  await admin.firestore().doc(`users/${user.uid}`).set({
    email: targetEmail,
    role: "admin",
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, uid: user.uid, email: targetEmail };
});

// ---------- Approve pending user (Manager/Admin) ----------
exports.approveUser = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["manager", "admin"]);

  const { uid, role } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }
  if (!ALLOWED_ROLES.includes(role) || role === "pending") {
    throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
  }

  if (callerRole(context) === "manager" && role === "admin") {
    throw new functions.https.HttpsError("permission-denied", "Managers cannot assign admin.");
  }

  const { claims } = await getUserClaims(uid);
  const active = claims.active !== false;

  await setClaims(uid, { role, active: true });

  await admin.firestore().doc(`users/${uid}`).set({
    role,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// ---------- Set user role (Admin only) ----------
exports.setUserRole = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["admin"]);

  const { uid, role } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }
  if (!ALLOWED_ROLES.includes(role) || role === "pending") {
    throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
  }

  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot change own role.");
  }

  const { claims } = await getUserClaims(uid);
  const currentRole = claims.role || "pending";
  const currentActive = claims.active !== false;

  if (currentRole === "admin" && role !== "admin") {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot remove the last admin.");
    }
  }

  await setClaims(uid, { role, active: currentActive });

  await admin.firestore().doc(`users/${uid}`).set({
    role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// ---------- Set user active (Admin only) ----------
exports.setUserActive = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["admin"]);

  const { uid, active } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }
  if (typeof active !== "boolean") {
    throw new functions.https.HttpsError("invalid-argument", "active must be boolean.");
  }

  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot deactivate self.");
  }

  const { claims } = await getUserClaims(uid);
  const role = claims.role || "pending";

  if (role === "admin" && active === false) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot deactivate the last admin.");
    }
  }

  await setClaims(uid, { role, active });

  await admin.firestore().doc(`users/${uid}`).set({
    active,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// ---------- Delete user (Admin only) ----------
exports.deleteUser = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["admin"]);

  const { uid } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }

  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot delete self.");
  }

  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const role = userDoc.exists ? (userDoc.data().role || "pending") : "pending";
  const isActive = userDoc.exists ? (userDoc.data().active !== false) : false;

  if (role === "admin" && isActive) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot delete the last admin.");
    }
  }

  await admin.auth().deleteUser(uid);
  await admin.firestore().doc(`users/${uid}`).delete();

  return { ok: true };
});

// =====================================================
// SCHEDULER
// =====================================================

const SCHEDULER_KEYS = [
  "scheduledAtMs",
  "scheduledEndAtMs",
  "scheduledBay",
  "scheduleRisk",
  "scheduleUpdatedAtMs"
];

function minsToMs(m) {
  return Math.floor(m * 60 * 1000);
}

function clampIntLocal(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseHHMM(s) {
  const str = String(s || "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (!m) return null;
  const hh = clampIntLocal(m[1], 0, 23, 0);
  const mm = clampIntLocal(m[2], 0, 59, 0);
  return { hh, mm };
}

function pickMinIndex(arr) {
  let idx = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[idx]) idx = i;
  return idx;
}

function pickSecondMinValue(arr) {
  if (!arr || arr.length === 0) return Infinity;
  if (arr.length === 1) return arr[0];
  let min1 = Infinity, min2 = Infinity;
  for (const v of arr) {
    if (v < min1) { min2 = min1; min1 = v; }
    else if (v < min2) { min2 = v; }
  }
  return min2;
}

// Get parts for America/New_York reliably (server can run in UTC)
function nyPartsFromMs(ms) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type) => parts.find(p => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: String(get("weekday")), // Sun/Mon/...
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

// Convert NY local Y-M-D HH:MM into epoch ms
function nyLocalToMs({ year, month, day, hh, mm }) {
  // Build a string that represents the NY time, then interpret using timeZone conversion trick:
  // We do a best-effort by using Date.UTC then adjusting via Intl is messy; easiest stable approach:
  // create a Date from NY parts by formatting in that zone isn't directly possible in JS without libs.
  // So we approximate by: create a Date in UTC for same Y-M-D HH:MM, then compute delta between UTC and NY at that moment.
  const utcGuess = Date.UTC(year, month - 1, day, hh, mm, 0);
  // Find the offset between NY and UTC at that instant:
  const nyAtUtcGuess = nyPartsFromMs(utcGuess);
  // If nyAtUtcGuess matches the requested local time, we’re done; if not, adjust by the hour diff.
  // Compute "local minutes since midnight" difference:
  const want = hh * 60 + mm;
  const got = nyAtUtcGuess.hour * 60 + nyAtUtcGuess.minute;
  const diffMin = got - want;
  return utcGuess - diffMin * 60 * 1000;
}

function dayTypeFromWeekdayShort(wd) {
  // wd: Sun Mon Tue Wed Thu Fri Sat
  if (wd === "Sat") return "sat";
  if (wd === "Sun") return "sun";
  return "mf";
}

function getDayConfig(s, dayType) {
  if (dayType === "sat") {
    return { bays: s.satBays, open: s.satOpen, close: s.satClose };
  }
  if (dayType === "sun") {
    return { bays: s.sunBays, open: s.sunOpen, close: s.sunClose };
  }
  return { bays: s.mfBays, open: s.mfOpen, close: s.mfClose };
}

function isWithinWindow(nowMinutes, openHHMM, closeHHMM) {
  const o = parseHHMM(openHHMM);
  const c = parseHHMM(closeHHMM);
  if (!o || !c) return false;
  const oMin = o.hh * 60 + o.mm;
  const cMin = c.hh * 60 + c.mm;
  if (oMin === cMin) return false; // closed
  // assume same-day window (no overnight windows)
  return nowMinutes >= oMin && nowMinutes < cMin;
}

async function recomputeScheduleV1(reason = "unknown") {
  const db = admin.firestore();
  const settingsSnap = await db.doc("settings/system").get();
  const raw = settingsSnap.exists ? settingsSnap.data() : {};

  // wash timing
  const washDurationMin = clampIntLocal(raw.washDurationMin, 1, 120, 15);
  const bufferMin = clampIntLocal(raw.bufferMin, 0, 60, 0);
  const slotMs = minsToMs(washDurationMin + bufferMin);

  // mode
  const autoStart = typeof raw.autoStart === "boolean" ? raw.autoStart : true;
  const isOpen = typeof raw.isOpen === "boolean" ? raw.isOpen : true;

  // bays by day
  const mfBays = clampIntLocal(raw.mfBays, 0, 50, 2);
  const satBays = clampIntLocal(raw.satBays, 0, 50, 1);
  const sunBays = clampIntLocal(raw.sunBays, 0, 50, 0);

  // hours (HH:MM strings)
  const mfOpen = String(raw.mfOpen || "07:30");
  const mfClose = String(raw.mfClose || "19:00");
  const satOpen = String(raw.satOpen || "08:00");
  const satClose = String(raw.satClose || "15:00");
  const sunOpen = String(raw.sunOpen || "00:00");
  const sunClose = String(raw.sunClose || "00:00");

  // legacy/override: openBays today only
  const openBaysOverride = clampIntLocal(raw.openBays, 0, 50, 0);

  const now = Date.now();
  const nyNow = nyPartsFromMs(now);
  const nowMinutes = nyNow.hour * 60 + nyNow.minute;
  const todayType = dayTypeFromWeekdayShort(nyNow.weekday);

  const cfgToday = getDayConfig({ mfBays, satBays, sunBays, mfOpen, mfClose, satOpen, satClose, sunOpen, sunClose }, todayType);
  const dayBays = clampIntLocal(cfgToday.bays, 0, 50, 0);
  const effectiveBays = openBaysOverride > 0 ? openBaysOverride : dayBays;

  // Determine scheduling anchor
  let anchorMs = null;

  if (!autoStart) {
    // Manual mode: only schedule queued cars when supervisor opened the day
    if (!isOpen) {
      functions.logger.info("Scheduler manual mode: CLOSED (queued schedule cleared)", { reason });
      anchorMs = null;
    } else {
      anchorMs = now;
    }
  } else {
    // Auto mode: schedule only during open window; otherwise start at next open time
    const openNow = isWithinWindow(nowMinutes, cfgToday.open, cfgToday.close) && effectiveBays > 0;

    if (openNow) {
      anchorMs = now;
    } else {
      // find next open day within next 7 days
      let found = null;
      let cursorMs = now;
      for (let i = 0; i < 8; i++) {
        const p = nyPartsFromMs(cursorMs);
        const type = dayTypeFromWeekdayShort(p.weekday);

        const cfg = getDayConfig({ mfBays, satBays, sunBays, mfOpen, mfClose, satOpen, satClose, sunOpen, sunClose }, type);
        const bays = clampIntLocal(cfg.bays, 0, 50, 0);
        const o = parseHHMM(cfg.open);
        const c = parseHHMM(cfg.close);

        if (bays > 0 && o && c && (o.hh * 60 + o.mm) !== (c.hh * 60 + c.mm)) {
          // candidate open time for that local day
          const openMs = nyLocalToMs({ year: p.year, month: p.month, day: p.day, hh: o.hh, mm: o.mm });
          if (openMs > now) { found = openMs; break; }
        }

        // advance cursor by 24h
        cursorMs += 24 * 60 * 60 * 1000;
      }

      anchorMs = found; // could be null if closed all week
    }
  }

  // If no bays or no anchor (manual closed / fully closed), we still keep washing tickets stable,
  // but we clear queued schedule so ETAs don't look fake overnight.
  const snap = await db.collection("washTickets")
    .where("status", "in", ["queued", "washing"])
    .get();

  const tickets = [];
  snap.forEach((docSnap) => {
    const t = docSnap.data() || {};
    const pt = String(t.priorityType || "normal");
    tickets.push({
      id: docSnap.id,
      status: t.status || "queued",
      waiter: !!t.waiter,
      priorityType: (pt === "waiter" ? "normal" : pt),
      needByAtMs: typeof t.needByAtMs === "number" ? t.needByAtMs : null,

      washingStartedAtMs: typeof t.washingStartedAtMs === "number" ? t.washingStartedAtMs : null,
      scheduledBay: typeof t.scheduledBay === "number" ? t.scheduledBay : null,
      createdAtMs: typeof t.createdAtMs === "number" ? t.createdAtMs : now,
    });
  });

  const washing = tickets.filter(t => t.status === "washing");

  // Always lock bays for currently washing tickets (even if closed)
  // If effectiveBays is 0, we still assign bay=1 for washing tickets to avoid nulls.
  const baysForWashing = Math.max(1, effectiveBays || 1);
  const bayNext = Array.from({ length: baysForWashing }, () => Math.max(now, anchorMs || now));

  washing.sort((a, b) => (a.washingStartedAtMs || now) - (b.washingStartedAtMs || now));

  const used = new Set();
  for (const t of washing) {
    let bay = t.scheduledBay;
    if (!bay || bay < 1 || bay > baysForWashing || used.has(bay)) {
      let found = null;
      for (let i = 1; i <= baysForWashing; i++) if (!used.has(i)) { found = i; break; }
      bay = found || 1;
    }
    used.add(bay);

    const start = t.washingStartedAtMs || now;
    const end = Math.max(now, start + slotMs);
    bayNext[bay - 1] = Math.max(bayNext[bay - 1], end);

    t._schedule = { scheduledBay: bay, scheduledAtMs: start, scheduledEndAtMs: end, scheduleRisk: "onTime" };
  }

  const batch = db.batch();
  const updatedAtMs = Date.now();

  // Write washing schedules always
  for (const t of washing) {
    const ref = db.collection("washTickets").doc(t.id);
    batch.set(ref, {
      scheduledBay: t._schedule.scheduledBay,
      scheduledAtMs: t._schedule.scheduledAtMs,
      scheduledEndAtMs: t._schedule.scheduledEndAtMs,
      scheduleRisk: t._schedule.scheduleRisk || "onTime",
      scheduleUpdatedAtMs: updatedAtMs
    }, { merge: true });
  }

  // If manual closed OR no anchor OR no effective bays: clear queued schedule fields
  const queued = tickets.filter(t => t.status === "queued");

  if (!anchorMs || effectiveBays <= 0) {
    for (const t of queued) {
      const ref = db.collection("washTickets").doc(t.id);
      batch.set(ref, {
        scheduledBay: admin.firestore.FieldValue.delete(),
        scheduledAtMs: admin.firestore.FieldValue.delete(),
        scheduledEndAtMs: admin.firestore.FieldValue.delete(),
        scheduleRisk: "closed",
        scheduleUpdatedAtMs: updatedAtMs
      }, { merge: true });
    }

    await batch.commit();
    functions.logger.info("Scheduler updated (closed/no-anchor)", {
      reason,
      countWashing: washing.length,
      countQueuedCleared: queued.length,
      effectiveBays,
      autoStart,
      isOpen,
      anchorMs
    });
    return;
  }

  // Normal scheduling for queued tickets
  const waiters = queued.filter(t => t.waiter === true).sort((a, b) => a.createdAtMs - b.createdAtMs);
  const needbys = queued
    .filter(t => t.priorityType === "needby" && typeof t.needByAtMs === "number")
    .sort((a, b) => a.needByAtMs - b.needByAtMs);
  const rewash = queued.filter(t => t.priorityType === "rewash").sort((a, b) => a.createdAtMs - b.createdAtMs);
  const normal = queued
    .filter(t => !t.waiter && t.priorityType !== "needby" && t.priorityType !== "rewash")
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  function needByWouldBeBrokenIfWeDoOneWaiterFirst() {
    if (needbys.length === 0) return false;
    const nb = needbys[0];

    const t0 = Math.min(...bayNext);
    const t1 = pickSecondMinValue(bayNext);

    const afterWaiterEarliest = Math.min(t1, t0 + slotMs);
    const nbEndIfWaiterFirst = afterWaiterEarliest + slotMs;

    return nbEndIfWaiterFirst > nb.needByAtMs;
  }

  const scheduledQueued = [];

  while (waiters.length || needbys.length || rewash.length || normal.length) {
    let next = null;

    if (waiters.length && needbys.length) {
      next = needByWouldBeBrokenIfWeDoOneWaiterFirst() ? needbys.shift() : waiters.shift();
    } else if (needbys.length) next = needbys.shift();
    else if (waiters.length) next = waiters.shift();
    else if (rewash.length) next = rewash.shift();
    else next = normal.shift();

    const bayIdx = pickMinIndex(bayNext);
    const start = Math.max(bayNext[bayIdx], anchorMs);
    const end = start + slotMs;
    bayNext[bayIdx] = end;

    const risk = (next.priorityType === "needby" && next.needByAtMs)
      ? (end <= next.needByAtMs ? "onTime" : "late")
      : "onTime";

    next._schedule = {
      scheduledBay: bayIdx + 1,
      scheduledAtMs: start,
      scheduledEndAtMs: end,
      scheduleRisk: risk
    };

    scheduledQueued.push(next);
  }

  for (const t of scheduledQueued) {
    const ref = db.collection("washTickets").doc(t.id);
    batch.set(ref, {
      scheduledBay: t._schedule.scheduledBay,
      scheduledAtMs: t._schedule.scheduledAtMs,
      scheduledEndAtMs: t._schedule.scheduledEndAtMs,
      scheduleRisk: t._schedule.scheduleRisk || "onTime",
      scheduleUpdatedAtMs: updatedAtMs
    }, { merge: true });
  }

  await batch.commit();

  functions.logger.info("Scheduler updated", {
    reason,
    count: washing.length + scheduledQueued.length,
    effectiveBays,
    washDurationMin,
    bufferMin,
    autoStart,
    isOpen,
    anchorMs,
    todayType
  });
}

// Trigger 1: washTickets changes
exports.onWashTicketWrite = functions.firestore
  .document("washTickets/{ticketId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return null;

    // loop guard: if ONLY scheduler fields changed, ignore
    if (before) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      const changed = [];
      for (const k of keys) {
        const a = JSON.stringify(before[k]);
        const b = JSON.stringify(after[k]);
        if (a !== b) changed.push(k);
      }
      if (changed.length && changed.every(k => SCHEDULER_KEYS.includes(k))) {
        return null;
      }
    }

    await recomputeScheduleV1("washTickets write");
    return null;
  });

// Trigger 2: settings/system changes
exports.onSettingsSystemWrite = functions.firestore
  .document("settings/system")
  .onWrite(async () => {
    await recomputeScheduleV1("settings/system write");
    return null;
  });