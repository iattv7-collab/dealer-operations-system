// public/js/ticketsUI.js
import { auth } from "./firebase.js";
import { listenTickets } from "./washTickets.js";

import { tabDefsForRole } from "./ui/roles.js";
import { colsForRole, colsForView } from "./ui/columns.js";
import { sortActiveQueue } from "./ui/sort.js";
import { computeEtaMap } from "./ui/scheduler.js";

import { ensureBaseStyles, buildTabs, buildTableSkeleton, el } from "./ui/dom.js";
import { renderRow } from "./ui/render.js";
import { buildActionsCell, handleTableClick } from "./ui/actions.js";

/* -------------------------------------------
   Public mount
--------------------------------------------*/
export function mountTicketsUI({ role, tableEl, msgEl, showTabs = true, searchEl = null, viewColumnKeys = [] }) {
  if (!tableEl) throw new Error("mountTicketsUI: missing tableEl");
  ensureBaseStyles();

  const cols = colsForView(role, viewColumnKeys);
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
      tabsEl.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      if (typeof rerender === "function") rerender();
    });
  }

  const tbody = buildTableSkeleton(tableEl, cols);

  let lastRows = [];
  let rerender = null;
  let searchText = "";

  const unsub = listenTickets(
    { statuses: ["queued", "washing", "washed", "closed"] },
    (rows) => {
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
    }
  );

  rerender = () => {
    const tabDef = TAB_DEFS.find((t) => t.id === currentTab) || TAB_DEFS[0];

    if (!Array.isArray(tabDef.statuses)) {
      tbody.innerHTML = "";
      const tr = el("tr");
      const td = el("td", { className: "muted", text: "Coming soon." });
      td.setAttribute("colspan", String(cols.length));
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const set = new Set(tabDef.statuses.map((s) => String(s).toLowerCase()));

    let rows = (lastRows || []).filter((r) =>
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

    const hasActions = cols.some((c) => c.key === "_actions");

    rows.forEach((t) => {
      const tr = renderRow(t, role, cols, etaMap);

      // ✅ Correct fix:
      // Fill the existing actions <td> placeholder instead of replacing/adding cells.
      if (hasActions) {
        const actionsTd = tr.querySelector('td[data-actions-cell="1"]');
        if (actionsTd) {
          actionsTd.innerHTML = "";
          actionsTd.appendChild(buildActionsCell({ t, role }));
        }
      }

      tbody.appendChild(tr);
    });
  };

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      searchText = String(searchEl.value || "").trim().toLowerCase();
      if (typeof rerender === "function") rerender();
    });
  }

  tableEl.addEventListener("click", async (e) => {
    await handleTableClick({ e, role, lastRows, msgEl });
  });

  rerender?.();
  return unsub;
}
