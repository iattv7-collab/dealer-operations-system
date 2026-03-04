// public/ro/firebase.js
// Use the SAME Firebase instance as Dealer Wash System

export { app, auth, db } from "../js/firebase.js";

// Messaging still needs to be created locally
import { getMessaging } from
"https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";

import { app } from "../js/firebase.js";

export const messaging = getMessaging(app);