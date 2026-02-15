import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const VALID_ROLES = ["admin", "manager", "advisor", "wash", "staff", "pending"];

async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) return snap;

  // Create a pending profile for new users
  await setDoc(ref, {
    email: user.email || "",
    role: "pending",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return await getDoc(ref);
}

export function requireRole(requiredRoles) {
  const statusEl = document.getElementById("status");

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/login.html";
      return;
    }

    try {
      const snap = await ensureUserProfile(user);

      if (!snap.exists()) {
        if (statusEl) statusEl.textContent = "Account profile not found. Please contact admin.";
        return;
      }

      const data = snap.data() || {};
      const role = data.role || "pending";

      if (!VALID_ROLES.includes(role)) {
        if (statusEl) statusEl.textContent = "Invalid role. Please contact admin.";
        return;
      }

      if (role === "pending") {
        if (statusEl) {
          statusEl.innerHTML = `<b>Waiting for admin approval.</b><br>Please contact your manager.`;
        }
        return;
      }

      if (!requiredRoles.includes(role)) {
        if (statusEl) statusEl.textContent = "Not allowed to access this page.";
        return;
      }

      if (statusEl) statusEl.textContent = `Signed in as ${user.email} (role: ${role})`;
    } catch (e) {
      if (statusEl) statusEl.textContent = "Error loading role. Check console.";
      console.error(e);
    }
  });
}
