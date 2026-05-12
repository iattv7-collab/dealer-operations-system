// public/js/rosWash.js

import { db, auth } from "./firebase.js";
import { getUserDealerId } from "./guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  increment,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const COL = "ros";

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
    cycle: cycle ? String(cycle) : "wash"
  };
}

function auditUser(user) {
  return {
    updatedByUid: user?.uid || "",
    updatedByName: String(user?.displayName || "").trim(),
    updatedByEmail: String(user?.email || "").trim()
  };
}

/* -------------------------------------------
   Create / Send to wash
   - Finds existing master RO in `ros`
   - Updates that SAME ticket instead of creating a duplicate
--------------------------------------------*/
export async function createWashTicket(data, user, role = "staff") {
  if (!user) throw new Error("Not authenticated.");

  const dealerId = await getUserDealerId(user);
  if (!dealerId) throw new Error("Missing dealerId on user profile.");

  const tag = String(data?.tag || "").trim();
  const notes = String(data?.notes || "").trim();
  const waiter = data?.waiter === true;
  const location = String(data?.location || "").trim();

  if (!tag) throw new Error("Tag is required.");

  const nowMs = Date.now();

  const q = query(
    collection(db, COL),
    where("dealerId", "==", dealerId),
    where("tag", "==", tag)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    throw new Error("No master RO found for this tag. Create it first in Scanner.");
  }

  if (snap.size > 1) {
    throw new Error("Multiple ROs found for this tag. Dropoff must be redesigned to search by RO.");
  }

  const hit = snap.docs[0];
  const ref = doc(db, COL, hit.id);

  await updateDoc(ref, {
    location,
    customerWaiting: waiter,
    washNotes: notes,
    washStatus: "queued",
    washQueuedAt: serverTimestamp(),
    washQueuedAtMs: nowMs,
    washQueuedBy: user.uid,
    priorityType: waiter ? "waiter" : "normal",
    washWaiterAtMs: waiter ? nowMs : null,
    updatedAt: serverTimestamp(),
    ...auditUser(user),
    washEvents: arrayUnion(
      makeEvent({ type: "wash_queued", atMs: nowMs, by: user.uid, role, cycle: "wash" })
    ),
    ...lastEditPatch(user, role, [
      "location",
      "customerWaiting",
      "washNotes",
      "washStatus",
      "washQueuedAt",
      "washQueuedAtMs",
      "washQueuedBy",
      "priorityType",
      "washWaiterAtMs",
      "updatedAt",
      "updatedByUid",
      "updatedByName",
      "updatedByEmail",
      "washEvents"
    ])
  });

  return hit.id;
}

/* -------------------------------------------
   Rewash request
--------------------------------------------*/
export async function requestRewash(ticketId, user, role = "advisor") {
  if (!user) throw new Error("Not authenticated.");
  if (!ticketId) throw new Error("Missing ticket id.");

  const ref = doc(db, COL, ticketId);
  const nowMs = Date.now();

  await updateDoc(ref, {
    priorityType: "rewash",
    isRewashCycle: true,
    rewashRequestedAtMs: nowMs,
    rewashRequestedBy: user.uid,
    washStatus: "queued",
    updatedAt: serverTimestamp(),
    ...auditUser(user),
    washEvents: arrayUnion(
      makeEvent({ type: "rewash_requested", atMs: nowMs, by: user.uid, role, cycle: "rewash" })
    ),
    ...lastEditPatch(user, role, [
      "priorityType",
      "isRewashCycle",
      "rewashRequestedAtMs",
      "rewashRequestedBy",
      "washStatus",
      "updatedAt",
      "updatedByUid",
      "updatedByName",
      "updatedByEmail",
      "washEvents"
    ])
  });
}

/* -------------------------------------------
   Pickup request
--------------------------------------------*/
export async function requestPickup(ticketId, user, role = "advisor") {
  if (!user) throw new Error("Not authenticated.");
  if (!ticketId) throw new Error("Missing ticket id.");

  const ref = doc(db, COL, ticketId);
  const nowMs = Date.now();

  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ticket not found.");

  const cur = snap.data() || {};
  const pickupStatus = String(cur.pickupStatus || "").toLowerCase();

  if (pickupStatus === "requested" || pickupStatus === "on_the_way") {
    throw new Error("Pickup already requested or in progress.");
  }

  await updateDoc(ref, {
    pickupStatus: "requested",
    pickupRequestedAtMs: nowMs,
    pickupRequestedBy: user.uid,
    pickupRequestedByName: String(user.displayName || user.email || "").trim(),
    updatedAt: serverTimestamp(),
    ...auditUser(user),
    washEvents: arrayUnion(
      makeEvent({ type: "pickup_requested", atMs: nowMs, by: user.uid, role, cycle: "pickup" })
    ),
    ...lastEditPatch(user, role, [
      "pickupStatus",
      "pickupRequestedAtMs",
      "pickupRequestedBy",
      "pickupRequestedByName",
      "updatedAt",
      "updatedByUid",
      "updatedByName",
      "updatedByEmail",
      "washEvents"
    ])
  });
}

/* -------------------------------------------
   Pickup claim / on the way
--------------------------------------------*/
export async function claimPickup(ticketId, user, role = "valet") {
  if (!user) throw new Error("Not authenticated.");
  if (!ticketId) throw new Error("Missing ticket id.");

  const ref = doc(db, COL, ticketId);
  const nowMs = Date.now();
  const who = String(user.displayName || user.email || "").trim();

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Ticket not found.");

    const cur = snap.data() || {};
    const pickupStatus = String(cur.pickupStatus || "").toLowerCase();

    if (pickupStatus !== "requested") {
      const handledBy = String(cur.pickupClaimedByName || "").trim();
      throw new Error(
        handledBy
          ? `Another valet is already handling this pickup (${handledBy}).`
          : "Another valet is already handling this pickup."
      );
    }

    tx.update(ref, {
      pickupStatus: "on_the_way",
      pickupClaimedBy: user.uid,
      pickupClaimedByName: who,
      pickupClaimedAtMs: nowMs,
      pickupOnTheWayAtMs: nowMs,
      updatedAt: serverTimestamp(),
      ...auditUser(user),
      washEvents: arrayUnion(
        makeEvent({ type: "pickup_claimed", atMs: nowMs, by: user.uid, role, cycle: "pickup" })
      ),
      ...lastEditPatch(user, role, [
        "pickupStatus",
        "pickupClaimedBy",
        "pickupClaimedByName",
        "pickupClaimedAtMs",
        "pickupOnTheWayAtMs",
        "updatedAt",
        "updatedByUid",
        "updatedByName",
        "updatedByEmail",
        "washEvents"
      ])
    });

    return {
      ok: true,
      id: ticketId,
      location: String(cur.location || "").trim(),
      ro: String(cur.ro || "").trim(),
      tag: String(cur.tag || "").trim()
    };
  });
}



/* -------------------------------------------
   Update wash status on SAME master RO
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

  const fieldsChanged = [
    "washStatus",
    "updatedAt",
    "updatedByUid",
    "updatedByName",
    "updatedByEmail"
  ];

  const patch = {
    washStatus: status,
    updatedAt: serverTimestamp(),
    ...auditUser(user)
  };

  if (status === "washing") {
    patch.washingStartedAt = serverTimestamp();
    patch.washingStartedAtMs = nowMs;
    patch.washingStartedBy = user.uid;
    patch.washEvents = arrayUnion(
      makeEvent({ type: "wash_start", atMs: nowMs, by: user.uid, role, cycle })
    );
    fieldsChanged.push(
      "washingStartedAt",
      "washingStartedAtMs",
      "washingStartedBy",
      "washEvents"
    );
  }

  if (status === "washed") {
    patch.washedAt = serverTimestamp();
    patch.washedAtMs = nowMs;
    patch.washedBy = user.uid;
    patch.washCount = increment(1);
    if (isRewash) patch.rewashCount = increment(1);
    patch.rewashRequestedAtMs = null;
    patch.rewashRequestedBy = null;
    patch.priorityType = "normal";
    patch.isRewashCycle = false;
    patch.washEvents = arrayUnion(
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
      "washEvents"
    );
  }

  if (status === "closed") {
    patch.washClosedAt = serverTimestamp();
    patch.washClosedAtMs = nowMs;
    patch.washClosedBy = user.uid;
    patch.washEvents = arrayUnion(
      makeEvent({ type: "wash_closed", atMs: nowMs, by: user.uid, role, cycle })
    );
    fieldsChanged.push("washClosedAt", "washClosedAtMs", "washClosedBy", "washEvents");
  }

  Object.assign(patch, lastEditPatch(user, role, fieldsChanged));

  await updateDoc(ref, patch);
}


export async function removeFromWashQueue(ticketId, user, role = "unknown") {
  if (!user) throw new Error("Not authenticated.");
  if (!ticketId) throw new Error("Missing ticket id.");

  const ref = doc(db, COL, ticketId);
  const nowMs = Date.now();

    await updateDoc(ref, {
    washStatus: "",
    washQueuedAt: null,
    washQueuedAtMs: null,
    washQueuedBy: null,
    washingStartedAt: null,
    washingStartedAtMs: null,
    washingStartedBy: null,
    washedAt: null,
    washedAtMs: null,
    washedBy: null,
    washWaiterAtMs: null,
    washNotes: "",
    priorityType: "normal",
    customerWaiting: false,
    needByAtMs: null,
    needBySetBy: null,
    isRewashCycle: false,
    rewashRequestedAtMs: null,
    rewashRequestedBy: null,
    updatedAt: serverTimestamp(),
    ...auditUser(user),
    washEvents: arrayUnion(
      makeEvent({ type: "wash_removed", atMs: nowMs, by: user.uid, role, cycle: "wash" })
    ),
    ...lastEditPatch(user, role, [
      "washStatus",
      "washQueuedAt",
      "washQueuedAtMs",
      "washQueuedBy",
      "washingStartedAt",
      "washingStartedAtMs",
      "washingStartedBy",
      "washedAt",
      "washedAtMs",
      "washedBy",
      "washWaiterAtMs",
      "washNotes",
      "priorityType",
      "customerWaiting",
      "needByAtMs",
      "needBySetBy",
      "isRewashCycle",
      "rewashRequestedAtMs",
      "rewashRequestedBy",
      "washEvents"
    ])
  });
}



/* -------------------------------------------
   Listen from master `ros`
   - maps wash fields into the existing wash UI shape
--------------------------------------------*/
export function listenTickets(options, callback) {
  const statuses = Array.isArray(options?.statuses) ? options.statuses : [];

  let unsubSnap = null;

  const unsubAuth = onAuthStateChanged(auth, async (user) => {
    if (unsubSnap) {
      try { unsubSnap(); } catch { }
      unsubSnap = null;
    }

    if (!user) {
      callback([]);
      return;
    }

    const dealerId = await getUserDealerId(user);
    if (!dealerId) {
      callback([]);
      return;
    }

    const q = query(
      collection(db, COL),
      where("dealerId", "==", dealerId)
    );

    unsubSnap = onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            ...data,

            // Main source of truth comes from RO list / shared ros record
            status: String(
              data.washStatus ||
              data.status ||
              ""
            ).toLowerCase(),

            waiter: !!data.customerWaiting,

            // Prefer main notes first, then wash notes if main notes empty
            notes: data.notes || data.washNotes || "",

            // Wash list arrival time must be when ticket entered wash queue
            createdAtMs: typeof data.washQueuedAtMs === "number"
              ? data.washQueuedAtMs
              : 0
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
  });

  return () => {
    try { unsubSnap?.(); } catch { }
    try { unsubAuth?.(); } catch { }
  };
}

export async function findTicketAnywhereByRoOrTag(value) {
  const user = auth.currentUser;
  if (!user) return null;

  const dealerId = await getUserDealerId(user);
  if (!dealerId) return null;

  const needle = String(value || "").trim();
  if (!needle) return null;

  let snap = await getDocs(
    query(
      collection(db, COL),
      where("dealerId", "==", dealerId),
      where("ro", "==", needle)
    )
  );

  if (snap.empty) {
    snap = await getDocs(
      query(
        collection(db, COL),
        where("dealerId", "==", dealerId),
        where("tag", "==", needle)
      )
    );
  }

  if (snap.empty) return null;

  const d = snap.docs[0];
  const data = d.data() || {};

  return {
    id: d.id,
    ...data,
    status: String(data.washStatus || data.status || "").toLowerCase(),
  };
}



/* -------------------------------------------
   Helpers
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
  return fmtTime(row.washQueuedAt || row.createdAt || row.createdAtMs);
}

export function fmtTs(value) {
  return fmtTime(value);
}