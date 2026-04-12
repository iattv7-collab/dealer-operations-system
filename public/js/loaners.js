// ==============================================
// LOANER MODULE — FLEET PAGE LOGIC
// PURPOSE: Create and manage live fleet records
// ==============================================

import { db } from "/js/firebase.js";
import {
  doc,
  setDoc,
  getDocs,
  getDoc,
  deleteDoc,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

console.log("loaners.js loaded");

import {
  scanVinWithCamera,
  normalizeVin,
  decodeVinLive
} from "/loaners/modules/vinScanner.js";

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {

const video = $("scannerVideo");
const status = $("scannerStatus");

let fleetRows = [];


$("scanFleetBtn").onclick = async () => {
  status.textContent = "Scanning VIN...";
  const res = await scanVinWithCamera(video, status);

  if (res?.vin) {
    await fill(res.vin);
    status.textContent = "VIN scanned";
  } else {
    status.textContent = res?.reason || "No VIN found";
  }
};

if ($("manualVin")) {
  $("manualVin").addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await fill($("manualVin").value);
    }
  });
}

if ($("fleetSearch")) {
  $("fleetSearch").addEventListener("input", renderFleetTable);
}

async function fill(vin) {
  vin = normalizeVin(vin);
  $("vin").value = vin;
  $("last8").value = vin.slice(-8);

  try {
    const d = await decodeVinLive(vin);

    $("year").value = d?.year || "";
    $("make").value = d?.make || "";
    $("model").value = d?.model || "";

    $("fleetMsg").textContent = "";
  } catch (err) {
    console.error("VIN decode failed:", err);

    $("year").value = "";
    $("make").value = "";
    $("model").value = "";

    $("fleetMsg").textContent = "VIN scanned, but decode failed";
  }
}

$("saveFleetBtn").onclick = async () => {
  const vin = normalizeVin($("vin").value);

  if (!vin) {
    $("fleetMsg").textContent = "VIN is required";
    return;
  }

  const ref = doc(db, "loanerFleet", vin);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data() : {};

  await setDoc(
    ref,
    {
      vin,
      last8: vin.slice(-8),
      unitNumber: $("unitNumber").value.trim(),
      plate: $("plate").value.trim(),
      year: $("year").value.trim(),
      make: $("make").value.trim(),
      model: $("model").value.trim(),

      status: existing.status || "Ready",
      location: existing.location || "Front Line",
      assignedRo: existing.assignedRo || "",

      lastReturnedAt: existing.lastReturnedAt || "",
      lastReceivedBy: existing.lastReceivedBy || "",
      lastMileage: existing.lastMileage || "",
      lastFuelLevel: existing.lastFuelLevel || "",
      lastDamageNotes: existing.lastDamageNotes || "",

      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  $("fleetMsg").textContent = "Saved";

  $("manualVin").value = "";
  $("vin").value = "";
  $("last8").value = "";
  $("year").value = "";
  $("make").value = "";
  $("model").value = "";
  $("unitNumber").value = "";
  $("plate").value = "";

  await load();
};

function getFilteredRows() {
  const q = ($("fleetSearch")?.value || "").trim().toUpperCase();

  if (!q) return [...fleetRows];

  return fleetRows.filter((x) => {
    return (
      String(x.vin || "").toUpperCase().includes(q) ||
      String(x.last8 || "").toUpperCase().includes(q) ||
      String(x.unitNumber || "").toUpperCase().includes(q) ||
      String(x.plate || "").toUpperCase().includes(q) ||
      String(x.year || "").toUpperCase().includes(q) ||
      String(x.make || "").toUpperCase().includes(q) ||
      String(x.model || "").toUpperCase().includes(q) ||
      String(x.status || "").toUpperCase().includes(q) ||
      String(x.location || "").toUpperCase().includes(q) ||
      String(x.assignedRo || "").toUpperCase().includes(q)
    );
  });
}

function renderFleetTable() {
  const filtered = getFilteredRows();

  let html = "";

  filtered.forEach((x) => {
    const vin = x.vin || "";
    const safeId = makeSafeId(vin);

    html += `
      <tr>
        <td>${escapeHtml(x.unitNumber || "")}</td>
        <td>${escapeHtml(x.last8 || "")}</td>
        <td>${escapeHtml(x.year || "")}</td>
        <td>${escapeHtml(x.make || "")}</td>
        <td>${escapeHtml(x.model || "")}</td>
        <td>${escapeHtml(x.plate || "")}</td>

        <td>
          <input
            class="mini-input"
            id="ro-${safeId}"
            value="${escapeAttr(x.assignedRo || "")}"
            placeholder="RO #"
          >
        </td>

        <td>
          <select class="mini-select" id="status-${safeId}">
            ${statusOptions(x.status || "")}
          </select>
        </td>

        <td>
          <input
            class="mini-input"
            id="location-${safeId}"
            value="${escapeAttr(x.location || "")}"
            placeholder="Location"
          >
        </td>

        <td>${escapeHtml(x.lastReturnedAt || "")}</td>
        <td>${escapeHtml(x.lastReceivedBy || "")}</td>
        <td>${escapeHtml(x.lastMileage || "")}</td>
        <td>${escapeHtml(x.lastFuelLevel || "")}</td>
        <td>${escapeHtml(x.lastDamageNotes || "")}</td>

        <td>
          <div class="actions">
            <button data-vin="${escapeAttr(vin)}" class="save-row-btn">Save</button>
            <button data-vin="${escapeAttr(vin)}" data-status="At Wash" class="quick-status-btn">Wash</button>
            <button data-vin="${escapeAttr(vin)}" data-status="Ready" class="quick-status-btn">Ready</button>
            <button data-vin="${escapeAttr(vin)}" data-status="Hold" class="quick-status-btn">Hold</button>
            <button data-vin="${escapeAttr(vin)}" class="remove-row-btn">Remove</button>
          </div>
        </td>
      </tr>
    `;
  });

  $("fleetTableBody").innerHTML = html;

  bindRowActions();
}

function bindRowActions() {
  document.querySelectorAll(".save-row-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await saveRow(btn.dataset.vin);
    });
  });

  document.querySelectorAll(".quick-status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const vin = btn.dataset.vin;
      const nextStatus = btn.dataset.status;
      const statusEl = document.getElementById(`status-${makeSafeId(vin)}`);
      if (statusEl) statusEl.value = nextStatus;
      await saveRow(vin);
    });
  });

  document.querySelectorAll(".remove-row-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await removeRow(btn.dataset.vin);
    });
  });
}

async function saveRow(vin) {
  const cleanVin = normalizeVin(vin);
  if (!cleanVin) return;

  const safeId = makeSafeId(cleanVin);

  await setDoc(
    doc(db, "loanerFleet", cleanVin),
    {
      assignedRo: document.getElementById(`ro-${safeId}`)?.value.trim() || "",
      status: document.getElementById(`status-${safeId}`)?.value || "",
      location: document.getElementById(`location-${safeId}`)?.value.trim() || "",
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await load();
}

async function removeRow(vin) {
  const cleanVin = normalizeVin(vin);
  if (!cleanVin) return;

  const skip = !!$("skipRemoveConfirm")?.checked;
  if (!skip) {
    const ok = window.confirm(`Remove loaner ${cleanVin.slice(-8)} from fleet?`);
    if (!ok) return;
  }

  await deleteDoc(doc(db, "loanerFleet", cleanVin));
  await load();
}

function statusOptions(selected) {
  const items = ["", "Out", "Returned", "At Wash", "Ready", "Hold"];
  return items
    .map((item) => {
      const sel = item === selected ? "selected" : "";
      const label = item || "Select";
      return `<option value="${escapeAttr(item)}" ${sel}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function makeSafeId(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}

async function load() {
  try {
    console.log("loading loanerFleet...");
    const snap = await getDocs(collection(db, "loanerFleet"));
    console.log("loanerFleet docs:", snap.size);

    fleetRows = [];
    snap.forEach((d) => {
      const row = d.data();
      console.log("row:", d.id, row);
      fleetRows.push(row);
    });

    fleetRows.sort((a, b) =>
      String(a.unitNumber || "").localeCompare(String(b.unitNumber || ""))
    );

    console.log("rendering rows:", fleetRows.length);
    renderFleetTable();
  } catch (err) {
    console.error("load() failed:", err);
  }
}

load();

}); // <-- THIS closes DOMContentLoaded