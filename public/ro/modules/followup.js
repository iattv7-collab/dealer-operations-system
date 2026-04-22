// public/modules/followup.js
import { db, auth } from "../firebase.js";
import { getUserProfile } from "../../js/guard.js";
import { collection, doc, getDoc, onSnapshot, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { addDaysAtTime, firstNameFromCustomer, fmtDue, renderTemplate, smsHref } from "./utils.js";
import { loadSettings } from "./settings.js";
import { COL_ARCHIVE } from "./firestore.js";
import { createUserNotification } from "./notification-center.js";
function ensureFollowupStyles() {
  if (document.getElementById("__rt_followup_styles")) return;
  const st = document.createElement("style");
  st.id = "__rt_followup_styles";
  st.textContent = `
    .rt-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:99999;}
    .rt-modal{background:#fff;border:1px solid #cfcfcf;border-radius:12px;width:calc(100vw - 40px);height:calc(100vh - 40px);max-width:1400px;max-height:95vh;overflow:auto;resize:both;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:"Times New Roman", Times, serif;padding:14px;}
    .rt-title{font-weight:bold;font-size:18px;margin-bottom:10px;background:#0b3d91;color:#fff;padding:10px 12px;border-radius:10px;}
    .rt-mini{font-size:12px;color:#333;margin:6px 0 10px;}
    .rt-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px;}
    .rt-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:8px 0 12px;flex-wrap:wrap;}
    .rt-search{font-family:"Times New Roman", Times, serif;padding:8px 10px;border:1px solid #c8d0d9;border-radius:8px;font-size:14px;min-width:280px;}
    .rt-btn{font-family:"Times New Roman", Times, serif;padding:8px 12px;border-radius:10px;border:1px solid #888;background:#fff;cursor:pointer;}
    .rt-list{width:100%;border-collapse:collapse;}
    .rt-list th,.rt-list td{border-bottom:1px solid #eee;padding:8px;text-align:left;}
    .rt-list td.center{text-align:center;}
    .rt-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;margin-left:6px;border:1px solid #0b3d91;color:#0b3d91;}
    .rt-pill.ready{background:#e8f0ff;}
  `;
  document.head.appendChild(st);
}
function openModal(titleText, buildFn) {
  ensureFollowupStyles();
  const backdrop = document.createElement("div");
  backdrop.className = "rt-backdrop";
  const modal = document.createElement("div");
  modal.className = "rt-modal";
  const title = document.createElement("div");
  title.className = "rt-title";
  title.textContent = titleText;
  const body = document.createElement("div");
  const close = () => backdrop.remove();
  buildFn(body, close);
  modal.appendChild(title);
  modal.appendChild(body);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}
function computeDueListForArchived(docData, settings) {
  const ts = docData?.archivedAt;
  const archivedMs = ts?.toMillis ? ts.toMillis() : (typeof ts === "number" ? ts : null);
  if (!archivedMs) return [];

  const out = [];

  // 🔥 TEST MODE (minutes after archive)
  if (settings.followUpQuickMin && Number(settings.followUpQuickMin) > 0) {
    const quickMs = archivedMs + (Number(settings.followUpQuickMin) * 60 * 1000);
    out.push({ slot: 1, dueMs: quickMs });
    return out;
  }

  // NORMAL MODE
  if (Number(settings.followUpDay1 || 0) > 0) {
    out.push({
      slot: 1,
      dueMs: addDaysAtTime(archivedMs, settings.followUpDay1, settings.followUpTime1)
    });
  }

  if (Number(settings.followUpDay2 || 0) > 0) {
    out.push({
      slot: 2,
      dueMs: addDaysAtTime(archivedMs, settings.followUpDay2, settings.followUpTime2)
    });
  }

  return out.sort((a, b) => a.dueMs - b.dueMs);
}
function openReadyUpModal(followupDocs) {


  const settings = loadSettings();
  const nowMs = Date.now();
  const queueItems = [];

  followupDocs
    .filter((d) => String(d.followupStatus || "waiting") !== "done")
    .forEach((d) => {
      const dueList = computeDueListForArchived(d, settings);

      dueList.forEach(({ slot, dueMs }) => {
        const sentKey = slot === 1 ? "followup1SentAtMs" : "followup2SentAtMs";
        const alreadySent = !!d[sentKey];

        if (!alreadySent) {
  const isDueNow = dueMs <= nowMs;

  queueItems.push({
    doc: d,
    slot,
    dueMs,
    isDue: isDueNow
  });

  // 🔥 CREATE NOTIFICATION (ONLY WHEN DUE)
  if (isDueNow && !d.__notifCreated) {
    d.__notifCreated = true;

    createUserNotification({
      userId: auth.currentUser.uid,
      title: "Follow-up Due",
      body: `RO ${d.ro || d.id} is ready for follow-up`,
      url: `/ro/index.html?ro=${d.ro || d.id}`,
      type: "followup",
      roId: d.ro || d.id
    });
  }
}
      });
    });

  queueItems.sort((a, b) => {
    if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
    if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
    return String(a.doc?.ro || a.doc?.id || "").localeCompare(
      String(b.doc?.ro || b.doc?.id || ""),
      undefined,
      { numeric: true }
    );
  });


  openModal("Follow Up Queue", (body, close) => {
    const note = document.createElement("div");
    note.className = "rt-mini";
    note.textContent = "Rows turn yellow when follow-up is due. Due items appear first, waiting items stay below. Use Text or Mark Done to remove them from this queue.";
    body.appendChild(note);

    const toolbar = document.createElement("div");
    toolbar.className = "rt-toolbar";

    const search = document.createElement("input");
    search.className = "rt-search";
    search.type = "text";
    search.placeholder = "Search RO, customer, phone, model, advisor #";

    toolbar.appendChild(search);
    body.appendChild(toolbar);

    const table = document.createElement("table");
    table.className = "rt-list";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr><th>RO</th><th>Name</th><th>Phone</th><th>Model</th><th>Advisor #</th><th>Due</th><th>Status</th><th class="center">Action</th></tr>`;
    table.appendChild(thead);


    const tbody = document.createElement("tbody");

    function renderRows(filterText = "") {
      const q = String(filterText || "").trim().toLowerCase();
      tbody.innerHTML = "";

      const filtered = !q
        ? queueItems
        : queueItems.filter(({ doc: d }) => {
          const hay = [
            d.ro || d.id || "",
            d.customerName || "",
            d.phone || "",
            d.model || "",
            d.advisorNo || ""
          ].join(" ").toLowerCase();

          return hay.includes(q);
        });

      if (!filtered.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 8;
        td.textContent = q ? "No matching follow-ups found." : "No follow-ups in queue.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      filtered.forEach(({ doc: d, slot, dueMs, isDue }) => {
        const tr = document.createElement("tr");
        tr.style.background = isDue ? "#fff59d" : "#fff";
        const name = String(d.customerName || "");
        const phone = String(d.phone || "");
        const ro = String(d.ro || d.id || "");
        const model = String(d.model || "");

        const pill = document.createElement("span");
        pill.className = "rt-pill ready";
        pill.textContent = isDue ? `READY (slot ${slot})` : `WAITING (slot ${slot})`;

        const tdRO = document.createElement("td");
        tdRO.appendChild(document.createTextNode(ro + " "));
        tdRO.appendChild(pill);

        const tdName = document.createElement("td");
        tdName.textContent = name;

        const tdPhone = document.createElement("td");
        tdPhone.textContent = phone;

        const tdModel = document.createElement("td");
        tdModel.textContent = model;

        const tdDue = document.createElement("td");
        tdDue.textContent = fmtDue(dueMs);

        const tdStatus = document.createElement("td");
        tdStatus.textContent = isDue ? "Follow Up Needed" : "Waiting";

        const tdAct = document.createElement("td");
        tdAct.className = "center";

        const btnText = document.createElement("button");
        btnText.className = "rt-btn";
        btnText.textContent = "Text";
        btnText.addEventListener("click", async () => {
          const msg = renderTemplate(settings.smsTemplate, {
            firstName: firstNameFromCustomer(name),
            name,
            ro,
            model
          });
          const sentAt = Date.now();
          const sentKey = slot === 1 ? "followup1SentAtMs" : "followup2SentAtMs";

          try {
            window.location.href = smsHref(phone, msg);

            setTimeout(async () => {
              const ref = doc(db, COL_ARCHIVE, ro);
              await updateDoc(ref, {
                [sentKey]: sentAt,
                followupLastSlot: slot,
                followupLastSentAtMs: sentAt,
                followupStatus: "done",
                followupCompletedAtMs: sentAt
              });
            }, 400);
          } catch (e) {
            alert(String(e?.message || e));
          }
        });

        const btnDone = document.createElement("button");
        btnDone.className = "rt-btn";
        btnDone.textContent = "Mark Done";
        btnDone.style.marginLeft = "8px";
        btnDone.addEventListener("click", async () => {
          try {
            const ref = doc(db, COL_ARCHIVE, ro);
            await updateDoc(ref, {
              followupStatus: "done",
              followupCompletedAtMs: Date.now()
            });

            tr.remove();
          } catch (e) {
            alert(String(e?.message || e));
          }
        });

        tdAct.appendChild(btnText);
        tdAct.appendChild(btnDone);

        const tdAdvisor = document.createElement("td");
        tdAdvisor.textContent = String(d.advisorNo || "");

        tr.appendChild(tdRO);
        tr.appendChild(tdName);
        tr.appendChild(tdPhone);
        tr.appendChild(tdModel);
        tr.appendChild(tdAdvisor);
        tr.appendChild(tdDue);
        tr.appendChild(tdStatus);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
    }

    search.addEventListener("input", () => renderRows(search.value));
    renderRows();


    table.appendChild(tbody);
    body.appendChild(table);
    const actions = document.createElement("div");
    actions.className = "rt-actions";
    const btnClose = document.createElement("button");
    btnClose.className = "rt-btn";
    btnClose.type = "button";
    btnClose.textContent = "Close";
    btnClose.onclick = close;
    actions.appendChild(btnClose);
    body.appendChild(actions);
  });
}
async function handleFollowUpLaunchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("fu") !== "1") return;
  const ro = String(params.get("ro") || "").trim();
  const slot = String(params.get("slot") || "").trim();
  if (!ro) return;
  try {
    const ref = doc(db, COL_ARCHIVE, ro);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data() || {};
    const settings = loadSettings();
    const name = String(d.customerName || "");
    const phone = String(d.phone || "");
    const model = String(d.model || "");
    const msg = renderTemplate(settings.smsTemplate, { firstName: firstNameFromCustomer(name), name, ro, model });
    window.location.href = smsHref(phone, msg);

    const sentAt = Date.now();

    setTimeout(async () => {
      // If push came from "archive" (or "quick"), do NOT mark followup1/followup2 as sent.
      if (slot === "archive" || slot === "quick") {
        await updateDoc(ref, {
          pushOpenedAtMs: sentAt,
          pushOpenedSlot: slot,
          pushOpenedRo: ro
        });
        return;
      }

      const sentKey = slot === "2" ? "followup2SentAtMs" : "followup1SentAtMs";
      await updateDoc(ref, {
        [sentKey]: sentAt,
        followupLastSlot: Number(slot) || 1,
        followupLastSentAtMs: sentAt
      });
    }, 500);


  } catch (e) {
    alert(String(e?.message || e));
  } finally {
    history.replaceState({}, document.title, window.location.pathname);
  }
}
let FOLLOWUP_CACHE = [];
let unsubFollowup = null;
export function initFollowUp() {
  handleFollowUpLaunchFromUrl();

  if (!unsubFollowup) {
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

      // Advisors only see their own archived ROs in Follow Up
      if (role === "advisor" && advisorNo) {
        refOrQuery = query(
          collection(db, COL_ARCHIVE),
          where("advisorNo", "==", advisorNo)
        );
      }

      unsubFollowup = onSnapshot(refOrQuery, (qs) => {
        const rows = [];
        qs.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        rows.forEach((r) => { if (!r.ro) r.ro = r.id; });
        FOLLOWUP_CACHE = rows;
      });
    });
  }

  const btn = document.getElementById("btnFollowUp");
  if (btn && !btn.__rtBound) {
    btn.__rtBound = true;
    btn.addEventListener("click", () => openReadyUpModal(FOLLOWUP_CACHE || []));
  }
}