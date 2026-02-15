// public/js/settingsPage.js
import { db, auth } from "./firebase.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getSystemSettings, setWashBayCount } from "./settings.js";

const pickupToggle = document.getElementById("pickupEnabledToggle");
const msg = document.getElementById("settingsMsg");

const washBayInput = document.getElementById("washBayCountInput");
const saveWashBayBtn = document.getElementById("saveWashBayBtn");

let washBayVisual = document.getElementById("washBayVisual");
if (!washBayVisual) {
    washBayVisual = document.createElement("div");
    washBayVisual.id = "washBayVisual";
    washBayVisual.style.marginTop = "12px";
    document.body.appendChild(washBayVisual);
}

const FEATURES_REF = doc(db, "settings", "features");

function flash(text) {
    msg.textContent = text;
    setTimeout(() => (msg.textContent = ""), 1500);
}

function setDisabled(disabled) {
    pickupToggle.disabled = disabled;
    washBayInput.disabled = disabled;
    saveWashBayBtn.disabled = disabled;
}

function renderWashBays(count) {
    const n = Math.max(1, Math.min(10, Number(count) || 1));
    washBayVisual.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px;">Bays Active: ${n}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      ${Array.from({ length: n })
            .map(
                (_, i) => `
        <div style="
          width:34px; height:34px;
          border:1px solid #333;
          display:flex; align-items:center; justify-content:center;
          font-weight:700;
        ">${i + 1}</div>
      `
            )
            .join("")}
    </div>
  `;
}

// ----- Pickup toggle -----
async function loadPickupToggle() {
    const snap = await getDoc(FEATURES_REF);
    const data = snap.exists() ? snap.data() : {};
    pickupToggle.checked = !!data.pickupEnabled;
}

async function savePickupToggle() {
    try {
        await setDoc(FEATURES_REF, { pickupEnabled: !!pickupToggle.checked }, { merge: true });
        flash("Saved");
    } catch (e) {
        console.error("Save pickupEnabled failed:", e);
        flash("Save failed: " + (e?.code || e?.message || "unknown"));
    }
}

// ----- Wash bay count -----
async function loadWashBayCount() {
    const { washBayCount } = await getSystemSettings();
    washBayInput.value = washBayCount;
    renderWashBays(washBayCount);
}

async function saveWashBayCount() {
    const user = auth.currentUser; // guaranteed by auth gate
    const raw = washBayInput.value;

    try {
        const saved = await setWashBayCount(user, raw);
        washBayInput.value = saved;
        renderWashBays(saved);
        flash("Saved");
    } catch (e) {
        console.error("Save washBayCount failed:", e);
        flash("Save failed: " + (e?.code || e?.message || "unknown"));
    }
}

// Wire UI (these handlers are fine even before auth; inputs disabled anyway)
pickupToggle.addEventListener("change", () => savePickupToggle());
saveWashBayBtn.addEventListener("click", () => saveWashBayCount());
washBayInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveWashBayBtn.click();
});

// ----- Auth gate -----
setDisabled(true);
flash("Checking sign-in...");

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        setDisabled(true);
        flash("Please sign in");
        // CHANGE this path if your login page is different
        setTimeout(() => (window.location.href = "/login.html"), 400);
        return;
    }

    // signed in
    setDisabled(false);
    flash("");

    // load settings
    try {
        await loadPickupToggle();
        await loadWashBayCount();
    } catch (e) {
        console.error("Load settings failed:", e);
        flash("Load failed: " + (e?.code || e?.message || "unknown"));
    }
});
