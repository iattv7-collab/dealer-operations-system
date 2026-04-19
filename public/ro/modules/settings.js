// public/modules/settings.js

import { db, auth } from "../firebase.js";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
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
    pushAfterArchiveDelayMin: 2,

    // Keep in touch (settings only for now)
    keepInTouchEnabled: false,
    keepInTouchMonths: 3,
    keepInTouchTime: "10:00",
    keepInTouchTemplate:
      "Hi {firstName}, just checking in and keeping in touch. If you need anything for your Porsche, we're here to help."
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

export async function registerPushToken(token) {
  if (!token) return;

  try {
    await updateDoc(PRIVATE_DOC, {
      fcmTokens: arrayUnion(token),
      fcmTokenUpdatedAtMs: Date.now()
    });
  } catch (e) {
    // if doc doesn't exist yet → create it
    await setDoc(
      PRIVATE_DOC,
      {
        fcmTokens: [token],
        fcmTokenUpdatedAtMs: Date.now()
      },
      { merge: true }
    );
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
    .rt-tabs{ display:flex; gap:8px; margin:6px 0 14px; }
    .rt-tab{
      font-family:"Times New Roman", Times, serif;
      padding:8px 12px;
      border-radius:10px;
      border:1px solid #888;
      background:#fff;
      cursor:pointer;
    }
    .rt-tab.active{
      background:#0b3d91;
      color:#fff;
      border-color:#0b3d91;
    }
    .rt-panel{ display:none; }
    .rt-panel.active{ display:block; }
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
    set("Browser notifications are not supported on this device.", "gray");
    return el;
  }

  const p = Notification.permission;

  if (p === "granted") {
    el.textContent = "";
    el.style.display = "none";
    return el;
  }

  if (p === "denied") {
    set("Browser notifications are blocked ❌ Enable them in browser settings.", "red");
    return el;
  }

  set("Browser notifications are not enabled yet ⚠️", "orange");
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
    pushAfterArchiveDelayMin: remote.pushAfterArchiveDelayMin ?? local.pushAfterArchiveDelayMin,

    keepInTouchEnabled: remote.keepInTouchEnabled ?? local.keepInTouchEnabled,
    keepInTouchMonths: remote.keepInTouchMonths ?? local.keepInTouchMonths,
    keepInTouchTime: remote.keepInTouchTime ?? local.keepInTouchTime,
    keepInTouchTemplate: remote.keepInTouchTemplate ?? local.keepInTouchTemplate
  };

  const user = auth.currentUser;
  const isMarlon = user?.email === "marlonv@gmail.com";


  openModal("Settings", (body, close) => {
    const tabs = document.createElement("div");
    tabs.className = "rt-tabs";

    const btnTabFollow = document.createElement("button");
    btnTabFollow.type = "button";
    btnTabFollow.className = "rt-tab active";
    btnTabFollow.textContent = "Follow Up";

    const btnTabKeep = document.createElement("button");
    btnTabKeep.type = "button";
    btnTabKeep.className = "rt-tab";
    btnTabKeep.textContent = "Keep In Touch";

    tabs.appendChild(btnTabFollow);
    tabs.appendChild(btnTabKeep);
    body.appendChild(tabs);

    const followPanel = document.createElement("div");
    followPanel.className = "rt-panel active";

    const keepPanel = document.createElement("div");
    keepPanel.className = "rt-panel";

    function showPanel(which) {
      const followOn = which === "follow";
      btnTabFollow.classList.toggle("active", followOn);
      btnTabKeep.classList.toggle("active", !followOn);
      followPanel.classList.toggle("active", followOn);
      keepPanel.classList.toggle("active", !followOn);
    }

    btnTabFollow.onclick = () => showPanel("follow");
    btnTabKeep.onclick = () => showPanel("keep");

    // FOLLOW UP TAB
    const row1 = document.createElement("div");
    row1.className = "rt-row";

    const labD1 = document.createElement("label");
    labD1.textContent = "Follow-up Days:";
    const inpD1 = document.createElement("input");
    inpD1.type = "number";
    inpD1.min = "0";
    inpD1.max = "30";
    inpD1.value = String(s.followUpDay1 || 0);
    inpD1.style.width = "120px";

    const labT1 = document.createElement("label");
    labT1.textContent = "Send Time:";
    const inpT1 = document.createElement("input");
    inpT1.type = "time";
    inpT1.value = String(s.followUpTime1 || "10:00");
    inpT1.style.width = "140px";

    row1.appendChild(labD1);
    row1.appendChild(inpD1);
    row1.appendChild(labT1);
    row1.appendChild(inpT1);

    const row3 = document.createElement("div");
    row3.className = "rt-row";

    const labTpl = document.createElement("label");
    labTpl.textContent = "Follow-up Text:";
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

    followPanel.appendChild(row1);
    followPanel.appendChild(row3);

    let quickToggle = null;
    let quickDelay = null;
    let btnTest = null;

    if (isMarlon) {
      const devNote = document.createElement("div");
      devNote.className = "rt-mini";
      devNote.style.marginTop = "8px";
      devNote.style.color = "#0b3d91";
      devNote.textContent = "DEV MODE: Test controls enabled";

      const rowQuick = document.createElement("div");
      rowQuick.className = "rt-row";

      const labQuick = document.createElement("label");
      labQuick.textContent = "Auto Push After Archive:";
      labQuick.style.width = "140px";

      quickToggle = document.createElement("input");
      quickToggle.type = "checkbox";
      quickToggle.checked = !!s.pushAfterArchiveEnabled;

      const labMin = document.createElement("span");
      labMin.className = "rt-mini";
      labMin.textContent = " Minutes:";

      quickDelay = document.createElement("input");
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

      const rowDev = document.createElement("div");
      rowDev.className = "rt-row";

      btnTest = document.createElement("button");
      btnTest.className = "rt-btn";
      btnTest.type = "button";
      btnTest.textContent = "TEST Notification";

      btnTest.onclick = async () => {
        try {
          const mins = Math.max(1, Number(quickDelay?.value || s.pushAfterArchiveDelayMin || 2));

          await setDoc(PRIVATE_DOC, {
            followUpTestAtMs: Date.now() + mins * 60 * 1000,
            followUpTestRequestedAtMs: Date.now()
          }, { merge: true });

          alert(`TEST scheduled ✅ You should get a push in about ${mins} minute(s).`);
        } catch (e) {
          alert(String(e?.message || e));
        }
      };

      quickToggle.addEventListener("change", () => {
        const enabled = quickToggle.checked;

        quickDelay.disabled = !enabled;
        quickDelay.readOnly = !enabled;
        quickDelay.style.opacity = enabled ? "1" : "0.5";
        quickDelay.style.cursor = enabled ? "pointer" : "not-allowed";

        btnTest.disabled = !enabled;
        btnTest.style.opacity = enabled ? "1" : "0.5";
        btnTest.style.cursor = enabled ? "pointer" : "not-allowed";
      });

      rowDev.appendChild(btnTest);

      // initial state
      const enabledInit = quickToggle.checked;

      quickDelay.disabled = !enabledInit;
      quickDelay.readOnly = !enabledInit;
      quickDelay.style.opacity = enabledInit ? "1" : "0.5";
      quickDelay.style.cursor = enabledInit ? "pointer" : "not-allowed";

      btnTest.disabled = !enabledInit;
      btnTest.style.opacity = enabledInit ? "1" : "0.5";
      btnTest.style.cursor = enabledInit ? "pointer" : "not-allowed";

      followPanel.appendChild(devNote);
      followPanel.appendChild(rowQuick);
      followPanel.appendChild(rowDev);
    }

    // KEEP IN TOUCH TAB
    const rowK0 = document.createElement("div");
    rowK0.className = "rt-row";

    const labKeepEnabled = document.createElement("label");
    labKeepEnabled.textContent = "Enable:";
    const keepEnabled = document.createElement("input");
    keepEnabled.type = "checkbox";
    keepEnabled.checked = !!s.keepInTouchEnabled;

    rowK0.appendChild(labKeepEnabled);
    rowK0.appendChild(keepEnabled);

    const rowK1 = document.createElement("div");
    rowK1.className = "rt-row";

    const labKeepMonths = document.createElement("label");
    labKeepMonths.textContent = "Months After:";
    const inpKeepMonths = document.createElement("input");
    inpKeepMonths.type = "number";
    inpKeepMonths.min = "1";
    inpKeepMonths.max = "24";
    inpKeepMonths.value = String(s.keepInTouchMonths || 3);
    inpKeepMonths.style.width = "120px";

    const labKeepTime = document.createElement("label");
    labKeepTime.textContent = "Send Time:";
    const inpKeepTime = document.createElement("input");
    inpKeepTime.type = "time";
    inpKeepTime.value = String(s.keepInTouchTime || "10:00");
    inpKeepTime.style.width = "140px";

    rowK1.appendChild(labKeepMonths);
    rowK1.appendChild(inpKeepMonths);
    rowK1.appendChild(labKeepTime);
    rowK1.appendChild(inpKeepTime);

    const rowK2 = document.createElement("div");
    rowK2.className = "rt-row";

    const labKeepTpl = document.createElement("label");
    labKeepTpl.textContent = "Keep in Touch Text:";
    labKeepTpl.style.width = "140px";

    const keepBox = document.createElement("div");
    keepBox.style.flex = "1";

    const keepTpl = document.createElement("textarea");
    keepTpl.value = String(s.keepInTouchTemplate || "");

    const keepHelp = document.createElement("div");
    keepHelp.className = "rt-mini";
    keepHelp.textContent = "This stores the Keep in Touch message only. It does not send automatically yet.";

    keepBox.appendChild(keepTpl);
    keepBox.appendChild(keepHelp);

    rowK2.appendChild(labKeepTpl);
    rowK2.appendChild(keepBox);

    keepPanel.appendChild(rowK0);
    keepPanel.appendChild(rowK1);
    keepPanel.appendChild(rowK2);

    body.appendChild(followPanel);
    body.appendChild(keepPanel);

    const actions = document.createElement("div");
    actions.className = "rt-actions";

    const btnCancel = document.createElement("button");
    btnCancel.className = "rt-btn";
    btnCancel.type = "button";
    btnCancel.textContent = "Close";
    btnCancel.onclick = close;

    let notifStatus = buildNotifStatusEl();

    function getCurrentSettingsSnapshot() {
      return {
        followUpDay1: Number(inpD1.value || 0),
        followUpTime1: String(inpT1.value || "10:00"),
        smsTemplate: String(tpl.value || ""),

        pushAfterArchiveEnabled: isMarlon ? !!quickToggle?.checked : !!s.pushAfterArchiveEnabled,
        pushAfterArchiveDelayMin: isMarlon
          ? Number(quickDelay?.value || s.pushAfterArchiveDelayMin || 2)
          : Number(s.pushAfterArchiveDelayMin || 2),

        keepInTouchEnabled: !!keepEnabled.checked,
        keepInTouchMonths: Number(inpKeepMonths.value || 3),
        keepInTouchTime: String(inpKeepTime.value || "10:00"),
        keepInTouchTemplate: String(keepTpl.value || "")
      };
    }

    const originalSnapshot = {
      followUpDay1: Number(s.followUpDay1 || 0),
      followUpTime1: String(s.followUpTime1 || "10:00"),
      smsTemplate: String(s.smsTemplate || ""),
      pushAfterArchiveEnabled: !!s.pushAfterArchiveEnabled,
      pushAfterArchiveDelayMin: Number(s.pushAfterArchiveDelayMin || 2),
      keepInTouchEnabled: !!s.keepInTouchEnabled,
      keepInTouchMonths: Number(s.keepInTouchMonths || 3),
      keepInTouchTime: String(s.keepInTouchTime || "10:00"),
      keepInTouchTemplate: String(s.keepInTouchTemplate || "")
    };

    function refreshSaveState() {
      const changed =
        JSON.stringify(getCurrentSettingsSnapshot()) !== JSON.stringify(originalSnapshot);

      btnSave.disabled = !changed;
      btnSave.style.opacity = changed ? "1" : "0.5";
      btnSave.style.cursor = changed ? "pointer" : "not-allowed";
    }

    const btnSave = document.createElement("button");
    btnSave.className = "rt-btn primary";
    btnSave.type = "button";
    btnSave.textContent = "Save";
    btnSave.disabled = true;
    btnSave.style.opacity = "0.5";
    btnSave.style.cursor = "not-allowed";

    btnSave.onclick = async () => {
      const next = {
        followUpDay1: Number(inpD1.value || 0),
        followUpTime1: String(inpT1.value || "10:00"),

        // keep old fields untouched so nothing breaks
        followUpDay2: Number(s.followUpDay2 || 0),
        followUpTime2: String(s.followUpTime2 || "14:00"),

        smsTemplate: String(tpl.value || ""),

        pushAfterArchiveEnabled: isMarlon ? !!quickToggle?.checked : !!s.pushAfterArchiveEnabled,
        pushAfterArchiveDelayMin: isMarlon
          ? Number(quickDelay?.value || s.pushAfterArchiveDelayMin || 2)
          : Number(s.pushAfterArchiveDelayMin || 2),

        keepInTouchEnabled: !!keepEnabled.checked,
        keepInTouchMonths: Number(inpKeepMonths.value || 3),
        keepInTouchTime: String(inpKeepTime.value || "10:00"),
        keepInTouchTemplate: String(keepTpl.value || "")
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

    [
      inpD1,
      inpT1,
      tpl,
      keepEnabled,
      inpKeepMonths,
      inpKeepTime,
      keepTpl,
      quickToggle,
      quickDelay
    ]
      .filter(Boolean)
      .forEach((el) => {
        el.addEventListener("input", refreshSaveState);
        el.addEventListener("change", refreshSaveState);
      });

    refreshSaveState();

    actions.appendChild(btnCancel);
    actions.appendChild(notifStatus);
    actions.appendChild(btnSave);

    body.appendChild(actions);
  });
}