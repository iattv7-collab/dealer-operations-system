// public/modules/followup.js
import { db } from "../firebase.js";
import { collection, doc, getDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { addDaysAtTime, firstNameFromCustomer, fmtDue, renderTemplate, smsHref } from "./utils.js";
import { loadSettings } from "./settings.js";
import { COL_ARCHIVE } from "./firestore.js";
function ensureFollowupStyles() {
  if (document.getElementById("__rt_followup_styles")) return;
  const st = document.createElement("style");
  st.id = "__rt_followup_styles";
  st.textContent = `
    .rt-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:99999;}
    .rt-modal{background:#fff;border:1px solid #cfcfcf;border-radius:12px;width:min(980px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:"Times New Roman", Times, serif;padding:14px;}
    .rt-title{font-weight:bold;font-size:18px;margin-bottom:10px;background:#0b3d91;color:#fff;padding:10px 12px;border-radius:10px;}
    .rt-mini{font-size:12px;color:#333;margin:6px 0 10px;}
    .rt-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px;}
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
  if (Number(settings.followUpDay1 || 0) > 0) out.push({ slot: 1, dueMs: addDaysAtTime(archivedMs, settings.followUpDay1, settings.followUpTime1) });
  if (Number(settings.followUpDay2 || 0) > 0) out.push({ slot: 2, dueMs: addDaysAtTime(archivedMs, settings.followUpDay2, settings.followUpTime2) });
  return out.sort((a, b) => a.dueMs - b.dueMs);
}
function openReadyUpModal(followupDocs) {
  const settings = loadSettings();
  const nowMs = Date.now();
  const readyItems = [];
  followupDocs.forEach((d) => {
    const dueList = computeDueListForArchived(d, settings);
    dueList.forEach(({ slot, dueMs }) => {
      const sentKey = slot === 1 ? "followup1SentAtMs" : "followup2SentAtMs";
      const alreadySent = !!d[sentKey];
      if (!alreadySent && dueMs <= nowMs) readyItems.push({ doc: d, slot, dueMs });
    });
  });
  readyItems.sort((a, b) => a.dueMs - b.dueMs);
  openModal("Follow Up — Ready", (body, close) => {
    const note = document.createElement("div");
    note.className = "rt-mini";
    note.textContent = "This list is based on Archived time + your settings. Tap Text to open your phone SMS prefilled.";
    body.appendChild(note);
    const table = document.createElement("table");
    table.className = "rt-list";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr><th>RO</th><th>Name</th><th>Phone</th><th>Model</th><th>Due</th><th class="center">Action</th></tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    if (!readyItems.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "Nothing ready right now.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      readyItems.forEach(({ doc: d, slot, dueMs }) => {
        const tr = document.createElement("tr");
        const name = String(d.customerName || "");
        const phone = String(d.phone || "");
        const ro = String(d.ro || d.id || "");
        const model = String(d.model || "");
        const pill = document.createElement("span");
        pill.className = "rt-pill ready";
        pill.textContent = `READY (slot ${slot})`;
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
        const tdAct = document.createElement("td");
        tdAct.className = "center";
        const btnText = document.createElement("button");
        btnText.className = "rt-btn";
        btnText.textContent = "Text";
        btnText.addEventListener("click", async () => {
          const msg = renderTemplate(settings.smsTemplate, { firstName: firstNameFromCustomer(name), name, ro, model });
          const sentAt = Date.now();
          const sentKey = slot === 1 ? "followup1SentAtMs" : "followup2SentAtMs";
          try {
            window.location.href = smsHref(phone, msg);
            setTimeout(async () => {
              const ref = doc(db, COL_ARCHIVE, ro);
              await updateDoc(ref, { [sentKey]: sentAt, followupLastSlot: slot, followupLastSentAtMs: sentAt });
            }, 400);
          } catch (e) {
            alert(String(e?.message || e));
          }
        });
        tdAct.appendChild(btnText);
        tr.appendChild(tdRO);
        tr.appendChild(tdName);
        tr.appendChild(tdPhone);
        tr.appendChild(tdModel);
        tr.appendChild(tdDue);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
    }
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
    unsubFollowup = onSnapshot(collection(db, COL_ARCHIVE), (qs) => {
      const rows = [];
      qs.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      rows.forEach((r) => { if (!r.ro) r.ro = r.id; });
      FOLLOWUP_CACHE = rows;
    });
  }
  const btn = document.getElementById("btnFollowUp");
  if (btn && !btn.__rtBound) {
    btn.__rtBound = true;
    btn.addEventListener("click", () => openReadyUpModal(FOLLOWUP_CACHE || []));
  }
}