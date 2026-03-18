// public/ro/auth-gate.js
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const NEXT = "/ro/";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace(`/login.html?next=${encodeURIComponent(NEXT)}`);
    return;
  }
  import("./app.js?v=20260314-1");
});