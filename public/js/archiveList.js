// File: public/js/archiveList.js
// Purpose: Reads and displays all records from tickets_archive

import { renderNav } from "./nav.js";
import { requireRole, getUserDealerId } from "./guard.js";
import { db, auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

document.getElementById("nav").innerHTML = renderNav("archive");

requireRole(["admin", "manager", "advisor", "booker"]);

const bodyEl = document.getElementById("archiveBody");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const sourceFilter = document.getElementById("sourceFilter");

let ALL_ROWS = [];

function fmtTime(value) {
  if (!value) return "";

  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toLocaleString();
    } catch {
      return "";
    }
  }

  if (typeof value === "number") {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "";
    }
  }

  return "";
}

function esc(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRows(rows) {
  bodyEl.innerHTML = "";

  if (!rows.length) {
    bodyEl.innerHTML = `
      <tr>
        <td colspan="13" class="muted">No archived tickets found.</td>
      </tr>
    `;
    return;
  }

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.ro || r.sourceId || "")}</td>
      <td>${esc(r.tag || "")}</td>
      <td>${esc(r.customerName || "")}</td>
      <td>${esc(r.phone || "")}</td>
      <td>${esc(r.model || "")}</td>
      <td title="${esc(r.concern || "")}">${esc(r.concern || "")}</td>
      <td>${esc(r.location || "")}</td>
      <td>${esc(r.archivedFrom || "")}</td>
      <td>${esc(r.archivedByRole || "")}</td>
      <td>${esc(fmtTime(r.archivedAt || r.archivedAtMs))}</td>
      <td>${esc(r.needBy || fmtTime(r.needByAtMs))}</td>
      <td>${esc(fmtTime(r.washedAt || r.washedAtMs))}</td>
      <td>${esc(fmtTime(r.createdAt || r.createdAtMs))}</td>
    `;
    bodyEl.appendChild(tr);
  });
}

function applyFilters() {
  const q = String(searchInput.value || "").trim().toLowerCase();
  const src = String(sourceFilter.value || "").trim().toLowerCase();

  let rows = ALL_ROWS.slice();

  if (src) {
    rows = rows.filter((r) => String(r.archivedFrom || "").toLowerCase() === src);
  }

  if (q) {
    rows = rows.filter((r) => {
      return [
        r.ro,
        r.tag,
        r.customerName,
        r.phone,
        r.model,
        r.concern,
        r.location,
        r.archivedFrom
      ].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }

  rows.sort((a, b) => Number(b.archivedAtMs || 0) - Number(a.archivedAtMs || 0));
  renderRows(rows);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const dealerId = await getUserDealerId(user);
  if (!dealerId) {
    statusEl.textContent = "Missing dealerId.";
    return;
  }

  const q = query(
    collection(db, "tickets_archive"),
    where("dealerId", "==", dealerId)
  );

  onSnapshot(
    q,
    (snap) => {
      ALL_ROWS = [];
      snap.forEach((d) => {
        ALL_ROWS.push({
          id: d.id,
          ...d.data()
        });
      });

      statusEl.textContent = `${ALL_ROWS.length} archived ticket(s)`;
      applyFilters();
    },
    (err) => {
      console.error(err);
      statusEl.textContent = err?.message || "Archive read failed.";
    }
  );
});

searchInput.addEventListener("input", applyFilters);
sourceFilter.addEventListener("change", applyFilters);