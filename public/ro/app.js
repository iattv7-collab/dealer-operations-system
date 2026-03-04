// public/app.js
import { db } from "./firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { pickDateTimeMs, formatNoYearDateTime, formatNoYearDate } from "./datetimePicker.js";
import { dateInputToMMDDYYYY, mmddyyyyToDateInput } from "./modules/utils.js";
import { COL_ACTIVE, COL_ARCHIVE, safeUpdate, addNewRO } from "./modules/firestore.js";
import { initScanner } from "./modules/scanner.js";
import { initNotifications } from "./modules/notifications.js";
import { initFollowUp } from "./modules/followup.js";
import { initArchiveModal } from "./modules/archive.js";
import { loadRemotePrivateSettings, openSettingsModal } from "./modules/settings.js";

const $ = (id) => document.getElementById(id);

function isReadyCalled(r) {
  const legacy = String(r.status || "").trim().toLowerCase() === "ready called";
  return !!r.readyCalled || legacy;
}

function rowClass(r) {
  const videoSent = !!r.techVideo;
  const ready = isReadyCalled(r);
  const waiter = !!r.customerWaiting;

  if (videoSent && ready) return "row-ready";
  if (waiter) return "row-waiter";

  const now = new Date();
  const nextMs = r.nextUpdateAtMs || null;

  if (nextMs) {
    const next = new Date(nextMs);
    const nextOnly = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (nextOnly < todayOnly) return "row-past";
    if (nextOnly.getTime() === todayOnly.getTime()) return "row-today";
  }

  return "";
}

function tdInput(value, onCommit, opts = {}) {
  const td = document.createElement("td");
  const inp = document.createElement("input");
  inp.className = "cell-edit";
  inp.type = opts.type || "text";
  inp.value = value || "";
  inp.placeholder = opts.placeholder || "";

  inp.addEventListener("blur", () => onCommit(inp.value));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
  });

  td.appendChild(inp);
  return td;
}

function tdHover(text) {
  const td = document.createElement("td");
  td.className = "hovertext";
  td.title = text || "";
  td.textContent = text || "";
  return td;
}

function tdBtn(label, onClick) {
  const td = document.createElement("td");
  td.className = "center";
  const b = document.createElement("button");
  b.className = "smallbtn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  td.appendChild(b);
  return td;
}

function tdDatePickerNoYear(mmddyyyy, onCommit) {
  const td = document.createElement("td");

  if (!document.getElementById("__rt_date_no_year_styles")) {
    const st = document.createElement("style");
    st.id = "__rt_date_no_year_styles";
    st.textContent = `
      .rt-datewrap{position:relative;display:inline-block;width:100%;}
      .rt-datewrap input[type="date"]{color:transparent !important;caret-color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important;}
      .rt-dateoverlay{position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;font-family:"Times New Roman", Times, serif;font-size:14px;color:#000;white-space:nowrap;}
    `;
    document.head.appendChild(st);
  }

  const wrap = document.createElement("div");
  wrap.className = "rt-datewrap";

  const inp = document.createElement("input");
  inp.className = "cell-edit";
  inp.type = "date";
  inp.value = mmddyyyyToDateInput(mmddyyyy);

  const overlay = document.createElement("div");
  overlay.className = "rt-dateoverlay";
  overlay.textContent = formatNoYearDate(mmddyyyy) || "";

  inp.addEventListener("change", () => {
    const full = dateInputToMMDDYYYY(inp.value);
    overlay.textContent = formatNoYearDate(full) || "";
    onCommit(full);
  });

  wrap.appendChild(inp);
  wrap.appendChild(overlay);
  td.appendChild(wrap);
  return td;
}

function tdDateTimePicker(ms, onCommit, opts = {}) {
  const showNow = !!opts.showNow;
  const stepMin = Number.isFinite(opts.stepMin) ? opts.stepMin : 5;

  const td = document.createElement("td");

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.gap = "6px";
  wrap.style.alignItems = "center";

  const inp = document.createElement("input");
  inp.className = "cell-edit";
  inp.type = "text";
  inp.readOnly = true;
  inp.value = ms ? formatNoYearDateTime(ms) : "";

  inp.addEventListener("click", async () => {
    const picked = await pickDateTimeMs("Select date/time", ms, stepMin, { showNow });
    if (picked) {
      inp.value = formatNoYearDateTime(picked);
      onCommit(picked);
    }
  });

  wrap.appendChild(inp);

  if (showNow) {
    const stamp = document.createElement("button");
    stamp.className = "smallbtn";
    stamp.textContent = "Now";
    stamp.addEventListener("click", () => {
      const now = Date.now();
      inp.value = formatNoYearDateTime(now);
      onCommit(now);
    });
    wrap.appendChild(stamp);
  }

  td.appendChild(wrap);
  return td;
}

function tdReadyCalled(r, tr) {
  const td = document.createElement("td");
  td.className = "center";

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.gap = "6px";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";

  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = isReadyCalled(r);
  c.disabled = !r.techVideo;

  const label = document.createElement("span");
  label.textContent = "Ready called";
  label.style.fontSize = "12px";

  c.addEventListener("change", async () => {
    if (!r.techVideo) { c.checked = false; return; }
    r.readyCalled = c.checked;
    r.status = c.checked ? "Ready called" : "";
    tr.className = rowClass(r);
    await safeUpdate(r.ro, { readyCalled: r.readyCalled, status: r.status });
  });

  wrap.appendChild(c);
  wrap.appendChild(label);
  td.appendChild(wrap);

  return {
    td,
    setEnabled: (on) => { c.disabled = !on; if (!on) c.checked = false; }
  };
}

function tdTechVideo(r, tr, readyCellApi) {
  const td = document.createElement("td");
  td.className = "center";

  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = !!r.techVideo;

  td.classList.toggle("cell-video-sent", !!r.techVideo);

  c.addEventListener("change", async () => {
    r.techVideo = c.checked;
    td.classList.toggle("cell-video-sent", !!r.techVideo);
    readyCellApi.setEnabled(r.techVideo);

    if (!r.techVideo) {
      r.readyCalled = false;
      r.status = "";
      await safeUpdate(r.ro, { techVideo: false, readyCalled: false, status: "" });
    } else {
      await safeUpdate(r.ro, { techVideo: true });
    }

    tr.className = rowClass(r);
  });

  td.appendChild(c);
  return td;
}

function tdWaiter(r, tr) {
  const td = document.createElement("td");
  td.className = "center";

  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = !!r.customerWaiting;

  c.addEventListener("change", async () => {
    r.customerWaiting = c.checked;
    tr.className = rowClass(r);
    await safeUpdate(r.ro, { customerWaiting: r.customerWaiting });
  });

  td.appendChild(c);
  return td;
}

function tdCheckSimple(checked, onToggle) {
  const td = document.createElement("td");
  td.className = "center";

  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = !!checked;
  c.addEventListener("change", () => onToggle(c.checked));

  td.appendChild(c);
  return td;
}

/* =========================================================
   RO EDIT (safe rename of Firestore doc id) + warning
========================================================= */

async function renameActiveRo(oldRo, newRo) {
  oldRo = String(oldRo || "").trim();
  newRo = String(newRo || "").trim();

  if (!oldRo || !newRo) return { ok: false, error: "Missing RO" };
  if (oldRo === newRo) return { ok: true };

  // basic guard (digits only). If your dealer uses letters, remove this.
  if (!/^\d+$/.test(newRo)) {
    return { ok: false, error: "RO must be numbers only." };
  }

  // uniqueness check
  const newRef = doc(db, COL_ACTIVE, newRo);
  const newSnap = await getDoc(newRef);
  if (newSnap.exists()) {
    return { ok: false, error: `RO ${newRo} already exists. Not allowed.` };
  }

  // ensure original exists
  const oldRef = doc(db, COL_ACTIVE, oldRo);
  const oldSnap = await getDoc(oldRef);
  if (!oldSnap.exists()) {
    return { ok: false, error: `Original RO ${oldRo} not found.` };
  }

  const data = oldSnap.data() || {};

  // move doc
  await setDoc(newRef, {
    ...data,
    ro: newRo,
    roCorrectedFrom: oldRo,
    roCorrectedAt: serverTimestamp()
  });

  await deleteDoc(oldRef);

  return { ok: true };
}

function tdEditableRO(r) {
  const td = document.createElement("td");
  const inp = document.createElement("input");
  inp.className = "cell-edit";
  inp.type = "text";
  inp.value = String(r.ro || "");
  inp.placeholder = "RO #";

  inp.addEventListener("blur", async () => {
    const oldRo = String(r.ro || "").trim();
    const newRo = String(inp.value || "").trim();

    if (!newRo || newRo === oldRo) {
      inp.value = oldRo;
      return;
    }

    const sure = confirm(
      `Change RO #?\n\nFROM: ${oldRo}\nTO:   ${newRo}\n\nThis will move/rename the ticket in Firestore.`
    );

    if (!sure) {
      inp.value = oldRo;
      return;
    }

    try {
      const res = await renameActiveRo(oldRo, newRo);
      if (!res.ok) {
        alert(res.error || "Could not change RO.");
        inp.value = oldRo;
        return;
      }

      // optimistic local update (snapshot will also refresh)
      r.ro = newRo;
      inp.value = newRo;
      alert("RO updated ✅");
    } catch (e) {
      alert(String(e?.message || e));
      inp.value = oldRo;
    }
  });

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    if (e.key === "Escape") { e.preventDefault(); inp.value = String(r.ro || ""); inp.blur(); }
  });

  td.appendChild(inp);
  return td;
}

/* ========================================================= */

function renderRows(rows) {
  const tb = $("tbody");
  tb.innerHTML = "";

  rows.forEach((r) => {
    if (!("readyCalled" in r)) r.readyCalled = isReadyCalled(r);

    const tr = document.createElement("tr");
    tr.className = rowClass(r);

    tr.appendChild(tdInput(r.customerName, (v) => safeUpdate(r.ro, { customerName: v })));
    tr.appendChild(tdInput(r.phone, (v) => safeUpdate(r.ro, { phone: v })));

    // RO # (editable with warning + safe Firestore rename)
    tr.appendChild(tdEditableRO(r));

    tr.appendChild(tdInput(r.tag, (v) => safeUpdate(r.ro, { tag: v })));
    tr.appendChild(tdDatePickerNoYear(r.roDate, (v) => safeUpdate(r.ro, { roDate: v })));
    tr.appendChild(tdDatePickerNoYear(r.promiseDate, (v) => safeUpdate(r.ro, { promiseDate: v })));
    tr.appendChild(tdInput(r.model, (v) => safeUpdate(r.ro, { model: v })));

    // Concern (editable)
    tr.appendChild(tdInput(r.concern, (v) => safeUpdate(r.ro, { concern: v })));

    const readyCell = tdReadyCalled(r, tr);
    tr.appendChild(readyCell.td);

    // Notes (editable)
    tr.appendChild(tdInput(r.notes, (v) => safeUpdate(r.ro, { notes: v })));

    tr.appendChild(tdTechVideo(r, tr, readyCell));

    tr.appendChild(tdDateTimePicker(
      r.calledAtMs || null,
      (ms) => safeUpdate(r.ro, { calledAtMs: ms }),
      { showNow: true, stepMin: 5 }
    ));

    tr.appendChild(tdDateTimePicker(
      r.nextUpdateAtMs || null,
      (ms) => { r.nextUpdateAtMs = ms; tr.className = rowClass(r); return safeUpdate(r.ro, { nextUpdateAtMs: ms }); },
      { showNow: false, stepMin: 15 }
    ));

    tr.appendChild(tdWaiter(r, tr));
    tr.appendChild(tdCheckSimple(!!r.hasLoaner, (v) => safeUpdate(r.ro, { hasLoaner: v })));

    tr.appendChild(tdBtn("Archive", async () => {
      const activeRef = doc(db, COL_ACTIVE, r.ro);
      const snap = await getDoc(activeRef);
      if (!snap.exists()) return;

      const data = snap.data();
      const archiveRef = doc(db, COL_ARCHIVE, r.ro);

      let pushAfterArchiveAtMs = null;
      try {
        const remote = await loadRemotePrivateSettings();
        const enabled = !!remote.pushAfterArchiveEnabled;
        const delayMin = Math.max(1, Number(remote.pushAfterArchiveDelayMin || 2));
        if (enabled) pushAfterArchiveAtMs = Date.now() + delayMin * 60 * 1000;
      } catch { }

      await setDoc(archiveRef, {
        ...data,
        ro: r.ro,
        archivedAt: serverTimestamp(),
        archivedRowClass: rowClass(r) || "",
        pushAfterArchiveAtMs,
        pushAfterArchiveSentAtMs: null,
        followup1SentAtMs: null,
        followup2SentAtMs: null,
        followupLastSlot: null,
        followupLastSentAtMs: null
      });

      await deleteDoc(activeRef);
    }));

    tb.appendChild(tr);
  });
}

function listenActive() {
  onSnapshot(collection(db, COL_ACTIVE), (qs) => {
    const rows = [];
    qs.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    rows.forEach((r) => { if (!r.ro) r.ro = r.id; });

    rows.sort((a, b) =>
      String(a.ro || a.id).localeCompare(String(b.ro || b.id), undefined, { numeric: true })
    );

    renderRows(rows);
  });
}

$("btnAdd")?.addEventListener("click", addNewRO);
$("btnSettings")?.addEventListener("click", () => openSettingsModal());

initScanner();

// notifications
const notifApi = initNotifications();
notifApi.bindStatusToButton("btnNotify");

initFollowUp();
initArchiveModal();
listenActive();