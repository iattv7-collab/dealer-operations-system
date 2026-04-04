// File: public/js/core/archive.js
// Purpose: Shared archive logic for moving active tickets from ros to tickets_archive

import { db } from "../firebase.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export async function archiveTicket({
  ticketId,
  archivedBy,
  archivedByRole,
  archivedFrom = "unknown"
}) {
  const ref = doc(db, "ros", ticketId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error("Ticket not found.");
  }

  const data = snap.data();

  const archiveRef = doc(db, "tickets_archive", ticketId);

await setDoc(archiveRef, {
  ...data,

  // core archive metadata
  archivedAt: serverTimestamp(),
  archivedAtMs: Date.now(),
  archivedBy,
  archivedByRole,
  archivedFrom,

  // 🔥 VERY IMPORTANT
  dealerId: data.dealerId || 1,

  // keep original id
  sourceId: ticketId
});

  // delete from active
  await deleteDoc(ref);
}