import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCUMHLuNf3AafN-BmzTMGX1HJhwk2RA-RE",
  authDomain: "dealer-wash-system.firebaseapp.com",
  projectId: "dealer-wash-system",
  storageBucket: "dealer-wash-system.appspot.app",
  messagingSenderId: "308118093197",
  appId: "1:308118093197:web:882c2687f394cb3cfd11c4"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
