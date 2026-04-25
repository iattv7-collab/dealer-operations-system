// File: /public/js/tech.js
// Purpose: Tech view pulling assigned ROs from main RO list / ros collection, with editable tech actions.

import { auth, db } from "./firebase.js";
import { getUserDealerId } from "./guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const table = document.getElementById("ticketsTable");
const searchInput = document.getElementById("searchInput");
const msgEl = document.getElementById("msg");

let allRows = [];

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

function makeInputCell(t, field, type = "text") {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = type;
  input.value = t[field] || "";
  input.style.width = "160px";

  input.onchange = async () => {
    await updateDoc(doc(db, "ros", t.id), {
      [field]: input.value,
      updatedAt: serverTimestamp()
    });
    setMsg("Saved.");
  };

  td.appendChild(input);
  return td;
}

function makeDoneCell(t) {
  const td = document.createElement("td");
  const btn = document.createElement("button");
  btn.textContent = t.techDone ? "Done ✅" : "Mark Done";

  btn.onclick = async () => {
    const next = !t.techDone;

    await updateDoc(doc(db, "ros", t.id), {
      techDone: next,
      repairCompleted: next,
      techDoneAt: next ? serverTimestamp() : null,
      updatedAt: serverTimestamp()
    });

    setMsg(next ? "Marked tech done." : "Tech done cleared.");
  };

  td.appendChild(btn);
  return td;
}

function render(rows) {
  table.innerHTML = "";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  ["RO", "Tag", "Year", "Model", "Concern", "Location", "Parts ETA", "Tech Done", "Tech Notes"]
    .forEach((h) => {
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
    td.colSpan = 9;
    td.textContent = "No assigned ROs.";
    td.className = "muted";
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    return;
  }

  rows.forEach((t) => {
    const tr = document.createElement("tr");

    tr.appendChild(makeTd(t.ro || t.id || ""));
    tr.appendChild(makeTd(t.tag || ""));
    tr.appendChild(makeTd(t.year || ""));
    tr.appendChild(makeTd(t.model || ""));
    tr.appendChild(makeTd(t.concern || ""));
    tr.appendChild(makeTd(t.location || ""));
    tr.appendChild(makeInputCell(t, "partsEta", "text"));
    tr.appendChild(makeDoneCell(t));
    tr.appendChild(makeInputCell(t, "techNotes", "text"));

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

function applySearch() {
  const q = String(searchInput?.value || "").trim().toLowerCase();

  if (!q) {
    render(allRows);
    return;
  }

  render(allRows.filter((t) => {
    const ro = String(t.ro || t.id || "").toLowerCase();
    const tag = String(t.tag || "").toLowerCase();
    const customer = String(t.customerName || "").toLowerCase();
    return ro.includes(q) || tag.includes(q) || customer.includes(q);
  }));
}

if (searchInput) searchInput.addEventListener("input", applySearch);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setMsg("Not signed in.", false);
    return;
  }

  try {
    const dealerId = await getUserDealerId(user);

    const q = query(
      collection(db, "ros"),
      where("dealerId", "==", dealerId),
      where("assignedTechUid", "==", user.uid)
    );

    onSnapshot(q, (snap) => {
      allRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      allRows.sort((a, b) =>
        String(a.ro || a.id || "").localeCompare(
          String(b.ro || b.id || ""),
          undefined,
          { numeric: true }
        )
      );

      setMsg(`Loaded ${allRows.length} assigned RO(s).`);
      applySearch();
    }, (err) => {
      console.error(err);
      setMsg("Error loading assigned ROs: " + err.message, false);
    });
  } catch (e) {
    console.error(e);
    setMsg("Tech load error: " + e.message, false);
  }
});