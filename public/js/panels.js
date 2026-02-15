// public/js/panels.js

export function renderSidePanelTabs(activeTab = "comingsoon") {
  return `
    <style>
      .side-card { border: 1px solid #ccc; border-radius: 8px; padding: 10px; font-family: "Times New Roman", Times, serif; }
      .side-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
      .side-tabs button { font-family: inherit; font-size: 15px; padding: 6px 10px; cursor:pointer; }
      .side-tabs button.active { font-weight: bold; }
      .side-section { display:none; }
      .side-section.active { display:block; }
      .side-muted { color:#666; font-size: 14px; }
      .side-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
      .side-actions button { font-family: inherit; font-size: 15px; padding: 6px 10px; }
      .side-hr { height: 1px; background:#ddd; margin: 10px 0; }
      .side-kpi { font-size:14px; }
      .side-kpi b { display:inline-block; min-width: 90px; }
    </style>

    <div class="side-card" id="sidePanelRoot">
      <div class="side-tabs">
        <button type="button" data-tab="comingsoon" class="${activeTab === "comingsoon" ? "active" : ""}">Coming Soon</button>
        <button type="button" data-tab="pickup" class="${activeTab === "pickup" ? "active" : ""}">Pickup</button>
        <button type="button" data-tab="slots" class="${activeTab === "slots" ? "active" : ""}">Swap/Slots</button>
        <button type="button" data-tab="history" class="${activeTab === "history" ? "active" : ""}">History</button>
      </div>

      <div class="side-section ${activeTab === "comingsoon" ? "active" : ""}" data-section="comingsoon">
        <div class="side-muted">
          These panels are placeholders. We’re locking the layout first. Logic comes later.
        </div>
        <div class="side-hr"></div>
        <div class="side-kpi">
          <div><b>Active:</b> (later)</div>
          <div><b>Waiters:</b> (later)</div>
          <div><b>Need By:</b> (later)</div>
          <div><b>Rewash:</b> (later)</div>
        </div>
      </div>

      <div class="side-section ${activeTab === "pickup" ? "active" : ""}" data-section="pickup">
        <div class="side-muted">
          Future: request any ready vehicle be brought to the front. Advisor marks picked up → auto-archive.
        </div>
        <div class="side-actions">
          <button type="button" disabled>Request Pickup</button>
          <button type="button" disabled>Mark Picked Up</button>
        </div>
        <div class="side-hr"></div>
        <div class="side-muted">
          Later fields: pickupRequestedAtMs / pickupRequestedBy / pickedUpAtMs / pickedUpBy.
        </div>
      </div>

      <div class="side-section ${activeTab === "slots" ? "active" : ""}" data-section="slots">
        <div class="side-muted">
          Future: slot engine, swaps, multi-bay scheduling, approvals.
        </div>
        <div class="side-actions">
          <button type="button" disabled>Lock Slot</button>
          <button type="button" disabled>Propose Swap</button>
        </div>
      </div>

      <div class="side-section ${activeTab === "history" ? "active" : ""}" data-section="history">
        <div class="side-muted">
          Future: audit history of wash events, rewash requests, pickup events.
        </div>
        <div class="side-actions">
          <button type="button" disabled>View Ticket History</button>
        </div>
      </div>
    </div>
  `;
}

export function mountSidePanelTabs(mountEl, activeTab = "comingsoon") {
  if (!mountEl) return;
  mountEl.innerHTML = renderSidePanelTabs(activeTab);

  const root = mountEl.querySelector("#sidePanelRoot");
  if (!root) return;

  const tabBtns = Array.from(root.querySelectorAll(".side-tabs button[data-tab]"));
  const sections = Array.from(root.querySelectorAll(".side-section[data-section]"));

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;

    const tab = b.getAttribute("data-tab");

    tabBtns.forEach(x => x.classList.toggle("active", x === b));
    sections.forEach(s => s.classList.toggle("active", s.getAttribute("data-section") === tab));
  });
}
