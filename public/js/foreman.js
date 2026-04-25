// File: /public/js/foreman.js
// Purpose: Foreman dispatch board from main RO list / ros collection.

import { auth, db } from "./firebase.js";
import { getUserDealerId } from "./guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    collection,
    query,
    where,
    onSnapshot,
    updateDoc,
    setDoc,
    doc,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const table = document.getElementById("ticketsTable");
const searchInput = document.getElementById("searchInput");
const msgEl = document.getElementById("msg");

let allRows = [];
let techUsers = [];
let currentDealerId = null;

let currentFilter = "all";
let currentSort = "ro";
let workloadFilterText = "";
let locationAreaFilter = "all"; // all | main | annex
let waiterCapacity = "open";

function setMsg(text, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "green" : "crimson";
}

function makeTd(value) {
    const td = document.createElement("td");
    td.textContent = value || "";
    return td;
}

function techDisplayName(tech) {
    return tech.employeeId || tech.name || tech.email || tech.uid || "";
}

function formatDate(val) {
    if (!val) return "";

    const d = new Date(val);
    if (isNaN(d)) return val;

    return d.toLocaleString(); // clean readable date
}

function getDueValue(t) {
    return formatDate(
        t.needByAtMs ||
        t.nextUpdateAtMs ||
        t.promiseDate
    );
}

async function loadTechUsers(dealerId) {
    const q = query(
        collection(db, "users"),
        where("dealerId", "==", dealerId),
        where("role", "==", "tech"),
        where("active", "==", true)
    );

    const snap = await getDocs(q);
    techUsers = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    techUsers.sort((a, b) =>
        String(techDisplayName(a)).localeCompare(String(techDisplayName(b)), undefined, { numeric: true })
    );
}

function ensureControls() {
    if (document.getElementById("foremanControls")) return;

    const wrap = document.createElement("div");
    wrap.id = "foremanControls";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";
    wrap.style.flexWrap = "wrap";
    wrap.style.margin = "10px 0";
    wrap.style.alignItems = "center";

    wrap.innerHTML = `
    <button type="button" data-filter="all">All</button>
    <button type="button" data-filter="waiters">Waiters</button>
    <button type="button" data-filter="unassigned">Unassigned</button>
    <button type="button" data-filter="assigned">Assigned</button>
    <span style="margin-left:12px;">Shop:</span>
    <span style="margin-left:12px;">Waiters:</span>
    <select id="waiterCapacitySelect">
      <option value="open">Open</option>
      <option value="limited">Limited</option>
      <option value="full">Full</option>
    </select>
    <button type="button" data-area="all">All Shops</button>
    <button type="button" data-area="main">Main Store</button>
    <button type="button" data-area="annex">Annex</button>

    <span style="margin-left:12px;">Workload:</span>
    <input id="foremanWorkloadFilter" type="text" placeholder="Tech or advisor # / name / email" style="padding:6px 8px; width:280px;">

    <button type="button" id="clearFiltersBtn">Clear Filters</button>

    <span style="margin-left:12px;">Sort:</span>
    <button type="button" data-sort="ro">RO</button>
    <button type="button" data-sort="due">Due Date</button>
    <button type="button" data-sort="tech">Tech</button>
    <button type="button" data-sort="advisor">Advisor</button>
  `;

    table.parentElement.insertBefore(wrap, table);

    wrap.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;

        if (btn.dataset.filter) currentFilter = btn.dataset.filter;
        if (btn.dataset.sort) currentSort = btn.dataset.sort;
        if (btn.dataset.area) locationAreaFilter = btn.dataset.area;

        applySearch();
    });

    document.getElementById("foremanWorkloadFilter")?.addEventListener("input", (e) => {
        workloadFilterText = String(e.target.value || "").trim().toLowerCase();
        applySearch();
    });

    document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
        currentFilter = "all";
        currentSort = "ro";
        workloadFilterText = "";
        locationAreaFilter = "all";

        if (searchInput) searchInput.value = "";
        const workloadInput = document.getElementById("foremanWorkloadFilter");
        if (workloadInput) workloadInput.value = "";

        applySearch();
    });
}

const waiterSelect = document.getElementById("waiterCapacitySelect");

if (waiterSelect) {
    waiterSelect.value = waiterCapacity;

    waiterSelect.addEventListener("change", async () => {
        waiterCapacity = waiterSelect.value;

        try {
            await setDoc(doc(db, "settings", `shopLoad_${currentDealerId}`), {
                dealerId: currentDealerId,
                waiterCapacity,
                updatedAt: serverTimestamp()
            }, { merge: true });

            setMsg("Waiter capacity updated.");
        } catch (e) {
            console.error(e);
            setMsg("Failed to update waiter capacity.", false);
        }
    });
}


function makeTechSelectCell(t) {
    const td = document.createElement("td");
    const select = document.createElement("select");

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "--";
    select.appendChild(empty);

    techUsers.forEach((tech) => {
        const opt = document.createElement("option");
        opt.value = tech.uid;
        opt.textContent = techDisplayName(tech);
        if (t.assignedTechUid === tech.uid) opt.selected = true;
        select.appendChild(opt);
    });

    select.onchange = async () => {
        try {
            const selectedUid = select.value;
            const selectedTech = techUsers.find((x) => x.uid === selectedUid) || null;

            if (!selectedTech) {
                await updateDoc(doc(db, "ros", t.id), {
                    assignedTechUid: "",
                    assignedTechName: "",
                    assignedTechEmployeeId: "",
                    assignedTechEmail: "",
                    assignedTechDealerId: currentDealerId,
                    assignedTechAt: null,
                    updatedAt: serverTimestamp()
                });

                setMsg("Tech assignment cleared.");
                return;
            }

            await updateDoc(doc(db, "ros", t.id), {
                assignedTechUid: selectedTech.uid,
                assignedTechName: selectedTech.name || "",
                assignedTechEmployeeId: selectedTech.employeeId || "",
                assignedTechEmail: selectedTech.email || "",
                assignedTechDealerId: currentDealerId,
                assignedTechAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            setMsg("Tech assigned.");
        } catch (e) {
            console.error(e);
            setMsg("Failed to assign tech: " + e.message, false);
        }
    };

    td.appendChild(select);
    return td;
}

function makeForemanNotesCell(t) {
    const td = document.createElement("td");
    const input = document.createElement("input");

    input.value = t.foremanNotes || "";
    input.style.width = "160px";

    input.onchange = async () => {
        try {
            await updateDoc(doc(db, "ros", t.id), {
                foremanNotes: input.value,
                updatedAt: serverTimestamp()
            });
            setMsg("Foreman notes saved.");
        } catch (e) {
            console.error(e);
            setMsg("Failed to save foreman notes: " + e.message, false);
        }
    };

    td.appendChild(input);
    return td;
}

function rowTechText(t) {
    return String([
        t.assignedTechEmployeeId,
        t.assignedTechName,
        t.assignedTechEmail,
        t.assignedTechUid
    ].filter(Boolean).join(" ")).toLowerCase();
}

function rowAdvisorText(t) {
    return String([
        t.advisorNumber,
        t.advisorName,
        t.advisorEmail,
        t.advisorId
    ].filter(Boolean).join(" ")).toLowerCase();
}

function filterRows(rows) {
    let out = rows;

    if (currentFilter === "waiters") {
        out = out.filter((t) => t.customerWaiting === true);
    }

    if (currentFilter === "unassigned") {
        out = out.filter((t) => !t.assignedTechUid);
    }

    if (locationAreaFilter !== "all") {
        out = out.filter((t) => String(t.locationArea || "").toLowerCase() === locationAreaFilter);
    }

    if (currentFilter === "assigned") {
        out = out.filter((t) => !!t.assignedTechUid);
    }

    if (workloadFilterText) {
        out = out.filter((t) =>
            rowTechText(t).includes(workloadFilterText) ||
            rowAdvisorText(t).includes(workloadFilterText)
        );
    }

    return out;
}

function sortRows(rows) {
    const out = rows.slice();

    if (currentSort === "due") {
        out.sort((a, b) =>
            String(getDueValue(a)).localeCompare(String(getDueValue(b)), undefined, { numeric: true })
        );
        return out;
    }

    if (currentSort === "tech") {
        out.sort((a, b) => rowTechText(a).localeCompare(rowTechText(b), undefined, { numeric: true }));
        return out;
    }

    if (currentSort === "advisor") {
        out.sort((a, b) => rowAdvisorText(a).localeCompare(rowAdvisorText(b), undefined, { numeric: true }));
        return out;
    }

    out.sort((a, b) =>
        String(a.ro || a.id || "").localeCompare(String(b.ro || b.id || ""), undefined, { numeric: true })
    );

    return out;
}

function render(rows) {
    ensureControls();
    table.innerHTML = "";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    [
        "RO",
        "Tag",
        "Year",
        "Model",
        "Concern",
        "Waiter",
        "Advisor",
        "Tech",
        "Location",
        "Due",
        "Parts ETA",
        "Foreman Notes",
        "Tech Done",
        "Tech Notes"
    ].forEach((h) => {
        const th = document.createElement("th");
        th.textContent = h;
        headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    if (!rows.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 14;
        td.textContent = "No RO found.";
        td.className = "muted";
        tr.appendChild(td);
        tbody.appendChild(tr);
        table.appendChild(tbody);
        return;
    }

    rows.forEach((t) => {
        const tr = document.createElement("tr");
        const isWaiter = t.customerWaiting === true;

        tr.appendChild(makeTd(t.ro || t.id || ""));
        tr.appendChild(makeTd(t.tag || ""));
        tr.appendChild(makeTd(t.year || ""));
        tr.appendChild(makeTd(t.model || ""));
        tr.appendChild(makeTd(t.concern || ""));
        tr.appendChild(makeTd(isWaiter ? "🔥 WAITER" : ""));
        tr.appendChild(makeTd(t.advisorNumber || t.advisorName || ""));
        tr.appendChild(makeTechSelectCell(t));
        tr.appendChild(makeTd(t.location || ""));
        tr.appendChild(makeTd(getDueValue(t)));
        tr.appendChild(makeTd(t.partsEta || ""));
        tr.appendChild(makeForemanNotesCell(t));
        tr.appendChild(makeTd(t.techDone ? "✅" : ""));
        tr.appendChild(makeTd(t.techNotes || t.techComments || ""));

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
}

function applySearch() {
    const q = String(searchInput?.value || "").trim().toLowerCase();

    let rows = filterRows(allRows);

    if (q) {
        rows = rows.filter((t) => {
            const main = String([
                t.ro,
                t.id,
                t.tag,
                t.customerName,
                t.model,
                t.concern,
                t.location
            ].filter(Boolean).join(" ")).toLowerCase();

            return main.includes(q) || rowAdvisorText(t).includes(q) || rowTechText(t).includes(q);
        });
    }

    const finalRows = sortRows(rows);
    setMsg(`Showing ${finalRows.length} / ${allRows.length} ROs`);
    render(finalRows);
}

if (searchInput) {
    searchInput.addEventListener("input", applySearch);
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        setMsg("Not signed in.", false);
        return;
    }

    try {
        currentDealerId = await getUserDealerId(user);
        await loadTechUsers(currentDealerId);

        const shopLoadSnap = await getDocs(
            query(collection(db, "settings"), where("dealerId", "==", currentDealerId))
        );

        shopLoadSnap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            if (data.waiterCapacity) {
                waiterCapacity = data.waiterCapacity;
            }
        });

        const q = query(
            collection(db, "ros"),
            where("dealerId", "==", currentDealerId)
        );

        onSnapshot(
            q,
            (snap) => {
                allRows = snap.docs.map((d) => ({
                    id: d.id,
                    ...d.data()
                }));

                applySearch();
            },
            (err) => {
                console.error(err);
                setMsg("Error loading main RO list: " + err.message, false);
            }
        );
    } catch (e) {
        console.error(e);
        setMsg("Foreman load error: " + e.message, false);
    }
});