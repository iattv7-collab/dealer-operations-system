// File: public/js/admin.js
// Purpose: Admin user management page, including per-user column visibility/edit modal

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
const ROLES = ["admin", "manager", "advisor", "wash", "valet", "staff", "dropoff", "booker", "qc", "pending"];

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
  viewColumnsMap: {},
  editColumnsMap: {},
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

function enableModalSave() {
  if (!modalSaveBtn) return;
  modalSaveBtn.disabled = false;
  modalSaveBtn.style.opacity = "1";
}

if (modalCloseBtn) modalCloseBtn.onclick = closeModal;
if (modalCancelBtn) modalCancelBtn.onclick = closeModal;
if (modalBackdrop) {
  modalBackdrop.addEventListener("click", (e) => {
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
  for (let i = 0; i < A.length; i++) {
    if (A[i] !== B[i]) return false;
  }
  return true;
}

function normalizeKeys(keys) {
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

  const effectiveView = new Set(getEffectiveKeysForView(viewKey));
  const editMap = modalState.editColumnsMap || {};
  const effectiveEdit = new Set(normalizeKeys(editMap[viewKey] || []));
  const keys = allColumnKeys().slice().sort();

  modalGrid.innerHTML = "";

  keys.forEach((k) => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr auto auto";
    row.style.alignItems = "center";
    row.style.gap = "10px";

    const left = document.createElement("span");
    left.textContent = k;

    const viewWrap = document.createElement("label");
    viewWrap.style.display = "flex";
    viewWrap.style.alignItems = "center";
    viewWrap.style.gap = "6px";

    const viewCb = document.createElement("input");
    viewCb.type = "checkbox";
    viewCb.checked = effectiveView.has(k);
    viewCb.dataset.colKey = k;
    viewCb.dataset.type = "view";

    const viewTxt = document.createElement("span");
    viewTxt.textContent = "View";

    viewWrap.appendChild(viewCb);
    viewWrap.appendChild(viewTxt);

    const editWrap = document.createElement("label");
    editWrap.style.display = "flex";
    editWrap.style.alignItems = "center";
    editWrap.style.gap = "6px";

    const editCb = document.createElement("input");
    editCb.type = "checkbox";
    editCb.checked = effectiveEdit.has(k);
    editCb.dataset.colKey = k;
    editCb.dataset.type = "edit";
    editCb.disabled = !viewCb.checked;

    const editTxt = document.createElement("span");
    editTxt.textContent = "Edit";

    editWrap.appendChild(editCb);
    editWrap.appendChild(editTxt);

    viewCb.addEventListener("change", () => {
      if (!viewCb.checked) {
        editCb.checked = false;
        editCb.disabled = true;
      } else {
        editCb.disabled = false;
      }
      enableModalSave(); // ✅ THIS WAS MISSING
    });

    editCb.addEventListener("change", () => {
      enableModalSave();
    });

    row.appendChild(left);
    row.appendChild(viewWrap);
    row.appendChild(editWrap);

    modalGrid.appendChild(row);
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

function openColumnsModalForUser({ uid, email, initialViewKey, viewColumnsMap, editColumnsMap }) {
  modalState.uid = uid;
  modalState.email = email || uid;
  modalState.viewKey = initialViewKey || "advisor";
  modalState.viewColumnsMap = viewColumnsMap || {};
  modalState.editColumnsMap = editColumnsMap || {};

  if (modalUserLine) {
    modalUserLine.textContent = `User: ${modalState.email}  |  UID: ${uid}`;
  }

  fillViewSelect(modalState.viewKey);
  renderColumnsGrid(modalState.viewKey);

  setModalMsg("Edit columns, then Save.", true);
  if (modalSaveBtn) {
    modalSaveBtn.disabled = true;
    modalSaveBtn.style.opacity = "0.5";
  }
  openModal();
}

if (modalViewSelect) {
  modalViewSelect.addEventListener("change", () => {
    modalState.viewKey = String(modalViewSelect.value || "advisor");
    renderColumnsGrid(modalState.viewKey);
    setModalMsg("");
    enableModalSave();
  });
}



if (modalSaveBtn) {
  modalSaveBtn.onclick = async () => {
    try {
      const uid = modalState.uid;
      const viewKey = modalState.viewKey;
      if (!uid || !viewKey) return;

      const checked = [];
      modalGrid
        .querySelectorAll('input[data-type="view"][data-col-key]')
        .forEach((cb) => {
          if (cb.checked) checked.push(cb.dataset.colKey);
        });

      const editChecked = [];
      modalGrid
        .querySelectorAll('input[data-type="edit"][data-col-key]')
        .forEach((cb) => {
          if (cb.checked) editChecked.push(cb.dataset.colKey);
        });

      const selectedKeys = normalizeKeys(checked);
      const editKeys = normalizeKeys(editChecked);
      const defaultKeys = normalizeKeys(DEFAULT_COLUMNS_BY_VIEW[viewKey] || []);

      const patch = {};

      if (arrayEq(selectedKeys, defaultKeys)) {
        patch[`viewColumns.${viewKey}`] = deleteField();
      } else {
        patch[`viewColumns.${viewKey}`] = selectedKeys;
      }

      if (editKeys.length === 0) {
        patch[`editColumns.${viewKey}`] = deleteField();
      } else {
        patch[`editColumns.${viewKey}`] = editKeys;
      }

      patch.updatedAt = serverTimestamp();

      await updateDoc(doc(db, "users", uid), patch);

      modalState.editColumnsMap = {
        ...(modalState.editColumnsMap || {}),
        [viewKey]: editKeys.length ? editKeys : undefined,
      };

      modalState.viewColumnsMap = {
        ...(modalState.viewColumnsMap || {}),
        [viewKey]: arrayEq(selectedKeys, defaultKeys) ? undefined : selectedKeys,
      };

      setModalMsg("✅ Saved successfully", true);
      if (modalSaveBtn) {
        modalSaveBtn.disabled = true;
        modalSaveBtn.style.opacity = "0.5";
      }

      await loadAllUsers();

      setTimeout(() => {
        closeModal();
      }, 800);

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

    const dealerInput = document.createElement("input");
    dealerInput.type = "number";
    dealerInput.value = Number(data.dealerId || 1);

    const sel = roleSelect("advisor");

    const approveBtn = document.createElement("button");
    approveBtn.textContent = "Approve";

    approveBtn.onclick = async () => {
      await updateDoc(doc(db, "users", docSnap.id), {
        name: nameInput.value.trim(),
        employeeId: empInput.value.trim(),
        dealerId: Number(dealerInput.value) || 1,
        role: sel.value,
        active: true,
        permissions: {
          canControlWashDay: false,
          canEditTickets: false,
          corrections: {
            tag: false,
            ro: false,
            location: false,
            advisorNumber: false,
          },
        },
        updatedAt: serverTimestamp(),
      });

      await loadPending();
      await loadAllUsers();

      openColumnsModalForUser({
        uid: docSnap.id,
        email: data.email || docSnap.id,
        initialViewKey: sel.value,
        viewColumnsMap: data.viewColumns || {},
        editColumnsMap: data.editColumns || {},
      });
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
    tr.children[3].appendChild(dealerInput);
    tr.children[4].appendChild(sel);
    tr.children[5].appendChild(approveBtn);

    pendingTable.appendChild(tr);
  });
}

// --------------------
// All users (Admin)
// --------------------
async function loadAllUsers() {
  usersTable.innerHTML = "";

  const headerRow = usersTable.closest("table")?.querySelector("thead tr");
  if (headerRow) {
    const ths = headerRow.querySelectorAll("th");
    ths.forEach((th) => {
      const t = String(th.textContent || "").trim().toLowerCase();
      if (t === "active") th.textContent = "Active (Account)";
      if (t === "actions") th.textContent = "Actions (Admin)";
    });
  }

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

    const dealerInput = document.createElement("input");
    dealerInput.type = "number";
    dealerInput.value = Number(data.dealerId || 1);

    const sel = roleSelect(data.role || "pending");

    const activeCheckbox = document.createElement("input");
    activeCheckbox.type = "checkbox";
    activeCheckbox.checked = data.active !== false;

    const supervisorCheckbox = document.createElement("input");
    supervisorCheckbox.type = "checkbox";
    supervisorCheckbox.checked = data.permissions?.canControlWashDay === true;

    const canEditTicketsCb = document.createElement("input");
    canEditTicketsCb.type = "checkbox";
    canEditTicketsCb.checked = data.permissions?.canEditTickets === true;

    const fixTagCb = document.createElement("input");
    fixTagCb.type = "checkbox";
    fixTagCb.checked = data.permissions?.corrections?.tag === true;

    const fixRoCb = document.createElement("input");
    fixRoCb.type = "checkbox";
    fixRoCb.checked = data.permissions?.corrections?.ro === true;

    const fixLocCb = document.createElement("input");
    fixLocCb.type = "checkbox";
    fixLocCb.checked = data.permissions?.corrections?.location === true;

    const fixAdvCb = document.createElement("input");
    fixAdvCb.type = "checkbox";
    fixAdvCb.checked = data.permissions?.corrections?.advisorNumber === true;

    function syncCorrectionsDisabled() {
      const on = canEditTicketsCb.checked;
      fixTagCb.disabled = !on;
      fixRoCb.disabled = !on;
      fixLocCb.disabled = !on;
      fixAdvCb.disabled = !on;
    }
    canEditTicketsCb.addEventListener("change", syncCorrectionsDisabled);
    syncCorrectionsDisabled();

    const columnsBtn = document.createElement("button");
    columnsBtn.textContent = "Columns";
    columnsBtn.style.marginRight = "8px";

    columnsBtn.onclick = async () => {
      const initialViewKey = String(sel.value || data.role || "advisor").toLowerCase();

      openColumnsModalForUser({
        uid,
        email: data.email || uid,
        initialViewKey,
        viewColumnsMap: data.viewColumns || {},
        editColumnsMap: data.editColumns || {},
      });
    };

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.disabled = true;
    saveBtn.style.opacity = "0.5";

    function enableSave() {
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
    }

    nameInput.addEventListener("input", enableSave);
    empInput.addEventListener("input", enableSave);
    dealerInput.addEventListener("input", enableSave);
    sel.addEventListener("change", enableSave);
    activeCheckbox.addEventListener("change", enableSave);
    supervisorCheckbox.addEventListener("change", enableSave);
    canEditTicketsCb.addEventListener("change", enableSave);
    fixTagCb.addEventListener("change", enableSave);
    fixRoCb.addEventListener("change", enableSave);
    fixLocCb.addEventListener("change", enableSave);
    fixAdvCb.addEventListener("change", enableSave);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.style.marginLeft = "8px";

    const isSelf = myUid && uid === myUid;
    if (isSelf) {
      deleteBtn.disabled = true;
      deleteBtn.title = "Admin cannot delete itself.";
    }

    saveBtn.onclick = async () => {
      const patch = {
        name: nameInput.value.trim(),
        employeeId: empInput.value.trim(),
        dealerId: Number(dealerInput.value || 1),
        role: sel.value,
        active: activeCheckbox.checked,
        updatedAt: serverTimestamp(),
      };

      patch["permissions.canControlWashDay"] = supervisorCheckbox.checked;
      patch["permissions.canEditTickets"] = canEditTicketsCb.checked;
      patch["permissions.corrections.tag"] = canEditTicketsCb.checked ? fixTagCb.checked : false;
      patch["permissions.corrections.ro"] = canEditTicketsCb.checked ? fixRoCb.checked : false;
      patch["permissions.corrections.location"] = canEditTicketsCb.checked ? fixLocCb.checked : false;
      patch["permissions.corrections.advisorNumber"] = canEditTicketsCb.checked ? fixAdvCb.checked : false;

      await updateDoc(doc(db, "users", uid), patch);

      const oldText = saveBtn.textContent;
      saveBtn.textContent = "Saved ✓";
      saveBtn.style.color = "#0a7a2a";
      saveBtn.style.fontWeight = "bold";
      saveBtn.disabled = true;
      saveBtn.style.opacity = "0.5";

      setTimeout(() => {
        saveBtn.textContent = oldText;
        saveBtn.style.color = "";
        saveBtn.style.fontWeight = "";
      }, 1200);
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
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    `;

    tr.children[1].appendChild(nameInput);
    tr.children[2].appendChild(empInput);
    tr.children[3].appendChild(dealerInput);
    tr.children[4].appendChild(sel);
    tr.children[5].appendChild(activeCheckbox);
    tr.children[6].appendChild(supervisorCheckbox);
    tr.children[7].appendChild(canEditTicketsCb);
    tr.children[8].appendChild(fixTagCb);
    tr.children[9].appendChild(fixRoCb);
    tr.children[10].appendChild(fixLocCb);
    tr.children[11].appendChild(fixAdvCb);
    tr.children[12].appendChild(columnsBtn);
    tr.children[12].appendChild(saveBtn);
    tr.children[12].appendChild(deleteBtn);

    usersTable.appendChild(tr);
  });
}

loadPending();
loadAllUsers();