// public/ro/modules/notifications.js
import { db, auth } from "../firebase.js";
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Firebase Messaging (must already be configured in your firebase.js)
import {
  getMessaging,
  getToken,
  deleteToken,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";

// This is where you store the token (same as Settings)


// IMPORTANT:
// Put your existing VAPID key here (the one you already use for getToken).
const VAPID_KEY =
  "BORkyk8u9Q70zCHPpXGoichwqKXzdOnhoJydC809r5rK2JH0BXJUKx7BeLWwnikaO0hxQ-kX14-NgwasO8bfpRk";

function $(id) {
  return document.getElementById(id);
}

function getDeviceType() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "desktop";
}

function currentDeviceDoc() {
  const user = auth.currentUser;
  if (!user) throw new Error("No signed-in user.");
  return doc(db, "users", user.uid, "notificationDevices", getDeviceType());
}

/**
 * NOTE:
 * This file lives at /ro/modules/...
 * So the service worker file at /ro/firebase-messaging-sw.js must be registered with "../"
 */
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;

  const reg = await navigator.serviceWorker.register("../firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

async function loadRemoteToken() {
  try {
    const user = auth.currentUser;
    if (!user) return [];

    const snap = await getDocs(
      collection(db, "users", user.uid, "notificationDevices")
    );

    const tokens = [];

    snap.forEach((d) => {
      const token = String(d.data()?.token || "").trim();
      if (token) tokens.push(token);
    });

    return tokens;
  } catch {
    return [];
  }
}

async function tokenDocId(token) {
  const data = new TextEncoder().encode(String(token || ""));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function saveRemoteToken(token) {
  if (!token) return;

  const user = auth.currentUser;
  if (!user) throw new Error("No signed-in user.");

  const deviceType = getDeviceType();
  const tokenId = await tokenDocId(token);

  const tokenRef = doc(db, "notificationTokens", tokenId);
  const oldSnap = await getDoc(tokenRef);
  const oldUid = oldSnap.exists() ? String(oldSnap.data()?.uid || "") : "";

  // If this device belonged to another user → remove it
  if (oldUid && oldUid !== user.uid) {
    await deleteDoc(doc(db, "users", oldUid, "notificationDevices", tokenId));
  }

  // Global ownership record
  await setDoc(tokenRef, {
    uid: user.uid,
    token,
    deviceType,
    updatedAtMs: Date.now()
  }, { merge: true });

  // Save under current user
  await setDoc(doc(db, "users", user.uid, "notificationDevices", tokenId), {
    token,
    deviceType,
    updatedAtMs: Date.now()
  }, { merge: true });
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
  // Keeps browser permission "granted", but stops OUR app from sending
  const messaging = getMessaging();
  const reg = await ensureServiceWorker();

  let currentToken = "";
  try {
    currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
  } catch {
    // ignore
  }

  try {
    await deleteToken(messaging);
  } catch {
    // ignore
  }

  await unsubscribePushManager(reg);

  try {
    console.log("DISABLE → currentToken:", currentToken);
    await deleteDoc(currentDeviceDoc());
  } catch {
    // ignore
  }
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

  btn.style.fontFamily = '"Times New Roman", Times, serif';
  btn.style.borderWidth = "1px";
  btn.style.borderStyle = "solid";
  btn.style.color = "#000";
  btn.style.opacity = "1";

  if (state === "on") {
    btn.style.background = "#d1ffd1";
    btn.style.borderColor = "#2e7d32";
    btn.style.color = "#000";
    return;
  }

  if (state === "blocked") {
    btn.style.background = "#ffd6d6";
    btn.style.borderColor = "#b71c1c";
    btn.style.color = "#000";
    return;
  }

  if (state === "unsupported") {
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
  let cachedTokens = [];
  let currentDeviceToken = "";

  async function refreshTokenCache() {
    cachedTokens = await loadRemoteToken();

    try {
      const reg = await ensureServiceWorker();
      const messaging = getMessaging();

      currentDeviceToken = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: reg,
      });
    } catch {
      currentDeviceToken = "";
    }

    console.log("REFRESH → currentDeviceToken:", currentDeviceToken);
    console.log("REFRESH → cachedTokens:", cachedTokens);

    return cachedTokens;
  }

  async function refreshButton(btn) {
    const perm = ("Notification" in window) ? Notification.permission : "unsupported";
    const thisDeviceEnabled = currentDeviceToken && cachedTokens.includes(currentDeviceToken);
    const state = computeState(perm, thisDeviceEnabled);

    btn.textContent = labelForState(state);
    btn.disabled = (state === "unsupported");
    btn.dataset.notifState = state;

    applyButtonStyle(btn, state);
  }

  async function bindStatusToButton(buttonId) {
    const btn = $(buttonId);
    if (!btn) return;

    if (btn.__rtBound) return;
    btn.__rtBound = true;

    await refreshTokenCache();
    await refreshButton(btn);

    btn.addEventListener("click", async () => {
      await refreshTokenCache();
      await refreshButton(btn);

      const state = btn.dataset.notifState || "off";

      // STEP 1: Confirm entering settings
      const proceed = confirm("You are about to change notification settings.\n\nContinue?");
      if (!proceed) return;

      // STEP 2: Build modal
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,.35)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.zIndex = "9999";

      const box = document.createElement("div");
      box.style.background = "#fff";
      box.style.padding = "18px";
      box.style.borderRadius = "6px";
      box.style.width = "320px";
      box.style.fontFamily = "Times New Roman";

      const title = document.createElement("div");
      title.textContent = "Notification Settings";
      title.style.fontWeight = "bold";
      title.style.marginBottom = "12px";

      const onLabel = document.createElement("label");
      const onRadio = document.createElement("input");
      onRadio.type = "radio";
      onRadio.name = "notifOption";
      onRadio.value = "on";

      const offLabel = document.createElement("label");
      const offRadio = document.createElement("input");
      offRadio.type = "radio";
      offRadio.name = "notifOption";
      offRadio.value = "off";

      // Preselect current state
      if (state === "on") onRadio.checked = true;
      else offRadio.checked = true;

      onLabel.appendChild(onRadio);
      onLabel.append(" Turn Notifications ON");

      offLabel.appendChild(offRadio);
      offLabel.append(" Turn Notifications OFF");

      onLabel.style.display = "block";
      offLabel.style.display = "block";
      onLabel.style.marginBottom = "6px";

      const msg = document.createElement("div");
      msg.style.marginTop = "10px";
      msg.style.fontSize = "13px";
      msg.style.color = "#b00020";

      const btnRow = document.createElement("div");
      btnRow.style.marginTop = "14px";
      btnRow.style.textAlign = "right";

      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.className = "smallbtn";
      cancel.style.marginRight = "8px";

      const save = document.createElement("button");
      save.textContent = "Save";
      save.className = "smallbtn";

      cancel.onclick = () => document.body.removeChild(overlay);

      save.onclick = async () => {
        const selected = onRadio.checked ? "on" : "off";

        try {
          if (selected === "on") {
            if (state === "blocked") {
              msg.textContent = "Notifications are blocked in your browser. Please enable them in browser settings.";
              return;
            }

            const ok = await enableThisDevice();
            if (!ok) return;

          } else {
            await disableThisDevice();
          }

          await refreshTokenCache();
          await refreshButton(btn);

          document.body.removeChild(overlay);

        } catch (e) {
          msg.textContent = String(e?.message || e);
        }
      };

      btnRow.appendChild(cancel);
      btnRow.appendChild(save);

      box.appendChild(title);
      box.appendChild(onLabel);
      box.appendChild(offLabel);
      box.appendChild(msg);
      box.appendChild(btnRow);

      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  return {
    bindStatusToButton,
  };
}