// public/ro/modules/notification-center.js
import { db } from "../firebase.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
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

      <div class="af-notif-meta">
        ${ro ? `<span class="af-notif-chip">RO: ${ro}</span>` : ""}
        ${unread ? `<span class="af-notif-chip unread-chip">Unread</span>` : `<span class="af-notif-chip">Read</span>`}
        ${dismissed ? `<span class="af-notif-chip">Dismissed</span>` : ""}
      </div>

      <div class="af-notif-actions">
        ${url
      ? `<button type="button" class="smallbtn af-open-btn" data-url="${url}">Open</button>`
      : ""
    }
        ${unread
      ? `<button type="button" class="smallbtn af-read-btn">Mark Read</button>`
      : ""
    }
        <button type="button" class="smallbtn af-dismiss-btn">
          ${dismissed ? "Undismiss" : "Dismiss"}
        </button>
        <button type="button" class="smallbtn af-delete-btn">Delete</button>
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

export function initNotificationCenter({
  userId,
  mountId,
  badgeId = "",
  showDismissed = true,
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
        <button type="button" class="smallbtn" id="${mountId}__markAll">Mark All Read</button>
      </div>
    </div>
    <div class="af-notif-list" id="${mountId}__list"></div>
  `;

  const countEl = $(`${mountId}__count`);
  const listEl = $(`${mountId}__list`);
  const badgeEl = badgeId ? $(badgeId) : null;
  const markAllBtn = $(`${mountId}__markAll`);

  let latestDocs = [];

  const q = query(notificationsCol(userId), orderBy("createdAt", "desc"));

  const unsub = onSnapshot(q, (snap) => {
    latestDocs = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    const visible = showDismissed
      ? latestDocs
      : latestDocs.filter((n) => !n.dismissed);

    const unreadCount = latestDocs.filter((n) => !n.read && !n.dismissed).length;

    countEl.textContent = unreadCount
      ? `Notifications (${unreadCount} unread)`
      : "Notifications";

    if (badgeEl) {
      badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      badgeEl.style.display = unreadCount ? "flex" : "none";
    }

    if (!visible.length) {
      listEl.innerHTML = `<div class="af-notif-empty">No notifications.</div>`;
      return;
    }

    listEl.innerHTML = visible.map(cardHtml).join("");

    listEl.querySelectorAll(".af-open-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        const url = btn.dataset.url || "/";
        await markNotificationRead(userId, id);
        window.location.href = url;
      });
    });

    listEl.querySelectorAll(".af-read-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        await markNotificationRead(userId, id);
      });
    });

    listEl.querySelectorAll(".af-dismiss-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        const current = latestDocs.find((n) => n.id === id);
        await toggleNotificationDismissed(userId, id, !current?.dismissed);
      });
    });

    listEl.querySelectorAll(".af-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".af-notif-card");
        const id = card?.dataset?.id || "";
        const ok = confirm("Delete this notification?");
        if (!ok) return;
        await deleteNotification(userId, id);
      });
    });
  });

  markAllBtn.addEventListener("click", async () => {
    await markAllNotificationsRead(userId, latestDocs);
  });

  return {
    unsubscribe: unsub,
  };
}