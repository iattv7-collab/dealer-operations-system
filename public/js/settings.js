// public/js/settings.js
import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const REF = doc(db, "settings", "system");

export async function getSystemSettings() {
  const snap = await getDoc(REF);
  const data = snap.exists() ? snap.data() : {};
  const washBayCount = clampInt(data.washBayCount ?? 1, 1, 10);
  return { washBayCount };
}

export function listenSystemSettings(cb) {
  return onSnapshot(REF, (snap) => {
    const data = snap.exists() ? snap.data() : {};
    const washBayCount = clampInt(data.washBayCount ?? 1, 1, 10);
    cb({ washBayCount });
  });
}

export async function setWashBayCount(user, count) {
  const washBayCount = clampInt(count, 1, 10);
  await setDoc(
    REF,
    {
      washBayCount,
      updatedAt: serverTimestamp(),
      updatedBy: user?.uid || null
    },
    { merge: true }
  );
  return washBayCount;
}

function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
