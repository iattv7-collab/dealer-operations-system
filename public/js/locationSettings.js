// File: /public/js/locationSettings.js

import { auth, db } from "./firebase.js";
import { getUserDealerId } from "./guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const locLabel = document.getElementById("locLabel");
const locArea = document.getElementById("locArea");
const addBtn = document.getElementById("addLocationBtn");
const saveAllBtn = document.getElementById("saveAllBtn");

const activeBody = document.getElementById("activeLocationCatalogBody");
const inactiveBody = document.getElementById("inactiveLocationCatalogBody");

let dealerId = null;
let locationCatalog = [];
let dirtyRows = new Map();

function locationKeyFromLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function updateSaveAllButton() {
  const hasChanges = dirtyRows.size > 0;

  saveAllBtn.disabled = !hasChanges;
  saveAllBtn.style.opacity = hasChanges ? "1" : "0.4";
  saveAllBtn.textContent = hasChanges
    ? `Save All Changes (${dirtyRows.size})`
    : "Save All Changes";
}

/* =========================
   RENDER
========================= */

function render(rows) {
  activeBody.innerHTML = "";
  inactiveBody.innerHTML = "";

  const activeRows = rows.filter(l => l.active !== false);
  const inactiveRows = rows.filter(l => l.active === false);

  renderTable(activeBody, activeRows, true);
  renderTable(inactiveBody, inactiveRows, false);

  updateSaveAllButton();
}

function renderTable(targetBody, rows, isActiveTable) {
  if (!rows.length) {
    targetBody.innerHTML = `
      <tr>
        <td colspan="4">
          ${isActiveTable ? "No active locations" : "No inactive locations"}
        </td>
      </tr>
    `;
    return;
  }

  rows.forEach((l) => {
    const tr = document.createElement("tr");

    const dirty = dirtyRows.get(l.id);

    const displayLabel = dirty?.label ?? l.label ?? "";
    const displayArea = dirty?.area ?? l.area ?? "main";

    tr.innerHTML = `
      <td><input value="${displayLabel}" style="width:220px;"></td>

      <td>
        <select>
          <option value="main" ${displayArea === "main" ? "selected" : ""}>Main Store</option>
          <option value="annex" ${displayArea === "annex" ? "selected" : ""}>Annex</option>
        </select>
      </td>

      <td>${isActiveTable ? "Active" : "Inactive"}</td>

      <td>
        <button type="button" class="toggleBtn" style="margin-left:6px;">
          ${isActiveTable ? "Deactivate" : "Restore"}
        </button>

        <button type="button" class="deleteBtn" style="margin-left:6px; background:#8a0018; color:#ffffff; font-weight:700; letter-spacing:0.3px; text-shadow: 0 0 0.5px rgba(0,0,0,0.3);">
          Delete
        </button>
      </td>
    `;

    const labelInput = tr.children[0].querySelector("input");
    const areaSelect = tr.children[1].querySelector("select");
    const toggleBtn = tr.querySelector(".toggleBtn");
    const deleteBtn = tr.querySelector(".deleteBtn");

    function markDirty() {
      const newLabel = labelInput.value.trim();
      const newArea = areaSelect.value;

      if (!newLabel) return;

      dirtyRows.set(l.id, {
        label: newLabel,
        area: newArea
      });

      updateSaveAllButton();
    }

    labelInput.addEventListener("input", markDirty);
    areaSelect.addEventListener("change", markDirty);

    toggleBtn.onclick = async () => {
      const action = isActiveTable ? "deactivate" : "restore";

      const ok = confirm(`Are you sure you want to ${action} this location?`);
      if (!ok) return;

      dirtyRows.delete(l.id);
      updateSaveAllButton();

      await updateDoc(doc(db, "locationCatalog", l.id), {
        active: !isActiveTable,
        updatedAt: serverTimestamp()
      });
    };

    deleteBtn.onclick = async () => {
      const firstConfirm = confirm(
        `WARNING: You are about to delete "${l.label}".\n\nThis should only be done during testing.\n\nContinue?`
      );

      if (!firstConfirm) return;

      const secondConfirm = confirm(
        `FINAL CONFIRMATION:\n\nDelete "${l.label}" permanently?`
      );

      if (!secondConfirm) return;

      dirtyRows.delete(l.id);
      updateSaveAllButton();

      await deleteDoc(doc(db, "locationCatalog", l.id));
    };

    targetBody.appendChild(tr);
  });
}

/* =========================
   LOAD DATA
========================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  dealerId = await getUserDealerId(user);

  const q = query(
    collection(db, "locationCatalog"),
    where("dealerId", "==", dealerId)
  );

  onSnapshot(q, (snap) => {
    locationCatalog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    locationCatalog.sort((a, b) => {
      const areaCompare = String(a.area || "").localeCompare(String(b.area || ""));
      if (areaCompare !== 0) return areaCompare;

      return String(a.label || "").localeCompare(String(b.label || ""), undefined, { numeric: true });
    });

    render(locationCatalog);
  });
});

/* =========================
   ADD LOCATION
========================= */

addBtn.onclick = async () => {
  const label = locLabel.value.trim();
  const area = locArea.value;

  if (!label) return;

  const exists = locationCatalog.some(l =>
    l.area === area &&
    l.label.toLowerCase().trim() === label.toLowerCase().trim()
  );

  if (exists) {
    alert("This location already exists in that area.");
    return;
  }

  await addDoc(collection(db, "locationCatalog"), {
    dealerId,
    label,
    key: locationKeyFromLabel(label),
    area,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  locLabel.value = "";
};

/* =========================
   SAVE ALL
========================= */

saveAllBtn.onclick = async () => {
  if (!dirtyRows.size) return;

  try {
    saveAllBtn.disabled = true;
    saveAllBtn.textContent = "Saving all...";

    const saves = [];

    dirtyRows.forEach((pending, id) => {
      saves.push(
        updateDoc(doc(db, "locationCatalog", id), {
          label: pending.label,
          key: locationKeyFromLabel(pending.label),
          area: pending.area,
          updatedAt: serverTimestamp()
        })
      );
    });

    await Promise.all(saves);

    dirtyRows.clear();
    updateSaveAllButton();

    saveAllBtn.textContent = "Saved All";

    setTimeout(() => {
      updateSaveAllButton();
    }, 900);
  } catch (e) {
    console.error(e);
    alert("Could not save all changes. Check console.");
    updateSaveAllButton();
  }
};