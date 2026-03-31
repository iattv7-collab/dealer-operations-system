// public/ro/app.js
import { auth, db } from "./firebase.js";
import { getUserDealerId, getUserProfile } from "../js/guard.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { pickDateTimeMs, formatNoYearDateTime, formatNoYearDate } from "./datetimePicker.js";
import { dateInputToMMDDYYYY, mmddyyyyToDateInput } from "./modules/utils.js";
import { COL_ACTIVE, COL_ARCHIVE, safeUpdate } from "./modules/firestore.js?v=20260314-1";
import { initNotifications } from "./modules/notifications.js";
import { initFollowUp } from "./modules/followup.js";
import { initArchiveModal } from "./modules/archive.js";
import { loadRemotePrivateSettings, openSettingsModal } from "./modules/settings.js";

const $ = (id) => document.getElementById(id);
let ACTIVE_ROWS = [];
let selectedRowEl = null;
let selectedRoKey = null;
let pendingHighlightRo = null;
let activeSnapshotInitialized = false;
let previousActiveRos = new Set();
let activeSearchTerm = "";
let currentUserProfile = null;
let activeTrackerTab = "mine";
let sharedTrackerTabs = [];
let iAmSharing = false;
let isShortView = false;

function applyColumnVisibility() {
  const table = document.querySelector(".tablewrap table");
  if (!table) return;

  const hideIndexes = [3, 4, 5, 6, 10];
  // 1-based columns:
  // 3 Customer
  // 4 Phone
  // 5 RO Date
  // 6 Promise Date
  // 10 Notes

  const rows = table.querySelectorAll("tr");

  rows.forEach((row) => {
    Array.from(row.children).forEach((cell, idx) => {
      const col = idx + 1;
      if (hideIndexes.includes(col)) {
        cell.style.display = isShortView ? "none" : "";
      }
    });
  });

  const btn = $("btnToggleView");
  if (btn) {
    btn.textContent = isShortView ? "Full View" : "Short View";
  }
}

function renderSignedInInfo(user, profile) {
  const el = $("signedInInfo");
  if (!el) return;

  const name = String(profile?.name || "").trim() || String(user?.email || "").trim();
  const dealerId = Number(profile?.dealerId || 0);

  el.textContent = `Dealer ${dealerId} · ${name}`;
}

function makeTabButton(label, key, active, onClickOverride = null) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.className = "smallbtn";
  btn.dataset.tabKey = key;

  btn.style.padding = "4px 10px";
  btn.style.borderRadius = "12px";
  btn.style.border = "1px solid #ccc";
  btn.style.cursor = "pointer";
  btn.style.fontFamily = "Times New Roman";
  btn.style.fontSize = "13px";
  btn.style.background = "#ffffff";
  btn.style.color = "#111";

  if (active) {
    btn.style.background = "#8feb94";

    btn.style.color = "#0b3d91";
    btn.style.fontWeight = "bold";
  }

  btn.addEventListener("click", () => {
    if (typeof onClickOverride === "function") {
      onClickOverride();
      return;
    }

    activeTrackerTab = key;
    renderTrackerTabs();
    renderRows(filterActiveRows(ACTIVE_ROWS));
  });

  return btn;
}

function renderTrackerTabs() {
  const wrap = $("trackerTabs");
  if (!wrap) return;

  wrap.innerHTML = "";

  if (String(currentUserProfile?.role || "").toLowerCase() === "advisor") {
    wrap.appendChild(makeTabButton("My ROs", "mine", activeTrackerTab === "mine"));

    sharedTrackerTabs.forEach((tab) => {
      const key = `shared:${tab.ownerId}`;
      wrap.appendChild(
        makeTabButton(`${tab.ownerName}'s ROs`, key, activeTrackerTab === key)
      );
    });

    const isSharing = iAmSharing;

    wrap.appendChild(
      makeTabButton(isSharing ? "Sharing" : "Share", "share", false, () => {
        openShareTrackerModal();
      })
    );
  } else {
    wrap.appendChild(makeTabButton("All ROs", "all", activeTrackerTab === "all"));
  }
}

async function loadSharedTrackersForMe(user, profile) {
  sharedTrackerTabs = [];

  if (!user || !profile) return;
  if (String(profile.role || "").toLowerCase() !== "advisor") return;

  const dealerId = Number(profile.dealerId || 0);
  if (!dealerId) return;

  const q = query(
    collection(db, "trackerShares"),
    where("dealerId", "==", dealerId),
    where("sharedWithIds", "array-contains", user.uid)
  );

  let snap;
  try {
    snap = await getDocs(q);
  } catch (e) {
    console.error("trackerShares query failed:", e);
    return;
  }

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const ownerId = String(data.ownerId || docSnap.id || "").trim();
    const ownerName = String(data.ownerName || ownerId).trim();

    if (!ownerId) return;

    sharedTrackerTabs.push({
      ownerId,
      ownerName
    });
  });
}

async function loadMySharingState(user) {
  iAmSharing = false;
  if (!user) return;

  const shareRef = doc(db, "trackerShares", user.uid);
  const snap = await getDoc(shareRef);

  if (!snap.exists()) {
    iAmSharing = false;
    return;
  }

  const data = snap.data() || {};
  const ids = Array.isArray(data.sharedWithIds) ? data.sharedWithIds : [];
  iAmSharing = ids.length > 0;
}

async function openShareTrackerModal() {
  const user = auth.currentUser;
  const profile = currentUserProfile;

  if (!user || !profile) return;
  if (String(profile.role || "").toLowerCase() !== "advisor") {
    alert("Only advisors can share their tracker.");
    return;
  }

  const dealerId = Number(profile.dealerId || 0);
  if (!dealerId) {
    alert("Missing dealerId.");
    return;
  }

  const usersSnap = await getDocs(
    query(collection(db, "users"), where("dealerId", "==", dealerId))
  );

  const advisors = [];
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const role = String(data.role || "").toLowerCase();
    const active = data.active !== false;

    if (!active) return;
    if (role !== "advisor") return;
    if (docSnap.id === user.uid) return;

    advisors.push({
      uid: docSnap.id,
      name: String(data.name || data.email || docSnap.id).trim()
    });
  });

  advisors.sort((a, b) => a.name.localeCompare(b.name));

  const shareRef = doc(db, "trackerShares", user.uid);
  const existingSnap = await getDoc(shareRef);
  const existing = existingSnap.exists() ? (existingSnap.data() || {}) : {};
  const existingIds = Array.isArray(existing.sharedWithIds) ? existing.sharedWithIds.map(String) : [];

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.35)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";

  const box = document.createElement("div");
  box.style.background = "#fff";
  box.style.padding = "18px";
  box.style.borderRadius = "8px";
  box.style.width = "520px";
  box.style.maxWidth = "92vw";
  box.style.maxHeight = "80vh";
  box.style.overflow = "auto";
  box.style.boxShadow = "0 10px 30px rgba(0,0,0,.3)";
  box.style.fontFamily = "Times New Roman";

  const h = document.createElement("div");
  h.textContent = "Share My RO Tracker";
  h.style.fontSize = "20px";
  h.style.marginBottom = "10px";
  h.style.fontWeight = "bold";

  const sub = document.createElement("div");
  sub.textContent = "Select one or more advisors who can view your tracker.";
  sub.style.marginBottom = "14px";

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gap = "8px";

  const checkboxRefs = [];

  advisors.forEach((a) => {
    const label = document.createElement("label");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.gap = "8px";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = a.uid;
    cb.checked = existingIds.includes(a.uid);

    const span = document.createElement("span");
    span.textContent = a.name;

    label.appendChild(cb);
    label.appendChild(span);
    list.appendChild(label);

    checkboxRefs.push(cb);
  });

  if (!advisors.length) {
    const empty = document.createElement("div");
    empty.textContent = "No other advisors found.";
    list.appendChild(empty);
  }

  const msg = document.createElement("div");
  msg.style.marginTop = "12px";
  msg.style.fontWeight = "bold";

  const btnRow = document.createElement("div");
  btnRow.style.marginTop = "14px";
  btnRow.style.display = "flex";
  btnRow.style.justifyContent = "flex-end";
  btnRow.style.gap = "8px";

  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.className = "smallbtn";

  const save = document.createElement("button");
  save.textContent = "Save";
  save.className = "smallbtn";

  cancel.onclick = () => document.body.removeChild(overlay);

  save.onclick = async () => {
    try {
      const selectedIds = checkboxRefs
        .filter((cb) => cb.checked)
        .map((cb) => String(cb.value));

      await setDoc(shareRef, {
        ownerId: user.uid,
        ownerName: String(profile.name || user.email || user.uid).trim(),
        dealerId,
        sharedWithIds: selectedIds,
        active: selectedIds.length > 0,
        updatedAt: serverTimestamp()
      });

      msg.textContent = "Sharing saved.";

      setTimeout(() => {
        document.body.removeChild(overlay);

        Promise.all([
          loadSharedTrackersForMe(user, currentUserProfile),
          loadMySharingState(user)
        ]).then(() => {
          renderTrackerTabs();
          renderRows(filterActiveRows(ACTIVE_ROWS));
        });
      }, 300);

    } catch (e) {
      msg.textContent = e?.message || "Save failed.";
    }
  };

  btnRow.appendChild(cancel);
  btnRow.appendChild(save);

  box.appendChild(h);
  box.appendChild(sub);
  box.appendChild(list);
  box.appendChild(msg);
  box.appendChild(btnRow);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function selectRow(tr, ro = null) {
  if (selectedRowEl && selectedRowEl !== tr) {
    selectedRowEl.classList.remove("row-selected");
  }
  selectedRowEl = tr;
  selectedRoKey = ro != null ? String(ro) : String(tr?.dataset?.ro || "");
  tr.classList.add("row-selected");
}

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


function formatPhoneInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function tdInput(value, onCommit, opts = {}) {
  const td = document.createElement("td");
  const inp = document.createElement("input");
  inp.className = "cell-edit";
  inp.type = opts.type || "text";
  inp.value = value || "";
  inp.placeholder = opts.placeholder || "";

  if (opts.phone) {
    inp.value = formatPhoneInput(inp.value);
    inp.addEventListener("input", () => {
      inp.value = formatPhoneInput(inp.value);
      if (opts.hoverFull) inp.title = inp.value || "";
    });
  }

  if (opts.hoverFull) {
    inp.title = inp.value || "";
    inp.addEventListener("input", () => {
      inp.title = inp.value || "";
    });
  }

  inp.addEventListener("blur", () => {
    if (opts.hoverFull) inp.title = inp.value || "";
    onCommit(inp.value);
  });

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

function openTextEditor(title, value, onSave) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.35)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";

  const box = document.createElement("div");
  box.style.background = "#fff";
  box.style.padding = "18px";
  box.style.borderRadius = "6px";
  box.style.width = "520px";
  box.style.boxShadow = "0 10px 30px rgba(0,0,0,.3)";
  box.style.fontFamily = "Times New Roman";

  const h = document.createElement("div");
  h.textContent = title;
  h.style.fontSize = "18px";
  h.style.marginBottom = "10px";

  const ta = document.createElement("textarea");
  ta.value = value || "";
  ta.style.width = "100%";
  ta.style.height = "160px";
  ta.style.fontFamily = "Times New Roman";
  ta.style.fontSize = "14px";
  ta.style.padding = "6px";

  const btnRow = document.createElement("div");
  btnRow.style.marginTop = "10px";
  btnRow.style.textAlign = "right";

  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.className = "smallbtn";
  cancel.style.marginRight = "8px";

  const save = document.createElement("button");
  save.textContent = "Save";
  save.className = "smallbtn";

  cancel.onclick = () => document.body.removeChild(overlay);

  save.onclick = () => {
    onSave(ta.value);
    document.body.removeChild(overlay);
  };

  btnRow.appendChild(cancel);
  btnRow.appendChild(save);

  box.appendChild(h);
  box.appendChild(ta);
  box.appendChild(btnRow);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  ta.focus();
}

function filterActiveRows(rows) {
  let filtered = rows;
  const role = String(currentUserProfile?.role || "").toLowerCase();

  if (role === "advisor") {
    if (activeTrackerTab === "mine") {
      filtered = filtered.filter((r) => String(r.advisorId || "") === String(auth.currentUser?.uid || ""));
    } else if (String(activeTrackerTab).startsWith("shared:")) {
      const ownerId = String(activeTrackerTab).split(":")[1] || "";
      filtered = filtered.filter((r) => String(r.advisorId || "") === ownerId);
    } else {
      filtered = [];
    }
  }

  const q = String(activeSearchTerm || "").trim().toLowerCase();
  if (!q) return filtered;

  return filtered.filter((r) => {
    const ro = String(r.ro || "").toLowerCase();
    const tag = String(r.tag || "").toLowerCase();
    const customer = String(r.customerName || "").toLowerCase();
    const phone = String(r.phone || "").toLowerCase();

    return (
      ro.includes(q) ||
      tag.includes(q) ||
      customer.includes(q) ||
      phone.includes(q)
    );
  });
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
    tr.dataset.ro = String(r.ro || "");

    // 1) RO #
    tr.appendChild(tdEditableRO(r));

    // 2) Tag #
    tr.appendChild(tdInput(r.tag, (v) => safeUpdate(r.ro, { tag: v })));

    // 3) Customer name
    tr.appendChild(tdInput(r.customerName, (v) => safeUpdate(r.ro, { customerName: v })));

    // 4) Phone
    tr.appendChild(tdInput(r.phone, (v) => safeUpdate(r.ro, { phone: v }), { phone: true }));

    // 5) RO Date
    tr.appendChild(tdDatePickerNoYear(r.roDate, (v) => safeUpdate(r.ro, { roDate: v })));

    // 6) Promise Date
    tr.appendChild(tdDatePickerNoYear(r.promiseDate, (v) => safeUpdate(r.ro, { promiseDate: v })));

    // 7) Model
    tr.appendChild(tdInput(r.model, (v) => safeUpdate(r.ro, { model: v })));

    // 8) Concern
    const concernCell = tdInput(
      r.concern,
      (v) => safeUpdate(r.ro, { concern: v }),
      { hoverFull: true }
    );

    concernCell.addEventListener("dblclick", () => {
      openTextEditor("Edit Concern", r.concern || "", (val) => {
        safeUpdate(r.ro, { concern: val });
      });
    });

    tr.appendChild(concernCell);

    // 9) Ready Called
    const readyCell = tdReadyCalled(r, tr);
    tr.appendChild(readyCell.td);

    // 10) Notes
    const notesCell = tdInput(
      r.notes,
      (v) => safeUpdate(r.ro, { notes: v }),
      { hoverFull: true }
    );

    notesCell.addEventListener("dblclick", () => {
      openTextEditor("Edit Notes", r.notes || "", (val) => {
        safeUpdate(r.ro, { notes: val });
      });
    });

    tr.appendChild(notesCell);

    // 11) Tech Video
    tr.appendChild(tdTechVideo(r, tr, readyCell));

    // 12) Called
    tr.appendChild(tdDateTimePicker(
      r.calledAtMs || null,
      (ms) => safeUpdate(r.ro, { calledAtMs: ms }),
      { showNow: true, stepMin: 5 }
    ));

    // 13) Next Update
    tr.appendChild(tdDateTimePicker(
      r.nextUpdateAtMs || null,
      (ms) => {
        r.nextUpdateAtMs = ms;
        tr.className = rowClass(r);
        return safeUpdate(r.ro, { nextUpdateAtMs: ms });
      },
      { showNow: false, stepMin: 15 }
    ));

    // 14) Waiter
    tr.appendChild(tdWaiter(r, tr));

    // 15) Loaner
    tr.appendChild(tdCheckSimple(!!r.hasLoaner, (v) => safeUpdate(r.ro, { hasLoaner: v })));

    // 16) Actions
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

    if (pendingHighlightRo && String(r.ro || "") === String(pendingHighlightRo)) {
      selectRow(tr, r.ro);
      tr.scrollIntoView({ block: "center", behavior: "smooth" });
      pendingHighlightRo = null;
    } else if (selectedRoKey && String(r.ro || "") === String(selectedRoKey)) {
      selectRow(tr, r.ro);
    }
  });

  applyColumnVisibility();
}

async function listenActive() {
  const user = auth.currentUser;
  const dealerId = user ? await getUserDealerId(user) : 0;
  const profile = user ? await getUserProfile(user) : null;
  const role = String(profile?.role || "").toLowerCase();

  currentUserProfile = profile;
  activeTrackerTab = role === "advisor" ? "mine" : "all";

  try {
    await loadSharedTrackersForMe(user, profile);
    await loadMySharingState(user);
  } catch (e) {
    console.error("loadSharedTrackersForMe failed:", e);
    sharedTrackerTabs = [];
    iAmSharing = false;
  }

  renderSignedInInfo(user, profile);
  renderTrackerTabs();

  const q = query(
    collection(db, COL_ACTIVE),
    where("dealerId", "==", dealerId)
  );

  onSnapshot(q,
    (qs) => {
      const rows = [];
      qs.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      rows.forEach((r) => { if (!r.ro) r.ro = r.id; });
      rows.sort((a, b) => String(a.ro || a.id).localeCompare(String(b.ro || b.id), undefined, { numeric: true }));

      const currentRos = new Set(rows.map((r) => String(r.ro || r.id || "")));

      if (activeSnapshotInitialized) {
        const newRows = rows.filter((r) => !previousActiveRos.has(String(r.ro || r.id || "")));
        if (newRows.length) {
          const newest = newRows[newRows.length - 1];
          pendingHighlightRo = String(newest.ro || newest.id || "");
        }
      } else {
        activeSnapshotInitialized = true;
      }

      previousActiveRos = currentRos;
      ACTIVE_ROWS = rows;
      renderRows(filterActiveRows(ACTIVE_ROWS));
    },
    (err) => {
      console.error("RO tracker read error:", err);
      alert("RO tracker read error: " + err.message);
    }
  );
}

$("btnSettings")?.addEventListener("click", () => openSettingsModal());

$("btnToggleView")?.addEventListener("click", () => {
  isShortView = !isShortView;
  applyColumnVisibility();
});

$("searchActive")?.addEventListener("input", (e) => {
  activeSearchTerm = e.target.value || "";
  renderRows(filterActiveRows(ACTIVE_ROWS));
});

$("searchActive")?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.target.value = "";
    activeSearchTerm = "";
    renderRows(ACTIVE_ROWS);
  }
});

const notifApi = initNotifications();
notifApi.bindStatusToButton("btnNotify");

initFollowUp();
initArchiveModal();;

$("tbody")?.addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (tr) selectRow(tr, tr.dataset.ro || "");
});

listenActive();