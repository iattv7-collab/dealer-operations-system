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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const pendingTable = document.getElementById("pendingTable");
const usersTable = document.getElementById("usersTable");

// Roles now (no tech)
const ROLES = ["admin", "manager", "advisor", "wash", "staff", "pending"];

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
        updatedAt: serverTimestamp()
      });

      await loadPending();
      await loadAllUsers();
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
        updatedAt: serverTimestamp()
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
    tr.children[5].appendChild(saveBtn);
    tr.children[5].appendChild(deleteBtn);

    usersTable.appendChild(tr);
  });
}

loadPending();
loadAllUsers();
