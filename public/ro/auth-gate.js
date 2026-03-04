// public/ro/auth-gate.js
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const NEXT = "/ro/";

// If your wash system login page is at /login.html (root), keep this:
const LOGIN_URL = `/login.html?next=${encodeURIComponent(NEXT)}`;

// Optional: if your login page is different, change it here.

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Not signed in -> go to Dealer Wash login
    window.location.replace(LOGIN_URL);
    return;
  }

  // Signed in -> load the RO Tracker app
  import("./app.js");
});