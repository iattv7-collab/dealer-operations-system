// public/js/guard.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Canonical roles (must match your handoff)
export const VALID_ROLES = ["admin", "manager", "advisor", "wash", "staff", "pending"];

let cache = { uid: null, data: null };

async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap;

  const email = user.email ? String(user.email) : "";

  await setDoc(ref, {
    email,
    role: "pending",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return await getDoc(ref);
}

export async function getUserProfile(user) {
  if (!user) return null;
  if (cache.uid === user.uid && cache.data) return cache.data;

  const snap = await ensureUserProfile(user);
  const data = snap.data() || {};
  cache = { uid: user.uid, data };
  return data;
}

// requiredRoles example: ["manager","admin"]
export function requireRole(requiredRoles = []) {
  const statusEl = document.getElementById("status");

  onAuthStateChanged(auth, async (user) => {

    if (!user) {
      window.location.href = "/login.html";
      return;
    }

    try {
      const data = await getUserProfile(user);

      const role = String(data.role || "pending").toLowerCase();
      const active = data.active !== false;

      if (!VALID_ROLES.includes(role)) {
        if (statusEl) statusEl.textContent = "Invalid role. Please contact admin.";
        return;
      }

      if (!active) {
        window.location.href = "/index.html";
        return;
      }

      if (role === "pending") {
        // Send pending users to a safe page
        if (!window.location.pathname.endsWith("/index.html") &&
            !window.location.pathname.endsWith("/pending.html")) {
          window.location.href = "/pending.html";
          return;
        }
        if (statusEl) {
          statusEl.innerHTML =
            "<b>Waiting for approval.</b><br>Please contact your manager/admin.";
        }
        return;
      }

      if (requiredRoles.length && !requiredRoles.includes(role)) {
        window.location.href = "/index.html";
        return;
      }

      if (statusEl) statusEl.textContent = `Signed in as ${user.email || ""} (role: ${role})`;
    } catch (e) {
      console.error(e);
      if (statusEl) statusEl.textContent = "Error loading role. Check console.";
    }
  });
}
