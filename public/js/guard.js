// public/js/guard.js

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const VALID_ROLES = [
  "admin",
  "manager",
  "advisor",
  "wash",
  "staff",
  "valet",
  "dropoff",
  "booker",
  "qc",
  "foreman",
  "tech",
  "pending"
];

let cache = {
  uid: null,
  data: null
};

async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap;

  const email = user.email ? String(user.email) : "";

  await setDoc(ref, {
    email,
    role: "pending",
    active: true,
    dealerId: 1,
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

  cache = {
    uid: user.uid,
    data
  };

  return data;
}

export async function getUserDealerId(user) {
  const data = await getUserProfile(user);
  return Number(data?.dealerId || 0);
}

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
        if (statusEl)
          statusEl.textContent = "Invalid role. Please contact admin.";
        return;
      }

      if (!active) {
        window.location.href = "/index.html";
        return;
      }

      if (role === "pending") {
        if (
          !window.location.pathname.endsWith("/index.html") &&
          !window.location.pathname.endsWith("/pending.html")
        ) {
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

      if (statusEl)
        statusEl.textContent =
          `Signed in as ${user.email || ""} (role: ${role}, dealerId: ${data.dealerId || 0})`;

    } catch (e) {
      console.error(e);
      if (statusEl)
        statusEl.textContent = "Error loading role. Check console.";
    }
  });
}