// public/js/ui/qcUsers.js
import { db } from "../firebase.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let __qcUsersCache = null;

export async function getQcUsers() {
  if (__qcUsersCache) return __qcUsersCache;

  const uq = query(collection(db, "users"), where("role", "==", "qc"));
  const snap = await getDocs(uq);

  const users = [];
  snap.forEach((d) => {
    const u = d.data() || {};
    users.push({
      uid: d.id,
      email: u.email || "",
      name: u.name || u.displayName || ""
    });
  });

  __qcUsersCache = users;
  return users;
}

export async function pickQcUserUid() {
  const users = await getQcUsers();
  if (!users.length) {
    alert("No QC users found.");
    return null;
  }

  const lines = users.map((u, i) => {
    const label = String((u.name || u.email || u.uid) || "").trim();
    return `${i + 1}) ${label}`;
  });

  const choice = prompt(
    `Assign QC to which user?\n\n${lines.join("\n")}\n\nType a number:`
  );

  const n = Number(choice);
  if (!Number.isFinite(n) || n < 1 || n > users.length) return null;

  return users[n - 1].uid;
}
