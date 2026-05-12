// public/js/ticketsUI.js
import { auth } from "./firebase.js";
import { listenTickets, findTicketAnywhereByRoOrTag } from "./rosWash.js";

import { tabDefsForRole } from "./ui/roles.js";
import { colsForView } from "./ui/columns.js";
import { buildSmartWashQueue } from "./ui/sort.js";
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

  function stageInfoForTicket(t) {
    const status = String(t?.status || t?.washStatus || "").toLowerCase();
    const hasQc = !!t?.qcAssignedTo && !t?.qcDoneAt;

    if (String(t?.pickupStatus || "").toLowerCase() === "requested") {
      return { tabId: "pickup", tabLabel: "Pickup" };
    }

    if (status === "queued" || status === "washing") {
      return { tabId: "active", tabLabel: "Wash" };
    }

    if (status === "washed") {
      if (hasQc) return { tabId: "washed", tabLabel: "QC" };
      return { tabId: "washed", tabLabel: "Washed" };
    }

    if (status === "closed") {
      return { tabId: "closed", tabLabel: "Archive" };
    }

    return { tabId: null, tabLabel: "In Shop" };
  }

  function buildSearchResultEntry(found) {
    const stage = stageInfoForTicket(found);

    return {
      status: String(found?.status || "").toLowerCase(),
      tabId: stage.tabId,
      tabLabel: stage.tabLabel,
      ro: found?.ro || "",
      tag: found?.tag || "",
      location: found?.location || "",
    };
  }

  let searchSeq = 0;

  rerender = () => {
    const tabDef = TAB_DEFS.find((t) => t.id === currentTab) || TAB_DEFS[0];

    let rows = [];
    let set = null;

    if (currentTab === "pickup") {
      rows = (lastRows || []).filter((r) =>
        String(r.pickupStatus || "").toLowerCase() === "requested"
      );
    } else {
      if (!Array.isArray(tabDef.statuses)) {
        tbody.innerHTML = "";
        const tr = el("tr");
        const td = el("td", { className: "muted", text: "Coming soon." });
        td.setAttribute("colspan", String(cols.length));
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      set = new Set(tabDef.statuses.map((s) => String(s).toLowerCase()));

      rows = (lastRows || []).filter((r) =>
        set.has(String(r.status || "").toLowerCase())
      );
    }

    if (searchText) {
      const allMatches = (lastRows || []).filter((t) => {
        const tag = String(t.tag || "").toLowerCase();
        const ro = String(t.ro || "").toLowerCase();
        return tag.includes(searchText) || ro.includes(searchText);
      });

      if (allMatches.length) {
        searchResultInfo = null;

        if (currentTab === "pickup") {
          const inCurrentTab = allMatches.filter((t) =>
            String(t.pickupStatus || "").toLowerCase() === "requested"
          );

          if (inCurrentTab.length) {
            rows = inCurrentTab;
          } else {
            const mapped = allMatches.map((found) => buildSearchResultEntry(found));

            const seen = new Set();
            const results = mapped.filter((x) => {
              const key = `${x.tabId}|${x.status}|${x.ro}|${x.tag}|${x.location}`;
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
          const inCurrentTab = allMatches.filter((t) =>
            set.has(String(t.status || "").toLowerCase())
          );

          if (inCurrentTab.length) {
            rows = inCurrentTab;
          } else {
            const mapped = allMatches.map((found) => buildSearchResultEntry(found));

            const seen = new Set();
            const results = mapped.filter((x) => {
              const key = `${x.tabId}|${x.status}|${x.ro}|${x.tag}|${x.location}`;
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
        }
      } else {
        rows = [];
        if (!searchResultInfo) {
          searchResultInfo = { type: "searching", results: [] };
        }
      }
    } else {
      searchResultInfo = null;
    }

    let etaMap = null;

    if (currentTab === "active") {
      const minutesPerCar = Number(sys?.washDurationMin) || 15;
      const bufferMin = Number(sys?.bufferMin) || 0;

      const baysOpen = Number.isFinite(sys?.effectiveBays)
        ? Math.floor(sys.effectiveBays)
        : 0;

      const scheduleOpts = {
        ...(sys || {}),
        baysOpen,
        minutesPerCar: minutesPerCar + bufferMin,
      };

      rows = buildSmartWashQueue(rows, scheduleOpts);

      etaMap = computeEtaMap(rows, scheduleOpts);
    }

    tbody.innerHTML = "";

    if (!rows.length) {
      const tr = el("tr");
      const td = el("td", { className: "muted" });
      td.setAttribute("colspan", String(cols.length));

      if (searchText && searchResultInfo) {
        if (searchResultInfo.type === "searching") {
          td.textContent = "Searching...";
        } else if (searchResultInfo.type === "notfound") {
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
            const base =
              r.ro && r.tag
                ? `${r.tabLabel} (RO ${r.ro} / Tag ${r.tag})`
                : r.ro
                  ? `${r.tabLabel} (RO ${r.ro})`
                  : r.tag
                    ? `${r.tabLabel} (Tag ${r.tag})`
                    : r.tabLabel;

            const label = r.location
              ? `${base} — ${r.location}`
              : base;

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

    const splitActionKeys = new Set([
      "requestRewash",
      "pickupRequestAction",
      "setNeedByAction",
      "startWash",
      "markComplete",
      "cpBookedAction",
      "wtyBookedAction",
      "requestQc",
      "noQc",
      "qcDoneAction",
      "removeWashQueueAction",
      "archiveAction",
    ]);

    const hasSplitActions = cols.some((c) => splitActionKeys.has(c.key));

    rows.forEach((t) => {
      const tr = renderRow(t, role, cols, etaMap);

      if (hasSplitActions) {
        const actionMap = buildActionsCell({
          t,
          role,
          tab: currentTab,
          correctionsPerms: {
            ...(correctionsPerms || {}),
            canEditTickets: canEditTickets,
          },
          splitMode: true,
        });

        if (actionMap && typeof actionMap === "object") {
          Object.entries(actionMap).forEach(([key, node]) => {
            const td = tr.querySelector(`td[data-action-key="${key}"]`);
            if (td && node) {
              td.innerHTML = "";
              td.appendChild(node);
            }
          });
        }
      }

      tbody.appendChild(tr);
    });
  };

  if (searchEl) {
    searchEl.addEventListener("input", async () => {
      const raw = String(searchEl.value || "").trim();
      searchText = raw.toLowerCase();

      const seq = ++searchSeq;

      if (!searchText) {
        searchResultInfo = null;
        if (typeof rerender === "function") rerender();
        return;
      }

      searchResultInfo = { type: "searching", results: [] };
      if (typeof rerender === "function") rerender();

      const localMatches = (lastRows || []).filter((t) => {
        const tag = String(t.tag || "").toLowerCase();
        const ro = String(t.ro || "").toLowerCase();
        return tag.includes(searchText) || ro.includes(searchText);
      });

      if (localMatches.length) {
        searchResultInfo = null;
        if (typeof rerender === "function") rerender();
        return;
      }

      try {
        const found = await findTicketAnywhereByRoOrTag(raw);

        if (seq !== searchSeq) return;

        if (found) {
          searchResultInfo = {
            type: "foundElsewhere",
            results: [buildSearchResultEntry(found)],
          };
        } else {
          searchResultInfo = { type: "notfound", results: [] };
        }

        if (typeof rerender === "function") rerender();
      } catch (err) {
        console.error(err);
        if (seq !== searchSeq) return;
        searchResultInfo = { type: "notfound", results: [] };
        if (typeof rerender === "function") rerender();
      }
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
    } catch { }
    try {
      unsubSys?.();
    } catch { }
  };
}