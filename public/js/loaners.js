// ==============================================
// /public/js/loaners.js
// LOANER MODULE — FLEET PAGE LOGIC
// PURPOSE: Create and manage live fleet records
// ==============================================

import { auth, db } from "/js/firebase.js";
import { getUserProfile } from "/js/guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  setDoc,
  getDocs,
  getDoc,
  collection,
  query,
  where,
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

  function openScannerFullscreen() {
    if (!video) return;

    video.style.display = "block";
    video.style.position = "fixed";
    video.style.top = "0";
    video.style.left = "0";
    video.style.width = "100vw";
    video.style.height = "100vh";
    video.style.objectFit = "cover";
    video.style.zIndex = "9999";
    video.style.background = "#000";

    if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => { });
    }
  }

  function closeScannerFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { });
    }

    video.removeAttribute("style");
    video.style.display = "none";
  }

  let fleetRows = [];
  let currentUser = null;
  let currentProfile = null;
  let currentDealerId = 0;

  $("scanFleetBtn").onclick = async () => {
    try {
      status.textContent = "Scanning VIN...";
      openScannerFullscreen();

      const res = await scanVinWithCamera(video, status);

      closeScannerFullscreen();

      if (res?.vin) {
        await fill(res.vin);
        status.textContent = "VIN scanned. Please verify before saving.";
      } else {
        status.textContent = res?.reason || "No VIN found";
      }
    } catch (err) {
      closeScannerFullscreen();
      console.error("Scan failed:", err);
      status.textContent = "Scan failed";
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
        dealerId: currentDealerId,
        last8: vin.slice(-8),
        unitNumber: $("unitNumber").value.trim(),
        plate: $("plate").value.trim(),
        year: $("year").value.trim(),
        make: $("make").value.trim(),
        model: $("model").value.trim(),

        status: existing.status || "Available",
        location: existing.location || "Front Line",
        assignedRo: existing.assignedRo || "",

        lastReturnedAt: existing.lastReturnedAt || "",
        lastReceivedBy: existing.lastReceivedBy || "",
        lastMileage: existing.lastMileage || "",
        lastFuelLevel: existing.lastFuelLevel || "",
        lastDamageNotes: existing.lastDamageNotes || "",

        washedAt: existing.washedAt || "",
        washedBy: existing.washedBy || "",
        outAt: existing.outAt || "",
        notes: existing.notes || "",
        holdReason: existing.holdReason || "",

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
         <input
           class="mini-input"
           id="notes-${safeId}"
           value="${escapeAttr(x.notes || "")}"
           placeholder="Notes"
         > 
       </td>

       <td>
         <div class="actions">
           <button data-vin="${escapeAttr(vin)}" class="save-row-btn">Update</button>
           <button data-vin="${escapeAttr(vin)}" class="remove-row-btn">Remove from Fleet</button>
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

    const assignedRo = document.getElementById(`ro-${safeId}`)?.value.trim() || "";
    const location = document.getElementById(`location-${safeId}`)?.value.trim() || "";
    const notes = document.getElementById(`notes-${safeId}`)?.value.trim() || "";
    let status = document.getElementById(`status-${safeId}`)?.value || "";

    const fleetRow = fleetRows.find(x => normalizeVin(x.vin) === cleanVin) || {};
    const previousRo = String(fleetRow.assignedRo || "").trim();

    if (assignedRo && previousRo && previousRo !== assignedRo) {
      alert(`This loaner is already assigned to RO # ${previousRo}. Return it first before assigning it to another RO.`);
      return;
    }

    // If RO is entered, confirm it exists in RO Tracker
    if (assignedRo) {
      const roQuery = query(
        collection(db, "ros"),
        where("dealerId", "==", currentDealerId),
        where("ro", "==", assignedRo)
      );

      const roSnap = await getDocs(roQuery);

      if (roSnap.empty) {
        alert(`RO # ${assignedRo} was not found in RO Tracker.`);
        return;
      }

      const roDoc = roSnap.docs[0];
      const roRef = roDoc.ref;

      const roData = roDoc.data();

      if (
        roData?.hasLoaner &&
        roData?.loanerVin &&
        normalizeVin(roData.loanerVin) !== cleanVin
      ) {
        alert(`RO # ${assignedRo} already has a different loaner assigned. Return that loaner first.`);
        return;
      }
      // Business rule: assigned loaner = Out
      status = "Out";

      await setDoc(
        roRef,
        {
          hasLoaner: true,
          loanerUnitNumber: fleetRow.unitNumber || "",
          loanerVin: cleanVin,
          loanerStatus: "Out",
          loanerAssignedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    // If loaner was previously assigned to another RO, clear old RO loaner info
    if (previousRo && previousRo !== assignedRo) {
      await setDoc(
        doc(db, "ros", previousRo),
        {
          hasLoaner: false,
          loanerUnitNumber: "",
          loanerVin: "",
          loanerStatus: "",
          loanerAssignedAt: null,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    // If RO was cleared, clear status unless user selected something else
    if (!assignedRo && previousRo) {
      status = status || "Available";
    }

    await setDoc(
      doc(db, "loanerFleet", cleanVin),
      {
        assignedRo,
        status,
        location,
        notes,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await load();
  }

  async function removeRow(vin) {
    const cleanVin = normalizeVin(vin);
    if (!cleanVin) return;

    const fleetRow = fleetRows.find(x => normalizeVin(x.vin) === cleanVin) || {};
    const assignedRo = String(fleetRow.assignedRo || "").trim();
    const status = String(fleetRow.status || "").trim().toUpperCase();

    if (assignedRo || status === "OUT") {
      alert("This loaner is currently out. Return it before removing it from the fleet.");
      return;
    }

    const skip = !!$("skipRemoveConfirm")?.checked;
    if (!skip) {
      const ok = window.confirm(`Remove loaner ${cleanVin.slice(-8)} from fleet?`);
      if (!ok) return;
    }

    await setDoc(
      doc(db, "loanerFleet", cleanVin),
      {
        status: "Removed",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    await load();
  }

  function statusOptions(selected) {
    const items = ["", "Out", "Returned", "At Wash", "Available", "Hold"];
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

  function updateCounts() {
    let out = 0;
    let available = 0;
    let inShop = 0;

    fleetRows.forEach(x => {
      const s = (x.status || "").toUpperCase();

      if (s === "OUT") out++;
      else if (s === "AVAILABLE") available++;
      else if (s === "REMOVED") return;
      else inShop++;
    });

    const el = $("loanerCounts");
    if (el) {
      el.textContent = `Out: ${out} | Available: ${available} | In Shop: ${inShop}`;
    }
  }


  async function load() {
    try {
      console.log("loading loanerFleet...");
      if (!currentDealerId) return;

      const q = query(
        collection(db, "loanerFleet"),
        where("dealerId", "==", currentDealerId)
      );

      const snap = await getDocs(q);
      console.log("loanerFleet docs:", snap.size);

      fleetRows = [];
      snap.forEach((d) => {
        const row = d.data();
        console.log("row:", d.id, row);

        if ((row.status || "") === "Removed") return;

        fleetRows.push(row);
      });

      fleetRows.sort((a, b) =>
        String(a.unitNumber || "").localeCompare(String(b.unitNumber || ""))
      );

      console.log("rendering rows:", fleetRows.length);
      renderFleetTable();
      updateCounts();
    } catch (err) {
      console.error("load() failed:", err);
    }
  }

  onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;

    if (!user) {
      fleetRows = [];
      renderFleetTable();
      updateCounts();
      return;
    }

    currentProfile = await getUserProfile(user);
    currentDealerId = Number(currentProfile?.dealerId || 0);

    await load();
  });

}); // <-- THIS closes DOMContentLoaded