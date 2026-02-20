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

const DEFAULTS = {
  washDurationMin: 15,
  openBays: 1,
  bufferMin: 0
};

export async function getSystemSettings() {
  const snap = await getDoc(REF);
  const data = snap.exists() ? snap.data() : {};

  const washDurationMin = clampInt(data.washDurationMin ?? DEFAULTS.washDurationMin, 1, 120);
  const openBays = clampInt(data.openBays ?? DEFAULTS.openBays, 0, 50);
  const bufferMin = clampInt(data.bufferMin ?? DEFAULTS.bufferMin, 0, 60);

  const effectiveBays = openBays;

  return { washDurationMin, openBays, bufferMin, effectiveBays };
}

export function listenSystemSettings(cb) {
  return onSnapshot(REF, (snap) => {
    const data = snap.exists() ? snap.data() : {};

    const washDurationMin = clampInt(data.washDurationMin ?? DEFAULTS.washDurationMin, 1, 120);
    const openBays = clampInt(data.openBays ?? DEFAULTS.openBays, 0, 50);
    const bufferMin = clampInt(data.bufferMin ?? DEFAULTS.bufferMin, 0, 60);

    const effectiveBays = openBays;

    cb({ washDurationMin, openBays, bufferMin, effectiveBays });
  });
}

export async function setSystemSettings(user, partial) {
  const incoming = partial || {};

  const washDurationMin =
    incoming.washDurationMin == null ? undefined : clampInt(incoming.washDurationMin, 1, 120);

  const openBays =
    incoming.openBays == null ? undefined : clampInt(incoming.openBays, 0, 50);

  const bufferMin =
    incoming.bufferMin == null ? undefined : clampInt(incoming.bufferMin, 0, 60);

  const payload = {
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || null
  };

  if (washDurationMin !== undefined) payload.washDurationMin = washDurationMin;
  if (openBays !== undefined) payload.openBays = openBays;
  if (bufferMin !== undefined) payload.bufferMin = bufferMin;

  await setDoc(REF, payload, { merge: true });
  return await getSystemSettings();
}

function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
