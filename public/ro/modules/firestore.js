// public/modules/firestore.js

import { db } from "../firebase.js";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { fmtDateMMDDYYYY } from "./utils.js";

const COL_ACTIVE = "ros";
const COL_ARCHIVE = "followup";

async function safeUpdate(roId, patch) {
  const ref = doc(db, COL_ACTIVE, roId);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
}

async function restoreFromArchive(roId) {
  const id = String(roId || "").trim();
  if (!id) return;

  const archRef = doc(db, COL_ARCHIVE, id);
  const snap = await getDoc(archRef);
  if (!snap.exists()) {
    alert("Archive record not found.");
    return;
  }

  // Prevent overwrite if active exists
  const activeRef = doc(db, COL_ACTIVE, id);
  const activeSnap = await getDoc(activeRef);
  if (activeSnap.exists()) {
    alert(`Active RO ${id} already exists. Restore cancelled.`);
    return;
  }

  const data = snap.data() || {};

  // Remove archive-only fields
  const cleaned = { ...data };
  delete cleaned.archivedAt;
  delete cleaned.archivedRowClass;

  await setDoc(activeRef, {
    ...cleaned,
    ro: id,
    restoredAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await deleteDoc(archRef);
}

async function addNewRO() {
  const ro = prompt("Enter RO # (must be unique):");
  if (!ro) return;

  const roId = String(ro).trim();
  if (!roId) return;

  const ref = doc(db, COL_ACTIVE, roId);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    alert("That RO already exists. RO must be unique.");
    return;
  }

  await setDoc(ref, {
    ro: roId,
    customerName: "",
    phone: "",
    tag: "",
    roDate: fmtDateMMDDYYYY(new Date()),
    promiseDate: fmtDateMMDDYYYY(new Date()),
    model: "",
    concern: "",
    status: "",
    notes: "",
    techVideo: false,
    readyCalled: false,
    calledAtMs: null,
    nextUpdateAtMs: null,
    customerWaiting: false,
    hasLoaner: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export {
  COL_ACTIVE,
  COL_ARCHIVE,
  safeUpdate,
  restoreFromArchive,
  addNewRO
};