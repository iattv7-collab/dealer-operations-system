// public/ro/modules/notification-center.js
import { COL_ARCHIVE } from "./firestore.js";
import { db } from "../firebase.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function $(id) {
  return document.getElementById(id);
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function notificationsCol(userId) {
  return collection(db, "users", userId, "notifications");
}

function fmtWhen(ts) {
  try {
    const d =
      typeof ts?.toDate === "function"
        ? ts.toDate()
        : ts instanceof Date
          ? ts
          : null;

    if (!d) return "";

    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function cardHtml(n) {
  const title = esc(n.title || "Notification");
  const body = esc(n.body || "");
  const type = esc(n.type || "");
  const url = esc(n.url || "");
  const ro = esc(n.roId || "");
  const when = fmtWhen(n.createdAt);
  const unread = !n.read;
  const dismissed = !!n.dismissed;

  return `
    <div class="af-notif-card ${unread ? "is-unread" : ""} ${dismissed ? "is-dismissed" : ""}" data-id="${esc(n.id)}">
      <div class="af-notif-top">
        <div class="af-notif-title-wrap">
          <div class="af-notif-title">${title}</div>
          ${type ? `<div class="af-notif-type">${type}</div>` : ""}
        </div>
        <div class="af-notif-time">${esc(when)}</div>
      </div>

      ${body ? `<div class="af-notif-body">${body}</div>` : ""}

      <div class="af-notif-actions">

  ${n.type === "valetRequest" && n.url
      ? `<button type="button" class="smallbtn af-open-request-btn">Open Request</button>`
      : ""}

  ${n.type === "followup"
      ? `
    <button type="button" class="smallbtn af-text-btn">Text</button>
    <button type="button" class="smallbtn af-no-followup-btn">No Follow Up Needed</button>
  `
      : `
    <button type="button" class="smallbtn af-clear-btn">Clear</button>
  `
    }

</div>
    </div>
  `;
}

function ensureStyles() {
  if (document.getElementById("af-notification-center-styles")) return;

  const style = document.createElement("style");
  style.id = "af-notification-center-styles";
  style.textContent = `
    .af-notif-wrap {
      font-family: "Times New Roman", Times, serif;
    }
    .af-notif-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .af-notif-left,
    .af-notif-right {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .af-notif-count {
      font-weight: bold;
    }
    .af-notif-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .af-notif-card {
      border: 1px solid #bdbdbd;
      border-radius: 6px;
      padding: 12px;
      background: #fff;
    }
    .af-notif-card.is-unread {
      border-color: #2e7d32;
      background: #f6fff6;
    }
    .af-notif-card.is-dismissed {
      opacity: 0.75;
    }
    .af-notif-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .af-notif-title {
      font-weight: bold;
      font-size: 16px;
    }
    .af-notif-type {
      font-size: 12px;
      color: #555;
      margin-top: 2px;
    }
    .af-notif-time {
      font-size: 12px;
      color: #555;
      white-space: nowrap;
    }
    .af-notif-body {
      margin-bottom: 8px;
      white-space: pre-wrap;
    }
    .af-notif-meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .af-notif-chip {
      border: 1px solid #ccc;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      background: #fafafa;
    }
    .unread-chip {
      border-color: #2e7d32;
      background: #e9f8e9;
    }
    .af-notif-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .af-notif-empty {
      border: 1px dashed #bdbdbd;
      border-radius: 6px;
      padding: 16px;
      color: #555;
      background: #fafafa;
    }
  `;
  document.head.appendChild(style);
}

export async function createUserNotification({
  userId,
  title,
  body = "",
  url = "",
  type = "",
  roId = "",
  dismissed = false,
}) {
  if (!userId) throw new Error("Missing userId");
  if (!title) throw new Error("Missing title");

  await addDoc(notificationsCol(userId), {
    title,
    body,
    url,
    type,
    roId,
    read: false,
    dismissed,
    createdAt: serverTimestamp(),
  });
}

export async function markNotificationRead(userId, notificationId) {
  if (!userId || !notificationId) return;
  await updateDoc(doc(db, "users", userId, "notifications", notificationId), {
    read: true,
  });
}

export async function toggleNotificationDismissed(userId, notificationId, nextValue) {
  if (!userId || !notificationId) return;
  await updateDoc(doc(db, "users", userId, "notifications", notificationId), {
    dismissed: !!nextValue,
    read: true,
  });
}

export async function deleteNotification(userId, notificationId) {
  if (!userId || !notificationId) return;
  await deleteDoc(doc(db, "users", userId, "notifications", notificationId));
}

export async function markAllNotificationsRead(userId, docs) {
  if (!userId || !Array.isArray(docs) || !docs.length) return;

  const batch = writeBatch(db);
  docs.forEach((n) => {
    if (!n.read) {
      batch.update(doc(db, "users", userId, "notifications", n.id), {
        read: true,
      });
    }
  });
  await batch.commit();
}

function showNotificationBanner(n) {
  // REMOVE existing banner if any
  const existing = document.getElementById("af-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "af-banner";

  banner.innerHTML = `
    <div class="af-banner-inner">
      <div class="af-banner-text">
        <div class="af-banner-title">${esc(n.title || "Notification")}</div>
        <div class="af-banner-body">${esc(n.body || "")}</div>
      </div>
      <button class="af-banner-btn">Open</button>
    </div>
  `;

  document.body.appendChild(banner);

  // OPEN REQUEST BUTTON
  banner.querySelector(".af-banner-btn").onclick = () => {
    if (n.url) {
      window.location.href = n.url;
    }
  };

  // AUTO HIDE
  setTimeout(() => {
    banner.remove();
  }, 5000);

  // 🔊 SOUND
  try {
    const audio = new Audio("/sounds/notify.mp3");
    audio.play().catch(() => { });
  } catch { }

  // 📳 VIBRATION (mobile only)
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
}

export function initNotificationBadge({
  userId,
  badgeId,
  includeDismissed = false,
  filterType = "",
}) {
  if (!userId) throw new Error("initNotificationBadge requires userId");
  if (!badgeId) throw new Error("initNotificationBadge requires badgeId");

  const badgeEl = $(badgeId);
  if (!badgeEl) throw new Error(`Notification badge #${badgeId} not found`);

  const q = query(notificationsCol(userId), orderBy("createdAt", "desc"));

  const unsub = onSnapshot(q, (snap) => {
    let docs = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    if (!includeDismissed) {
      docs = docs.filter((n) => !n.dismissed);
    }

    if (filterType) {
      docs = docs.filter((n) => n.type === filterType);
    }

    const unreadCount = docs.filter((n) => !n.read && !n.dismissed).length;

    badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badgeEl.style.display = unreadCount ? "flex" : "none";
  });

  return {
    unsubscribe: unsub,
  };
}

export function initNotificationCenter({
  userId,
  mountId,
  badgeId = "",
  showDismissed = true,
  filterType = "",
}) {
  if (!userId) throw new Error("initNotificationCenter requires userId");

  const mount = $(mountId);
  if (!mount) throw new Error(`Notification center mount #${mountId} not found`);

  ensureStyles();
  mount.classList.add("af-notif-wrap");
  mount.innerHTML = `
    <div class="af-notif-toolbar">
      <div class="af-notif-left">
        <span class="af-notif-count" id="${mountId}__count">Notifications</span>
      </div>
      <div class="af-notif-right">
        
      </div>
    </div>
    <div class="af-notif-list" id="${mountId}__list"></div>
  `;

  const countEl = $(`${mountId}__count`);
  const listEl = $(`${mountId}__list`);
  const badgeEl = badgeId ? $(badgeId) : null;

  let latestDocs = [];
  let firstLoad = true;

  const q = query(notificationsCol(userId), orderBy("createdAt", "desc"));

  const unsub = onSnapshot(q, (snap) => {
    const newDocs = snap.docChanges()
      .filter(c => c.type === "added")
      .map(c => ({ id: c.doc.id, ...c.doc.data() }));

    if (!firstLoad && newDocs.length) {
      newDocs.forEach((n) => {
        if (!n.dismissed && n.type === "valetRequest") {
          showNotificationBanner(n);
        }
      });
    }

    firstLoad = false;

    latestDocs = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    let visible = showDismissed
      ? latestDocs
      : latestDocs.filter((n) => !n.dismissed);

    if (filterType) {
      visible = visible.filter((n) => n.type === filterType);
    }

    const countSource = filterType
      ? latestDocs.filter((n) => n.type === filterType)
      : latestDocs;

    const unreadCount = countSource.filter((n) => !n.read && !n.dismissed).length;

    countEl.textContent = unreadCount
      ? `Notifications (${unreadCount} unread)`
      : "Notifications";

    if (badgeEl) {
      badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      badgeEl.style.display = unreadCount ? "flex" : "none";
    }

    if (!visible.length) {
      mount.style.display = "none";
      return;
    }

    mount.style.display = "";

    listEl.innerHTML = visible.map(cardHtml).join("");

    listEl.querySelectorAll(".af-text-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        const notif = latestDocs.find((n) => n.id === id);
        if (!notif) return;

        const ro = notif.roId || "";
        if (!ro) return;

        await deleteNotification(userId, id);
        window.location.href = `/ro/index.html?fu=1&ro=${encodeURIComponent(ro)}&slot=1`;
      });
    });

    listEl.querySelectorAll(".af-open-request-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        const notif = latestDocs.find((n) => n.id === id);
        if (!notif) return;

        const url = notif.url || "";
        if (!url) return;

        await markNotificationRead(userId, id);

        const targetUrl = new URL(url, window.location.origin);
        const requestId = targetUrl.searchParams.get("requestId");

        if (window.location.pathname.includes("requests.html") && requestId) {
          const row = document.querySelector(`tr[data-id="${CSS.escape(requestId)}"]`);

          if (row) {
            row.scrollIntoView({ block: "center", behavior: "smooth" });
            row.style.outline = "3px solid #0b3d91";
            return;
          }
        }

        window.location.href = url;
      });
    });

    listEl.querySelectorAll(".af-clear-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        if (!id) return;

        await deleteNotification(userId, id);
      });
    });

    listEl.querySelectorAll(".af-no-followup-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        const notif = latestDocs.find((n) => n.id === id);
        if (!notif) return;

        const ro = notif.roId || "";
        if (!ro) return;

        try {
          const ref = doc(db, COL_ARCHIVE, ro);

          const snap = await getDoc(ref);

          if (snap.exists()) {
            await updateDoc(ref, {
              followupStatus: "done",
              followupCompletedAtMs: Date.now()
            });
          }

          // always remove notification
          await deleteNotification(userId, id);
        } catch (e) {
          alert(String(e?.message || e));
        }
      });
    });
  });

  return {
    unsubscribe: unsub,
  };
}