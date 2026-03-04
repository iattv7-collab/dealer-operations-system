// public/ro/modules/notifications.js
import { db } from "../firebase.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Firebase Messaging (must already be configured in your firebase.js)
import {
  getMessaging,
  getToken,
  deleteToken,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";

// This is where you store the token (same as Settings)
const PRIVATE_DOC = doc(db, "privateSettings", "me");

// IMPORTANT:
// Put your existing VAPID key here (the one you already use for getToken).
// If you already had it in the old notifications.js, copy it exactly.
const VAPID_KEY =
  "BOXVBmTiuAkn8NJJ5n9lXURIllGbl_kq5sQLzWVvEffKhvtUOlrw0fPFJEpwQp869QS8nraOCfRhgHP2FGZhL10"; // fallback if you set it globally

function $(id) {
  return document.getElementById(id);
}

/**
 * NOTE:
 * This file lives at /ro/modules/...
 * So the service worker file at /ro/firebase-messaging-sw.js must be registered with "../"
 */
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;

  // ✅ correct path from /ro/modules/ -> /ro/
  const reg = await navigator.serviceWorker.register("../firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

async function loadRemoteToken() {
  try {
    const snap = await getDoc(PRIVATE_DOC);
    if (!snap.exists()) return "";
    const d = snap.data() || {};
    return String(d.fcmToken || "");
  } catch {
    return "";
  }
}

async function saveRemoteToken(token) {
  await setDoc(
    PRIVATE_DOC,
    {
      fcmToken: token || "",
      fcmTokenUpdatedAtMs: Date.now(),
    },
    { merge: true }
  );
}

function labelForState(state) {
  // state: "unsupported" | "blocked" | "prompt" | "off" | "on"
  if (state === "unsupported") return "Notifications: N/A";
  if (state === "blocked") return "Notifications: BLOCKED";
  if (state === "prompt") return "Notifications: OFF";
  if (state === "on") return "Notifications: ON";
  return "Notifications: OFF";
}

function computeState(permission, hasToken) {
  if (!("Notification" in window)) return "unsupported";
  if (permission === "denied") return "blocked";
  if (permission === "default") return "prompt";
  // granted:
  return hasToken ? "on" : "off";
}

async function unsubscribePushManager(reg) {
  try {
    if (!reg?.pushManager) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {
    // ignore
  }
}

async function disableThisDevice() {
  // This keeps browser permission "granted", but stops OUR app from sending
  const messaging = getMessaging();
  const reg = await ensureServiceWorker();

  try {
    await deleteToken(messaging);
  } catch {
    /* ignore */
  }
  await unsubscribePushManager(reg);
  await saveRemoteToken("");
}

async function enableThisDevice() {
  if (!("Notification" in window)) {
    alert("Notifications are not supported on this device/browser.");
    return false;
  }
  if (!VAPID_KEY) {
    alert("Missing VAPID key (notifications not configured).");
    return false;
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    if (perm === "denied") {
      alert("Notifications are blocked in the browser settings for this site.");
    }
    return false;
  }

  const reg = await ensureServiceWorker();
  const messaging = getMessaging();

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: reg,
  });

  if (!token) {
    alert("Could not get notification token.");
    return false;
  }

  await saveRemoteToken(token);
  return true;
}

/* ===========================
   BUTTON COLOR INDICATOR
=========================== */

function applyButtonStyle(btn, state) {
  if (!btn) return;

  // consistent feel
  btn.style.fontFamily = '"Times New Roman", Times, serif';
  btn.style.borderWidth = "1px";
  btn.style.borderStyle = "solid";

  // defaults
  btn.style.color = "#000";
  btn.style.opacity = "1";

  if (state === "on") {
    // green
    btn.style.background = "#d1ffd1";
    btn.style.borderColor = "#2e7d32";
    btn.style.color = "#000";
    return;
  }

  if (state === "blocked") {
    // dark red
    btn.style.background = "#ffd6d6";
    btn.style.borderColor = "#b71c1c";
    btn.style.color = "#000";
    return;
  }

  if (state === "unsupported") {
    // gray
    btn.style.background = "#eeeeee";
    btn.style.borderColor = "#999999";
    btn.style.color = "#333";
    btn.style.opacity = "0.7";
    return;
  }

  // prompt/off => red so it's obvious you're not enabled
  btn.style.background = "#ffd6d6";
  btn.style.borderColor = "#b71c1c";
  btn.style.color = "#000";
}

export function initNotifications() {
  /**
   * ✅ TEMP SAFETY:
   * Embedded RO module is now running under Dealer Wash Firebase project.
   * Until we configure FCM (VAPID key + sender) for that project, disable notifications
   * to avoid the OAuth/messaging subscribe error popup.
   *
   * Later: remove this block once Dealer Wash FCM is configured.
   */
  return {
    bindStatusToButton(buttonId) {
      const btn = document.getElementById(buttonId);
      if (!btn) return;
      btn.textContent = "Notifications: OFF";
      btn.disabled = true;
      btn.style.opacity = "0.7";
    },
  };

  // ---- (kept below for later re-enable) ----
  // let cachedToken = "";

  // async function refreshTokenCache() {
  //   cachedToken = await loadRemoteToken();
  //   return cachedToken;
  // }

  // async function refreshButton(btn) {
  //   const perm = ("Notification" in window) ? Notification.permission : "unsupported";
  //   const hasToken = !!(cachedToken && cachedToken.length > 10);
  //   const state = computeState(perm, hasToken);

  //   btn.textContent = labelForState(state);

  //   // Make it obvious it’s clickable / usable
  //   btn.disabled = (state === "unsupported");
  //   btn.dataset.notifState = state;

  //   // NEW: color indicator on the tab/button
  //   applyButtonStyle(btn, state);
  // }

  // async function bindStatusToButton(buttonId) {
  //   const btn = $(buttonId);
  //   if (!btn) return;

  //   if (btn.__rtBound) return;
  //   btn.__rtBound = true;

  //   await refreshTokenCache();
  //   await refreshButton(btn);

  //   btn.addEventListener("click", async () => {
  //     await refreshTokenCache();
  //     await refreshButton(btn);

  //     const state = btn.dataset.notifState || "off";

  //     if (state === "blocked") {
  //       alert("Notifications are blocked for this site. Enable them in your browser settings.");
  //       return;
  //     }

  //     if (state === "prompt" || state === "off") {
  //       try {
  //         const ok = await enableThisDevice();
  //         await refreshTokenCache();
  //         await refreshButton(btn);
  //         if (ok) alert("Notifications enabled ✅");
  //       } catch (e) {
  //         alert(String(e?.message || e));
  //       }
  //       return;
  //     }

  //     if (state === "on") {
  //       const sure = confirm(
  //         "Turn OFF notifications for this device?\n\n" +
  //         "This stops pushes from this app (browser permission stays ON)."
  //       );
  //       if (!sure) return;

  //       try {
  //         await disableThisDevice();
  //         await refreshTokenCache();
  //         await refreshButton(btn);
  //         alert("Notifications disabled for this device ✅");
  //       } catch (e) {
  //         alert(String(e?.message || e));
  //       }
  //       return;
  //     }
  //   });
  // }

  // // return API
  // return {
  //   bindStatusToButton
  // };
}