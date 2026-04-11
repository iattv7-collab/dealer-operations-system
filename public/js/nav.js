// public/js/nav.js
import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getUserProfile } from "./guard.js";

const NAV_ITEMS = [
  ["Home", "/index.html", "home", ["admin", "manager", "advisor", "wash", "staff", "valet", "booker", "qc"]],
  ["Scanner", "/ro/scan.html", "scanner", ["admin", "manager", "advisor"]],
  ["Location", "/location.html", "location", ["admin", "manager", "advisor", "valet", "wash", "staff", "booker", "qc"]],
  ["Advisor", "/advisor.html", "advisor", ["admin", "manager", "advisor"]],
  ["Valet", "/valet.html", "valet", ["admin", "manager", "valet"]],
  ["Wash", "/wash.html", "wash", ["admin", "manager", "wash"]],
  ["Manager", "/manager.html", "manager", ["admin", "manager"]],
  ["Admin", "/admin.html", "admin", ["admin"]],
  ["Dropoff", "/dropoff.html", "dropoff", ["admin", "manager", "advisor", "wash", "staff", "valet", "qc"]],
  ["Settings", "/settings.html", "settings", ["admin", "manager"]],
  ["Booker", "/booker.html", "booker", ["admin", "manager", "booker"]],
  ["QC", "/qc.html", "qc", ["admin", "manager", "qc"]],

  ["Master RO", "/master-ro.html", "masterro", ["admin", "manager", "advisor", "booker", "wash", "valet", "qc"]],

  ["Archive", "/archive.html", "archive", ["admin", "manager","advisor", "booker"]],

  ["RO Tracker", "/ro/index.html", "rotracker", ["admin", "manager", "advisor"]],
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}

export function renderNav(active = "") {
  const shell = `
    <style>
      .topnav { margin: 6px 0 10px 0; }
      .topnav a {
        display:inline-block;
        padding: 6px 10px;
        margin-right: 6px;
        border: 1px solid #bbb;
        border-radius: 6px;
        text-decoration: none;
        color: #00f;
        background: #fff;
      }
      .topnav a.active {
        color: #000;
        background: #ffeaa7;
        border-color: #888;
        font-weight: bold;
      }
    </style>

    <h1>Dealer Wash System</h1>
    <div id="nav-links" class="topnav">Loading...</div>
    <p id="nav-user"></p>
    <hr />
  `;

  onAuthStateChanged(auth, async (user) => {
    const linksEl = document.getElementById("nav-links");
    const userEl = document.getElementById("nav-user");
    if (!linksEl || !userEl) return;

    if (!user) {
      linksEl.innerHTML = `<a href="/login.html">Login</a>`;
      userEl.textContent = "";
      return;
    }

    let role = "pending";
    try {
      const profile = await getUserProfile(user);
      role = String(profile?.role || "pending").toLowerCase();
    } catch (e) {
      console.error("Failed to load user profile for nav:", e);
      role = "pending";
    }

    if (role === "pending") {
      linksEl.textContent = "Awaiting approval...";
    } else {
      const allowed = NAV_ITEMS.filter(([, , , roles]) => roles.includes(role));

      linksEl.innerHTML = allowed
        .map(([label, href, key]) => {
          const cls = key === active ? "active" : "";
          return `<a class="${cls}" href="${href}">${label}</a>`;
        })
        .join("");
    }

    userEl.innerHTML = `${escapeHtml(user.email || "")} (${escapeHtml(role)}) · <a href="#" id="nav-signout">Sign out</a>`;

    const signoutEl = document.getElementById("nav-signout");
    if (signoutEl) {
      signoutEl.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await signOut(auth);
          window.location.href = "/login.html";
        } catch (err) {
          console.error("Sign out failed:", err);
        }
      });
    }
  });

  return shell;
}
