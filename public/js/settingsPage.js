// public/js/settingsPage.js
import { auth } from "./firebase.js";
import { listenSystemSettings, setSystemSettings } from "./settings.js";
let lastSaved = null;
function setSaveState(text, ok = true) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.textContent = text;
  el.style.background = ok ? "#eee" : "#ffe6e6";
  el.style.border = ok ? "none" : "1px solid crimson";
}

function renderCurrentSaved(s) {
  const el = document.getElementById("currentSettingsText");
  if (!el) return;

  el.textContent =
    `Wash: ${s.washDurationMin}m + buffer ${s.bufferMin}m
Today override bays: ${s.openBays}
Effective bays now: ${s.effectiveBays}

Auto-start: ${s.autoStart ? "ON" : "OFF"}
Mon–Fri bays: ${s.mfBays}   Sat: ${s.satBays}   Sun: ${s.sunBays}

Hours:
Mon–Fri ${s.mfOpen}–${s.mfClose}
Sat     ${s.satOpen}–${s.satClose}
Sun     ${s.sunOpen}–${s.sunClose}`;
}

// ---- helpers
const $ = (id) => document.getElementById(id);

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

function setMsg(text, ok = true) {
  const el = $("settingsMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "green" : "crimson";
}

// ---- bind UI
function applyToUI(s) {
  renderCurrentSaved(s);
  setSaveState("Saved ✓", true);
  if ($("pickupEnabled")) $("pickupEnabled").checked = !!s.pickupEnabled; // if you have it

  if ($("washDurationMin")) $("washDurationMin").value = s.washDurationMin ?? 15;
  if ($("bufferMin")) $("bufferMin").value = s.bufferMin ?? 0;
  if ($("openBays")) $("openBays").value = s.openBays ?? 0;

  if ($("autoStart")) $("autoStart").checked = !!s.autoStart;
  if ($("mfBays")) $("mfBays").value = s.mfBays ?? 2;
  if ($("satBays")) $("satBays").value = s.satBays ?? 1;
  if ($("sunBays")) $("sunBays").value = s.sunBays ?? 0;

  if ($("mfOpen")) $("mfOpen").value = s.mfOpen ?? "07:30";
  if ($("mfClose")) $("mfClose").value = s.mfClose ?? "19:00";
  if ($("satOpen")) $("satOpen").value = s.satOpen ?? "08:00";
  if ($("satClose")) $("satClose").value = s.satClose ?? "15:00";
  if ($("sunOpen")) $("sunOpen").value = s.sunOpen ?? "00:00";
  if ($("sunClose")) $("sunClose").value = s.sunClose ?? "00:00";

  if ($("effectiveBays")) $("effectiveBays").textContent = String(s.effectiveBays ?? "");
  lastSaved = readForm();
  renderCurrentSaved(s);
  setSaveState("Saved ✓", true);
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
  } catch (e) {
    console.error(e);
    setMsg(e?.message || "Save failed.", false);
  }
}

function init() {
  const btn = $("saveSystemSettingsBtn");
  if (btn) btn.addEventListener("click", onSave);

  // live load
  listenSystemSettings((s) => {
    applyToUI(s);
  });

  // detect unsaved changes
  const ids = [
    "washDurationMin", "bufferMin", "openBays", "autoStart",
    "mfBays", "satBays", "sunBays",
    "mfOpen", "mfClose", "satOpen", "satClose", "sunOpen", "sunClose"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("input", () => {
      setSaveState("Not saved", false);
    });

    el.addEventListener("change", () => {
      setSaveState("Not saved", false);
    });
  });
}

init();