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
const cors = require("cors")({ origin: true });
const Busboy = require("busboy");
const vision = require("@google-cloud/vision");
const sharp = require("sharp");

admin.initializeApp();
const visionClient = new vision.ImageAnnotatorClient();

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
// RO TRACKER PUSH NOTIFICATIONS
// =====================================================

exports.followUpScheduler = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("America/New_York")
  .onRun(async () => {

    const db = admin.firestore();
    const now = Date.now();

    const settingsRef = db.doc("privateSettings/me");
    const settingsSnap = await settingsRef.get();
    if (!settingsSnap.exists) return null;

    const settings = settingsSnap.data() || {};

    const tokens = Array.isArray(settings.fcmTokens) && settings.fcmTokens.length
      ? settings.fcmTokens
      : [];

    functions.logger.info("Push tokens:", tokens);

    if (!tokens.length) return null;

    // =========================
    // TEST PUSH (instant)
    // =========================
    if (settings.followUpTestAtMs) {
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: "Test Notification",
          body: "Push is working ✅"
        }
      });

      await settingsRef.set({
        followUpTestAtMs: null,
        followUpTestRequestedAtMs: admin.firestore.FieldValue.delete(),
        followUpLastTestSentAtMs: now
      }, { merge: true });

      return null;
    }

    // =========================
    // ARCHIVE / FOLLOW-UP PUSH
    // =========================
    const snap = await db.collection("followup").get();

    for (const docSnap of snap.docs) {
      const d = docSnap.data() || {};

      if (
        d.pushAfterArchiveAtMs &&
        d.pushAfterArchiveAtMs <= now &&
        !d.pushAfterArchiveSentAtMs
      ) {
        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: "Follow Up Reminder",
            body: `RO ${d.ro || docSnap.id} needs follow-up`
          },
          data: {
            url: `/ro/index.html?fu=1&ro=${encodeURIComponent(String(d.ro || docSnap.id))}&slot=archive`
          }
        });

        await docSnap.ref.set({
          pushAfterArchiveSentAtMs: now
        }, { merge: true });

        break;
      }
    }

    return null;
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
    weekday: String(get("weekday")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

// Convert NY local Y-M-D HH:MM into epoch ms
function nyLocalToMs({ year, month, day, hh, mm }) {
  const utcGuess = Date.UTC(year, month - 1, day, hh, mm, 0);
  const nyAtUtcGuess = nyPartsFromMs(utcGuess);
  const want = hh * 60 + mm;
  const got = nyAtUtcGuess.hour * 60 + nyAtUtcGuess.minute;
  const diffMin = got - want;
  return utcGuess - diffMin * 60 * 1000;
}

function dayTypeFromWeekdayShort(wd) {
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
  if (oMin === cMin) return false;
  return nowMinutes >= oMin && nowMinutes < cMin;
}

async function recomputeScheduleV1(reason = "unknown") {
  const db = admin.firestore();
  const settingsSnap = await db.doc("settings/system").get();
  const raw = settingsSnap.exists ? settingsSnap.data() : {};

  const washDurationMin = clampIntLocal(raw.washDurationMin, 1, 120, 15);
  const bufferMin = clampIntLocal(raw.bufferMin, 0, 60, 0);
  const slotMs = minsToMs(washDurationMin + bufferMin);

  const autoStart = typeof raw.autoStart === "boolean" ? raw.autoStart : true;
  const isOpen = typeof raw.isOpen === "boolean" ? raw.isOpen : true;

  const mfBays = clampIntLocal(raw.mfBays, 0, 50, 2);
  const satBays = clampIntLocal(raw.satBays, 0, 50, 1);
  const sunBays = clampIntLocal(raw.sunBays, 0, 50, 0);

  const mfOpen = String(raw.mfOpen || "07:30");
  const mfClose = String(raw.mfClose || "19:00");
  const satOpen = String(raw.satOpen || "08:00");
  const satClose = String(raw.satClose || "15:00");
  const sunOpen = String(raw.sunOpen || "00:00");
  const sunClose = String(raw.sunClose || "00:00");

  const openBaysOverride = clampIntLocal(raw.openBays, 0, 50, 0);

  const now = Date.now();
  const nyNow = nyPartsFromMs(now);
  const nowMinutes = nyNow.hour * 60 + nyNow.minute;
  const todayType = dayTypeFromWeekdayShort(nyNow.weekday);

  const cfgToday = getDayConfig(
    { mfBays, satBays, sunBays, mfOpen, mfClose, satOpen, satClose, sunOpen, sunClose },
    todayType
  );
  const dayBays = clampIntLocal(cfgToday.bays, 0, 50, 0);
  const effectiveBays = openBaysOverride > 0 ? openBaysOverride : dayBays;

  let anchorMs = null;

  if (!autoStart) {
    if (!isOpen) {
      functions.logger.info("Scheduler manual mode: CLOSED (queued schedule cleared)", { reason });
      anchorMs = null;
    } else {
      anchorMs = now;
    }
  } else {
    const openNow = isWithinWindow(nowMinutes, cfgToday.open, cfgToday.close) && effectiveBays > 0;

    if (openNow) {
      anchorMs = now;
    } else {
      let found = null;
      let cursorMs = now;
      for (let i = 0; i < 8; i++) {
        const p = nyPartsFromMs(cursorMs);
        const type = dayTypeFromWeekdayShort(p.weekday);

        const cfg = getDayConfig(
          { mfBays, satBays, sunBays, mfOpen, mfClose, satOpen, satClose, sunOpen, sunClose },
          type
        );
        const bays = clampIntLocal(cfg.bays, 0, 50, 0);
        const o = parseHHMM(cfg.open);
        const c = parseHHMM(cfg.close);

        if (bays > 0 && o && c && (o.hh * 60 + o.mm) !== (c.hh * 60 + c.mm)) {
          const openMs = nyLocalToMs({ year: p.year, month: p.month, day: p.day, hh: o.hh, mm: o.mm });
          if (openMs > now) { found = openMs; break; }
        }

        cursorMs += 24 * 60 * 60 * 1000;
      }

      anchorMs = found;
    }
  }

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

// =====================================================
// SCAN RO
// =====================================================

exports.scanRO = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Use POST" });
    }

    try {
      const fileBuffer = await readUpload(req);

      if (!fileBuffer || !fileBuffer.length) {
        return res.status(400).json({ ok: false, error: "Missing file" });
      }

      const [ocrResult] = await visionClient.documentTextDetection({
        image: { content: fileBuffer }
      });

      const rawText =
        ocrResult.fullTextAnnotation?.text ||
        (ocrResult.textAnnotations && ocrResult.textAnnotations[0]?.description) ||
        "";

      // zone OCR for the center info box
      const meta = await sharp(fileBuffer).metadata();

      const zoneBuffer = await sharp(fileBuffer)
        .extract({
          left: Math.floor((meta.width || 0) * 0.18),
          top: Math.floor((meta.height || 0) * 0.24),
          width: Math.floor((meta.width || 0) * 0.52),
          height: Math.floor((meta.height || 0) * 0.34),
        })
        .toBuffer();

      const [zoneResult] = await visionClient.documentTextDetection({
        image: { content: zoneBuffer }
      });

      const zoneText =
        zoneResult.fullTextAnnotation?.text ||
        (zoneResult.textAnnotations && zoneResult.textAnnotations[0]?.description) ||
        "";

      const parsed = parseReynoldsRO(rawText, zoneText);

      return res.json({
        ok: true,
        pass: parsed.missingRequired.length === 0,
        rawText,
        data: parsed.data,
        missingRequired: parsed.missingRequired
      });
    } catch (err) {
      console.error("scanRO error:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Server error"
      });
    }
  });
});



function readUpload(req) {
  return new Promise((resolve, reject) => {
    try {
      const busboy = Busboy({ headers: req.headers });
      const chunks = [];
      let fileFound = false;

      busboy.on("file", (_fieldname, file) => {
        fileFound = true;
        file.on("data", chunk => chunks.push(chunk));
        file.on("end", () => { });
      });

      busboy.on("finish", () => {
        if (!fileFound) return resolve(null);
        resolve(Buffer.concat(chunks));
      });

      busboy.on("error", reject);

      if (req.rawBody) {
        busboy.end(req.rawBody);
      } else {
        req.pipe(busboy);
      }
    } catch (err) {
      reject(err);
    }
  });
}

function parseReynoldsRO(rawText, zoneText = "") {
  const text = normalizeText(rawText);
  const lines = text
    .split("\n")
    .map(line => cleanupSpacing(line))
    .filter(Boolean);
  const zoneLines = normalizeText(zoneText)
    .split("\n")
    .map(line => cleanupSpacing(line))
    .filter(Boolean);

  const data = {
    roNumber: extractRoNumber(lines, text),
    tagNumber: extractTagNumber(lines),
    customerName: extractCustomerName(lines),
    cellPhone: extractCellPhone(lines),
    yearModel: extractYearModel(lines),
    concern: extractConcern(lines),
    roDate: extractRoDate(lines),
    promiseDate: extractPromiseDateOnly(lines),
    advisor: "",
    vin: extractVin(lines),
    confidenceHint: ""
  };

  function extractPromiseDateOnly(linesArg) {
    const full = extractPromiseDate(linesArg);
    const d = normalizeDateToken(full);
    return d || "";
  }

  const missingRequired = [];
  if (!data.roNumber) missingRequired.push("roNumber");
  if (!data.tagNumber) missingRequired.push("tagNumber");
  if (!data.customerName) missingRequired.push("customerName");

  return { data, missingRequired };
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[|]/g, "I")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function cleanupSpacing(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function findPhone(text) {
  const m = String(text || "").match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (!m) return "";
  return digitsOnly(m[0]);
}

function looksLikePhoneLine(line) {
  return /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(String(line || ""));
}

function looksLikeAddress(line) {
  const text = String(line || "");
  return /\b(ST|AVE|AVENUE|ROAD|RD|DR|DRIVE|BLVD|COURT|CT|LANE|LN|WAY|FL|DAVIE|MIAMI|APT|UNIT)\b/i.test(text) ||
    /\b\d{3,6}\b/.test(text);
}

function cleanupName(name) {
  return cleanupSpacing(String(name || "").replace(/[^A-Za-z0-9.' -]/g, "").trim());
}

function looksLikePersonName(s) {
  if (!s) return false;

  const clean = cleanupSpacing(s);

  // reject obvious junk
  if (/^\d+$/.test(clean)) return false;
  if (/^(YES|NO|Y|N)$/i.test(clean)) return false;
  if (/^(RN|CMCMCU)$/i.test(clean)) return false;

  // must have at least 2 words (first + last name)
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;

  // each word should be letters (basic check)
  if (!parts.every(p => /^[A-Za-z.'-]+$/.test(p))) return false;

  return true;
}

function looksLikeVIN(line) {
  return /\b[A-HJ-NPR-Z0-9]{17}\b/.test(String(line || ""));
}

function normalizeDateToken(value) {
  const m = String(value || "").match(/\b(\d{2})\/(\d{2})\/(\d{2,4})\b/);
  return m ? m[0] : "";
}

function normalizeTimeToken(value) {
  const m = String(value || "").match(/\b\d{1,2}:\d{2}\s*[ap]m\b/i);
  return m ? cleanupSpacing(m[0]).replace(/\s+/g, "") : "";
}

function getVinBlock(lines) {
  const vinIdx = lines.findIndex(line => looksLikeVIN(line));
  if (vinIdx < 0) return [];
  return lines.slice(vinIdx, Math.min(lines.length, vinIdx + 18));
}

function extractRoNumber(lines, text) {
  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);

    let m = line.match(/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?\s*[:.]?\s*(\d{5,8})/i);
    if (m) return m[1];

    if (/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?/i.test(line)) {
      for (let j = 1; j <= 4; j++) {
        const next = cleanupSpacing(lines[i + j] || "");
        if (!next) continue;

        m = next.match(/\b(\d{5,8})\b/);
        if (m) return m[1];
      }

      const joined = [line, lines[i + 1] || "", lines[i + 2] || "", lines[i + 3] || ""].join(" ");
      m = joined.match(/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?\s*[:.]?\s*(\d{5,8})/i);
      if (m) return m[1];
    }
  }

  const vinBlock = getVinBlock(lines);
  if (vinBlock.length) {
    for (let i = 0; i < vinBlock.length; i++) {
      const line = cleanupSpacing(vinBlock[i]);

      let m = line.match(/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?\s*[:.]?\s*(\d{5,8})/i);
      if (m) return m[1];

      if (/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?/i.test(line)) {
        for (let j = 1; j <= 4; j++) {
          const next = cleanupSpacing(vinBlock[i + j] || "");
          if (!next) continue;

          m = next.match(/\b(\d{5,8})\b/);
          if (m) return m[1];
        }
      }
    }
  }

  const allMatches = text.match(/\b\d{5,8}\b/g) || [];
  return allMatches.length ? allMatches[0] : "";
}



function extractTagNumber(lines) {
  function isGoodTagCandidate(s) {
    const t = cleanupSpacing(s || "");
    if (!/^\d{3,6}$/.test(t)) return false;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return false;
    if (t.includes(",")) return false;
    return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);

    let m = line.match(/TAG\s*(?:NO|#)\s*[:.]?\s*(\d{2,10})/i);
    if (m) return m[1];

    if (/TAG\s*(?:NO|#)/i.test(line)) {
      for (let j = 1; j <= 8; j++) {
        const next = cleanupSpacing(lines[i + j] || "");
        if (!next) continue;

        if (isGoodTagCandidate(next)) return next;

        m = next.match(/\b(\d{3,6})\b/);
        if (m && isGoodTagCandidate(m[1])) return m[1];

        if (/ADVISOR\s*NO|ADVISOR/i.test(next)) break;
      }
    }
  }

  const vinBlock = getVinBlock(lines);
  if (vinBlock.length) {
    for (let i = 0; i < vinBlock.length; i++) {
      const line = cleanupSpacing(vinBlock[i]);

      let m = line.match(/TAG\s*(?:NO|#)\s*[:.]?\s*(\d{2,10})/i);
      if (m) return m[1];

      if (/TAG\s*(?:NO|#)/i.test(line)) {
        for (let j = 1; j <= 8; j++) {
          const next = cleanupSpacing(vinBlock[i + j] || "");
          if (!next) continue;

          if (isGoodTagCandidate(next)) return next;

          m = next.match(/\b(\d{3,6})\b/);
          if (m && isGoodTagCandidate(m[1])) return m[1];

          if (/ADVISOR\s*NO|ADVISOR/i.test(next)) break;
        }
      }
    }
  }

  return "";
}

async function decodeVin(vin) {
  try {
    const clean = String(vin || "").trim();
    if (clean.length !== 17) return null;

    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${clean}?format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const json = await res.json();
    const row = json?.Results?.[0];
    if (!row) return null;

    return {
      year: row.ModelYear || "",
      make: row.Make || "",
      model: row.Model || ""
    };
  } catch {
    return null;
  }
}

// =====================================================
// SCAN RO
// =====================================================

exports.scanRO = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Use POST" });
    }

    try {
      const fileBuffer = await readUpload(req);

      if (!fileBuffer || !fileBuffer.length) {
        return res.status(400).json({ ok: false, error: "Missing file" });
      }

      const [ocrResult] = await visionClient.documentTextDetection({
        image: { content: fileBuffer }
      });

      const rawText =
        ocrResult.fullTextAnnotation?.text ||
        (ocrResult.textAnnotations && ocrResult.textAnnotations[0]?.description) ||
        "";

      const parsed = parseReynoldsRO(rawText);
      const vin = parsed?.data?.vin || "";

      if (vin) {
        const decoded = await decodeVin(vin);
        if (decoded) {
          parsed.data.yearModel =
            `${decoded.year} ${decoded.make} ${decoded.model}`.trim();
        }
      }

      return res.json({
        ok: true,
        pass: parsed.missingRequired.length === 0,
        rawText,
        data: parsed.data,
        missingRequired: parsed.missingRequired
      });
    } catch (err) {
      console.error("scanRO error:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Server error"
      });
    }
  });
});

function readUpload(req) {
  return new Promise((resolve, reject) => {
    try {
      const busboy = Busboy({ headers: req.headers });
      const chunks = [];
      let fileFound = false;

      busboy.on("file", (_fieldname, file) => {
        fileFound = true;
        file.on("data", chunk => chunks.push(chunk));
        file.on("end", () => { });
      });

      busboy.on("finish", () => {
        if (!fileFound) return resolve(null);
        resolve(Buffer.concat(chunks));
      });

      busboy.on("error", reject);

      if (req.rawBody) {
        busboy.end(req.rawBody);
      } else {
        req.pipe(busboy);
      }
    } catch (err) {
      reject(err);
    }
  });
}

function parseReynoldsRO(rawText) {
  const text = normalizeText(rawText);
  const lines = text
    .split("\n")
    .map(line => cleanupSpacing(line))
    .filter(Boolean);

  const data = {
    roNumber: extractRoNumber(lines, text),
    tagNumber: extractTagNumber(lines),
    customerName: extractCustomerName(lines),
    cellPhone: extractCellPhone(lines),
    yearModel: extractYearModel(lines),
    concern: extractConcern(lines),
    roDate: extractRoDate(lines),
    promiseDate: extractPromiseDateOnly(lines),
    advisorNo: extractAdvisorNo(lines),
    advisor: extractAdvisor(lines),
    vin: extractVin(lines),
    confidenceHint: ""
  };

  function extractPromiseDateOnly(linesArg) {
    const full = extractPromiseDate(linesArg);
    const d = normalizeDateToken(full);
    return d || "";
  }

  const missingRequired = [];
  if (!data.roNumber) missingRequired.push("roNumber");
  if (!data.tagNumber) missingRequired.push("tagNumber");
  if (!data.customerName) missingRequired.push("customerName");

  return { data, missingRequired };
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[|]/g, "I")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function cleanupSpacing(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function findPhone(text) {
  const m = String(text || "").match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (!m) return "";
  return digitsOnly(m[0]);
}

function looksLikePhoneLine(line) {
  return /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(String(line || ""));
}

function looksLikeAddress(line) {
  const text = String(line || "");
  return /\b(ST|AVE|AVENUE|ROAD|RD|DR|DRIVE|BLVD|COURT|CT|LANE|LN|WAY|FL|DAVIE|MIAMI|APT|UNIT)\b/i.test(text) ||
    /\b\d{3,6}\b/.test(text);
}

function cleanupName(name) {
  return cleanupSpacing(String(name || "").replace(/[^A-Za-z0-9.' -]/g, "").trim());
}

function looksLikePersonName(line) {
  const text = cleanupSpacing(String(line || ""));
  if (!text) return false;
  if (text.length < 4 || text.length > 40) return false;
  if (/\d{2,}/.test(text)) return false;
  if (looksLikeAddress(text)) return false;

  const words = text.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;

  const goodWords = words.filter(w => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
  return goodWords.length >= 2;
}

function looksLikeVIN(line) {
  return /\b[A-HJ-NPR-Z0-9]{17}\b/.test(String(line || ""));
}

function normalizeDateToken(value) {
  const m = String(value || "").match(/\b(\d{2})\/(\d{2})\/(\d{2,4})\b/);
  return m ? m[0] : "";
}

function normalizeTimeToken(value) {
  const m = String(value || "").match(/\b\d{1,2}:\d{2}\s*[ap]m\b/i);
  return m ? cleanupSpacing(m[0]).replace(/\s+/g, "") : "";
}

function getVinBlock(lines) {
  const vinIdx = lines.findIndex(line => looksLikeVIN(line));
  if (vinIdx < 0) return [];
  return lines.slice(vinIdx, Math.min(lines.length, vinIdx + 18));
}

function extractRoNumber(lines, text) {
  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);

    let m = line.match(/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?\s*[:.]?\s*(\d{5,8})/i);
    if (m) return m[1];

    if (/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?/i.test(line)) {
      for (let j = 1; j <= 6; j++) {
        const next = cleanupSpacing(lines[i + j] || "");
        if (!next) continue;

        m = next.match(/^\d{5,8}$/);
        if (m) return m[0];
      }
    }
  }

  const vinBlock = getVinBlock(lines);
  if (vinBlock.length) {
    for (let i = 0; i < vinBlock.length; i++) {
      const line = cleanupSpacing(vinBlock[i]);

      let m = line.match(/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?\s*[:.]?\s*(\d{5,8})/i);
      if (m) return m[1];

      if (/R\.?\s*O\.?\s*(?:NO|#|NUMBER)\.?/i.test(line)) {
        for (let j = 1; j <= 6; j++) {
          const next = cleanupSpacing(vinBlock[i + j] || "");
          if (!next) continue;

          m = next.match(/^\d{5,8}$/);
          if (m) return m[0];
        }
      }
    }
  }

  return "";
}

function extractTagNumber(lines) {
  function isGoodTagCandidate(s) {
    const t = cleanupSpacing(s || "");
    if (!/^\d{3,6}$/.test(t)) return false;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return false;
    if (t.includes(",")) return false;
    return true;
  }

  const STOP_LABELS = [
    /^R\.?\s*O\.?\s*DATE/i,
    /^ADVISOR\s*NO/i,
    /^ADVISOR$/i,
    /^TIME RECEIVED/i,
    /^DATE\/?TIME PROMISED/i,
    /^CELL\b/i,
    /^PRIORITY$/i,
    /^LABOR RATE$/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);

    let m = line.match(/TAG\s*(?:NO|#)\s*[:.]?\s*(\d{2,10})/i);
    if (m && isGoodTagCandidate(m[1])) return m[1];

    if (/TAG\s*(?:NO|#)/i.test(line)) {
      for (let j = 1; j <= 12; j++) {
        const next = cleanupSpacing(lines[i + j] || "");
        if (!next) continue;

        if (STOP_LABELS.some(rx => rx.test(next))) break;

        if (isGoodTagCandidate(next)) return next;

        m = next.match(/\b(\d{3,6})\b/);
        if (m && isGoodTagCandidate(m[1])) return m[1];
      }
    }
  }

  return "";
}

function extractAdvisorNo(lines) {
  function isGoodAdvisorNo(s) {
    const t = cleanupSpacing(s || "");
    if (!/^\d{2,4}$/.test(t)) return false;
    if (t.includes(",")) return false;
    return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);

    let m = line.match(/ADVISOR\s*NO\.?\s*[:.]?\s*(\d{2,4})/i);
    if (m) return m[1];

    if (/ADVISOR\s*NO\.?/i.test(line)) {
      for (let j = 1; j <= 8; j++) {
        const next = cleanupSpacing(lines[i + j] || "");
        if (!next) continue;

        if (/^[A-Z]$/i.test(next)) continue;
        if (next.includes(",")) continue;
        if (/^TAG\s*(?:NO|#)/i.test(next)) continue;

        if (isGoodAdvisorNo(next)) return next;

        m = next.match(/\b(\d{2,4})\b/);
        if (m && isGoodAdvisorNo(m[1])) return m[1];
      }
    }
  }

  return "";
}

function extractAdvisor(lines) {
  const BAD = new Set([
    "ADVISOR",
    "ADVISOR NO",
    "ADVISOR NO.",
    "TECHNICIAN",
    "TYPE",
    "TECHNICIAN TYPE",
    "MILEAGE",
    "TRANS",
    "POZZ",
    "AIR COND. P. S.",
    "TURBO M/MC",
    "TAG NO",
    "TAG NO."
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);

    let m = line.match(/ADVISOR\s*[:.]?\s*([A-Za-z][A-Za-z.' -]{2,40})$/i);
    if (m) {
      const candidate = cleanupName(m[1]);
      if (!BAD.has(candidate.toUpperCase()) && looksLikePersonName(candidate)) {
        return candidate;
      }
    }

    if (/^ADVISOR$/i.test(line) || /^ADVISOR\s*NO\.?/i.test(line)) {
      for (let j = 1; j <= 10; j++) {
        const next = cleanupSpacing(lines[i + j] || "");
        if (!next) continue;

        const upper = next.toUpperCase();
        if (BAD.has(upper)) continue;
        if (/^\d{1,6}$/.test(next)) continue;
        if (next.includes(",")) continue;

        if (looksLikePersonName(next)) return cleanupName(next);
      }
    }
  }

  return "";
}


function extractCustomerName(lines) {
  const BAD_NAME_FRAGMENTS = [
    "VEHICLE",
    "I.D.",
    "ID",
    "YEAR/MAKE/MODEL",
    "SERVICE",
    "CUSTOMER NO",
    "SERVICE CONTRACT",
    "CASH",
    "CHECK",
    "CREDIT",
    "SAVE PARTS",
    "YES NO",
    "PHONE",
    "RESIDENCE PHONE",
    "BUSINESS PHONE",
    "COLOR",
    "TURBO",
    "M/MC",
    "AIR COND",
    "P.S.",
    "TRANS",
    "MILEAGE",
    "ADVISOR",
    "ADVISOR NO"
  ];

  function isBadNameLine(s) {
    const t = cleanupSpacing(s || "");
    if (!t) return true;
    if (BAD_NAME_FRAGMENTS.some(x => t.toUpperCase().includes(x))) return true;
    if (looksLikeAddress(t)) return true;
    if (looksLikePhoneLine(t)) return true;
    if (looksLikeVIN(t)) return true;
    if (/\d/.test(t)) return true;
    return false;
  }

  const vinIdx = lines.findIndex(line => looksLikeVIN(line));
  if (vinIdx >= 0) {
    for (let i = vinIdx + 1; i <= Math.min(vinIdx + 10, lines.length - 1); i++) {
      const line = cleanupSpacing(lines[i]);
      if (!line) continue;
      if (isBadNameLine(line)) continue;
      if (looksLikePersonName(line)) return cleanupName(line);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]).toUpperCase();

    if (line.includes("CREDIT") || line.includes("CUSTOMER")) {
      for (let j = i; j < i + 8 && j < lines.length; j++) {
        const candidate = cleanupSpacing(lines[j]);
        if (!candidate) continue;
        if (isBadNameLine(candidate)) continue;
        if (looksLikePersonName(candidate)) return cleanupName(candidate);
      }
    }
  }

  const candidates = lines.filter(line => looksLikePersonName(line) && !isBadNameLine(line));
  return candidates.length ? cleanupName(candidates[0]) : "";
}

function extractCellPhone(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/CELL\s*:/i.test(line) || /^CELL\b/i.test(line)) {
      const sameLine = findPhone(line);
      if (sameLine) return sameLine;

      const next1 = findPhone(lines[i + 1] || "");
      if (next1) return next1;

      const next2 = findPhone(lines[i + 2] || "");
      if (next2) return next2;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/RESIDENCE\s+PHONE/i.test(line)) {
      const sameLine = findPhone(line);
      if (sameLine) return sameLine;

      const next1 = findPhone(lines[i + 1] || "");
      if (next1) return next1;
    }
  }

  return "";
}

function extractYearModel(lines) {
  const vinBlock = getVinBlock(lines);

  for (const line of vinBlock) {
    if (/\bPORSCHE\b/i.test(line) && /\b\d{2}\/PORSCHE\//i.test(line)) {
      return line.replace(/^[A-HJ-NPR-Z0-9]{17}\s+/, "").trim();
    }
  }

  for (const line of lines) {
    if (/PORSCHE/i.test(line)) {
      if (/PORSCHE WEST BROWARD/i.test(line)) continue;
      if (/YEAR|MAKE|MODEL/i.test(line)) continue;
      if (!/\b\d{2}\/PORSCHE\//i.test(line)) continue;
      return line.replace(/^[A-HJ-NPR-Z0-9]{17}\s+/, "").trim();
    }
  }

  return "";
}

function extractConcern(lines) {
  const BAD_LINES = [
    /^PORSCHE WEST BROWARD$/i,
    /^RECOMMENDED SERVICES$/i,
    /^SERVICE HISTORY$/i,
    /^ORIGINAL CUSTOMER ESTIMATE:?$/i,
    /^NOTE TO CONSUMER/i,
    /^ON EITHER BACK SIDE OR LAST PAGE HEREOF$/i,
    /^Marlon Vargas$/i,
    /^QUICK SERVICE$/i,
    /^MULTIPOINT INSPECT$/i,
    /^WashCarService$/i,
    /^QUALITY CONTROL$/i,
    /^TOTAL$/i,
    /^PRIORITY$/i,
    /^LABOR RATE$/i,
    /^JOB$/i,
    /^SERVICE$/i,
    /^NONE$/i,
    /^OPERATION$/i,
    /^OPERATION DESCRIPTION$/i,
    /^MO\/MI$/i,
    /^DATE$/i,
    /^REPAIR ORDER$/i,
    /^MILEAGE$/i,
    /^ADVISOR$/i,
    /^TECHNICIAN$/i,
    /^TYPE$/i,
    /^CUSTOMER NO\.?$/i,
    /^COLOR$/i,
    /^SERVICE CONTRACT$/i,
    /^PRODUCTION DATE$/i,
    /^STOCK NO\.?$/i,
    /^LICENSE NO\.?$/i,
    /^R\.?O\.? NO\.?$/i,
    /^R\.?O\.? DATE$/i,
    /^TAG NO\.?$/i,
    /^TURBO$/i,
    /^M\/MC$/i,
    /^AIR COND\.?$/i,
    /^P\.? ?S\.?$/i,
    /^TRANS$/i,
    /^ADVISOR NO\.?$/i,
    /^APPOINTMENT$/i,
    /^TIME RECEIVED$/i,
    /^DATE\/TIME PROMISED$/i
  ];

  function isBadConcernLine(s) {
    const text = cleanupSpacing(s || "");
    if (!text) return true;
    if (BAD_LINES.some(rx => rx.test(text))) return true;
    if (looksLikePhoneLine(text)) return true;
    if (looksLikeAddress(text)) return true;
    if (looksLikeVIN(text)) return true;

    if (/^(CELL|RESIDENCE PHONE|BUSINESS PHONE|ADVISOR|ADVISOR NO\.?|DATE|SIGNED|PAGE \d)/i.test(text)) return true;
    if (/\b(Customer agrees|NOTE TO CONSUMER|ON EITHER BACK SIDE|I hereby authorize|created\s+\d{4}-\d{2}-\d{2})\b/i.test(text)) return true;

    if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(text)) return true;
    if (/^\d{1,2}:\d{2}\s*[ap]m$/i.test(text)) return true;

    if (/^\*?\s*[A-Z0-9]{4,10}$/.test(text)) return true;
    if (/^[A-Z][A-Z ]+$/.test(text) && text.split(/\s+/).length <= 4) return true;

    return false;
  }

  function looksLikeRealConcern(text) {
    const t = cleanupSpacing(text || "");
    if (!t || isBadConcernLine(t)) return false;

    if (/\b(CUSTOMER STATES|C\/S|REQUEST|CONCERN|CORRECTION|LEAK|NOISE|VIBRATION|CHECK|WARNING|LIGHT|ISSUE|PROBLEM)\b/i.test(t)) {
      return true;
    }

    if (/^(M&B|ALIGNMENT|TRIM CONCERN|SHUTTLE TRANSPORT|MULTIPOINT INSPECT|QUALITY CONTROL|WASHCARSERVICE)/i.test(t)) {
      return false;
    }

    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 8) return false;
    if (!/^[A-Za-z0-9/&().,' -]+$/.test(t)) return false;

    return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);
    if (/CUSTOMER\s+STATES/i.test(line)) {
      const sameLine = cleanupSpacing(line.replace(/.*CUSTOMER\s+STATES[:\-]?\s*/i, ""));
      if (looksLikeRealConcern(sameLine)) return sameLine;

      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const next = cleanupSpacing(lines[j]);
        if (looksLikeRealConcern(next)) return next;
      }
      return "";
    }
  }

  const estIdx = lines.findIndex(line => /^ORIGINAL CUSTOMER ESTIMATE:?$/i.test(cleanupSpacing(line)));
  if (estIdx >= 0) {
    for (let i = estIdx + 1; i < Math.min(lines.length, estIdx + 8); i++) {
      const line = cleanupSpacing(lines[i]);
      if (looksLikeRealConcern(line)) return line;
    }
  }

  const commentsIdx = lines.findIndex(line => /^COMMENTS\s*:?/i.test(cleanupSpacing(line)));
  if (commentsIdx >= 0) {
    for (let i = commentsIdx + 1; i < Math.min(lines.length, commentsIdx + 5); i++) {
      const line = cleanupSpacing(lines[i]);
      if (looksLikeRealConcern(line)) return line;
    }
  }

  return "";
}

function extractRoDate(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = cleanupSpacing(lines[i]);

    if (/R\.?\s*O\.?\s*DATE/i.test(line)) {
      const joined = [line, lines[i + 1] || "", lines[i + 2] || ""].join(" ");
      const m = joined.match(/R\.?\s*O\.?\s*DATE\s*[:.]?\s*(\d{2}\/\d{2}\/\d{2,4})/i);
      if (m) return m[1];

      const d = joined.match(/\b\d{2}\/\d{2}\/\d{2,4}\b/);
      if (d) return d[0];
    }
  }

  const vinBlock = getVinBlock(lines);
  if (vinBlock.length) {
    const joined = vinBlock.join(" ");
    const m = joined.match(/R\.?\s*O\.?\s*DATE\s*[:.]?\s*(\d{2}\/\d{2}\/\d{2,4})/i);
    if (m) return m[1];
  }

  return "";
}

function extractPromiseDate(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/DATE\/?TIME\s+PROMISED/i.test(lines[i])) {
      const joined = [lines[i], lines[i + 1] || "", lines[i + 2] || ""].join(" ");

      let m = joined.match(/DATE\/?TIME\s+PROMISED\s*[:.]?\s*(\d{2}\/\d{2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[ap]m)/i);
      if (m) return `${m[1]} ${cleanupSpacing(m[2]).replace(/\s+/g, "")}`;

      const d = normalizeDateToken(joined);
      const t = normalizeTimeToken(joined);
      if (d && t) return `${d} ${t}`;
    }
  }

  return "";
}

function extractVin(lines) {
  for (const line of lines) {
    const m = String(line || "").match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (m) return m[1];
  }
  return "";
}