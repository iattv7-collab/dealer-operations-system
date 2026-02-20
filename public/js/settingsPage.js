// public/js/settingsPage.js
import { db, auth } from "./firebase.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { getSystemSettings, setSystemSettings, listenSystemSettings } from "./settings.js";

const pickupToggle = document.getElementById("pickupEnabledToggle");
const msg = document.getElementById("settingsMsg");

const washDurationMinInput = document.getElementById("washDurationMin");
const openBaysInput = document.getElementById("openBays");
const bufferMinInput = document.getElementById("bufferMin");

const effectiveBaysEl = document.getElementById("effectiveBays");
const saveSystemSettingsBtn = document.getElementById("saveSystemSettingsBtn");
const systemSettingsMsg = document.getElementById("systemSettingsMsg");

const FEATURES_REF = doc(db, "settings", "features");

function flash(text) {
  msg.textContent = text;
  setTimeout(() => (msg.textContent = ""), 1500);
}

function flashSystem(text, ok = true) {
  if (!systemSettingsMsg) return;
  systemSettingsMsg.textContent = text;
  systemSettingsMsg.style.color = ok ? "green" : "crimson";
  setTimeout(() => {
    systemSettingsMsg.textContent = "";
  }, 1800);
}

function setDisabled(disabled) {
  pickupToggle.disabled = disabled;

  washDurationMinInput.disabled = disabled;
  openBaysInput.disabled = disabled;
  bufferMinInput.disabled = disabled;
  saveSystemSettingsBtn.disabled = disabled;
}

function readSystemInputs() {
  return {
    washDurationMin: Number(washDurationMinInput.value),
    openBays: Number(openBaysInput.value),
    bufferMin: Number(bufferMinInput.value)
  };
}

function writeSystemInputs(s) {
  washDurationMinInput.value = s.washDurationMin;
  openBaysInput.value = s.openBays;
  bufferMinInput.value = s.bufferMin;

  if (effectiveBaysEl) {
    effectiveBaysEl.textContent = String(s.effectiveBays);
  }
}

// ----- Pickup toggle -----
async function loadPickupToggle() {
  const snap = await getDoc(FEATURES_REF);
  const data = snap.exists() ? snap.data() : {};
  pickupToggle.checked = !!data.pickupEnabled;
}

async function savePickupToggle() {
  try {
    await setDoc(FEATURES_REF, { pickupEnabled: !!pickupToggle.checked }, { merge: true });
    flash("Saved");
  } catch (e) {
    console.error("Save pickupEnabled failed:", e);
    flash("Save failed: " + (e?.code || e?.message || "unknown"));
  }
}

// ----- System settings -----
async function loadSystemSettings() {
  const s = await getSystemSettings();
  writeSystemInputs(s);
}

async function saveSystemSettings() {
  const user = auth.currentUser;
  const payload = readSystemInputs();

  try {
    const saved = await setSystemSettings(user, payload);
    writeSystemInputs(saved);
    flashSystem("Saved ✅");
  } catch (e) {
    console.error("Save system settings failed:", e);
    flashSystem("Save failed: " + (e?.code || e?.message || "unknown"), false);
  }
}

// Wire UI
pickupToggle.addEventListener("change", () => savePickupToggle());
saveSystemSettingsBtn.addEventListener("click", () => saveSystemSettings());

// Enter key saves
[washDurationMinInput, openBaysInput, bufferMinInput].forEach((inp) => {
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveSystemSettingsBtn.click();
  });
});

// ----- Auth gate -----
setDisabled(true);
flash("Checking sign-in...");

let unsubSettings = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setDisabled(true);
    flash("Please sign in");
    setTimeout(() => (window.location.href = "/login.html"), 400);
    return;
  }

  setDisabled(false);
  flash("");

  try {
    await loadPickupToggle();
    await loadSystemSettings();

    if (typeof unsubSettings === "function") unsubSettings();
    unsubSettings = listenSystemSettings((s) => {
      if (effectiveBaysEl) effectiveBaysEl.textContent = String(s.effectiveBays);
    });
  } catch (e) {
    console.error("Load settings failed:", e);
    flash("Load failed: " + (e?.code || e?.message || "unknown"));
  }
});
