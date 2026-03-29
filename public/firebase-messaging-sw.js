/* public/firebase-messaging-sw.js */
/* Firebase Messaging service worker */

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");
} catch (e) {
  // stop cleanly
}

// Must match /public/firebase.js EXACTLY
try {
  if (self.firebase && self.firebase.initializeApp) {
    self.firebase.initializeApp({
      apiKey: "AIzaSyCUMHLuNf3AafN-BmzTMGX1HJhwk2RA-RE",
      authDomain: "dealer-wash-system.firebaseapp.com",
      projectId: "dealer-wash-system",
      storageBucket: "dealer-wash-system.appspot.app",
      messagingSenderId: "308118093197",
      appId: "1:308118093197:web:882c2687f394cb3cfd11c4"
    });
  }
} catch (e) {
  // stop cleanly
}

function pickUrl(data) {
  const u = (data && (data.url || data.link)) || "/";
  try {
    return new URL(u, self.location.origin).toString();
  } catch {
    return new URL("/", self.location.origin).toString();
  }
}

function normalizePayload(raw) {
  const payload = raw || {};
  const data = payload.data || {};
  const n = payload.notification || {};

  const title = n.title || data.title || "RO Tracker";
  const body = n.body || data.body || "Follow-up due";

  // Prefer payload.notification.icon if present, else default
  const icon = n.icon || "/icon-192.png";
  const badge = "/icon-192.png";

  const url = pickUrl({ ...data, url: data.url || data.link });

  return {
    title,
    options: {
      body,
      icon,
      badge,
      data: { ...data, url }
    }
  };
}

function showFromPayload(raw) {
  try {
    const { title, options } = normalizePayload(raw);
    return self.registration.showNotification(title, options);
  } catch (e) {
    // never crash SW
    return Promise.resolve();
  }
}

/* -------------------------------------------------------
   1) Firebase background handler (works for many cases)
-------------------------------------------------------- */
try {
  if (self.firebase && self.firebase.messaging) {
    const messaging = self.firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      // IMPORTANT: show notification even if payload.notification is missing (data-only messages)
      showFromPayload(payload);
    });
  }
} catch (e) {
  // swallow to prevent evaluation failure
}

/* -------------------------------------------------------
   2) HARD FALLBACK: listen to the native "push" event
   This fixes the common case where FCM reports success,
   but onBackgroundMessage never fires on Android/Chrome.
-------------------------------------------------------- */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    if (event.data) {
      try {
        payload = event.data.json();
      } catch {
        // sometimes it's text
        const txt = event.data.text();
        payload = txt ? JSON.parse(txt) : {};
      }
    }
  } catch {
    payload = {};
  }

  event.waitUntil(showFromPayload(payload));
});

/* -------------------------------------------------------
   Notification click → open/focus app
-------------------------------------------------------- */
self.addEventListener("notificationclick", (event) => {
  try {
    event.notification.close();
    const data = (event.notification && event.notification.data) || {};
    const url = pickUrl(data);

    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        // Prefer focusing an existing window from the same origin
        for (const c of clientList) {
          if (c && c.url && new URL(c.url).origin === self.location.origin && "focus" in c) {
            c.navigate(url);
            return c.focus();
          }
        }
        return clients.openWindow(url);
      })
    );
  } catch (e) {
    // ignore
  }
});