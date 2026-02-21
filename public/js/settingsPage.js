// public/js/settingsPage.js
import { auth } from "./firebase.js";
import { listenSystemSettings, setSystemSettings } from "./settings.js";
import { getUserProfile } from "./guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// ---- helpers
const $ = (id) => document.getElementById(id);

// ✅ global permission flag used by BOTH applyWashDayPermission() and applyToUI()
let canControlWashDay = false;

function setSaveState(text, ok = true) {
  const el = $("saveState");
  if (!el) return;
  el.textContent = text;
  el.style.background = ok ? "#eee" : "#ffe6e6";
  el.style.border = ok ? "none" : "1px solid crimson";
}

function setMsg(text, ok = true) {
  const el = $("settingsMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "green" : "crimson";
}

function intVal(id) {
  const el = $(id);
  if (!el) return null;
  const s = String(el.value || "").trim();
  if (s === "") return null;
  return Number(s);
}

function strVal(id) {
  const el = $(id);
  if (!el) return null;
  const s = String(el.value || "").trim();
  return s === "" ? null : s;
}

function checkedVal(id) {
  const el = $(id);
  if (!el) return null;
  return !!el.checked;
}

function renderCurrentSaved(s) {
  const el = $("currentSettingsText");
  if (!el) return;

  el.textContent =
    `Wash: ${s.washDurationMin}m + buffer ${s.bufferMin}m
Today override bays: ${s.openBays}
Effective bays now: ${s.effectiveBays}

Auto-start: ${s.autoStart ? "ON" : "OFF"}
Wash day: ${s.isOpen ? "OPEN" : "CLOSED"}

Mon–Fri bays: ${s.mfBays}   Sat: ${s.satBays}   Sun: ${s.sunBays}

Hours:
Mon–Fri ${s.mfOpen}–${s.mfClose}
Sat     ${s.satOpen}–${s.satClose}
Sun     ${s.sunOpen}–${s.sunClose}`;
}

function readForm() {
  return {
    washDurationMin: intVal("washDurationMin"),
    bufferMin: intVal("bufferMin"),
    openBays: intVal("openBays"),
    autoStart: checkedVal("autoStart"),
    mfBays: intVal("mfBays"),
    satBays: intVal("satBays"),
    sunBays: intVal("sunBays"),
    mfOpen: strVal("mfOpen"),
    mfClose: strVal("mfClose"),
    satOpen: strVal("satOpen"),
    satClose: strVal("satClose"),
    sunOpen: strVal("sunOpen"),
    sunClose: strVal("sunClose"),
  };
}

// ---- supervisor permission (from Admin checkbox)
function applyWashDayPermission(profile) {
  const role = String(profile?.role || "").toLowerCase();

  canControlWashDay =
    role === "admin" ||
    role === "manager" ||
    profile?.permissions?.canControlWashDay === true;

  // Buttons are safety-disabled here; panel show/hide happens in applyToUI()
  const openBtn = $("openWashBtn");
  const closeBtn = $("closeWashBtn");
  if (openBtn) openBtn.disabled = !canControlWashDay;
  if (closeBtn) closeBtn.disabled = !canControlWashDay;
}

async function setWashOpen(isOpen) {
  try {
    const user = auth.currentUser;
    if (!user) {
      setMsg("Not signed in.", false);
      return;
    }

    await setSystemSettings(user, { isOpen: !!isOpen });
    setMsg(isOpen ? "Wash day OPEN." : "Wash day CLOSED.");
  } catch (e) {
    console.error(e);
    setMsg(e?.message || "Failed to update wash day.", false);
  }
}

// ---- bind UI
function applyToUI(s) {
  renderCurrentSaved(s);
  setSaveState("Saved ✓", true);

  // Wash config
  if ($("washDurationMin")) $("washDurationMin").value = s.washDurationMin ?? 15;
  if ($("bufferMin")) $("bufferMin").value = s.bufferMin ?? 0;
  if ($("openBays")) $("openBays").value = s.openBays ?? 0;

  // Auto start toggle
  if ($("autoStart")) $("autoStart").checked = !!s.autoStart;

  // OPEN / CLOSED badge
  if ($("isOpenBadge")) {
    $("isOpenBadge").textContent = s.isOpen ? "OPEN" : "CLOSED";
  }

  // ✅ FIXED: manual controls only show if autoStart OFF AND user has permission
  const manualPanel = $("manualControls");
  if (manualPanel) {
    manualPanel.style.display = (!s.autoStart && canControlWashDay) ? "block" : "none";
  }

  // Bays
  if ($("mfBays")) $("mfBays").value = s.mfBays ?? 2;
  if ($("satBays")) $("satBays").value = s.satBays ?? 1;
  if ($("sunBays")) $("sunBays").value = s.sunBays ?? 0;

  // Hours
  if ($("mfOpen")) $("mfOpen").value = s.mfOpen ?? "07:30";
  if ($("mfClose")) $("mfClose").value = s.mfClose ?? "19:00";
  if ($("satOpen")) $("satOpen").value = s.satOpen ?? "08:00";
  if ($("satClose")) $("satClose").value = s.satClose ?? "15:00";
  if ($("sunOpen")) $("sunOpen").value = s.sunOpen ?? "00:00";
  if ($("sunClose")) $("sunClose").value = s.sunClose ?? "00:00";

  // Effective bays display
  if ($("effectiveBays")) {
    $("effectiveBays").textContent = String(s.effectiveBays ?? "");
  }

  // Re-apply button disabled state (in case role loaded after settings)
  const openBtn = $("openWashBtn");
  const closeBtn = $("closeWashBtn");
  if (openBtn) openBtn.disabled = !canControlWashDay;
  if (closeBtn) closeBtn.disabled = !canControlWashDay;
}

async function onSave() {
  try {
    const user = auth.currentUser;
    if (!user) {
      setMsg("Not signed in.", false);
      return;
    }

    const partial = {
      washDurationMin: intVal("washDurationMin"),
      bufferMin: intVal("bufferMin"),
      openBays: intVal("openBays"),
      autoStart: checkedVal("autoStart"),
      mfBays: intVal("mfBays"),
      satBays: intVal("satBays"),
      sunBays: intVal("sunBays"),
      mfOpen: strVal("mfOpen"),
      mfClose: strVal("mfClose"),
      satOpen: strVal("satOpen"),
      satClose: strVal("satClose"),
      sunOpen: strVal("sunOpen"),
      sunClose: strVal("sunClose"),
    };

    await setSystemSettings(user, partial);
    setMsg("Saved.");
    setSaveState("Saved ✓", true);
  } catch (e) {
    console.error(e);
    setMsg(e?.message || "Save failed.", false);
  }
}

function init() {
  const saveBtn = $("saveSystemSettingsBtn");
  if (saveBtn) saveBtn.addEventListener("click", onSave);

  const openBtn = $("openWashBtn");
  const closeBtn = $("closeWashBtn");
  if (openBtn) openBtn.addEventListener("click", () => setWashOpen(true));
  if (closeBtn) closeBtn.addEventListener("click", () => setWashOpen(false));

  // Auth -> load profile -> apply permission
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const profile = await getUserProfile(user);
    applyWashDayPermission(profile);
  });

  // live load settings
  listenSystemSettings((s) => {
    applyToUI(s);
  });

  const ids = [
    "washDurationMin", "bufferMin", "openBays", "autoStart",
    "mfBays", "satBays", "sunBays",
    "mfOpen", "mfClose", "satOpen", "satClose", "sunOpen", "sunClose"
  ];

  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => setSaveState("Not saved", false));
    el.addEventListener("change", () => setSaveState("Not saved", false));
  });
}

init();