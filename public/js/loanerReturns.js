// FILE: /public/js/loanerReturns.js

import { auth, db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  setDoc,
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
      status.textContent = "Scanning VIN...";
      openScannerFullscreen();

      const res = await scanVinWithCamera(video, status);

      closeScannerFullscreen();

      if (res?.vin) {
        await fillReturnFromVin(res.vin);
        status.textContent = "VIN captured. Verify before saving.";
      } else {
        status.textContent = res?.reason || "No VIN found";
      }

    } catch (err) {
      closeScannerFullscreen();
      console.error("Scan failed:", err);
      status.textContent = err.message || "Camera error";
      $("returnMsg").textContent = err.message || "Camera error";
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

    const returnedAtText = $("returnedAt")?.value || "";
    const receivedBy = $("receivedBy")?.value || "";
    const mileage = $("mileage")?.value || "";
    const fuelLevel = $("fuelLevel")?.value || "";
    const damageNotes = $("damageNotes")?.value || "";
    const year = $("year")?.value || "";
    const model = $("model")?.value || "";

    await addDoc(collection(db, "loanerReturns"), {
      vin,
      year,
      model,
      returnedAtText,
      receivedBy,
      mileage,
      fuelLevel,
      damageNotes,
      createdAt: serverTimestamp()
    });

    const fleetRef = doc(db, "loanerFleet", vin);
    const fleetSnap = await getDoc(fleetRef);

    if (fleetSnap.exists()) {
      await setDoc(
        fleetRef,
        {
          status: "At Wash",
          assignedRo: "",
          lastReturnedAt: returnedAtText,
          lastReceivedBy: receivedBy,
          lastMileage: mileage,
          lastFuelLevel: fuelLevel,
          lastDamageNotes: damageNotes,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      $("returnMsg").textContent = "Saved and moved to At Wash";
    } else {
      $("returnMsg").textContent = "Return saved, but VIN was not found in Fleet";
    }

    [
      "manualVin", "vin", "year", "model",
      "returnedAt", "receivedBy",
      "mileage", "fuelLevel", "damageNotes"
    ].forEach(id => {
      if ($(id)) $(id).value = "";
    });

    await load();
    await updateCounts();
  });

  // =========================
  // LIVE LOANER COUNTS
  // =========================
  async function updateCounts() {
    const snap = await getDocs(collection(db, "loanerFleet"));

    let out = 0;
    let available = 0;
    let inShop = 0;

    snap.forEach(d => {
      const s = (d.data().status || "").toUpperCase();

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
  updateCounts();

});