// public/js/ticketsUI.js
import { auth } from "./firebase.js";
import { listenTickets } from "./rosWash.js";

import { tabDefsForRole } from "./ui/roles.js";
import { colsForView } from "./ui/columns.js";
import { sortActiveQueue } from "./ui/sort.js";
import { computeEtaMap } from "./ui/scheduler.js";

import { ensureBaseStyles, buildTabs, buildTableSkeleton, el } from "./ui/dom.js";
import { renderRow } from "./ui/render.js";
import { buildActionsCell, handleTableClick } from "./ui/actions.js";

import { listenSystemSettings } from "./settings.js";

/* -------------------------------------------
   Public mount
--------------------------------------------*/
export function mountTicketsUI({
  role,
  tableEl,
  msgEl,
  showTabs = true,
  searchEl = null,
  viewColumnKeys = [],
  canEditTickets = false,
  correctionsPerms = {}, // ✅ per-field corrections perms (tag/ro/location/advisorNumber)
}) {
  if (!tableEl) throw new Error("mountTicketsUI: missing tableEl");
  ensureBaseStyles();

  const cols = colsForView(role, viewColumnKeys);
  const containerEl = tableEl.parentElement || document.body;

  // ✅ Base tabs for role
  const TAB_DEFS = tabDefsForRole(role).slice();

  // ✅ Add Corrections tab ONLY if permission enabled
  if (canEditTickets === true) {
    TAB_DEFS.push({
      id: "corrections",
      label: "Corrections",
      statuses: ["queued", "washing", "washed", "closed"],
    });
  }

  let currentTab = "active";
  let tabsEl = null;

  // ✅ System settings cache (bays + minutes)
  let sys = null;

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
  let searchResultInfo = null; // { type, results: [{ status, tabId, tabLabel, ro, tag }] }

  // ✅ Listen system settings (so CLOSED means baysOpen = 0 everywhere)
  const unsubSys = listenSystemSettings((s) => {
    sys = s || null;
    if (typeof rerender === "function") rerender();
  });

  const unsub = listenTickets(
    { statuses: ["queued", "washing", "washed", "closed"] },
    (rows) => {
      let out = rows || [];

      if (role === "qc") {
        const uid = auth.currentUser?.uid || null;
        out = uid ? out.filter((t) => t.qcAssignedTo === uid) : [];

        const isSearching = !!String(searchText || "").trim();
        if (!isSearching) out = out.filter((t) => !t.qcDoneAt);
      }

      lastRows = out;
      if (typeof rerender === "function") rerender();
    }
  );

  function switchToTab(tabId) {
    if (!tabId) return;
    currentTab = tabId;

    tabsEl?.querySelectorAll("button").forEach((x) =>
      x.classList.remove("active")
    );

    tabsEl
      ?.querySelector(`button[data-tab="${currentTab}"]`)
      ?.classList.add("active");

    rerender();
  }

  function buildFoundLink(label, onClick) {
    const span = document.createElement("span");
    span.textContent = label;
    span.style.cursor = "pointer";
    span.style.color = "#0a7a2a";
    span.style.fontWeight = "bold";
    span.style.textDecoration = "underline";
    span.style.display = "inline-block";
    span.style.padding = "2px 8px";
    span.style.border = "1px solid #0a7a2a";
    span.style.borderRadius = "999px";
    span.style.margin = "2px 6px 2px 0";
    span.style.background = "#eefaf0";
    span.onclick = onClick;
    return span;
  }

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
      const allMatches = (lastRows || []).filter((t) => {
        const tag = String(t.tag || "").toLowerCase();
        const ro = String(t.ro || "").toLowerCase();
        return tag.includes(searchText) || ro.includes(searchText);
      });

      searchResultInfo = null;

      if (allMatches.length) {
        const inCurrentTab = allMatches.filter((t) =>
          set.has(String(t.status || "").toLowerCase())
        );

        if (inCurrentTab.length) {
          rows = inCurrentTab;
        } else {
          const mapped = allMatches.map((found) => {
            const foundStatus = String(found.status || "").toLowerCase();

            const foundTab = TAB_DEFS.find((tab) =>
              Array.isArray(tab.statuses) &&
              tab.statuses.map((s) => String(s).toLowerCase()).includes(foundStatus)
            );

            return {
              status: foundStatus,
              tabId: foundTab?.id || null,
              tabLabel: foundTab?.label || foundStatus,
              ro: found.ro || "",
              tag: found.tag || "",
            };
          });

          // de-dupe by tabId + status + ro + tag
          const seen = new Set();
          const results = mapped.filter((x) => {
            const key = `${x.tabId}|${x.status}|${x.ro}|${x.tag}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          searchResultInfo = {
            type: "foundElsewhere",
            results,
          };

          rows = [];
        }
      } else {
        rows = [];
        searchResultInfo = { type: "notfound", results: [] };
      }
    } else {
      searchResultInfo = null;
    }

    let etaMap = null;

    if (currentTab === "active") {
      rows = rows.slice().sort(sortActiveQueue);

      const minutesPerCar = Number(sys?.washDurationMin) || 15;
      const bufferMin = Number(sys?.bufferMin) || 0;

      const baysOpen = Number.isFinite(sys?.effectiveBays)
        ? Math.floor(sys.effectiveBays)
        : 0;

      etaMap = computeEtaMap(rows, {
        minutesPerCar: minutesPerCar + bufferMin,
        baysOpen,
      });
    }

    tbody.innerHTML = "";

    if (!rows.length) {
      const tr = el("tr");
      const td = el("td", { className: "muted" });
      td.setAttribute("colspan", String(cols.length));

      if (searchText && searchResultInfo) {
        if (searchResultInfo.type === "notfound") {
          td.textContent = "No ticket found.";
        } else if (searchResultInfo.type === "foundElsewhere") {
          const wrap = document.createElement("div");

          const intro = document.createElement("div");
          intro.style.marginBottom = "8px";
          intro.textContent =
            searchResultInfo.results.length === 1
              ? "Found in:"
              : "Found in multiple places:";
          wrap.appendChild(intro);

          searchResultInfo.results.forEach((r) => {
            const label =
              r.ro && r.tag
                ? `${r.tabLabel} (RO ${r.ro} / Tag ${r.tag})`
                : r.ro
                ? `${r.tabLabel} (RO ${r.ro})`
                : r.tag
                ? `${r.tabLabel} (Tag ${r.tag})`
                : r.tabLabel;

            if (r.tabId) {
              wrap.appendChild(
                buildFoundLink(label, () => switchToTab(r.tabId))
              );
            } else {
              const plain = document.createElement("span");
              plain.textContent = label;
              plain.style.display = "inline-block";
              plain.style.margin = "2px 6px 2px 0";
              wrap.appendChild(plain);
            }
          });

          td.appendChild(wrap);
        } else {
          td.textContent = "No tickets.";
        }
      } else {
        td.textContent = "No tickets.";
      }

      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const hasActions = cols.some((c) => c.key === "_actions");

    rows.forEach((t) => {
      const tr = renderRow(t, role, cols, etaMap);

      if (hasActions) {
        const actionsTd = tr.querySelector('td[data-actions-cell="1"]');
        if (actionsTd) {
          actionsTd.innerHTML = "";
          actionsTd.appendChild(
            buildActionsCell({
              t,
              role,
              tab: currentTab,
              correctionsPerms: {
                ...(correctionsPerms || {}),
                canEditTickets: canEditTickets,
              },
            })
          );
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
    await handleTableClick({
      e,
      role,
      tab: currentTab,
      lastRows,
      msgEl,
      correctionsPerms: {
        ...(correctionsPerms || {}),
        canEditTickets: canEditTickets,
      },
    });
  });

  rerender?.();

  return () => {
    try {
      unsub?.();
    } catch {}
    try {
      unsubSys?.();
    } catch {}
  };
}