// public/js/ticketsUI.js
import { auth, db } from "./firebase.js";
import {
  listenTickets,
  setTicketStatus,
  requestRewash,
  fmtCreated,
  fmtTs,
  fmtTime
} from "./washTickets.js";

import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* -------------------------------------------
   Tabs (UNIVERSAL everywhere)
--------------------------------------------*/
const TAB_DEFS_BY_ROLE = {
  wash: [
    { id: "active", label: "Active", statuses: ["queued", "washing"] },
    { id: "washed", label: "Washed", statuses: ["washed"] },
  ],
  default: [
    { id: "active", label: "Active", statuses: ["queued", "washing"] },
    { id: "washed", label: "Washed", statuses: ["washed"] },
    { id: "closed", label: "Closed", statuses: ["closed"] },

    // future tabs
    { id: "pickup", label: "Pickup", statuses: null },
    { id: "slots", label: "Swap/Slots", statuses: null },
    { id: "history", label: "History", statuses: null }
  ]
};

function tabDefsForRole(role) {
  return TAB_DEFS_BY_ROLE[role] || TAB_DEFS_BY_ROLE.default;
}

/* -------------------------------------------
   Roles (UI gating ONLY)
--------------------------------------------*/
const ROLE_CAPS = {
  dropoff: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },
  staff: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },

  booker: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },
  qc: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },

  wash: { canNeedBy: false, canRewash: false, canWashOps: true, canArchive: false, canEditRO: false },

  advisor: { canNeedBy: true, canRewash: true, canWashOps: false, canArchive: false, canEditRO: true },

  manager: { canNeedBy: true, canRewash: true, canWashOps: true, canArchive: true, canEditRO: true },
  admin: { canNeedBy: true, canRewash: true, canWashOps: true, canArchive: true, canEditRO: true }
};

function capsFor(role) {
  return ROLE_CAPS[role] || ROLE_CAPS.staff;
}

/* -------------------------------------------
   Columns (MASTER set)
--------------------------------------------*/
const MASTER_COLS = [
  { key: "tag", label: "Tag" },
  { key: "ro", label: "RO" },
  { key: "priority", label: "Priority" },
  { key: "cycleType", label: "Type" },

  { key: "needBy", label: "need By" },
  { key: "eta", label: "ETA (Finish)" },
  { key: "location", label: "Location" },
  { key: "status", label: "Status" },
  { key: "created", label: "Created" },
  { key: "washed", label: "Last Washed" },
  { key: "cpBooked", label: "CP Booked" },
  { key: "wtyBooked", label: "WTY Booked" },
  { key: "qcDone", label: "QC Done" },
  { key: "notes", label: "Notes" },
  { key: "_actions", label: "Actions" }
];

const VISIBLE_COLS_BY_ROLE = {
  dropoff: ["tag", "ro", "priority", "eta", "location", "status", "created", "notes", "_actions"],
  staff: ["tag", "ro", "priority", "eta", "location", "status", "created", "notes", "_actions"],

  wash: ["tag", "ro", "priority", "cycleType", "needBy", "eta", "location", "status", "created", "washed", "notes", "_actions"],

  advisor: ["tag", "ro", "priority", "needBy", "eta", "location", "status", "created", "washed", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],

  booker: ["tag", "ro", "status", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],
  qc: ["tag", "ro", "location", "status", "qcDone", "notes", "_actions"],

  manager: ["tag", "ro", "priority", "needBy", "eta", "location", "status", "created", "washed", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],
  admin: ["tag", "ro", "priority", "needBy", "eta", "location", "status", "created", "washed", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],
};

function colsForRole(role) {
  const keys = VISIBLE_COLS_BY_ROLE[role] || VISIBLE_COLS_BY_ROLE.staff;
  return MASTER_COLS.filter(c => keys.includes(c.key));
}

/* -------------------------------------------
   Sorting (UNIVERSAL for Active)
--------------------------------------------*/
function sortActiveQueue(a, b) {
  const aw = a.waiter === true;
  const bw = b.waiter === true;
  if (aw !== bw) return aw ? -1 : 1;

  const an = (typeof a.needByAtMs === "number") ? a.needByAtMs : null;
  const bn = (typeof b.needByAtMs === "number") ? b.needByAtMs : null;

  if (an !== null || bn !== null) {
    if (an === null) return 1;
    if (bn === null) return -1;
    if (an !== bn) return an - bn;
  }

  const ac = (typeof a.createdAtMs === "number") ? a.createdAtMs : 0;
  const bc = (typeof b.createdAtMs === "number") ? b.createdAtMs : 0;
  return ac - bc;
}

/* -------------------------------------------
   ETA (UI-only)
--------------------------------------------*/
const MINUTES_PER_CAR = 15;

function computeEtaMap(activeSorted) {
  const now = Date.now();
  const map = new Map();
  activeSorted.forEach((t, idx) => {
    const etaMs = now + (idx + 1) * MINUTES_PER_CAR * 60 * 1000;
    map.set(t.id, etaMs);
  });
  return map;
}

/* -------------------------------------------
   Priority label
--------------------------------------------*/
function isRewashTicket(t) {
  return (
    t.priorityType === "rewash" ||
    (typeof t.rewashRequestedAtMs === "number" && t.rewashRequestedAtMs > 0)
  );
}

function priorityLabel(t) {
  if (t.waiter === true) return "WAITer";

  if (typeof t.needByAtMs === "number" && t.needByAtMs > 0) {
    if (isRewashTicket(t)) return "REWASH";
    return "NEED BY";
  }

  if (isRewashTicket(t)) return "REWASH";
  return "NORMAL";
}

/* -------------------------------------------
   DOM helpers
--------------------------------------------*/
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = !!v;
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    if (typeof c === "string") node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  });
  return node;
}

function ensureBaseStyles() {
  if (document.getElementById("__ticketsUI_styles")) return;

  const style = el("style", { id: "__ticketsUI_styles" }, `
    body { margin: 10px 20px; }

    .tickets-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 0 0 10px 0;
    }

    .tickets-tabs button {
      padding: 6px 12px;
      cursor: pointer;
      border: 1px solid #999;
      border-radius: 6px;
      background: #f7f7f7;
    }

    .tickets-tabs button.active {
      background: #ffeaa7;
      border-color: #555;
      font-weight: bold;
      outline: 2px solid #000;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }

    th, td {
      padding: 6px 10px;
      border: 1px solid #ccc;
      white-space: nowrap;
      font-size: 13px;
    }

    th {
      background: #f0f0f0;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    tbody tr:nth-child(even) { background: #fafafa; }

    .row-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    button { font-size: 14px; }
    .muted { color: #666; }
    .ro-input { width: 110px; padding: 4px 6px; font-family: inherit; }
  `);

  document.head.appendChild(style);
}

function buildTabs(containerEl, tabDefs) {
  const wrap = el("div", { className: "tickets-tabs" });
  tabDefs.forEach((t, idx) => {
    const b = el("button", { type: "button", "data-tab": t.id, text: t.label });
    if (idx === 0) b.classList.add("active");
    wrap.appendChild(b);
  });
  containerEl.insertBefore(wrap, containerEl.firstChild);
  return wrap;
}

function buildTableSkeleton(tableEl, cols) {
  tableEl.innerHTML = "";
  const thead = el("thead");
  const hr = el("tr");
  cols.forEach((c) => hr.appendChild(el("th", { text: c.label })));
  thead.appendChild(hr);

  const tbody = el("tbody");
  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);
  return tbody;
}

/* -------------------------------------------
   Cell formatting
--------------------------------------------*/
function formatCell(key, t, etaMap) {
  if (key === "tag") return t.tag || "";
  if (key === "ro") return t.ro || "";
  if (key === "priority") return priorityLabel(t);

  if (key === "cycleType") {
    const isRewash =
      t.isRewashCycle === true ||
      t.priorityType === "rewash" ||
      (typeof t.rewashRequestedAtMs === "number" && t.rewashRequestedAtMs > 0);

    return isRewash ? "REWASH" : "WASH";
  }

  if (key === "needBy") {
    return (typeof t.needByAtMs === "number" && t.needByAtMs > 0) ? fmtTime(t.needByAtMs) : "";
  }

  if (key === "eta") {
    const ms = etaMap?.get(t.id);
    return ms ? fmtTime(ms) : "";
  }

  if (key === "location") return t.location || "";
  if (key === "status") return t.status || "";
  if (key === "created") return fmtCreated(t);
  if (key === "washed") return fmtTs(t.washedAt);
  if (key === "notes") return t.notes || "";
  return t[key] ?? "";
}

/* -------------------------------------------
   Booker/QC helpers
--------------------------------------------*/
const NO_QC_TOKEN = "__NO_QC__";

function buildLastEditedPatch(role, uid, fields) {
  return {
    updatedAt: serverTimestamp(),
    lastEditedAtMs: Date.now(),
    lastEditedBy: uid,
    lastEditedRole: role,
    lastEditedFields: fields
  };
}

let __qcUsersCache = null;

async function getQcUsers() {
  if (__qcUsersCache) return __qcUsersCache;

  const uq = query(collection(db, "users"), where("role", "==", "qc"));
  const snap = await getDocs(uq);

  const users = [];
  snap.forEach((d) => {
    const u = d.data() || {};
    users.push({
      uid: d.id,
      email: u.email || "",
      name: u.name || u.displayName || ""
    });
  });

  __qcUsersCache = users;
  return users;
}

async function pickQcUserUid() {
  const users = await getQcUsers();
  if (!users.length) {
    alert("No QC users found.");
    return null;
  }

  const lines = users.map((u, i) => {
    const label = String((u.name || u.email || u.uid) || "").trim();
    return `${i + 1}) ${label}`;
  });

  const choice = prompt(
    `Assign QC to which user?\n\n${lines.join("\n")}\n\nType a number:`
  );

  const n = Number(choice);
  if (!Number.isFinite(n) || n < 1 || n > users.length) return null;

  return users[n - 1].uid;
}

/* -------------------------------------------
   Actions
--------------------------------------------*/
function canRequestRewash(t) {
  return String(t.status || "").toLowerCase() === "washed";
}

async function pickDateTimeMs(titleText) {
  if (!document.getElementById("__dtpicker_styles")) {
    const st = document.createElement("style");
    st.id = "__dtpicker_styles";
    st.textContent = `
      .dtp-backdrop{
        position:fixed; inset:0; background:rgba(0,0,0,.35);
        display:flex; align-items:center; justify-content:center;
        z-index:9999;
      }
      .dtp-modal{
        background:#fff; border:1px solid #ccc; border-radius:10px;
        padding:14px; width:min(420px, calc(100vw - 24px));
        box-shadow:0 10px 30px rgba(0,0,0,.25);
        font-family:"Times New Roman", Times, serif;
      }
      .dtp-title{ font-weight:bold; margin-bottom:10px; }
      .dtp-row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      .dtp-row input{ font-family:inherit; font-size:16px; padding:6px 8px; }
      .dtp-preview{ margin-top:8px; color:#444; }
      .dtp-actions{ margin-top:12px; display:flex; gap:10px; justify-content:flex-end; }
      .dtp-actions button{ font-family:inherit; font-size:16px; padding:6px 10px; }
      .dtp-muted{ color:#666; font-size:14px; }
    `;
    document.head.appendChild(st);
  }

  return await new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dtp-backdrop";

    const modal = document.createElement("div");
    modal.className = "dtp-modal";

    const title = document.createElement("div");
    title.className = "dtp-title";
    title.textContent = titleText;

    const row = document.createElement("div");
    row.className = "dtp-row";

    const input = document.createElement("input");
    input.type = "datetime-local";
    input.step = "60";

    const hint = document.createElement("div");
    hint.className = "dtp-muted";
    hint.textContent = "Pick date & time, then Save.";

    row.appendChild(input);
    row.appendChild(hint);

    const preview = document.createElement("div");
    preview.className = "dtp-preview";
    preview.textContent = "Selected: —";

    const actions = document.createElement("div");
    actions.className = "dtp-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    modal.appendChild(title);
    modal.appendChild(row);
    modal.appendChild(preview);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    function updatePreview() {
      const raw = input.value;
      if (!raw) { preview.textContent = "Selected: —"; return; }
      const ms = new Date(raw).getTime();
      if (!Number.isFinite(ms)) { preview.textContent = "Selected: (invalid)"; return; }
      preview.textContent = "Selected: " + new Date(ms).toLocaleString("en-US", {
        year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit"
      });
    }
    input.addEventListener("input", updatePreview);

    function close(val) { backdrop.remove(); resolve(val); }
    cancelBtn.addEventListener("click", () => close(null));

    saveBtn.addEventListener("click", () => {
      const raw = input.value;
      const ms = raw ? new Date(raw).getTime() : NaN;
      if (!raw || !Number.isFinite(ms)) {
        preview.textContent = "Selected: Please pick a valid date/time.";
        return;
      }
      close(ms);
    });

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(null); });

    window.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") {
        window.removeEventListener("keydown", onKey);
        close(null);
      }
    });

    input.focus();
  });
}

async function requestRewashWithNeedBy(ticketId, user, role, needByMs) {
  await requestRewash(ticketId, user, role);

  if (Number.isFinite(needByMs)) {
    const ref = doc(db, "washTickets", ticketId);
    await updateDoc(ref, {
      needByAtMs: needByMs,
      needBySetBy: user.uid,
      ...buildLastEditedPatch(role, user.uid, ["needByAtMs", "needBySetBy"])
    });
  }
}

async function setNeedBy(ticketId, user, needByMs) {
  const ref = doc(db, "washTickets", ticketId);
  await updateDoc(ref, {
    priorityType: "needby",
    needByAtMs: needByMs,
    needBySetBy: user.uid,
    updatedAt: serverTimestamp()
  });
}

function renderRow(t, role, cols, etaMap) {
  const caps = capsFor(role);
  const tr = el("tr", { "data-id": t.id });

  cols.forEach((c) => {
    if (c.key === "ro") {
      const status = String(t.status || "").toLowerCase();
      const isClosed = status === "closed";

      if (caps.canEditRO && !isClosed) {
        const td = el("td");
        const inp = el("input", {
          type: "text",
          className: "ro-input",
          value: t.ro || "",
          "data-ro-input": "1"
        });

        inp.addEventListener("blur", async () => {
          const user = auth.currentUser;
          if (!user) return;

          const val = String(inp.value || "").trim();
          const ref = doc(db, "washTickets", t.id);

          await updateDoc(ref, {
            ro: val,
            updatedAt: serverTimestamp()
          });
        });

        td.appendChild(inp);
        tr.appendChild(td);
        return;
      }

      tr.appendChild(el("td", { text: t.ro || "" }));
      return;
    }

    if (c.key === "cpBooked" || c.key === "wtyBooked" || c.key === "qcDone") {
      const td = el("td");

      let at = null;
      let by = "";

      if (c.key === "cpBooked") { at = t.cpBookedAt; by = t.cpBookedBy || ""; }
      if (c.key === "wtyBooked") { at = t.wtyBookedAt; by = t.wtyBookedBy || ""; }
      if (c.key === "qcDone") { at = t.qcDoneAt; by = t.qcDoneBy || ""; }

      const isDone = !!at;

      td.textContent = isDone ? "✅" : "";

      if (isDone) {
        const when = fmtTs(at) || "";
        td.title = `By: ${by || "unknown"}${when ? " — " + when : ""}`;
        td.style.cursor = "help";
      }

      tr.appendChild(td);
      return;
    }

    if (c.key === "_actions") {
      const td = el("td");
      const wrap = el("div", { className: "row-actions" });

      const bRewash = el("button", { type: "button", className: "btn-rewash", text: "Request Rewash" });
      const bNeedBy = el("button", { type: "button", className: "btn-needby", text: "Set Need By" });

      const bWashing = el("button", { type: "button", className: "btn-washing", text: "Start Wash" });
      const bWashed = el("button", { type: "button", className: "btn-washed", text: "Mark Complete" });

      const bArchive = el("button", { type: "button", className: "btn-archive", text: "Archive" });

      const bCpBooked = el("button", { type: "button", className: "btn-cpbooked", text: "CP Booked" });
      const bWtyBooked = el("button", { type: "button", className: "btn-wtybooked", text: "WTY Booked" });
      const bRequestQc = el("button", { type: "button", className: "btn-requestqc", text: "Request QC" });
      const bNoQc = el("button", { type: "button", className: "btn-noqc", text: "No QC Required" });

      const bQcDone = el("button", { type: "button", className: "btn-qcdone", text: "Mark QC Complete" });

      const status = String(t.status || "").toLowerCase();
      const isClosed = status === "closed";

      bRewash.disabled = isClosed || !(caps.canRewash && canRequestRewash(t));
      bNeedBy.disabled = isClosed || !(caps.canNeedBy && (status === "queued" || status === "washing"));
      bWashing.disabled = isClosed || !(caps.canWashOps && status === "queued");
      bWashed.disabled = isClosed || !(caps.canWashOps && status === "washing");
      bArchive.disabled = !(caps.canArchive && !isClosed);

      const canCpBook = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");
      const canWtyBook = (role === "booker" || role === "manager" || role === "admin");
      const canQcDecision = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");

      const qcAssigned = typeof t.qcAssignedTo === "string" ? t.qcAssignedTo : "";
      const qcIsNoQc = qcAssigned === NO_QC_TOKEN;
      const qcIsRealAssigned = !!qcAssigned && !qcIsNoQc;

      bCpBooked.disabled = !canCpBook || isClosed || !!t.cpBookedAt;
      bWtyBooked.disabled = !canWtyBook || isClosed || !!t.wtyBookedAt;

      bRequestQc.disabled = !canQcDecision || isClosed || !!t.qcDoneAt || qcIsRealAssigned;
      bNoQc.disabled = !canQcDecision || isClosed || !!t.qcDoneAt || qcIsNoQc;

      const isQc = role === "qc";
      bQcDone.disabled = !isQc || isClosed || !!t.qcDoneAt;

      wrap.appendChild(bRewash);
      wrap.appendChild(bNeedBy);
      wrap.appendChild(bWashing);
      wrap.appendChild(bWashed);

      if (canCpBook) wrap.appendChild(bCpBooked);
      if (canWtyBook) wrap.appendChild(bWtyBooked);

      if (canQcDecision) {
        wrap.appendChild(bRequestQc);
        wrap.appendChild(bNoQc);
      }

      if (isQc) wrap.appendChild(bQcDone);

      wrap.appendChild(bArchive);

      td.appendChild(wrap);
      tr.appendChild(td);
      return;
    }

    tr.appendChild(el("td", { text: formatCell(c.key, t, etaMap) }));
  });

  return tr;
}

function setRowButtonsDisabled(tr, disabled) {
  tr.querySelectorAll("button").forEach((b) => {
    if (disabled) {
      b.dataset.prevDisabled = b.disabled ? "1" : "0";
      b.disabled = true;
    } else {
      if (b.dataset.prevDisabled != null) {
        b.disabled = b.dataset.prevDisabled === "1";
        delete b.dataset.prevDisabled;
      }
    }
  });
}

/* -------------------------------------------
   Public mount
--------------------------------------------*/
export function mountTicketsUI({ role, tableEl, msgEl, showTabs = true, searchEl = null }) {
  if (!tableEl) throw new Error("mountTicketsUI: missing tableEl");
  ensureBaseStyles();

  const cols = colsForRole(role);
  const containerEl = tableEl.parentElement || document.body;
  const TAB_DEFS = tabDefsForRole(role);

  let currentTab = "active";
  let tabsEl = null;

  if (showTabs) {
    tabsEl = buildTabs(containerEl, TAB_DEFS);
    tabsEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (!b) return;
      currentTab = b.getAttribute("data-tab");
      tabsEl.querySelectorAll("button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      if (typeof rerender === "function") rerender();
    });
  }

  const tbody = buildTableSkeleton(tableEl, cols);

  let lastRows = [];
  let rerender = null;
  let searchText = "";

  const unsub = listenTickets({ statuses: ["queued", "washing", "washed", "closed"] }, (rows) => {
    // ✅ IMPORTANT: DO NOT auto-clear msgEl.err here.
    // If an action is denied by Firestore rules, we WANT the red message to remain visible.

    let out = rows || [];

    if (role === "qc") {
      const uid = auth.currentUser?.uid || null;
      out = uid ? out.filter((t) => t.qcAssignedTo === uid) : [];

      const isSearching = !!String(searchText || "").trim();
      if (!isSearching) {
        out = out.filter((t) => !t.qcDoneAt);
      }
    }

    lastRows = out;
    if (typeof rerender === "function") rerender();
  });

  rerender = () => {
    const tabDef = TAB_DEFS.find(t => t.id === currentTab) || TAB_DEFS[0];

    if (!Array.isArray(tabDef.statuses)) {
      tbody.innerHTML = "";
      const tr = el("tr");
      const td = el("td", { className: "muted", text: "Coming soon." });
      td.setAttribute("colspan", String(cols.length));
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const set = new Set(tabDef.statuses.map(s => String(s).toLowerCase()));

    let rows = (lastRows || []).filter(r =>
      set.has(String(r.status || "").toLowerCase())
    );

    if (searchText) {
      rows = rows.filter((t) => {
        const tag = String(t.tag || "").toLowerCase();
        const ro = String(t.ro || "").toLowerCase();
        return tag.includes(searchText) || ro.includes(searchText);
      });
    }

    let etaMap = null;
    if (currentTab === "active") {
      rows = rows.slice().sort(sortActiveQueue);
      etaMap = computeEtaMap(rows);
    }

    tbody.innerHTML = "";

    if (!rows.length) {
      const tr = el("tr");
      const td = el("td", { className: "muted", text: "No tickets." });
      td.setAttribute("colspan", String(cols.length));
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((t) => tbody.appendChild(renderRow(t, role, cols, etaMap)));
  };

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      searchText = String(searchEl.value || "").trim().toLowerCase();
      if (typeof rerender === "function") rerender();
    });
  }

  tableEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const id = tr.getAttribute("data-id");
    const user = auth.currentUser;

    if (!user) {
      if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Not signed in."; }
      return;
    }

    const tRow = (lastRows || []).find(x => x.id === id) || {};
    const isRewash = isRewashTicket(tRow);
    const startedMs = (typeof tRow.washingStartedAtMs === "number") ? tRow.washingStartedAtMs : null;

    const caps = capsFor(role);

    try {
      setRowButtonsDisabled(tr, true);

      const canCpBook = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");
      const canWtyBook = (role === "booker" || role === "manager" || role === "admin");
      const canQcDecision = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");

      if (btn.classList.contains("btn-cpbooked")) {
        if (!canCpBook) return;

        const ref = doc(db, "washTickets", id);
        await updateDoc(ref, {
          cpBookedAt: serverTimestamp(),
          cpBookedBy: user.uid,
          ...buildLastEditedPatch(role, user.uid, ["cpBookedAt", "cpBookedBy"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "CP booked saved."; }
        return;
      }

      if (btn.classList.contains("btn-wtybooked")) {
        if (!canWtyBook) return;

        const ref = doc(db, "washTickets", id);
        await updateDoc(ref, {
          wtyBookedAt: serverTimestamp(),
          wtyBookedBy: user.uid,
          ...buildLastEditedPatch(role, user.uid, ["wtyBookedAt", "wtyBookedBy"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "WTY booked saved."; }
        return;
      }

      if (btn.classList.contains("btn-requestqc")) {
        if (!canQcDecision) return;

        const assignedUid = await pickQcUserUid();
        if (!assignedUid) return;

        const ref = doc(db, "washTickets", id);
        await updateDoc(ref, {
          qcRequestedAt: serverTimestamp(),
          qcRequestedBy: user.uid,
          qcAssignedTo: assignedUid,
          ...buildLastEditedPatch(role, user.uid, ["qcRequestedAt", "qcRequestedBy", "qcAssignedTo"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "QC requested & assigned."; }
        return;
      }

      if (btn.classList.contains("btn-noqc")) {
        if (!canQcDecision) return;

        const ref = doc(db, "washTickets", id);
        await updateDoc(ref, {
          qcRequestedAt: serverTimestamp(),
          qcRequestedBy: user.uid,
          qcAssignedTo: NO_QC_TOKEN,
          ...buildLastEditedPatch(role, user.uid, ["qcRequestedAt", "qcRequestedBy", "qcAssignedTo"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Set to No QC Required."; }
        return;
      }

      if (btn.classList.contains("btn-qcdone")) {
        if (role !== "qc") return;

        const ref = doc(db, "washTickets", id);
        await updateDoc(ref, {
          qcDoneAt: serverTimestamp(),
          qcDoneBy: user.uid,
          ...buildLastEditedPatch("qc", user.uid, ["qcDoneAt", "qcDoneBy"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "QC marked complete."; }
        return;
      }

      if (btn.classList.contains("btn-rewash")) {
        if (!caps.canRewash) return;

        const ms = await pickDateTimeMs("Request rewash by what time?");
        if (ms === null) return;
        if (!Number.isFinite(ms)) {
          if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Invalid date/time."; }
          return;
        }

        await requestRewashWithNeedBy(id, user, role, ms);
        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Rewash requested."; }
        return;
      }

      if (btn.classList.contains("btn-needby")) {
        if (!caps.canNeedBy) return;

        const ms = await pickDateTimeMs("Set Need By date/time:");
        if (ms === null) return;
        if (!Number.isFinite(ms)) {
          if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Invalid date/time."; }
          return;
        }

        await setNeedBy(id, user, ms);
        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Need By saved."; }
        return;
      }

      if (btn.classList.contains("btn-washing")) {
        if (!caps.canWashOps) return;

        await setTicketStatus(id, "washing", user, role, { isRewash });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Marked as washing."; }
        return;
      }

      if (btn.classList.contains("btn-washed")) {
        if (!caps.canWashOps) return;

        await setTicketStatus(id, "washed", user, role, {
          isRewash,
          washingStartedAtMs: startedMs
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Marked as washed."; }
        return;
      }

      if (btn.classList.contains("btn-archive")) {
        if (!caps.canArchive) return;
        await setTicketStatus(id, "closed", user, role);
        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Archived (closed)."; }
        return;
      }
    } catch (err) {
      console.error(err);
      if (msgEl) { msgEl.className = "err"; msgEl.textContent = err?.message || "Error updating ticket."; }
    } finally {
      setRowButtonsDisabled(tr, false);
    }
  });

  rerender?.();
  return unsub;
}
