import { auth, db } from "./firebase.js";
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

document.getElementById("nav").innerHTML = `
  <div style="
    background:#0b3d91;
    color:#fff;
    padding:12px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    border-bottom:4px solid #00a8c6;
  ">
    <button onclick="window.location.href='/home.html'"
      style="
        background:#fff;
        color:#0b3d91;
        border:none;
        padding:8px 12px;
        border-radius:8px;
        font-weight:bold;
      ">
      ← Home
    </button>

    <div style="font-weight:bold;">
      Location
    </div>
  </div>
`;

requireRole(["admin", "manager", "advisor", "wash", "valet", "staff", "dropoff", "booker", "qc", "foreman", "tech"]);

const statusEl = document.getElementById("status");
const msgEl = document.getElementById("msg");

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

const locRo = document.getElementById("locRo");
const locTag = document.getElementById("locTag");
const locBlockedByTag = document.getElementById("locBlockedByTag");

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
const moveAreaSelect = document.getElementById("moveAreaSelect");
const blocksTagInput = document.getElementById("blocksTagInput");
const saveFinalLocationBtn = document.getElementById("saveFinalLocationBtn");
const cancelMoveBtn = document.getElementById("cancelMoveBtn");

const movingTableBody = document.getElementById("movingTableBody");

let currentUser = null;
let currentProfile = null;
let currentTicket = null;
let movingUnsub = null;
let locationCatalog = [];
let locationCatalogUnsub = null;

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
    locBlockedByTag.textContent = "—";
    locModel.textContent = "";
    locAdvisor.textContent = "";
    locCurrentLocation.textContent = "";
    locMoveStatus.textContent = "";
    locMoveStartedBy.textContent = "";
    locMoveStartedAt.textContent = "";

    moveIdleSection.style.display = "block";
    moveActiveSection.style.display = "none";

    moveAreaSelect.value = "";
    finalLocationSelect.innerHTML = `<option value="">Select area first...</option>`;
    if (blocksTagInput) blocksTagInput.value = "";
}

function renderTicket() {
    if (!currentTicket) {
        resetPreview();
        return;
    }

    locRo.textContent = currentTicket.ro || "";
    locTag.textContent = currentTicket.tag || "";

    // Find full blocking chain for THIS car
    (async () => {
        try {
            const dealerId = Number(currentProfile?.dealerId || 0);

            const result = [];
            let toCheck = [currentTicket.tag];

            while (toCheck.length) {
                const next = [];

                for (const tag of toCheck) {
                    const q = query(
                        collection(db, "ros"),
                        where("dealerId", "==", dealerId),
                        where("blocksTag", "==", tag)
                    );

                    const snap = await getDocs(q);

                    snap.forEach((d) => {
                        const blockerTag = d.data()?.tag;

                        if (blockerTag && !result.includes(blockerTag)) {
                            result.push(blockerTag);
                            next.push(blockerTag);
                        }
                    });
                }

                toCheck = next;
            }

            locBlockedByTag.textContent = result.length ? result.join(", ") : "—";
        } catch (err) {
            console.error(err);
            locBlockedByTag.textContent = "—";
        }
    })();

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
        moveAreaSelect.value = "";
        finalLocationSelect.innerHTML = `<option value="">Select area first...</option>`;
        if (blocksTagInput) blocksTagInput.value = "";
    }
}

async function findTicketByRoOrTag(value, dealerId) {
    const cleanValue = String(value || "").trim().toUpperCase();

    const qByRo = query(
        collection(db, "ros"),
        where("dealerId", "==", dealerId),
        where("ro", "==", cleanValue)
    );

    let snap = await getDocs(qByRo);
    if (!snap.empty) return snap.docs[0];

    const qByTag = query(
        collection(db, "ros"),
        where("dealerId", "==", dealerId),
        where("tag", "==", cleanValue)
    );

    snap = await getDocs(qByTag);
    if (!snap.empty) return snap.docs[0];

    const qByVin = query(
        collection(db, "ros"),
        where("dealerId", "==", dealerId)
    );

    snap = await getDocs(qByVin);

    const match = snap.docs.find((d) => {
        const vin = String(d.data()?.vin || "").toUpperCase();
        return vin && vin.endsWith(cleanValue);
    });

    return match || null;
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
        const dealerId = Number(currentProfile?.dealerId || 0);
        const found = await findTicketByRoOrTag(value, dealerId);

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

async function cancelMove() {
    if (!currentUser || !currentTicket) return;

    try {
        clearMsg();

        const ref = doc(db, "ros", currentTicket.id);

        await updateDoc(ref, {
            moveStatus: "idle",
            moveStartedAt: null,
            moveStartedBy: "",
            moveCompletedAt: null,
            moveCompletedBy: "",
            updatedAt: serverTimestamp(),
        });

        currentTicket.moveStatus = "idle";
        currentTicket.moveStartedBy = "";
        currentTicket.moveStartedAt = null;

        renderTicket();
        setMsg("Move cancelled.", true);

    } catch (err) {
        console.error(err);
        setMsg(err?.message || "Could not cancel move.", false);
    }
}


function locationKeyFromLabel(label) {
    return String(label || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function renderAreaDropdown() {
    const moveAreaSelect = document.getElementById("moveAreaSelect");

    moveAreaSelect.innerHTML = `<option value="">Select...</option>`;

    const areas = [...new Set(locationCatalog.map(l => l.area))];

    areas.forEach(area => {
        const opt = document.createElement("option");
        opt.value = area;
        opt.textContent = area === "annex" ? "Annex" : "Main Store";
        moveAreaSelect.appendChild(opt);
    });
}

function renderLocationDropdownByArea(area) {
    finalLocationSelect.innerHTML = `<option value="">Select...</option>`;

    const filtered = locationCatalog.filter(l => l.area === area);

    filtered.forEach(loc => {
        const opt = document.createElement("option");
        opt.value = loc.key;
        opt.textContent = loc.label;
        finalLocationSelect.appendChild(opt);
    });
}

function startLocationCatalogListener(dealerId) {
    if (!dealerId) return;

    if (locationCatalogUnsub) {
        try { locationCatalogUnsub(); } catch { }
    }

    const q = query(
        collection(db, "locationCatalog"),
        where("dealerId", "==", dealerId),
        where("active", "==", true)
    );

    locationCatalogUnsub = onSnapshot(q, (snap) => {
        locationCatalog = snap.docs.map((d) => ({
            id: d.id,
            ...d.data()
        }));

        locationCatalog.sort((a, b) =>
            String(a.label || "").localeCompare(String(b.label || ""), undefined, { numeric: true })
        );

        renderAreaDropdown();
        finalLocationSelect.innerHTML = `<option value="">Select area first...</option>`;
    });
}

function buildFinalLocationInfo() {
    const area = moveAreaSelect.value;
    const selectedKey = String(finalLocationSelect.value || "").trim();

    if (!area || !selectedKey) return null;

    const selectedLoc = locationCatalog.find((l) =>
        String(l.key || locationKeyFromLabel(l.label)) === selectedKey &&
        l.area === area
    );

    if (!selectedLoc) return null;

    return {
        location: selectedLoc.label,
        locationKey: selectedLoc.key || locationKeyFromLabel(selectedLoc.label),
        locationArea: area
    };
}

async function saveFinalLocation() {
    if (!currentUser || !currentTicket) return;

    const finalLocationInfo = buildFinalLocationInfo();
    const blocksTag = String(blocksTagInput?.value || "").trim();

    if (!finalLocationInfo?.location) {
        setMsg("Select where the vehicle was moved to and the location/spot.", false);
        return;
    }

    try {
        clearMsg();

        const ref = doc(db, "ros", currentTicket.id);

        await updateDoc(ref, {
            location: finalLocationInfo.location,
            locationKey: finalLocationInfo.locationKey,
            locationArea: finalLocationInfo.locationArea,
            blocksTag: blocksTag || null,
            moveStatus: "idle",
            moveCompletedAt: serverTimestamp(),
            moveCompletedBy: currentUser.email || currentUser.uid || "",
            updatedAt: serverTimestamp(),
        });

        currentTicket.location = finalLocationInfo.location;
        currentTicket.locationKey = finalLocationInfo.locationKey;
        currentTicket.locationArea = finalLocationInfo.locationArea;
        currentTicket.blocksTag = blocksTag || null;
        currentTicket.moveStatus = "idle";
        currentTicket.moveCompletedBy = currentUser.email || currentUser.uid || "";

        setMsg(`Vehicle moved to ${finalLocationInfo.location}.`, true);

        setTimeout(() => {
            resetPreview();
            searchInput.value = "";
            searchInput.focus();
            clearMsg();
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
        <td colspan="5" class="muted">No moving vehicles.</td>
      </tr>
    `;
        return;
    }

    movingTableBody.innerHTML = rows.map((t) => `
    <tr data-id="${t.id}">
      <td>${t.tag || ""}</td>
      <td>${t.ro || ""}</td>
      <td>${t.location || "—"}</td>
      <td>${t.moveStartedBy || "—"}</td>
      <td>${fmtTs(t.moveStartedAt) || "—"}</td>
    </tr>
  `).join("");
}

function startMovingListener(dealerId) {
    if (movingUnsub) {
        try { movingUnsub(); } catch { }
    }

    const q = query(
        collection(db, "ros"),
        where("dealerId", "==", dealerId),
        where("moveStatus", "==", "moving")
    );

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
        <td colspan="5" class="err">Could not load moving vehicles.</td>
      </tr>
    `;
    });
}

moveAreaSelect.addEventListener("change", () => {
    renderLocationDropdownByArea(moveAreaSelect.value);
});


searchBtn.addEventListener("click", searchTicket);

searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        searchTicket();
    }
});

startMoveBtn.addEventListener("click", startMove);
saveFinalLocationBtn.addEventListener("click", saveFinalLocation);
cancelMoveBtn.addEventListener("click", cancelMove);

const toggleDetailsBtn = document.getElementById("toggleDetailsBtn");
const vehicleDetails = document.getElementById("vehicleDetails");

toggleDetailsBtn.addEventListener("click", () => {
    const open = vehicleDetails.style.display !== "none";
    vehicleDetails.style.display = open ? "none" : "block";
    toggleDetailsBtn.textContent = open ? "More Info" : "Less Info";
});

onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;

    if (!user) {
        statusEl.textContent = "Not signed in.";
        resetPreview();
        return;
    }

    currentProfile = await getUserProfile(user);
    const role = String(currentProfile?.role || "").toLowerCase();
    const dealerId = Number(currentProfile?.dealerId || 0);

    statusEl.textContent = `${user.email || ""} · ${role}`;

    startLocationCatalogListener(dealerId);
    startMovingListener(dealerId);
    clearMsg();
});  