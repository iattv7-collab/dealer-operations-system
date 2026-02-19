// public/js/ui/dom.js

export function el(tag, props = {}, children = []) {
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

export function ensureBaseStyles() {
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

    /* ✅ Keep table + header + buttons in ONE layout context */
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
      vertical-align: top;
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
      justify-content: flex-start;
      align-items: flex-start;
    }

    button { font-size: 14px; }
    .muted { color: #666; }
    .ro-input { width: 110px; padding: 4px 6px; font-family: inherit; }

    /* ✅ Actions cell can wrap */
    td[data-col="actions"] { white-space: normal; }
  `);

  document.head.appendChild(style);
}

export function buildTabs(containerEl, tabDefs) {
  const wrap = el("div", { className: "tickets-tabs" });
  tabDefs.forEach((t, idx) => {
    const b = el("button", { type: "button", "data-tab": t.id, text: t.label });
    if (idx === 0) b.classList.add("active");
    wrap.appendChild(b);
  });
  containerEl.insertBefore(wrap, containerEl.firstChild);
  return wrap;
}

export function buildTableSkeleton(tableEl, cols) {
  tableEl.innerHTML = "";
  const thead = el("thead");
  const hr = el("tr");

  cols.forEach((c) => {
    const th = el("th", { text: c.label });
    hr.appendChild(th);
  });

  thead.appendChild(hr);

  const tbody = el("tbody");
  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);
  return tbody;
}
