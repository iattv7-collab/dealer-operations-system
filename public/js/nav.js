import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getUserProfile } from "./guard.js";

export function renderNav() {
  const shell = `
  <style>
    .af-nav {
      background: #0b3d91;
      color: #fff;
      padding: 14px 16px;
      border-bottom: 4px solid #00a8c6;
    }

    /* ROW 1 */
    .af-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .af-title {
      font-size: 22px;
      font-weight: bold;
    }

    .af-name {
      font-weight: bold;
    }

    /* ROW 2 */
    .af-bottom {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
    }

    .af-nav a {
      color: #fff;
      text-decoration: none;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,0.35);
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
    }
  </style>

  <div class="af-nav">
    <div class="af-top">
      <div class="af-title">Arrow Flow</div>
      <div id="nav-name" class="af-name"></div>
    </div>

    <div class="af-bottom">
      <a href="/home.html">Home</a>
      <a href="#" id="nav-signout">Sign out</a>
    </div>
  </div>
`;

  onAuthStateChanged(auth, async (user) => {
    const nameEl = document.getElementById("nav-name");
    const signoutEl = document.getElementById("nav-signout");

    if (!user) return;

    try {
      const profile = await getUserProfile(user);
      nameEl.textContent = profile?.name || user.email?.split("@")[0] || "";
    } catch {
      nameEl.textContent = user.email?.split("@")[0] || "";
    }

    signoutEl.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut(auth);
      window.location.href = "/login.html";
    });
  });

  return shell;
}