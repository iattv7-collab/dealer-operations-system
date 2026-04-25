// File: /public/js/locationSettings.js
// Purpose: Manage dealership location catalog (Main Store / Annex / custom lots).
// Description:
// - Loads all locations for the current dealer from Firestore (locationCatalog)
// - Allows inline editing of location name, area, and active status
// - Save button is disabled until changes are made (dirty state)
// - Updates label, key, area, and active fields safely
// - Prevents accidental overwrite by requiring explicit Save action
// - Used by Location module (Move/Locate) and Foreman filtering (Main vs Annex)


import { auth, db } from "./firebase.js";
import { getUserDealerId } from "./guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const locLabel = document.getElementById("locLabel");
const locArea = document.getElementById("locArea");
const addBtn = document.getElementById("addLocationBtn");
const body = document.getElementById("locationCatalogBody");

let dealerId = null;

function locationKeyFromLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function render(rows) {
  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4">No locations</td></tr>`;
    return;
  }

  rows.forEach((l) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><input value="${l.label || ""}" style="width:220px;"></td>

      <td>
        <select>
          <option value="main" ${l.area === "main" ? "selected" : ""}>Main Store</option>
          <option value="annex" ${l.area === "annex" ? "selected" : ""}>Annex</option>
        </select>
      </td>

      <td><input type="checkbox" ${l.active !== false ? "checked" : ""}></td>

      <td><button disabled style="opacity:0.4;">Save</button></td>
    `;

    const labelInput = tr.children[0].querySelector("input");
    const areaSelect = tr.children[1].querySelector("select");
    const activeCheckbox = tr.children[2].querySelector("input");
    const saveBtn = tr.children[3].querySelector("button");

    function markDirty() {
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
      saveBtn.textContent = "Save";
    }

    labelInput.addEventListener("input", markDirty);
    areaSelect.addEventListener("change", markDirty);
    activeCheckbox.addEventListener("change", markDirty);

    saveBtn.onclick = async () => {
      const newLabel = labelInput.value.trim();
      const newArea = areaSelect.value;
      const newActive = activeCheckbox.checked;

      if (!newLabel) return;

      try {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        await updateDoc(doc(db, "locationCatalog", l.id), {
          label: newLabel,
          key: locationKeyFromLabel(newLabel),
          area: newArea,
          active: newActive,
          updatedAt: serverTimestamp()
        });

        saveBtn.textContent = "Saved";
        saveBtn.style.opacity = "0.4";

        setTimeout(() => {
          saveBtn.textContent = "Save";
          saveBtn.disabled = true;
        }, 900);
      } catch (e) {
        console.error(e);
        saveBtn.textContent = "Error";
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";
      }
    };

    body.appendChild(tr);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  dealerId = await getUserDealerId(user);

  const q = query(
    collection(db, "locationCatalog"),
    where("dealerId", "==", dealerId)
  );

  onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    rows.sort((a, b) =>
      String(a.label || "").localeCompare(String(b.label || ""), undefined, { numeric: true })
    );

    render(rows);
  });
});

addBtn.onclick = async () => {
  const label = locLabel.value.trim();
  const area = locArea.value;

  if (!label) return;

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