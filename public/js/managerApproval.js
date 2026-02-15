// public/js/managerApproval.js
import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const pendingTable = document.getElementById("pendingTable");
const usersTable = document.getElementById("usersTable");

// Managers can assign everyone EXCEPT admin
const MANAGER_ASSIGNABLE_ROLES = ["manager", "advisor", "wash", "staff"];
const ALL_DISPLAY_ROLES = ["admin", ...MANAGER_ASSIGNABLE_ROLES, "pending"];

function makeRoleSelect(currentRole, allowedRoles) {
  const sel = document.createElement("select");
  allowedRoles.forEach(r => {
    const o = document.createElement("option");
    o.value = r;
    o.textContent = r;
    if (currentRole === r) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

async function loadPending() {
  pendingTable.innerHTML = "";

  const q = query(collection(db, "users"), where("role", "==", "pending"));
  const snap = await getDocs(q);

  snap.forEach(docSnap => {
    const data = docSnap.data();
    const tr = document.createElement("tr");

    const roleSelect = makeRoleSelect("advisor", MANAGER_ASSIGNABLE_ROLES);

    const approveBtn = document.createElement("button");
    approveBtn.textContent = "Approve";

    approveBtn.onclick = async () => {
      await updateDoc(doc(db, "users", docSnap.id), {
        role: roleSelect.value,
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
    `;

    tr.children[1].appendChild(roleSelect);
    tr.children[2].appendChild(approveBtn);

    pendingTable.appendChild(tr);
  });
}

async function loadAllUsers() {
  usersTable.innerHTML = "";

  const snap = await getDocs(collection(db, "users"));

  snap.forEach(docSnap => {
    const data = docSnap.data();
    const email = data.email || "";
    const role = data.role || "pending";
    const active = data.active !== false;

    const tr = document.createElement("tr");

    // If the user is already admin, manager cannot change them.
    const isAdmin = role === "admin";

    const roleSelect = isAdmin
      ? makeRoleSelect("admin", ["admin"])
      : makeRoleSelect(role, [...MANAGER_ASSIGNABLE_ROLES, "pending"]);

    roleSelect.disabled = isAdmin;

    const activeCheckbox = document.createElement("input");
    activeCheckbox.type = "checkbox";
    activeCheckbox.checked = active;

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.disabled = isAdmin;

    saveBtn.onclick = async () => {
      await updateDoc(doc(db, "users", docSnap.id), {
        role: roleSelect.value,
        active: activeCheckbox.checked,
        updatedAt: serverTimestamp()
      });
    };

    tr.innerHTML = `
      <td>${email}</td>
      <td></td>
      <td></td>
      <td></td>
    `;

    tr.children[1].appendChild(roleSelect);
    tr.children[2].appendChild(activeCheckbox);
    tr.children[3].appendChild(saveBtn);

    usersTable.appendChild(tr);
  });
}

loadPending();
loadAllUsers();
