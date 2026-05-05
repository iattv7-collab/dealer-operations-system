import { auth, db } from "./firebase.js";
import { getUserProfile } from "./guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { initNotificationCenter } from "../ro/modules/notification-center.js";

const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const msgEl = $("msg");

const requestSearchInput = $("requestSearchInput");
const requestSearchBtn = $("requestSearchBtn");
const vehicleBox = $("vehicleBox");

const reqRo = $("reqRo");
const reqTag = $("reqTag");
const reqCustomer = $("reqCustomer");
const reqLocation = $("reqLocation");

const requestType = $("requestType");
const toArea = $("toArea");
const toLocation = $("toLocation");
const requestNote = $("requestNote");
const submitRequestBtn = $("submitRequestBtn");
const requestsBody = $("requestsBody");



let currentUser = null;
let currentProfile = null;
let currentVehicle = null;
let locationCatalog = [];

function setMsg(text, ok = true) {
    msgEl.textContent = text || "";
    msgEl.className = ok ? "ok" : "err";
}

function locationKeyFromLabel(label) {
    return String(label || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function requestTypeLabel(type) {
    if (type === "customerPickup") return "Customer Pickup";
    if (type === "bringToShop") return "Bring to Shop";
    if (type === "moveToAnnex") return "Move to Annex";
    if (type === "moveToMain") return "Move to Main Store";
    return type || "";
}

function renderRequestTypeOptions() {
    const role = String(currentProfile?.role || "").toLowerCase();

    requestType.innerHTML = `<option value="">Select...</option>`;

    // Only advisor + manager + admin can request pickup
    if (["advisor", "manager", "admin"].includes(role)) {
        requestType.innerHTML += `<option value="customerPickup">Customer Pickup</option>`;
    }

    // Everyone else can do internal moves
    requestType.innerHTML += `
    <option value="bringToShop">Bring to Shop</option>
    <option value="moveToAnnex">Move to Annex</option>
    <option value="moveToMain">Move to Main Store</option>
  `;
}

function valetGroupForRequest(type) {
    if (type === "customerPickup") return "front";
    return "shop";
}

async function findVehicle(value, dealerId) {
    const clean = String(value || "").trim().toUpperCase();
    if (!clean) return null;

    let snap = await getDocs(query(
        collection(db, "ros"),
        where("dealerId", "==", dealerId),
        where("ro", "==", clean)
    ));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

    snap = await getDocs(query(
        collection(db, "ros"),
        where("dealerId", "==", dealerId),
        where("tag", "==", clean)
    ));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

    snap = await getDocs(query(
        collection(db, "ros"),
        where("dealerId", "==", dealerId)
    ));

    const match = snap.docs.find((d) => {
        const vin = String(d.data()?.vin || "").toUpperCase();
        return vin && vin.endsWith(clean);
    });

    return match ? { id: match.id, ...match.data() } : null;
}

async function searchVehicle() {
    setMsg("");

    const dealerId = Number(currentProfile?.dealerId || 0);
    const value = requestSearchInput.value.trim();

    if (!value) {
        setMsg("Enter RO, Tag, or VIN.", false);
        return;
    }

    const found = await findVehicle(value, dealerId);

    if (!found) {
        currentVehicle = null;
        vehicleBox.style.display = "none";
        setMsg("Vehicle not found.", false);
        return;
    }

    currentVehicle = found;

    reqRo.textContent = found.ro || "";
    reqTag.textContent = found.tag || "";
    reqCustomer.textContent = found.customerName || "";
    $("reqVin").textContent = found.vin || "";
    $("reqDescription").textContent = found.model || "";
    reqLocation.textContent = found.location || "—";

    vehicleBox.style.display = "block";
    setMsg("Vehicle found.", true);

    const toggleBtn = $("toggleDetailsBtn");
    const detailsBox = $("vehicleDetails");

    if (toggleBtn && detailsBox) {
        toggleBtn.onclick = () => {
            const isOpen = detailsBox.style.display === "block";
            detailsBox.style.display = isOpen ? "none" : "block";
            toggleBtn.textContent = isOpen ? "Details" : "Hide";
        };
    }

}

function renderAreaDropdown() {
    toArea.innerHTML = `<option value="">Select...</option>`;

    const areas = [...new Set(locationCatalog.map(l => l.area))];

    areas.forEach((area) => {
        const opt = document.createElement("option");
        opt.value = area;
        opt.textContent = area === "annex" ? "Annex" : "Main Store";
        toArea.appendChild(opt);
    });
}

function renderLocationDropdown(area) {
    toLocation.innerHTML = "";

    const filtered = locationCatalog.filter(l => l.area === area);

    if (!filtered.length) {
        toLocation.innerHTML = `<option value="">No locations available</option>`;
        return;
    }

    toLocation.innerHTML = `<option value="">Select...</option>`;

    filtered.forEach((loc) => {
        const opt = document.createElement("option");
        opt.value = loc.key || locationKeyFromLabel(loc.label);
        opt.textContent = loc.label || "";
        toLocation.appendChild(opt);
    });
}

function autoSelectLocationByWord(area, word) {
    const match = locationCatalog.find(l =>
        l.area === area &&
        String(l.label || "").toLowerCase().includes(word)
    );

    if (match) {
        toLocation.value = match.key || locationKeyFromLabel(match.label);
    }
}


async function loadLocationCatalog(dealerId) {
    const snap = await getDocs(query(
        collection(db, "locationCatalog"),
        where("dealerId", "==", dealerId),
        where("active", "==", true)
    ));

    locationCatalog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    locationCatalog.sort((a, b) => {
        const areaCompare = String(a.area || "").localeCompare(String(b.area || ""));
        if (areaCompare !== 0) return areaCompare;
        return String(a.label || "").localeCompare(String(b.label || ""), undefined, { numeric: true });
    });

    renderAreaDropdown();
}

async function dismissValetRequestNotifications(requestId, requestData) {
    const usersSnap = await getDocs(query(
        collection(db, "users"),
        where("dealerId", "==", requestData.dealerId),
        where("role", "==", "valet"),
        where("valetGroup", "==", requestData.valetGroup)
    ));

    const url = `/requests.html?requestId=${encodeURIComponent(requestId)}`;
    const promises = [];

    for (const userDoc of usersSnap.docs) {
        const notifSnap = await getDocs(query(
            collection(db, "users", userDoc.id, "notifications"),
            where("type", "==", "valetRequest"),
            where("url", "==", url)
        ));

        notifSnap.forEach((n) => {
            promises.push(updateDoc(doc(db, "users", userDoc.id, "notifications", n.id), {
                read: true,
                dismissed: true
            }));
        });
    }

    await Promise.all(promises);
}

async function submitRequest() {
    if (!currentVehicle) {
        setMsg("Find a vehicle first.", false);
        return;
    }

    const type = requestType.value;
    const area = toArea.value;
    const locationKey = toLocation.value;

    if (!type || !area || !locationKey) {
        setMsg("Select request type, destination area, and destination location.", false);
        return;
    }

    const selectedLoc = locationCatalog.find((l) =>
        String(l.area || "") === area &&
        String(l.key || locationKeyFromLabel(l.label)) === locationKey
    );

    if (locationKey && !selectedLoc) {
        setMsg("Selected location not found.", false);
        return;
    }

    const dealerId = Number(currentProfile?.dealerId || 0);

    const existingSnap = await getDocs(query(
        collection(db, "valetRequests"),
        where("dealerId", "==", dealerId),
        where("tag", "==", String(currentVehicle.tag || "")),
        where("status", "in", ["requested", "inRoute"])
    ));

    if (!existingSnap.empty) {
        const ok = confirm(
            `This vehicle already has an open valet request.\n\nCancel the previous request and create a new one?`
        );

        if (!ok) return;

        const cancelPromises = [];
        existingSnap.forEach((d) => {
            cancelPromises.push(updateDoc(doc(db, "valetRequests", d.id), {
                status: "cancelled",
                cancelledAt: serverTimestamp(),
                cancelledByUid: currentUser.uid,
                cancelledByName: currentProfile?.name || currentUser.email || currentUser.uid,
                updatedAt: serverTimestamp()
            }));
        });

        await Promise.all(cancelPromises);
    }

    const requestRef = doc(collection(db, "valetRequests"));

    const data = {
        dealerId,
        roId: currentVehicle.id,
        ro: String(currentVehicle.ro || ""),
        tag: String(currentVehicle.tag || ""),
        customerName: String(currentVehicle.customerName || ""),
        currentLocation: String(currentVehicle.location || ""),

        requestType: type,
        valetGroup: valetGroupForRequest(type),

        requestedByUid: currentUser.uid,
        requestedByName: String(currentProfile?.name || currentUser.email || currentUser.uid),
        requestedByRole: String(currentProfile?.role || ""),

        toArea: area,
        toLocationKey: selectedLoc ? (selectedLoc.key || locationKeyFromLabel(selectedLoc.label)) : "",
        toLocationLabel: selectedLoc ? (selectedLoc.label || "") : "",

        status: "requested",
        note: String(requestNote.value || "").trim(),

        createdAt: serverTimestamp(),
        startedAt: null,
        completedAt: null,
        updatedAt: serverTimestamp()
    };

    await setDoc(requestRef, data);

    await updateDoc(doc(db, "ros", currentVehicle.id), {
        activeValetRequestId: requestRef.id,
        activeValetRequestType: type,
        activeValetRequestStatus: "requested",
        updatedAt: serverTimestamp()
    });

    setMsg("Request submitted. Valets will be notified.", true);

    requestType.value = "";
    toArea.value = "";
    toLocation.innerHTML = `<option value="">Select area first...</option>`;
    requestNote.value = "";
}

function renderRequests(rows) {
    if (!rows.length) {
        requestsBody.innerHTML = `<tr><td colspan="8">No open requests.</td></tr>`;
        return;
    }

    requestsBody.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <td>${r.ro || ""}</td>
      <td>${r.tag || ""}</td>
      <td>${requestTypeLabel(r.requestType)}</td>
      <td>${r.currentLocation || "—"}</td>
      <td>${r.toLocationLabel || ""}</td>
      <td>${r.status || ""}</td>
      <td>${r.requestedByName || ""}</td>
      <td>
        ${r.status === "requested"
            ? `<button type="button" class="startBtn">Start</button>`
            : ""}

        ${r.status === "inRoute" && r.startedByUid === currentUser?.uid
            ? `<button type="button" class="completeBtn">Complete</button>`
            : ""}

        ${r.status === "inRoute" && r.startedByUid !== currentUser?.uid
            ? `<span class="muted">Claimed by ${r.startedByName || "another valet"}</span>`
            : ""}

  <button type="button" class="cancelBtn">Cancel</button>
      </td>
    </tr>
  `).join("");

    requestsBody.querySelectorAll(".startBtn").forEach((btn) => {
        btn.onclick = async () => {
            const tr = btn.closest("tr");
            const id = tr?.dataset?.id;
            if (!id) return;

            const request = rows.find(r => r.id === id);

            await updateDoc(doc(db, "valetRequests", id), {
                status: "inRoute",
                startedAt: serverTimestamp(),
                startedByUid: currentUser.uid,
                startedByName: currentProfile?.name || currentUser.email || currentUser.uid,
                updatedAt: serverTimestamp()
            });

            await dismissValetRequestNotifications(id, request);

            // 🔥 LINK TO MOVE & LOCATE
            if (request?.roId) {
                await updateDoc(doc(db, "ros", request.roId), {
                    moveStatus: "moving",
                    moveStartedAt: serverTimestamp(),
                    moveStartedBy: currentProfile?.name || currentUser.email || currentUser.uid,
                    activeMoveRequestId: id,
                    requestedDestinationArea: request.toArea || "",
                    requestedDestinationKey: request.toLocationKey || "",
                    requestedDestinationLabel: request.toLocationLabel || "",
                    updatedAt: serverTimestamp()
                });
            };
        };
    });

    requestsBody.querySelectorAll(".completeBtn").forEach((btn) => {
        btn.onclick = async () => {
            const tr = btn.closest("tr");
            const id = tr?.dataset?.id;
            if (!id) return;

            const request = rows.find(r => r.id === id);

            if (!request) {
                alert("Request not found.");
                return;
            }

            try {
                const roSnap = await getDocs(query(
                    collection(db, "ros"),
                    where("dealerId", "==", Number(request.dealerId || 0)),
                    where("tag", "==", String(request.tag || ""))
                ));

                if (roSnap.empty) {
                    alert("Vehicle not found in Master RO.");
                    return;
                }

                const roDoc = roSnap.docs[0];

                await updateDoc(doc(db, "ros", roDoc.id), {
                    location: request.toLocationLabel || "",
                    locationKey: request.toLocationKey || "",
                    locationArea: request.toArea || "",
                    moveStatus: "idle",

                    activeValetRequestId: null,
                    activeValetRequestType: null,
                    activeValetRequestStatus: null,
                    activeMoveRequestId: null,
                    requestedDestinationArea: null,
                    requestedDestinationKey: null,
                    requestedDestinationLabel: null,

                    updatedAt: serverTimestamp()
                });

                await updateDoc(doc(db, "valetRequests", id), {
                    status: "delivered",
                    completedAt: serverTimestamp(),
                    completedByUid: currentUser.uid,
                    completedByName: currentProfile?.name || currentUser.email || currentUser.uid,
                    updatedAt: serverTimestamp()
                });

            } catch (err) {
                console.error("Complete failed:", err);
                alert(err?.message || "Could not complete request.");
            }
        };

    });

    requestsBody.querySelectorAll(".cancelBtn").forEach((btn) => {
        btn.onclick = async () => {
            const tr = btn.closest("tr");
            const id = tr?.dataset?.id;
            if (!id) return;

            const ok = confirm("Cancel this request?");
            if (!ok) return;

            await updateDoc(doc(db, "valetRequests", id), {
                status: "cancelled",
                cancelledAt: serverTimestamp(),
                cancelledByUid: currentUser.uid,
                cancelledByName: currentProfile?.name || currentUser.email || currentUser.uid,
                updatedAt: serverTimestamp()
            });
        };
    });
}

function listenRequests(dealerId) {
    const q = query(
        collection(db, "valetRequests"),
        where("dealerId", "==", dealerId)
    );

    onSnapshot(q, (snap) => {
        let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        rows = rows.filter((r) => r.status !== "delivered" && r.status !== "cancelled");

        const role = String(currentProfile?.role || "").toLowerCase();
        const valetGroup = String(currentProfile?.valetGroup || "").toLowerCase();

        if (role === "valet" && valetGroup) {
            rows = rows.filter((r) => String(r.valetGroup || "") === valetGroup);
        }

        rows.sort((a, b) => {
            const aMs = typeof a.createdAt?.toDate === "function" ? a.createdAt.toDate().getTime() : 0;
            const bMs = typeof b.createdAt?.toDate === "function" ? b.createdAt.toDate().getTime() : 0;
            return bMs - aMs;
        });

        renderRequests(rows);

        const params = new URLSearchParams(window.location.search);
        const requestId = params.get("requestId");
        if (requestId) {
            const row = requestsBody.querySelector(`tr[data-id="${CSS.escape(requestId)}"]`);
            if (row) {
                row.style.outline = "3px solid #0b3d91";
                row.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        }
    });
}

requestSearchBtn.addEventListener("click", searchVehicle);

requestSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        searchVehicle();
    }
});

toArea.addEventListener("change", () => {
    const area = toArea.value;
    renderLocationDropdown(area);

    if (requestType.value === "bringToShop") {
        autoSelectLocationByWord(area, "shop");
    }
});

requestType.addEventListener("change", () => {
    const type = requestType.value;

    if (!type) return;

    // RESET
    toArea.value = "";
    toLocation.innerHTML = `<option value="">Select area first...</option>`;

    // 🔥 CUSTOMER PICKUP
    if (type === "customerPickup") {
        toArea.value = "main";
        renderLocationDropdown("main");

        // auto select Service Drive if exists
        const match = locationCatalog.find(l =>
            l.area === "main" &&
            String(l.label || "").toLowerCase().includes("service drive")
        );

        if (match) {
            toLocation.value = match.key || locationKeyFromLabel(match.label);
        }
    }

    // 🔥 BRING TO SHOP
    if (type === "bringToShop") {
        toArea.value = "";
        toLocation.innerHTML = `<option value="">Select area first...</option>`;
    }

    // 🔥 MOVE TO ANNEX
    if (type === "moveToAnnex") {
        toArea.value = "annex";
        renderLocationDropdown("annex");
        toLocation.value = "";
    }

    // 🔥 MOVE TO MAIN
    if (type === "moveToMain") {
        toArea.value = "main";
        renderLocationDropdown("main");
        toLocation.value = "";
    }
});

submitRequestBtn.addEventListener("click", async () => {
    try {
        await submitRequest();
    } catch (e) {
        console.error(e);
        setMsg(e?.message || "Could not submit request.", false);
    }
});

onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;

    if (!user) {
        window.location.href = "/login.html";
        return;
    }

    currentProfile = await getUserProfile(user);

    const role = String(currentProfile?.role || "").toLowerCase();
    const dealerId = Number(currentProfile?.dealerId || 0);

    statusEl.textContent = "";

    await loadLocationCatalog(dealerId);
    listenRequests(dealerId);
    renderRequestTypeOptions();

    initNotificationCenter({
        userId: user.uid,
        mountId: "notifMount",
        showDismissed: false,
        filterType: "valetRequest"
    });
});