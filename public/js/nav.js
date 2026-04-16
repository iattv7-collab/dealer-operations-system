// public/js/nav.js
import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getUserProfile } from "./guard.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const TAB_CONFIG = [
  {
    label: "Home",
    href: "/home.html",
    key: "home",
    defaultRoles: ["admin", "manager", "advisor", "wash", "staff", "valet", "booker", "qc"],
  },
  {
    label: "New RO",
    href: "/ro/scan.html",
    key: "scanner",
    defaultRoles: ["admin", "manager", "advisor"],
  },
  {
    label: "Location",
    href: "/location.html",
    key: "location",
    defaultRoles: ["admin", "manager", "advisor", "valet", "wash", "staff", "booker", "qc"],
  },
  {
    label: "Advisor",
    href: "/advisor.html",
    key: "advisor",
    defaultRoles: ["admin", "manager", "advisor"],
  },
  {
    label: "Valet",
    href: "/valet.html",
    key: "valet",
    defaultRoles: ["admin", "manager", "valet"],
  },
  {
    label: "Wash",
    href: "/wash.html",
    key: "wash",
    defaultRoles: ["admin", "manager", "wash"],
  },
  {
    label: "Loaners",
    href: "/loaners.html",
    key: "loaners",
    defaultRoles: ["admin", "manager", "advisor", "wash"],
  },
  {
    label: "Manager",
    href: "/manager.html",
    key: "manager",
    defaultRoles: ["admin", "manager"],
  },
  {
    label: "Admin",
    href: "/admin.html",
    key: "admin",
    defaultRoles: ["admin"],
  },
  {
    label: "Send to Wash",
    href: "/dropoff.html",
    key: "dropoff",
    defaultRoles: ["admin", "manager", "advisor", "wash", "staff", "valet", "qc"],
  },
  {
    label: "Settings",
    href: "/settings.html",
    key: "settings",
    defaultRoles: ["admin", "manager"],
  },
  {
    label: "Booker",
    href: "/booker.html",
    key: "booker",
    defaultRoles: ["admin", "manager", "booker"],
  },
  {
    label: "QC",
    href: "/qc.html",
    key: "qc",
    defaultRoles: ["admin", "manager", "qc"],
  },
  {
    label: "Master RO",
    href: "/master-ro.html",
    key: "masterro",
    defaultRoles: ["admin", "manager", "advisor", "booker"], // qc removed by default
  },
  {
    label: "Archive",
    href: "/archive.html",
    key: "archive",
    defaultRoles: ["admin", "manager", "advisor", "booker"],
  },
  {
    label: "RO Tracker",
    href: "/ro/index.html",
    key: "rotracker",
    defaultRoles: ["admin", "manager", "advisor"],
  },
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

function normalizeRole(role) {
  return String(role || "pending").trim().toLowerCase();
}

/*
  Placeholder for future admin toggle system.

  Later this can come from Firestore, for example:
  {
    masterro: {
      addRoles: ["qc"],
      removeRoles: []
    }
  }
*/

function canRoleSeeTab(tab, role, tabVisibility) {
  const configuredRoles = Array.isArray(tabVisibility?.[tab.key])
    ? tabVisibility[tab.key].map(normalizeRole)
    : tab.defaultRoles.map(normalizeRole);

  return configuredRoles.includes(role);
}

function getAllowedTabsForRole(role, tabVisibility = {}) {
  return TAB_CONFIG.filter((tab) => canRoleSeeTab(tab, role, tabVisibility));
}

export function renderNav(active = "") {
  const shell = `
    <style>
      .topnav { margin: 6px 0 10px 0; }
      .topnav a {
        display: inline-block;
        padding: 6px 10px;
        margin-right: 6px;
        margin-bottom: 6px;
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
      role = normalizeRole(profile?.role || "pending");
    } catch (e) {
      console.error("Failed to load user profile for nav:", e);
      role = "pending";
    }

    if (role === "pending") {
      linksEl.textContent = "Awaiting approval...";
    } else {
      let tabVisibility = {};
      try {
        const snap = await getDoc(doc(db, "settings", "tabVisibility"));
        if (snap.exists()) {
          tabVisibility = snap.data();
        }
      } catch (e) {
        console.error("Failed to load tab visibility:", e);
      }

      const allowedTabs = getAllowedTabsForRole(role, tabVisibility);

      linksEl.innerHTML = allowedTabs
        .map((tab) => {
          const cls = tab.key === active ? "active" : "";
          return `<a class="${cls}" href="${tab.href}">${tab.label}</a>`;
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

export { TAB_CONFIG, getAllowedTabsForRole, canRoleSeeTab };