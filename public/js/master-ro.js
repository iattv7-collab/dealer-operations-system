import { renderNav } from "/js/nav.js";
import { requireRole, getUserDealerId } from "/js/guard.js";
import { db, auth } from "/js/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

document.getElementById("nav").innerHTML = renderNav("masterro");

requireRole(["admin", "manager", "advisor", "booker", "wash", "valet", "qc"]);

const tbody = document.getElementById("ro-body");

function clean(v) {
  return String(v || "").trim();
}

function escapeHtml(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function tagExistsElsewhere(tag, currentDocId) {
  const q = query(collection(db, "ros"), where("tag", "==", tag));
  const snap = await getDocsSafe(q);
  return snap.some((d) => d.id !== currentDocId);
}

async function getDocsSafe(qy) {
  return new Promise((resolve, reject) => {
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
      .then(({ getDocs }) => getDocs(qy))
      .then((snap) => {
        const out = [];
        snap.forEach((d) => out.push(d));
        resolve(out);
      })
      .catch(reject);
  });
}

function renderReadRow(docSnap) {
  const r = docSnap.data();
  const tr = document.createElement("tr");
  tr.dataset.id = docSnap.id;

  tr.innerHTML = `
    <td>${escapeHtml(r.ro || docSnap.id)}</td>
    <td>${escapeHtml(r.customerName || "")}</td>
    <td>${escapeHtml(r.phone || "")}</td>
    <td>${escapeHtml(r.tag || "")}</td>
    <td>${escapeHtml(r.model || "")}</td>
    <td>${escapeHtml(r.concern || "")}</td>
    <td>
      <button type="button" class="btn-edit">Edit</button>
    </td>
  `;

  tr.querySelector(".btn-edit").addEventListener("click", () => {
    renderEditRow(tr, docSnap);
  });

  return tr;
}

function renderEditRow(tr, docSnap) {
  const r = docSnap.data();

  tr.innerHTML = `
    <td><input type="text" class="edit-ro" value="${escapeHtml(r.ro || docSnap.id)}"></td>
    <td><input type="text" class="edit-customer" value="${escapeHtml(r.customerName || "")}"></td>
    <td><input type="text" class="edit-phone" value="${escapeHtml(r.phone || "")}"></td>
    <td><input type="text" class="edit-tag" value="${escapeHtml(r.tag || "")}"></td>
    <td><input type="text" class="edit-model" value="${escapeHtml(r.model || "")}"></td>
    <td><textarea class="edit-concern" rows="3" style="width:100%; box-sizing:border-box;">${escapeHtml(r.concern || "")}</textarea></td>
    <td>
      <button type="button" class="btn-save">Save</button>
      <button type="button" class="btn-cancel">Cancel</button>
    </td>
  `;

  const saveBtn = tr.querySelector(".btn-save");
  const cancelBtn = tr.querySelector(".btn-cancel");

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const newRo = clean(tr.querySelector(".edit-ro")?.value);
      const customerName = clean(tr.querySelector(".edit-customer")?.value);
      const phone = clean(tr.querySelector(".edit-phone")?.value);
      const tag = clean(tr.querySelector(".edit-tag")?.value);
      const model = clean(tr.querySelector(".edit-model")?.value);
      const concern = clean(tr.querySelector(".edit-concern")?.value);

      if (!newRo) throw new Error("RO is required.");
      if (!/^\d+$/.test(newRo)) throw new Error("RO must be numeric.");
      if (!tag) throw new Error("Tag is required.");

      const currentId = docSnap.id;
      const currentData = docSnap.data();

      const tagConflict = await tagExistsElsewhere(tag, currentId);
      if (tagConflict) throw new Error(`Tag # ${tag} already exists.`);

      if (newRo === currentId) {
        await updateDoc(doc(db, "ros", currentId), {
          ro: newRo,
          customerName,
          phone,
          tag,
          model,
          concern,
          updatedAt: serverTimestamp()
        });
        return;
      }

      const newRef = doc(db, "ros", newRo);
      const newSnap = await getDoc(newRef);
      if (newSnap.exists()) {
        throw new Error(`RO # ${newRo} already exists.`);
      }

      const ok = window.confirm(
        `Change RO #?\n\nFROM: ${currentId}\nTO: ${newRo}\n\nThis will move/rename the ticket in Firestore.`
      );
      if (!ok) {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = "Save";
        return;
      }

      await setDoc(newRef, {
        ...currentData,
        ro: newRo,
        customerName,
        phone,
        tag,
        model,
        concern,
        updatedAt: serverTimestamp()
      });

      await deleteDoc(doc(db, "ros", currentId));
    } catch (err) {
      alert(err.message || String(err));
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  cancelBtn.addEventListener("click", () => {
    tr.replaceWith(renderReadRow(docSnap));
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const dealerId = await getUserDealerId(user);

  const q = query(
    collection(db, "ros"),
    where("dealerId", "==", dealerId)
  );

  onSnapshot(q, (snap) => {
    tbody.innerHTML = "";
    snap.forEach((docSnap) => {
      tbody.appendChild(renderReadRow(docSnap));
    });
  });
});