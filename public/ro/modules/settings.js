// public/modules/settings.js

import { db } from "../firebase.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ===========================
   SETTINGS (Local + Remote)
=========================== */

export const SETTINGS_KEY = "rt_followup_settings_v1";

// Store token + settings in Firestore (only you)
export const PRIVATE_DOC = doc(db, "privateSettings", "me");

export function defaultSettings() {
  return {
    followUpDay1: 3,
    followUpTime1: "10:00",
    followUpDay2: 0,
    followUpTime2: "14:00",
    smsTemplate:
      "Hi {firstName}, just following up on your Porsche service visit for RO {ro}. Any questions or updates needed?",
    // Push right after archiving (backend sends it)
    pushAfterArchiveEnabled: false,
    pushAfterArchiveDelayMin: 2
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const s = JSON.parse(raw);
    return { ...defaultSettings(), ...(s || {}) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export async function loadRemotePrivateSettings() {
  try {
    const snap = await getDoc(PRIVATE_DOC);
    return snap.exists() ? (snap.data() || {}) : {};
  } catch {
    return {};
  }
}

/* ===========================
   Modal helpers
=========================== */

function ensureModalStyles() {
  if (document.getElementById("__rt_modal_styles")) return;
  const st = document.createElement("style");
  st.id = "__rt_modal_styles";
  st.textContent = `
    .rt-backdrop{
      position:fixed; inset:0; background:rgba(0,0,0,.35);
      display:flex; align-items:center; justify-content:center;
      z-index:99999;
    }
    .rt-modal{
      background:#fff; border:1px solid #cfcfcf; border-radius:12px;
      width:min(820px, calc(100vw - 24px));
      max-height: calc(100vh - 24px);
      overflow:auto;
      box-shadow:0 10px 30px rgba(0,0,0,.25);
      font-family:"Times New Roman", Times, serif;
      padding:14px;
    }
    .rt-modal-title{
      font-weight:bold; font-size:18px; margin-bottom:10px;
      background:#0b3d91; color:#fff;
      padding:10px 12px; border-radius:10px;
    }
    .rt-row{ display:flex; gap:10px; align-items:center; margin:10px 0; flex-wrap:wrap; }
    .rt-row label{ width:140px; }
    .rt-row input, .rt-row textarea{
      font-family:"Times New Roman", Times, serif;
      padding:8px 10px;
      border:1px solid #c8d0d9; border-radius:8px;
      font-size:14px;
    }
    .rt-row textarea{ width:100%; min-height:90px; }
    .rt-actions{ display:flex; justify-content:flex-end; gap:10px; margin-top:14px; flex-wrap:wrap; align-items:center; }
    .rt-btn{
      font-family:"Times New Roman", Times, serif;
      padding:8px 12px; border-radius:10px;
      border:1px solid #888; background:#fff; cursor:pointer;
    }
    .rt-btn.primary{ background:#0b3d91; color:#fff; border-color:#0b3d91; }
    .rt-mini{ font-size:12px; color:#333; }
  `;
  document.head.appendChild(st);
}

function openModal(titleText, buildBodyFn) {
  ensureModalStyles();
  const backdrop = document.createElement("div");
  backdrop.className = "rt-backdrop";
  const modal = document.createElement("div");
  modal.className = "rt-modal";
  const title = document.createElement("div");
  title.className = "rt-modal-title";
  title.textContent = titleText;
  const body = document.createElement("div");
  buildBodyFn(body, () => backdrop.remove());
  modal.appendChild(title);
  modal.appendChild(body);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

/* ===========================
   Notification status helper
=========================== */

function buildNotifStatusEl() {
  const el = document.createElement("div");
  el.className = "rt-mini";
  el.style.fontWeight = "bold";
  el.style.marginTop = "6px";
  el.style.marginLeft = "6px";
  const set = (text, color) => {
    el.textContent = text;
    el.style.color = color;
  };
  if (!("Notification" in window)) {
    set("Notifications: Not supported on this device", "gray");
    return el;
  }
  const p = Notification.permission;
  if (p === "granted") set("Notifications: Allowed ✅", "green");
  else if (p === "denied") set("Notifications: Blocked ❌ (enable in browser settings)", "red");
  else set("Notifications: Not enabled yet ⚠️", "orange");
  return el;
}

/* ===========================
   Settings Modal (export)
=========================== */

export async function openSettingsModal() {
  const local = loadSettings();
  const remote = await loadRemotePrivateSettings();
  const s = {
    ...local,
    followUpDay1: remote.followUpDay1 ?? local.followUpDay1,
    followUpTime1: remote.followUpTime1 ?? local.followUpTime1,
    followUpDay2: remote.followUpDay2 ?? local.followUpDay2,
    followUpTime2: remote.followUpTime2 ?? local.followUpTime2,
    smsTemplate: remote.smsTemplate ?? local.smsTemplate,
    pushAfterArchiveEnabled: remote.pushAfterArchiveEnabled ?? local.pushAfterArchiveEnabled,
    pushAfterArchiveDelayMin: remote.pushAfterArchiveDelayMin ?? local.pushAfterArchiveDelayMin
  };

  openModal("Settings — Follow Up", (body, close) => {
    const row1 = document.createElement("div");
    row1.className = "rt-row";

    const labD1 = document.createElement("label");
    labD1.textContent = "Follow-up Day #1:";
    const inpD1 = document.createElement("input");
    inpD1.type = "number";
    inpD1.min = "0";
    inpD1.max = "30";
    inpD1.value = String(s.followUpDay1 || 0);
    inpD1.style.width = "120px";

    const labT1 = document.createElement("label");
    labT1.textContent = "Time #1 (HH:MM):";
    const inpT1 = document.createElement("input");
    inpT1.type = "time";
    inpT1.value = String(s.followUpTime1 || "10:00");
    inpT1.style.width = "140px";

    row1.appendChild(labD1);
    row1.appendChild(inpD1);
    row1.appendChild(labT1);
    row1.appendChild(inpT1);

    const row2 = document.createElement("div");
    row2.className = "rt-row";

    const labD2 = document.createElement("label");
    labD2.textContent = "Follow-up Day #2:";
    const inpD2 = document.createElement("input");
    inpD2.type = "number";
    inpD2.min = "0";
    inpD2.max = "30";
    inpD2.value = String(s.followUpDay2 || 0);
    inpD2.style.width = "120px";

    const labT2 = document.createElement("label");
    labT2.textContent = "Time #2 (HH:MM):";
    const inpT2 = document.createElement("input");
    inpT2.type = "time";
    inpT2.value = String(s.followUpTime2 || "14:00");
    inpT2.style.width = "140px";

    const mini = document.createElement("div");
    mini.className = "rt-mini";
    mini.textContent = "Set Day #2 = 0 to disable.";

    row2.appendChild(labD2);
    row2.appendChild(inpD2);
    row2.appendChild(labT2);
    row2.appendChild(inpT2);
    row2.appendChild(mini);

    const row3 = document.createElement("div");
    row3.className = "rt-row";

    const labTpl = document.createElement("label");
    labTpl.textContent = "SMS template:";
    labTpl.style.width = "140px";

    const box = document.createElement("div");
    box.style.flex = "1";

    const tpl = document.createElement("textarea");
    tpl.value = String(s.smsTemplate || "");

    const help = document.createElement("div");
    help.className = "rt-mini";
    help.textContent = "Use: {firstName} {name} {ro} {model}";

    box.appendChild(tpl);
    box.appendChild(help);

    row3.appendChild(labTpl);
    row3.appendChild(box);

    const rowQuick = document.createElement("div");
    rowQuick.className = "rt-row";

    const labQuick = document.createElement("label");
    labQuick.textContent = "Push after archive:";
    labQuick.style.width = "140px";

    const quickToggle = document.createElement("input");
    quickToggle.type = "checkbox";
    quickToggle.checked = !!s.pushAfterArchiveEnabled;

    const labMin = document.createElement("span");
    labMin.className = "rt-mini";
    labMin.textContent = " Minutes:";

    const quickDelay = document.createElement("input");
    quickDelay.type = "number";
    quickDelay.min = "1";
    quickDelay.max = "60";
    quickDelay.step = "1";
    quickDelay.value = String(Number(s.pushAfterArchiveDelayMin || 2));
    quickDelay.style.width = "90px";

    rowQuick.appendChild(labQuick);
    rowQuick.appendChild(quickToggle);
    rowQuick.appendChild(labMin);
    rowQuick.appendChild(quickDelay);

    const actions = document.createElement("div");
    actions.className = "rt-actions";

    const btnCancel = document.createElement("button");
    btnCancel.className = "rt-btn";
    btnCancel.type = "button";
    btnCancel.textContent = "Close";
    btnCancel.onclick = close;

    const btnTest = document.createElement("button");
    btnTest.className = "rt-btn";
    btnTest.type = "button";
    btnTest.textContent = "TEST (2 min)";

    let notifStatus = buildNotifStatusEl();

    btnTest.onclick = async () => {
      try {
        // refresh status (in case user changed permissions)
        const nextStatus = buildNotifStatusEl();
        try { notifStatus.replaceWith(nextStatus); } catch { }
        notifStatus = nextStatus;

        await setDoc(PRIVATE_DOC, {
          followUpTestAtMs: Date.now() + 2 * 60 * 1000,
          followUpTestRequestedAtMs: Date.now()
        }, { merge: true });

        alert("TEST scheduled ✅ You should get a push in ~2 minutes.");
      } catch (e) {
        alert(String(e?.message || e));
      }
    };

    const btnSave = document.createElement("button");
    btnSave.className = "rt-btn primary";
    btnSave.type = "button";
    btnSave.textContent = "Save";

    btnSave.onclick = async () => {
      const next = {
        followUpDay1: Number(inpD1.value || 0),
        followUpTime1: String(inpT1.value || "10:00"),
        followUpDay2: Number(inpD2.value || 0),
        followUpTime2: String(inpT2.value || "14:00"),
        smsTemplate: String(tpl.value || ""),
        pushAfterArchiveEnabled: !!quickToggle.checked,
        pushAfterArchiveDelayMin: Number(quickDelay.value || 2)
      };

      saveSettings(next);

      try {
        await setDoc(PRIVATE_DOC, {
          ...next,
          followUpSettingsUpdatedAtMs: Date.now()
        }, { merge: true });
      } catch (e) {
        alert("Saved locally, but Firestore save failed: " + String(e?.message || e));
        return;
      }

      close();
      alert("Settings saved ✅");
    };

    actions.appendChild(btnCancel);
    actions.appendChild(btnTest);
    actions.appendChild(notifStatus);
    actions.appendChild(btnSave);

    body.appendChild(row1);
    body.appendChild(row2);
    body.appendChild(row3);
    body.appendChild(rowQuick);
    body.appendChild(actions);
  });
}