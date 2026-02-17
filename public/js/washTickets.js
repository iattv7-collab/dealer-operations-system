// public/js/washTickets.js

import { db } from "./firebase.js";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  updateDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const COL = "washTickets";

function lastEditPatch(user, role, fields) {
  return {
    lastEditedAtMs: Date.now(),
    lastEditedBy: user.uid,
    lastEditedRole: String(role || "unknown"),
    lastEditedFields: Array.isArray(fields) ? fields : []
  };
}

function makeEvent({ type, atMs, by, role, cycle }) {
  return {
    type: String(type || "").trim(),
    atMs: Number.isFinite(atMs) ? atMs : Date.now(),
    by: String(by || "").trim(),
    role: String(role || "").trim(),
    cycle: cycle ? String(cycle) : "wash" // "wash" | "rewash"
  };
}

/* -------------------------------------------
   Create
--------------------------------------------*/
export async function createWashTicket(data, user, role = "staff") {
  if (!user) throw new Error("Not authenticated.");

  const tag = String(data?.tag || "").trim();
  const notes = String(data?.notes || "").trim();

  const waiter = data?.waiter === true;
  const location = String(data?.location || "").trim();

  if (!tag) throw new Error("Tag is required.");

  const nowMs = Date.now();

  const base = {
    tag,
    notes,
    waiter,
    location,

    // Core flow
    status: "queued",

    // Timestamps
    createdAt: serverTimestamp(),
    createdAtMs: nowMs,
    updatedAt: serverTimestamp(),

    // Who created it
    createdBy: user.uid,

    // Wash timeline
    washingStartedAt: null,
    washingStartedAtMs: null,
    washingStartedBy: null,

    // Wash completion (keeps last wash time)
    washedAt: null,
    washedAtMs: null,
    washedBy: null,

    // Need-by foundation
    priorityType: waiter ? "waiter" : "normal",
    needByAtMs: null,
    needBySetBy: null,

    // Rewash foundation
    rewashRequestedAtMs: null,
    rewashRequestedBy: null,

    // ✅ NEW: reporting + drilldown foundations
    washCount: 0,       // total completed washes (includes first wash)
    rewashCount: 0,     // completed rewashes only
    isRewashCycle: false, // when true, next completion counts as rewash
    events: [],

    // Archive foundation
    archivedAt: null,
    archivedAtMs: null,
    archivedBy: null
  };

  const ref = await addDoc(collection(db, COL), {
    ...base,
    events: arrayUnion(
      makeEvent({ type: "created", atMs: nowMs, by: user.uid, role, cycle: "wash" })
    ),
    ...lastEditPatch(user, role, ["create"])
  });

  return ref.id;
}

/* -------------------------------------------
   Rewash request (Advisor/Manager/Admin)
   - Marks ticket as a rewash cycle
   - Moves ticket back into queue (status: "queued")
--------------------------------------------*/
export async function requestRewash(ticketId, user, role = "advisor") {
  if (!user) throw new Error("Not authenticated.");
  if (!ticketId) throw new Error("Missing ticket id.");

  const ref = doc(db, COL, ticketId);
  const nowMs = Date.now();

  await updateDoc(ref, {
    priorityType: "rewash",
    isRewashCycle: true, // ✅ next completion counts as rewash
    rewashRequestedAtMs: nowMs,
    rewashRequestedBy: user.uid,
    status: "queued",
    updatedAt: serverTimestamp(),

    events: arrayUnion(
      makeEvent({ type: "rewash_requested", atMs: nowMs, by: user.uid, role, cycle: "rewash" })
    ),

    ...lastEditPatch(user, role, [
      "priorityType",
      "isRewashCycle",
      "rewashRequestedAtMs",
      "rewashRequestedBy",
      "status"
    ])
  });
}

/* -------------------------------------------
   Update status (Wash team / Manager/Admin)
--------------------------------------------*/
export async function setTicketStatus(ticketId, nextStatus, user, role = "unknown") {
  if (!user) throw new Error("Not authenticated.");
  if (!ticketId) throw new Error("Missing ticket id.");

  const status = String(nextStatus || "").toLowerCase().trim();
  if (!["queued", "washing", "washed", "closed"].includes(status)) {
    throw new Error("Invalid status.");
  }

  const ref = doc(db, COL, ticketId);
  const nowMs = Date.now();

  // We need the current ticket to know whether this cycle is a REWASH.
  let cur = {};
  try {
    const snap = await getDoc(ref);
    cur = snap.exists() ? (snap.data() || {}) : {};
  } catch {
    cur = {};
  }

  const isRewash =
    cur?.isRewashCycle === true ||
    String(cur?.priorityType || "").toLowerCase() === "rewash" ||
    (typeof cur?.rewashRequestedAtMs === "number" && cur.rewashRequestedAtMs > 0);

  const cycle = isRewash ? "rewash" : "wash";

  const fieldsChanged = ["status", "updatedAt"];

  const patch = {
    status,
    updatedAt: serverTimestamp()
  };

  // ✅ record wash START only when wash team actually clicks "Start Wash"
  if (status === "washing") {
    patch.washingStartedAt = serverTimestamp();
    patch.washingStartedAtMs = nowMs;
    patch.washingStartedBy = user.uid;

    patch.events = arrayUnion(
      makeEvent({ type: "wash_start", atMs: nowMs, by: user.uid, role, cycle })
    );

    fieldsChanged.push(
      "washingStartedAt",
      "washingStartedAtMs",
      "washingStartedBy",
      "events"
    );
  }

  // ✅ Washed completion (counts + history + reset rewash flags)
  if (status === "washed") {
    patch.washedAt = serverTimestamp();
    patch.washedAtMs = nowMs;
    patch.washedBy = user.uid;

    // Counts
    patch.washCount = increment(1);
    if (isRewash) patch.rewashCount = increment(1);

    // Reset rewash request flags after completion
    patch.rewashRequestedAtMs = null;
    patch.rewashRequestedBy = null;
    patch.priorityType = "normal";
    patch.isRewashCycle = false;

    patch.events = arrayUnion(
      makeEvent({ type: "wash_complete", atMs: nowMs, by: user.uid, role, cycle })
    );

    fieldsChanged.push(
      "washedAt",
      "washedAtMs",
      "washedBy",
      "washCount",
      "rewashCount",
      "rewashRequestedAtMs",
      "rewashRequestedBy",
      "priorityType",
      "isRewashCycle",
      "events"
    );
  }

  // ✅ Archive / Close
  if (status === "closed") {
    patch.archivedAt = serverTimestamp();
    patch.archivedAtMs = nowMs;
    patch.archivedBy = user.uid;

    patch.events = arrayUnion(
      makeEvent({ type: "archived", atMs: nowMs, by: user.uid, role, cycle })
    );

    fieldsChanged.push("archivedAt", "archivedAtMs", "archivedBy", "events");
  }

  Object.assign(patch, lastEditPatch(user, role, fieldsChanged));

  await updateDoc(ref, patch);
}

/* -------------------------------------------
   Listen (NO where() to avoid index requirement)
--------------------------------------------*/
export function listenTickets(options, callback) {
  const statuses = Array.isArray(options?.statuses) ? options.statuses : [];

  const q = query(collection(db, COL), orderBy("createdAtMs", "desc"));

  return onSnapshot(
    q,
    (snap) => {
      let rows = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          ...data,
          createdAtMs: typeof data.createdAtMs === "number" ? data.createdAtMs : 0
        };
      });

      if (statuses.length) {
        const set = new Set(statuses.map((s) => String(s).toLowerCase()));
        rows = rows.filter((r) => set.has(String(r.status || "").toLowerCase()));
      }

      callback(rows);
    },
    (err) => {
      console.error("listenTickets error:", err);
      callback([]);
    }
  );
}

/* -------------------------------------------
   Helpers (no seconds)
--------------------------------------------*/
export function fmtTime(value) {
  if (!value) return "";

  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toLocaleString([], {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch {
      return "";
    }
  }

  if (typeof value === "number") {
    try {
      return new Date(value).toLocaleString([], {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch {
      return "";
    }
  }

  return "";
}

export function fmtCreated(row) {
  if (!row) return "";
  return fmtTime(row.createdAt || row.createdAtMs);
}

export function fmtTs(value) {
  return fmtTime(value);
}
