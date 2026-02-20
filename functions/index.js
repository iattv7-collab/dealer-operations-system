"use strict";

/**
 * functions/index.js
 * Dealer Wash System — Auth callables + Scheduler triggers (v1 style)
 *
 * Paste this whole file into: dealer-wash-system/functions/index.js
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
  const snap = await admin
    .firestore()
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
// Only works if:
// - caller is logged in as 777mlvl@gmail.com
// - AND there are currently 0 active admins in Firestore users collection
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

  await admin
    .firestore()
    .doc(`users/${user.uid}`)
    .set(
      {
        email: targetEmail,
        role: "admin",
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true, uid: user.uid, email: targetEmail };
});

// ---------- Approve pending user (Manager/Admin) ----------
// manager/admin can approve, but manager cannot grant admin
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

  // preserve existing active if present, default true
  const { claims } = await getUserClaims(uid);
  const active = claims.active !== false;

  await setClaims(uid, { role, active: true });

  await admin
    .firestore()
    .doc(`users/${uid}`)
    .set(
      {
        role,
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true };
});

// ---------- Set user role (Admin only) ----------
// includes promotion to admin, and demotion from admin, BUT:
// - cannot change your own role
// - cannot demote the last active admin
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

  // prevent self-demotion / self role edits
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot change own role.");
  }

  const { claims } = await getUserClaims(uid);
  const currentRole = claims.role || "pending";
  const currentActive = claims.active !== false;

  // if demoting an admin, ensure not last admin
  if (currentRole === "admin" && role !== "admin") {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot remove the last admin.");
    }
  }

  await setClaims(uid, { role, active: currentActive });

  await admin
    .firestore()
    .doc(`users/${uid}`)
    .set(
      {
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true };
});

// ---------- Set user active (Admin only) ----------
// can deactivate/activate users, BUT:
// - cannot deactivate self
// - cannot deactivate last active admin
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

  // prevent self-deactivate
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot deactivate self.");
  }

  const { claims } = await getUserClaims(uid);
  const role = claims.role || "pending";

  // prevent deactivating last admin
  if (role === "admin" && active === false) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot deactivate the last admin.");
    }
  }

  await setClaims(uid, { role, active });

  await admin
    .firestore()
    .doc(`users/${uid}`)
    .set(
      {
        active,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true };
});

// ---------- Delete user (Admin only) ----------
// deletes Auth user + Firestore profile, BUT:
// - cannot delete self
// - cannot delete last active admin
exports.deleteUser = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["admin"]);

  const { uid } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }

  // prevent self-delete
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot delete self.");
  }

  // check if target is an active admin in Firestore
  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const role = userDoc.exists ? userDoc.data().role || "pending" : "pending";
  const isActive = userDoc.exists ? userDoc.data().active !== false : false;

  if (role === "admin" && isActive) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot delete the last admin.");
    }
  }

  // delete Auth + Firestore
  await admin.auth().deleteUser(uid);
  await admin.firestore().doc(`users/${uid}`).delete();

  return { ok: true };
});

// =====================================================
// SCHEDULER (writes schedule fields onto washTickets)
// =====================================================

const SCHEDULER_KEYS = [
  "scheduledAtMs",
  "scheduledEndAtMs",
  "scheduledBay",
  "scheduleRisk",
  "scheduleUpdatedAtMs",
];

function minsToMs(m) {
  return Math.floor(m * 60 * 1000);
}

function clampIntLocal(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function pickMinIndex(arr) {
  let idx = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[idx]) idx = i;
  return idx;
}

function pickSecondMinValue(arr) {
  if (!arr || arr.length === 0) return Infinity;
  if (arr.length === 1) return arr[0];
  let min1 = Infinity,
    min2 = Infinity;
  for (const v of arr) {
    if (v < min1) {
      min2 = min1;
      min1 = v;
    } else if (v < min2) {
      min2 = v;
    }
  }
  return min2;
}

async function recomputeScheduleV1(reason = "unknown") {
  const db = admin.firestore();

  const settingsSnap = await db.doc("settings/system").get();
  const s = settingsSnap.exists ? settingsSnap.data() : {};

  const washDurationMin = clampIntLocal(s.washDurationMin, 1, 120, 15);
  const openBays = clampIntLocal(s.openBays, 0, 50, 1);
  const bufferMin = clampIntLocal(s.bufferMin, 0, 60, 0);

  const effectiveBays = openBays;
  const slotMs = minsToMs(washDurationMin + bufferMin);

  if (effectiveBays <= 0) {
    functions.logger.warn("Scheduler skipped: openBays is 0", { reason });
    return;
  }

  const snap = await db
    .collection("washTickets")
    .where("status", "in", ["queued", "washing"])
    .get();

  const now = Date.now();

  const tickets = [];
  snap.forEach((docSnap) => {
    const t = docSnap.data() || {};
    const pt = String(t.priorityType || "normal");
    tickets.push({
      id: docSnap.id,
      status: t.status || "queued",
      waiter: !!t.waiter,
      priorityType: pt === "waiter" ? "normal" : pt, // normalize old data
      needByAtMs: typeof t.needByAtMs === "number" ? t.needByAtMs : null,

      // if already washing
      washingStartedAtMs:
        typeof t.washingStartedAtMs === "number" ? t.washingStartedAtMs : null,
      scheduledBay: typeof t.scheduledBay === "number" ? t.scheduledBay : null,

      createdAtMs: typeof t.createdAtMs === "number" ? t.createdAtMs : now,
    });
  });

  const bayNext = Array.from({ length: effectiveBays }, () => now);

  // Lock bays for currently washing tickets
  const washing = tickets.filter((t) => t.status === "washing");
  washing.sort((a, b) => (a.washingStartedAtMs || now) - (b.washingStartedAtMs || now));

  const used = new Set();
  for (const t of washing) {
    let bay = t.scheduledBay;
    if (!bay || bay < 1 || bay > effectiveBays || used.has(bay)) {
      let found = null;
      for (let i = 1; i <= effectiveBays; i++) {
        if (!used.has(i)) {
          found = i;
          break;
        }
      }
      bay = found || 1;
    }
    used.add(bay);

    const start = t.washingStartedAtMs || now;
    const end = Math.max(now, start + slotMs);
    bayNext[bay - 1] = Math.max(bayNext[bay - 1], end);

    t._schedule = {
      scheduledBay: bay,
      scheduledAtMs: start,
      scheduledEndAtMs: end,
      scheduleRisk: "onTime",
    };
  }

  const queued = tickets.filter((t) => t.status === "queued");

  const waiters = queued
    .filter((t) => t.waiter === true)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  const needbys = queued
    .filter((t) => t.priorityType === "needby" && typeof t.needByAtMs === "number")
    .sort((a, b) => a.needByAtMs - b.needByAtMs);

  const rewash = queued
    .filter((t) => t.priorityType === "rewash")
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  const normal = queued
    .filter((t) => !t.waiter && t.priorityType !== "needby" && t.priorityType !== "rewash")
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  function needByWouldBeBrokenIfWeDoOneWaiterFirst() {
    if (needbys.length === 0) return false;
    const nb = needbys[0];

    const t0 = Math.min(...bayNext);
    const t1 = pickSecondMinValue(bayNext);

    // waiter takes earliest bay slot
    const afterWaiterEarliest = Math.min(t1, t0 + slotMs);
    const nbEndIfWaiterFirst = afterWaiterEarliest + slotMs;

    return nbEndIfWaiterFirst > nb.needByAtMs;
  }

  const scheduledQueued = [];

  while (waiters.length || needbys.length || rewash.length || normal.length) {
    let next = null;

    // Rule:
    // Waiters first ONLY if it does not break earliest Need-By promise
    if (waiters.length && needbys.length) {
      next = needByWouldBeBrokenIfWeDoOneWaiterFirst() ? needbys.shift() : waiters.shift();
    } else if (needbys.length) next = needbys.shift();
    else if (waiters.length) next = waiters.shift();
    else if (rewash.length) next = rewash.shift();
    else next = normal.shift();

    const bayIdx = pickMinIndex(bayNext);
    const start = bayNext[bayIdx];
    const end = start + slotMs;
    bayNext[bayIdx] = end;

    const risk =
      next.priorityType === "needby" && next.needByAtMs
        ? end <= next.needByAtMs
          ? "onTime"
          : "late"
        : "onTime";

    next._schedule = {
      scheduledBay: bayIdx + 1,
      scheduledAtMs: start,
      scheduledEndAtMs: end,
      scheduleRisk: risk,
    };

    scheduledQueued.push(next);
  }

  const batch = db.batch();
  const updatedAtMs = Date.now();

  for (const t of [...washing, ...scheduledQueued]) {
    const ref = db.collection("washTickets").doc(t.id);
    batch.set(
      ref,
      {
        scheduledBay: t._schedule.scheduledBay,
        scheduledAtMs: t._schedule.scheduledAtMs,
        scheduledEndAtMs: t._schedule.scheduledEndAtMs,
        scheduleRisk: t._schedule.scheduleRisk || "onTime",
        scheduleUpdatedAtMs: updatedAtMs,
      },
      { merge: true }
    );
  }

  await batch.commit();

  functions.logger.info("Scheduler updated", {
    reason,
    count: washing.length + scheduledQueued.length,
    openBays,
    washDurationMin,
    bufferMin,
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
      if (changed.length && changed.every((k) => SCHEDULER_KEYS.includes(k))) {
        return null;
      }
    }

    try {
      await recomputeScheduleV1("washTickets write");
    } catch (e) {
      functions.logger.error("Scheduler failed on washTickets write", {
        err: e?.message || String(e),
        ticketId: context.params.ticketId,
      });
      throw e;
    }

    return null;
  });

// Trigger 2: settings/system changes
exports.onSettingsSystemWrite = functions.firestore
  .document("settings/system")
  .onWrite(async () => {
    try {
      await recomputeScheduleV1("settings/system write");
    } catch (e) {
      functions.logger.error("Scheduler failed on settings/system write", {
        err: e?.message || String(e),
      });
      throw e;
    }
    return null;
  });