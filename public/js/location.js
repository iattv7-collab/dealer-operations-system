import { auth, db } from "./firebase.js";
import { renderNav } from "./nav.js";
import { requireRole, getUserProfile } from "./guard.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

document.getElementById("nav").innerHTML = renderNav("location");

requireRole(["admin", "manager", "advisor", "wash", "valet", "staff", "dropoff", "booker", "qc"]);

const statusEl = document.getElementById("status");
const msgEl = document.getElementById("msg");

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

const locRo = document.getElementById("locRo");
const locTag = document.getElementById("locTag");
const locCustomer = document.getElementById("locCustomer");
const locModel = document.getElementById("locModel");
const locAdvisor = document.getElementById("locAdvisor");
const locCurrentLocation = document.getElementById("locCurrentLocation");
const locMoveStatus = document.getElementById("locMoveStatus");
const locMoveStartedBy = document.getElementById("locMoveStartedBy");
const locMoveStartedAt = document.getElementById("locMoveStartedAt");

const moveIdleSection = document.getElementById("moveIdleSection");
const moveActiveSection = document.getElementById("moveActiveSection");
const startMoveBtn = document.getElementById("startMoveBtn");
const finalLocationSelect = document.getElementById("finalLocationSelect");
const customLocationInput = document.getElementById("customLocationInput");
const saveFinalLocationBtn = document.getElementById("saveFinalLocationBtn");

const movingTableBody = document.getElementById("movingTableBody");

let currentUser = null;
let currentProfile = null;
let currentTicket = null;
let movingUnsub = null;

function setMsg(text, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.className = ok ? "ok" : "err";
}

function clearMsg() {
    if (!msgEl) return;
    msgEl.textContent = "";
    msgEl.className = "muted";
}

function fmtTs(value) {
    if (!value) return "";
    try {
        if (typeof value?.toDate === "function") {
            return value.toDate().toLocaleString();
        }
        if (typeof value === "number") {
            return new Date(value).toLocaleString();
        }
        if (typeof value === "string") {
            const d = new Date(value);
            if (!Number.isNaN(d.getTime())) return d.toLocaleString();
            return value;
        }
        return "";
    } catch {
        return "";
    }
}

function getAdvisorDisplay(ticket) {
    return (
        ticket?.advisorName ||
        ticket?.advisor ||
        ticket?.advisorNumber ||
        ""
    );
}

function getMoveStatusDisplay(ticket) {
    const status = String(ticket?.moveStatus || "").toLowerCase();
    if (status === "moving") return "Moving";
    return "Idle";
}

function resetPreview() {
    currentTicket = null;

    locRo.textContent = "";
    locTag.textContent = "";
    locCustomer.textContent = "";
    locModel.textContent = "";
    locAdvisor.textContent = "";
    locCurrentLocation.textContent = "";
    locMoveStatus.textContent = "";
    locMoveStartedBy.textContent = "";
    locMoveStartedAt.textContent = "";

    moveIdleSection.style.display = "block";
    moveActiveSection.style.display = "none";

    finalLocationSelect.value = "";
    customLocationInput.value = "";
}

function renderTicket() {
    if (!currentTicket) {
        resetPreview();
        return;
    }

    locRo.textContent = currentTicket.ro || "";
    locTag.textContent = currentTicket.tag || "";
    locCustomer.textContent = currentTicket.customerName || "";
    locModel.textContent = currentTicket.model || currentTicket.yearModel || "";
    locAdvisor.textContent = getAdvisorDisplay(currentTicket);
    locCurrentLocation.textContent = currentTicket.location || "—";
    locMoveStatus.textContent = getMoveStatusDisplay(currentTicket);
    locMoveStartedBy.textContent = currentTicket.moveStartedBy || "—";
    locMoveStartedAt.textContent = fmtTs(currentTicket.moveStartedAt) || "—";

    const moving = String(currentTicket.moveStatus || "").toLowerCase() === "moving";

    moveIdleSection.style.display = moving ? "none" : "block";
    moveActiveSection.style.display = moving ? "block" : "none";

    if (!moving) {
        finalLocationSelect.value = "";
        customLocationInput.value = "";
    }
}

async function findTicketByRoOrTag(value) {
    const qByRo = query(collection(db, "ros"), where("ro", "==", value));
    let snap = await getDocs(qByRo);
    if (!snap.empty) return snap.docs[0];

    const qByTag = query(collection(db, "ros"), where("tag", "==", value));
    snap = await getDocs(qByTag);
    if (!snap.empty) return snap.docs[0];

    return null;
}

async function searchTicket() {
    clearMsg();

    const value = String(searchInput.value || "").trim();
    if (!value) {
        setMsg("Enter RO # or Tag #.", false);
        searchInput.focus();
        return;
    }

    setMsg("Searching...", true);

    try {
        const found = await findTicketByRoOrTag(value);

        if (!found) {
            resetPreview();
            setMsg("Vehicle not found.", false);
            return;
        }

        currentTicket = {
            id: found.id,
            ...found.data(),
        };

        renderTicket();
        setMsg("Vehicle found.", true);
    } catch (err) {
        console.error(err);
        setMsg(err?.message || "Search failed.", false);
    }
}

async function startMove() {
    if (!currentUser || !currentTicket) return;

    try {
        clearMsg();

        const ref = doc(db, "ros", currentTicket.id);

        await updateDoc(ref, {
            moveStatus: "moving",
            moveStartedAt: serverTimestamp(),
            moveStartedBy: currentUser.email || currentUser.uid || "",
            moveCompletedAt: null,
            moveCompletedBy: "",
            updatedAt: serverTimestamp(),
        });

        currentTicket.moveStatus = "moving";
        currentTicket.moveStartedBy = currentUser.email || currentUser.uid || "";
        currentTicket.moveStartedAt = Date.now();

        renderTicket();
        setMsg("Vehicle marked as moving.", true);
    } catch (err) {
        console.error(err);
        setMsg(err?.message || "Could not start move.", false);
    }
}

function buildFinalLocation() {
    const selected = String(finalLocationSelect.value || "").trim();
    const custom = String(customLocationInput.value || "").trim();

    if (selected === "Other") {
        return custom;
    }

    if (selected && custom) {
        return `${selected} - ${custom}`;
    }

    if (selected) return selected;
    if (custom) return custom;

    return "";
}

async function saveFinalLocation() {
    if (!currentUser || !currentTicket) return;

    const finalLocation = buildFinalLocation();

    if (!finalLocation) {
        setMsg("Select or enter a final location.", false);
        return;
    }

    try {
        clearMsg();

        const ref = doc(db, "ros", currentTicket.id);

        await updateDoc(ref, {
            location: finalLocation,
            moveStatus: "idle",
            moveCompletedAt: serverTimestamp(),
            moveCompletedBy: currentUser.email || currentUser.uid || "",
            updatedAt: serverTimestamp(),
        });

        currentTicket.location = finalLocation;
        currentTicket.moveStatus = "idle";
        currentTicket.moveCompletedBy = currentUser.email || currentUser.uid || "";

        setMsg("Final location saved.", true);

        // Show confirmation briefly before clearing
        setTimeout(() => {
            resetPreview();
            searchInput.value = "";
            searchInput.focus();
        }, 3000);
    } catch (err) {
        console.error(err);
        setMsg(err?.message || "Could not save final location.", false);
    }
}

function renderMovingRows(rows) {
    if (!Array.isArray(rows) || !rows.length) {
        movingTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="muted">No moving vehicles.</td>
      </tr>
    `;
        return;
    }

    movingTableBody.innerHTML = rows.map((t) => `
    <tr data-id="${t.id}">
      <td>${t.tag || ""}</td>
      <td>${t.ro || ""}</td>
      <td>${t.customerName || ""}</td>
      <td>${t.location || "—"}</td>
      <td>${t.moveStartedBy || "—"}</td>
      <td>${fmtTs(t.moveStartedAt) || "—"}</td>
    </tr>
  `).join("");
}

function startMovingListener() {
    if (movingUnsub) {
        try { movingUnsub(); } catch { }
    }

    const q = query(collection(db, "ros"), where("moveStatus", "==", "moving"));

    movingUnsub = onSnapshot(q, (snap) => {
        const rows = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
        }));

        rows.sort((a, b) => {
            const aMs = typeof a.moveStartedAt?.toDate === "function"
                ? a.moveStartedAt.toDate().getTime()
                : (typeof a.moveStartedAt === "number" ? a.moveStartedAt : 0);

            const bMs = typeof b.moveStartedAt?.toDate === "function"
                ? b.moveStartedAt.toDate().getTime()
                : (typeof b.moveStartedAt === "number" ? b.moveStartedAt : 0);

            return bMs - aMs;
        });

        renderMovingRows(rows);
    }, (err) => {
        console.error(err);
        movingTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="err">Could not load moving vehicles.</td>
      </tr>
    `;
    });
}

searchBtn.addEventListener("click", searchTicket);

searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        searchTicket();
    }
});

startMoveBtn.addEventListener("click", startMove);
saveFinalLocationBtn.addEventListener("click", saveFinalLocation);

onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;

    if (!user) {
        statusEl.textContent = "Not signed in.";
        resetPreview();
        return;
    }

    currentProfile = await getUserProfile(user);
    const role = String(currentProfile?.role || "").toLowerCase();

    statusEl.textContent = `${user.email || ""} · ${role}`;

    startMovingListener();
    clearMsg();
});  