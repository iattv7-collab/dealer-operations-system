import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form = document.getElementById("registerForm");
const msg = document.getElementById("msg");

function setMsg(text, isError = false) {
  msg.textContent = text;
  msg.style.color = isError ? "red" : "green";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // Create profile doc in Firestore (PENDING until admin approves)
    await setDoc(doc(db, "users", cred.user.uid), {
      email: email,
      role: "pending",
      createdAt: serverTimestamp()
    });

    setMsg("Account created. Waiting for admin approval...");
    // Send them to home (they will see the pending message on pages)
    window.location.href = "/index.html";

  } catch (err) {
    setMsg(err.message, true);
    console.error(err);
  }
});
