// public/js/washTickets.js

import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
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

    // Wash completion (keeps last wash time)
    washedAt: null,
    washedBy: null,

    // Need-by foundation
    priorityType: waiter ? "waiter" : "normal",
    needByAtMs: null,
    needBySetBy: null,

    // Rewash foundation
    rewashRequestedAtMs: null,
    rewashRequestedBy: null,

    // Archive foundation (future)
    archivedAt: null,
    archivedBy: null
  };

  const ref = await addDoc(collection(db, COL), {
    ...base,
    ...lastEditPatch(user, role, ["create"])
  });

  return ref.id;
}

/* -------------------------------------------
   Rewash request (Advisor/Manager/Admin)
   - Moves ticket into wash queue (status: "washing")
   - DOES NOT erase washedAt (keeps last wash timestamp)
--------------------------------------------*/
export async function requestRewash(ticketId, user, role = "advisor") {
  if (!user) throw new Error("Not authenticated.");
  if (!ticketId) throw new Error("Missing ticket id.");

  const ref = doc(db, COL, ticketId);

  await updateDoc(ref, {
    priorityType: "rewash",
    rewashRequestedAtMs: Date.now(),
    rewashRequestedBy: user.uid,
    status: "washing",
    updatedAt: serverTimestamp(),
    ...lastEditPatch(user, role, ["priorityType","rewashRequestedAtMs","rewashRequestedBy","status"])
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

  const fieldsChanged = ["status","updatedAt"];

  const patch = {
    status,
    updatedAt: serverTimestamp()
  };

  if (status === "washed") {
    patch.washedAt = serverTimestamp();
    patch.washedBy = user.uid;

    patch.rewashRequestedAtMs = null;
    patch.rewashRequestedBy = null;
    patch.priorityType = "normal";

    fieldsChanged.push("washedAt","washedBy","rewashRequestedAtMs","rewashRequestedBy","priorityType");
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
