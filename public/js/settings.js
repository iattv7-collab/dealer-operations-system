// public/js/settings.js
import { db } from "./firebase.js";
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
const REF = doc(db, "settings", "system");

const DEFAULTS = {
  washDurationMin: 15,
  bufferMin: 0,

  // legacy (kept for backward compatibility + "today override")
  openBays: 0,

  // Option 2 (new)
  autoStart: true,
  isOpen: true,

  mfBays: 2,
  satBays: 1,
  sunBays: 0,

  mfOpen: "07:30",
  mfClose: "19:00",
  satOpen: "08:00",
  satClose: "15:00",
  sunOpen: "00:00",
  sunClose: "00:00",
};

export async function getSystemSettings() {
  const snap = await getDoc(REF);
  const data = snap.exists() ? snap.data() : {};

  const washDurationMin = clampInt(data.washDurationMin ?? DEFAULTS.washDurationMin, 1, 120);
  const bufferMin = clampInt(data.bufferMin ?? DEFAULTS.bufferMin, 0, 60);

  // today override (optional)
  const openBays = clampInt(data.openBays ?? DEFAULTS.openBays, 0, 50);

  const autoStart = typeof data.autoStart === "boolean" ? data.autoStart : DEFAULTS.autoStart;
  const isOpen = typeof data.isOpen === "boolean" ? data.isOpen : DEFAULTS.isOpen;

  const mfBays = clampInt(data.mfBays ?? DEFAULTS.mfBays, 0, 50);
  const satBays = clampInt(data.satBays ?? DEFAULTS.satBays, 0, 50);
  const sunBays = clampInt(data.sunBays ?? DEFAULTS.sunBays, 0, 50);

  const mfOpen = clampHHMM(data.mfOpen ?? DEFAULTS.mfOpen);
  const mfClose = clampHHMM(data.mfClose ?? DEFAULTS.mfClose);
  const satOpen = clampHHMM(data.satOpen ?? DEFAULTS.satOpen);
  const satClose = clampHHMM(data.satClose ?? DEFAULTS.satClose);
  const sunOpen = clampHHMM(data.sunOpen ?? DEFAULTS.sunOpen);
  const sunClose = clampHHMM(data.sunClose ?? DEFAULTS.sunClose);

  // effectiveBays is computed on client too (for display only)
  const effectiveBays = computeEffectiveBaysClient({
    openBays,
    mfBays,
    satBays,
    sunBays,
    autoStart,
    isOpen,
  });

  return {
    washDurationMin,
    bufferMin,
    openBays,

    autoStart,
    isOpen,

    mfBays,
    satBays,
    sunBays,

    mfOpen,
    mfClose,
    satOpen,
    satClose,
    sunOpen,
    sunClose,

    effectiveBays,
  };
}

export function listenSystemSettings(cb) {
  return onSnapshot(REF, async (snap) => {
    const s = snap.exists() ? snap.data() : {};
    const merged = await getSystemSettings(); // ensures same normalization path
    cb(merged);
  });
}

export async function setSystemSettings(user, partial) {
  const incoming = partial || {};

  const washDurationMin =
    incoming.washDurationMin == null ? undefined : clampInt(incoming.washDurationMin, 1, 120);

  const bufferMin =
    incoming.bufferMin == null ? undefined : clampInt(incoming.bufferMin, 0, 60);

  const openBays =
    incoming.openBays == null ? undefined : clampInt(incoming.openBays, 0, 50);

  const autoStart =
    typeof incoming.autoStart === "boolean" ? incoming.autoStart : undefined;

  const isOpen =
    typeof incoming.isOpen === "boolean" ? incoming.isOpen : undefined;

  const mfBays =
    incoming.mfBays == null ? undefined : clampInt(incoming.mfBays, 0, 50);

  const satBays =
    incoming.satBays == null ? undefined : clampInt(incoming.satBays, 0, 50);

  const sunBays =
    incoming.sunBays == null ? undefined : clampInt(incoming.sunBays, 0, 50);

  const mfOpen = incoming.mfOpen == null ? undefined : clampHHMM(incoming.mfOpen);
  const mfClose = incoming.mfClose == null ? undefined : clampHHMM(incoming.mfClose);
  const satOpen = incoming.satOpen == null ? undefined : clampHHMM(incoming.satOpen);
  const satClose = incoming.satClose == null ? undefined : clampHHMM(incoming.satClose);
  const sunOpen = incoming.sunOpen == null ? undefined : clampHHMM(incoming.sunOpen);
  const sunClose = incoming.sunClose == null ? undefined : clampHHMM(incoming.sunClose);

  const payload = {
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || null,
  };

  if (washDurationMin !== undefined) payload.washDurationMin = washDurationMin;
  if (bufferMin !== undefined) payload.bufferMin = bufferMin;
  if (openBays !== undefined) payload.openBays = openBays;

  if (autoStart !== undefined) payload.autoStart = autoStart;
  if (isOpen !== undefined) payload.isOpen = isOpen;

  if (mfBays !== undefined) payload.mfBays = mfBays;
  if (satBays !== undefined) payload.satBays = satBays;
  if (sunBays !== undefined) payload.sunBays = sunBays;

  if (mfOpen !== undefined) payload.mfOpen = mfOpen;
  if (mfClose !== undefined) payload.mfClose = mfClose;
  if (satOpen !== undefined) payload.satOpen = satOpen;
  if (satClose !== undefined) payload.satClose = satClose;
  if (sunOpen !== undefined) payload.sunOpen = sunOpen;
  if (sunClose !== undefined) payload.sunClose = sunClose;

  await setDoc(REF, payload, { merge: true });
  return await getSystemSettings();
}

function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampHHMM(v) {
  const s = String(v || "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return "00:00";
  const hh = clampInt(m[1], 0, 23);
  const mm = clampInt(m[2], 0, 59);
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

// For display only (client time). Server is the source of truth.
function computeEffectiveBaysClient({ openBays, mfBays, satBays, sunBays, autoStart, isOpen }) {
  if (!autoStart) return isOpen ? (openBays > 0 ? openBays : mfBays) : 0;

  const d = new Date();
  const day = d.getDay(); // 0 Sun ... 6 Sat

  const dayBays = day === 0 ? sunBays : day === 6 ? satBays : mfBays;
  return openBays > 0 ? openBays : dayBays;
}