// public/firebase.js

// Firebase core
import { initializeApp } from
"https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

// Firestore
import {
getFirestore
} from
"https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Auth
import {
getAuth
} from
"https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// Messaging
import {
getMessaging
} from
"https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";

// Your Firebase config
const firebaseConfig = {

apiKey: "AIzaSyBTkwUjsZ-B-z4MICwtzaWS9PCIj85Xx3I",

authDomain: "ro-tracker-app.firebaseapp.com",

projectId: "ro-tracker-app",

storageBucket: "ro-tracker-app.firebasestorage.app",

messagingSenderId: "767089230784",

appId: "1:767089230784:web:c32ff2ba3fa2340f863e25"

};


// Initialize Firebase
export const app = initializeApp(firebaseConfig);


// Initialize Firestore
export const db = getFirestore(app);


// Initialize Auth
export const auth = getAuth(app);

// Initialize Messaging (for push notifications)
export const messaging = getMessaging(app);