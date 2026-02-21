// public/js/admin.js
import { auth, db } from "./firebase.js";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { VIEW_KEYS, DEFAULT_COLUMNS_BY_VIEW, allColumnKeys } from "./ui/columnCatalog.js";

const pendingTable = document.getElementById("pendingTable");
const usersTable = document.getElementById("usersTable");

// Roles now (no tech)
const ROLES = ["admin", "manager", "advisor", "wash", "staff", "dropoff", "booker", "qc", "pending"];

/* -----------------------------
   Modal elements (from admin.html)
------------------------------ */
const modalBackdrop = document.getElementById("columnsModalBackdrop");
const modalCloseBtn = document.getElementById("columnsModalCloseBtn");
const modalCancelBtn = document.getElementById("columnsModalCancelBtn");
const modalSaveBtn = document.getElementById("columnsModalSaveBtn");
const modalUserLine = document.getElementById("columnsModalUserLine");
const modalMsg = document.getElementById("columnsModalMsg");
const modalViewSelect = document.getElementById("columnsModalViewSelect");
const modalGrid = document.getElementById("columnsModalGrid");

let modalState = {
  uid: null,
  email: "",
  viewKey: "advisor",
  // latest from Firestore snapshot (if any)
  viewColumnsMap: {},
};

function setModalMsg(text, ok = true) {
  if (!modalMsg) return;
  modalMsg.className = ok ? "ok" : "err";
  modalMsg.textContent = text || "";
}

function openModal() {
  if (!modalBackdrop) return;
  modalBackdrop.style.display = "flex";
  modalBackdrop.setAttribute("aria-hidden", "false");
}

function closeModal() {
  if (!modalBackdrop) return;
  modalBackdrop.style.display = "none";
  modalBackdrop.setAttribute("aria-hidden", "true");
  setModalMsg("");
}

if (modalCloseBtn) modalCloseBtn.onclick = closeModal;
if (modalCancelBtn) modalCancelBtn.onclick = closeModal;
if (modalBackdrop) {
  modalBackdrop.addEventListener("click", (e) => {
    // click outside the modal closes
    if (e.target === modalBackdrop) closeModal();
  });
}

function roleSelect(currentRole) {
  const sel = document.createElement("select");
  ROLES.forEach((r) => {
    const o = document.createElement("option");
    o.value = r;
    o.textContent = r;
    if ((currentRole || "pending") === r) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

function waitForAuthUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u || null);
    });
  });
}

/* -----------------------------
   Columns modal helpers
------------------------------ */
function arrayEq(a, b) {
  const A = Array.isArray(a) ? a : [];
  const B = Array.isArray(b) ? b : [];
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
  return true;
}

function normalizeKeys(keys) {
  // Keep only known catalog keys; keep order as provided
  const known = new Set(allColumnKeys());
  return (keys || []).map(String).filter((k) => known.has(k));
}

function getEffectiveKeysForView(viewKey) {
  const custom = modalState.viewColumnsMap?.[viewKey];
  if (Array.isArray(custom) && custom.length) return normalizeKeys(custom);
  return normalizeKeys(DEFAULT_COLUMNS_BY_VIEW[viewKey] || []);
}

function renderColumnsGrid(viewKey) {
  if (!modalGrid) return;

  const effective = new Set(getEffectiveKeysForView(viewKey));
  const keys = allColumnKeys().slice().sort(); // simple stable list

  modalGrid.innerHTML = "";
  keys.forEach((k) => {
    const label = document.createElement("label");
    label.style.display = "flex";
    label.style.gap = "8px";
    label.style.alignItems = "center";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = effective.has(k);
    cb.dataset.colKey = k;

    const txt = document.createElement("span");
    txt.textContent = k;

    label.appendChild(cb);
    label.appendChild(txt);
    modalGrid.appendChild(label);
  });
}

function fillViewSelect(selectedViewKey) {
  if (!modalViewSelect) return;

  modalViewSelect.innerHTML = "";
  (VIEW_KEYS || []).forEach((vk) => {
    const o = document.createElement("option");
    o.value = vk;
    o.textContent = vk;
    modalViewSelect.appendChild(o);
  });

  modalViewSelect.value = selectedViewKey;
}

function openColumnsModalForUser({ uid, email, initialViewKey, viewColumnsMap }) {
  modalState.uid = uid;
  modalState.email = email || uid;
  modalState.viewKey = initialViewKey || "advisor";
  modalState.viewColumnsMap = viewColumnsMap || {};

  if (modalUserLine) {
    modalUserLine.textContent = `User: ${modalState.email}  |  UID: ${uid}`;
  }

  fillViewSelect(modalState.viewKey);
  renderColumnsGrid(modalState.viewKey);

  setModalMsg("Edit columns, then Save.", true);
  openModal();
}

if (modalViewSelect) {
  modalViewSelect.addEventListener("change", () => {
    modalState.viewKey = String(modalViewSelect.value || "advisor");
    renderColumnsGrid(modalState.viewKey);
    setModalMsg("");
  });
}

if (modalSaveBtn) {
  modalSaveBtn.onclick = async () => {
    try {
      const uid = modalState.uid;
      const viewKey = modalState.viewKey;
      if (!uid || !viewKey) return;

      // collect checked keys in the same order as shown
      const checked = [];
      modalGrid
        .querySelectorAll('input[type="checkbox"][data-col-key]')
        .forEach((cb) => {
          if (cb.checked) checked.push(cb.dataset.colKey);
        });

      const selectedKeys = normalizeKeys(checked);
      const defaultKeys = normalizeKeys(DEFAULT_COLUMNS_BY_VIEW[viewKey] || []);

      // If user selection matches defaults, store nothing (keeps DB clean)
      const patch = {};
      if (arrayEq(selectedKeys, defaultKeys)) {
        patch[`viewColumns.${viewKey}`] = deleteField();
      } else {
        patch[`viewColumns.${viewKey}`] = selectedKeys;
      }
      patch.updatedAt = serverTimestamp();

      await updateDoc(doc(db, "users", uid), patch);

      // update local modal state too
      modalState.viewColumnsMap = {
        ...(modalState.viewColumnsMap || {}),
        [viewKey]: arrayEq(selectedKeys, defaultKeys) ? undefined : selectedKeys,
      };

      setModalMsg("Saved.", true);
    } catch (e) {
      console.error(e);
      setModalMsg(e?.message || "Save failed.", false);
    }
  };
}

// --------------------
// Pending approvals
// --------------------
async function loadPending() {
  pendingTable.innerHTML = "";

  const q = query(collection(db, "users"), where("role", "==", "pending"));
  const snap = await getDocs(q);

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const tr = document.createElement("tr");

    const nameInput = document.createElement("input");
    nameInput.value = data.name || "";

    const empInput = document.createElement("input");
    empInput.value = data.employeeId || "";

    // Default role when approving
    const sel = roleSelect("advisor");

    const approveBtn = document.createElement("button");
    approveBtn.textContent = "Approve";

    approveBtn.onclick = async () => {
      await updateDoc(doc(db, "users", docSnap.id), {
        name: nameInput.value.trim(),
        employeeId: empInput.value.trim(),
        role: sel.value,
        active: true,
        updatedAt: serverTimestamp(),
      });

      await loadPending();
      await loadAllUsers();

      // ✅ optional: open column modal right after approval
      openColumnsModalForUser({
        uid: docSnap.id,
        email: data.email || docSnap.id,
        initialViewKey: sel.value,
        viewColumnsMap: data.viewColumns || {},
      });
    };

    tr.innerHTML = `
      <td>${data.email || ""}</td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    `;
    tr.children[1].appendChild(nameInput);
    tr.children[2].appendChild(empInput);
    tr.children[3].appendChild(sel);
    tr.children[4].appendChild(approveBtn);

    pendingTable.appendChild(tr);
  });
}

// --------------------
// All users (Admin)
// --------------------
async function loadAllUsers() {
  usersTable.innerHTML = "";

  const me = await waitForAuthUser();
  const myUid = me?.uid || null;

  const snap = await getDocs(collection(db, "users"));

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const uid = docSnap.id;

    const tr = document.createElement("tr");

    const nameInput = document.createElement("input");
    nameInput.value = data.name || "";

    const empInput = document.createElement("input");
    empInput.value = data.employeeId || "";

    const sel = roleSelect(data.role || "pending");

    const activeCheckbox = document.createElement("input");
    activeCheckbox.type = "checkbox";
    activeCheckbox.checked = data.active !== false;

    // ✅ REAL Columns button (opens modal)
    const columnsBtn = document.createElement("button");
    columnsBtn.textContent = "Columns";
    columnsBtn.style.marginRight = "8px";

    columnsBtn.onclick = async () => {
      // use the user's CURRENT role as the default view selection
      const initialViewKey = String(sel.value || data.role || "advisor").toLowerCase();

      openColumnsModalForUser({
        uid,
        email: data.email || uid,
        initialViewKey,
        viewColumnsMap: data.viewColumns || {},
      });
    };

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.style.marginLeft = "8px";

    const isSelf = myUid && uid === myUid;
    if (isSelf) {
      deleteBtn.disabled = true;
      deleteBtn.title = "Admin cannot delete itself.";
    }

    saveBtn.onclick = async () => {
      await updateDoc(doc(db, "users", uid), {
        name: nameInput.value.trim(),
        employeeId: empInput.value.trim(),
        role: sel.value,
        active: activeCheckbox.checked,
        updatedAt: serverTimestamp(),
      });
    };

    deleteBtn.onclick = async () => {
      if (isSelf) return;

      const ok = confirm(`Delete user ${data.email || uid}? This is permanent.`);
      if (!ok) return;

      await deleteDoc(doc(db, "users", uid));
      await loadPending();
      await loadAllUsers();
    };

    tr.innerHTML = `
      <td>${data.email || ""}</td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    `;

    tr.children[1].appendChild(nameInput);
    tr.children[2].appendChild(empInput);
    tr.children[3].appendChild(sel);
    tr.children[4].appendChild(activeCheckbox);

    // ✅ Actions: Columns + Save + Delete (FIXED)
    tr.children[5].appendChild(columnsBtn);
    tr.children[5].appendChild(saveBtn);
    tr.children[5].appendChild(deleteBtn);

    usersTable.appendChild(tr);
  });
}

loadPending();
loadAllUsers();