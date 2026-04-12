// FILE: /public/js/loanerReturns.js

import { auth, db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  scanVinWithCamera,
  normalizeVin,
  decodeVinLive
} from "/loaners/modules/vinScanner.js";

const $ = (id) => document.getElementById(id);

// =========================
// WAIT FOR DOM (CRITICAL FIX)
// =========================
document.addEventListener("DOMContentLoaded", () => {

  const video = $("scannerVideo");
  const status = $("scannerStatus");

  // =========================
  // TIME STAMP
  // =========================
  function stampNow() {
    return new Date().toLocaleString();
  }

  // =========================
  // FILL FORM FROM VIN
  // =========================
  async function fillReturnFromVin(rawVin) {
    const vin = normalizeVin(rawVin);

    if (!vin) {
      $("returnMsg").textContent = "Invalid VIN";
      return;
    }

    $("returnMsg").textContent = "Decoding VIN...";

    try {
      const decoded = await decodeVinLive(vin);

      $("vin").value = vin;
      $("year").value = decoded?.year || "";
      $("model").value = decoded?.model || "";
      $("returnedAt").value = stampNow();
      $("receivedBy").value = auth.currentUser?.email || "";

      $("returnMsg").textContent = "";
      $("mileage")?.focus();

    } catch (err) {
      console.error("VIN decode failed:", err);

      $("vin").value = vin;
      $("year").value = "";
      $("model").value = "";
      $("returnedAt").value = stampNow();
      $("receivedBy").value = auth.currentUser?.email || "";

      $("returnMsg").textContent = "VIN scanned, decode failed";
    }
  }

  // =========================
  // SCAN BUTTON (FIXED)
  // =========================
 $("scanReturnBtn").addEventListener("click", async () => {

  try {
    status.textContent = "Opening camera...";

    const res = await scanVinWithCamera(video, status);

    if (res?.vin) {
      await fillReturnFromVin(res.vin);
      status.textContent = "VIN captured";
    } else {
      status.textContent = res?.reason || "No VIN found";
    }

  } catch (err) {
    console.error("Scan failed:", err);
    status.textContent = err.message || "Camera error";
    $("returnMsg").textContent = err.message || "Camera error";
    alert(err.message);
  }
});

  // =========================
  // MANUAL VIN
  // =========================
  $("manualVin")?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await fillReturnFromVin($("manualVin").value);
    }
  });

  // =========================
  // SAVE RETURN
  // =========================
  $("saveReturnBtn").addEventListener("click", async () => {
    const vin = normalizeVin($("vin").value);

    if (!vin) {
      $("returnMsg").textContent = "VIN is required";
      return;
    }

    await addDoc(collection(db, "loanerReturns"), {
      vin,
      year: $("year")?.value || "",
      model: $("model")?.value || "",
      returnedAtText: $("returnedAt")?.value || "",
      receivedBy: $("receivedBy")?.value || "",
      mileage: $("mileage")?.value || "",
      fuelLevel: $("fuelLevel")?.value || "",
      damageNotes: $("damageNotes")?.value || "",
      createdAt: serverTimestamp()
    });

    $("returnMsg").textContent = "Saved";

    [
      "manualVin","vin","year","model",
      "returnedAt","receivedBy",
      "mileage","fuelLevel","damageNotes"
    ].forEach(id => { if ($(id)) $(id).value = ""; });

    load();
  });

  // =========================
  // LOAD TABLE
  // =========================
  async function load() {
    const snap = await getDocs(collection(db, "loanerReturns"));

    let html = `
      <table>
        <tr>
          <th>VIN</th>
          <th>Year</th>
          <th>Model</th>
          <th>Returned At</th>
          <th>Received By</th>
          <th>Mileage</th>
          <th>Fuel</th>
          <th>Damage</th>
        </tr>
    `;

    snap.forEach((d) => {
      const x = d.data();
      html += `
        <tr>
          <td>${x.vin || ""}</td>
          <td>${x.year || ""}</td>
          <td>${x.model || ""}</td>
          <td>${x.returnedAtText || ""}</td>
          <td>${x.receivedBy || ""}</td>
          <td>${x.mileage || ""}</td>
          <td>${x.fuelLevel || ""}</td>
          <td>${x.damageNotes || ""}</td>
        </tr>
      `;
    });

    html += `</table>`;
    $("returnTable").innerHTML = html;
  }

  load();

});