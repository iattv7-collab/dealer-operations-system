// public/modules/archive.js
import { db, auth } from "../firebase.js";
import { getUserProfile } from "../../js/guard.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { formatNoYearDate } from "../datetimePicker.js";
import { restoreFromArchive, COL_ARCHIVE } from "./firestore.js";
function ensureArchiveStyles() {
  if (document.getElementById("__rt_archive_styles")) return;
  const st = document.createElement("style");
  st.id = "__rt_archive_styles";
  st.textContent = `
    .rt-arch-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:99999;}
    .rt-arch-modal{background:#fff;border:1px solid #cfcfcf;border-radius:12px;width:min(1100px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:"Times New Roman", Times, serif;padding:14px;}
    .rt-arch-title{font-weight:bold;font-size:18px;margin-bottom:10px;background:#0b3d91;color:#fff;padding:10px 12px;border-radius:10px;}
    .rt-arch-closeRow{display:flex;justify-content:flex-end;margin:8px 0 12px;}
    .rt-arch-table{width:100%;border-collapse:collapse;}
    .rt-arch-table th{border-bottom:1px solid #ddd;padding:8px;text-align:left;}
    .rt-arch-table td{border-bottom:1px solid #eee;padding:8px;text-align:left;}
    .rt-arch-actions{white-space:nowrap;}
  `;
  document.head.appendChild(st);
}
function openArchiveUpModal() {
  if (document.getElementById("__rt_archive_backdrop")) return;
  ensureArchiveStyles();
  const backdrop = document.createElement("div");
  backdrop.id = "__rt_archive_backdrop";
  backdrop.className = "rt-arch-backdrop";
  const modal = document.createElement("div");
  modal.className = "rt-arch-modal";
  const title = document.createElement("div");
  title.className = "rt-arch-title";
  title.textContent = "Archive / Follow Up";
  const closeRow = document.createElement("div");
  closeRow.className = "rt-arch-closeRow";
  const btnClose = document.createElement("button");
  btnClose.className = "smallbtn";
  btnClose.textContent = "Close";
  let unsub = null;
  btnClose.onclick = () => {
    try { unsub && unsub(); } catch { }
    backdrop.remove();
  };
  closeRow.appendChild(btnClose);
  const table = document.createElement("table");
  table.className = "rt-arch-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th>Customer</th><th>Phone</th><th>RO</th><th>Promise</th><th>Model</th><th>Advisor #</th><th>Archived</th><th>Actions</th></tr>`;
  const tbody = document.createElement("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  modal.appendChild(title);
  modal.appendChild(closeRow);
  modal.appendChild(table);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) btnClose.click();
  });
  const user = auth.currentUser;

  Promise.resolve(user ? getUserProfile(user) : null).then((profile) => {
    const role = String(profile?.role || "").toLowerCase();
    const advisorNo = String(
      profile?.employeeId ||
      profile?.advisorNo ||
      profile?.advisorNumber ||
      ""
    ).trim();

    let refOrQuery = collection(db, COL_ARCHIVE);

    // Advisors only see their own archived ROs
    if (role === "advisor" && advisorNo) {
      refOrQuery = query(
        collection(db, COL_ARCHIVE),
        where("advisorNo", "==", advisorNo)
      );
    }

    unsub = onSnapshot(refOrQuery, (qs) => {
      const rows = [];
      qs.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      rows.forEach((r) => { if (!r.ro) r.ro = r.id; });
      rows.sort((a, b) => {
        const am = a.archivedAt?.toMillis ? a.archivedAt.toMillis() : 0;
        const bm = b.archivedAt?.toMillis ? b.archivedAt.toMillis() : 0;
        if (bm !== am) return bm - am;
        return String(a.ro || "").localeCompare(String(b.ro || ""), undefined, { numeric: true });
      });

      tbody.innerHTML = "";

      rows.forEach((r) => {
        const tr = document.createElement("tr");

        const td = (txt) => {
          const x = document.createElement("td");
          x.textContent = txt || "";
          return x;
        };

        tr.appendChild(td(r.customerName || ""));
        tr.appendChild(td(r.phone || ""));
        tr.appendChild(td(r.ro || ""));
        tr.appendChild(td(formatNoYearDate(r.promiseDate || "")));
        tr.appendChild(td(r.model || ""));
        tr.appendChild(td(r.advisorNo || ""));

        const archivedTxt = r.archivedAt?.toDate ? r.archivedAt.toDate().toLocaleString() : "";
        tr.appendChild(td(archivedTxt));

        const tdAct = document.createElement("td");
        tdAct.className = "rt-arch-actions";

        const btnText = document.createElement("button");
        btnText.className = "smallbtn";
        btnText.textContent = "Text";
        btnText.addEventListener("click", () => {
          const phone = String(r.phone || "").replace(/[^\d]/g, "");
          if (!phone) { alert("Missing phone."); return; }
          const msg = `Hello ${r.customerName || ""}, following up on your Porsche service RO ${r.ro || ""}.`;
          window.location.href = `sms:${phone}?&body=${encodeURIComponent(msg)}`;
        });

        const btnRestore = document.createElement("button");
        btnRestore.className = "smallbtn";
        btnRestore.textContent = "Restore";
        btnRestore.style.marginLeft = "8px";
        btnRestore.addEventListener("click", async () => {
          const ro = String(r.ro || "").trim();
          if (!ro) return;
          if (!confirm(`Restore RO ${ro} back to Active?`)) return;
          try {
            await restoreFromArchive(ro);
          } catch (e) {
            alert(String(e?.message || e));
          }
        });

        tdAct.appendChild(btnText);
        tdAct.appendChild(btnRestore);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
    });
  });
}
export function initArchiveModal() {
  const btn = document.getElementById("btnArchiveView");
  if (!btn || btn.__rtBound) return;
  btn.__rtBound = true;
  btn.addEventListener("click", openArchiveUpModal);
}