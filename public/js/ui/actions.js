// public/js/ui/actions.js
import { auth, db } from "../firebase.js";
import { requestRewash, setTicketStatus } from "../washTickets.js";
import { pickDateTimeMs } from "./datetimePicker.js";
import { pickQcUserUid } from "./qcUsers.js";
import { capsFor } from "./roles.js";
import { isRewashTicket } from "./formatters.js";
import { el } from "./dom.js";

import { updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const NO_QC_TOKEN = "__NO_QC__";

export function buildLastEditedPatch(role, uid, fields) {
  return {
    updatedAt: serverTimestamp(),
    lastEditedAtMs: Date.now(),
    lastEditedBy: uid,
    lastEditedRole: role,
    lastEditedFields: fields
  };
}

function canRequestRewash(t) {
  return String(t.status || "").toLowerCase() === "washed";
}

export async function requestRewashWithNeedBy(ticketId, user, role, needByMs) {
  await requestRewash(ticketId, user, role);

  if (Number.isFinite(needByMs)) {
    const ref = doc(db, "washTickets", ticketId);
    await updateDoc(ref, {
      needByAtMs: needByMs,
      needBySetBy: user.uid,
      ...buildLastEditedPatch(role, user.uid, ["needByAtMs", "needBySetBy"])
    });
  }
}

export async function setNeedBy(ticketId, user, needByMs) {
  const ref = doc(db, "washTickets", ticketId);
  await updateDoc(ref, {
    priorityType: "needby",
    needByAtMs: needByMs,
    needBySetBy: user.uid,
    updatedAt: serverTimestamp()
  });
}

export function setRowButtonsDisabled(tr, disabled) {
  tr.querySelectorAll("button").forEach((b) => {
    if (disabled) {
      b.dataset.prevDisabled = b.disabled ? "1" : "0";
      b.disabled = true;
    } else {
      if (b.dataset.prevDisabled != null) {
        b.disabled = b.dataset.prevDisabled === "1";
        delete b.dataset.prevDisabled;
      }
    }
  });
}

/* -------------------------------------------
   ✅ Corrections helpers (TEST MODE: valet only)
--------------------------------------------*/
function canUseCorrections(role, tab) {
  return tab === "corrections" && role === "valet"; // ✅ valet can edit all 4 for now
}

async function promptNonEmpty(label, currentVal = "") {
  const v = window.prompt(label, String(currentVal || ""));
  if (v === null) return null; // cancelled
  const out = String(v).trim();
  if (!out) return null;
  return out;
}

export function buildActionsCell({ t, role, tab = "" }) {
  const caps = capsFor(role);

  const td = el("td");
  const wrap = el("div", { className: "row-actions" });

  const bRewash = el("button", { type: "button", className: "btn-rewash", text: "Request Rewash" });
  const bNeedBy = el("button", { type: "button", className: "btn-needby", text: "Set Need By" });

  const bWashing = el("button", { type: "button", className: "btn-washing", text: "Start Wash" });
  const bWashed = el("button", { type: "button", className: "btn-washed", text: "Mark Complete" });

  const bArchive = el("button", { type: "button", className: "btn-archive", text: "Archive" });

  const bCpBooked = el("button", { type: "button", className: "btn-cpbooked", text: "CP Booked" });
  const bWtyBooked = el("button", { type: "button", className: "btn-wtybooked", text: "WTY Booked" });
  const bRequestQc = el("button", { type: "button", className: "btn-requestqc", text: "Request QC" });
  const bNoQc = el("button", { type: "button", className: "btn-noqc", text: "No QC Required" });

  const bQcDone = el("button", { type: "button", className: "btn-qcdone", text: "Mark QC Complete" });

  // ✅ Corrections buttons (tab-only)
  const bFixTag = el("button", { type: "button", className: "btn-fix-tag", text: "Fix Tag" });
  const bFixRo = el("button", { type: "button", className: "btn-fix-ro", text: "Fix RO" });
  const bFixLoc = el("button", { type: "button", className: "btn-fix-loc", text: "Fix Location" });
  const bFixAdv = el("button", { type: "button", className: "btn-fix-adv", text: "Fix Advisor #" });

  const status = String(t.status || "").toLowerCase();
  const isClosed = status === "closed";

  bRewash.disabled = isClosed || !(caps.canRewash && canRequestRewash(t));
  bNeedBy.disabled = isClosed || !(caps.canNeedBy && (status === "queued" || status === "washing"));
  bWashing.disabled = isClosed || !(caps.canWashOps && status === "queued");
  bWashed.disabled = isClosed || !(caps.canWashOps && status === "washing");
  bArchive.disabled = !(caps.canArchive && !isClosed);

  const canCpBook = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");
  const canWtyBook = (role === "booker" || role === "manager" || role === "admin");
  const canQcDecision = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");

  const qcAssigned = typeof t.qcAssignedTo === "string" ? t.qcAssignedTo : "";
  const qcIsNoQc = qcAssigned === NO_QC_TOKEN;
  const qcIsRealAssigned = !!qcAssigned && !qcIsNoQc;

  bCpBooked.disabled = !canCpBook || isClosed || !!t.cpBookedAt;
  bWtyBooked.disabled = !canWtyBook || isClosed || !!t.wtyBookedAt;

  bRequestQc.disabled = !canQcDecision || isClosed || !!t.qcDoneAt || qcIsRealAssigned;
  bNoQc.disabled = !canQcDecision || isClosed || !!t.qcDoneAt || qcIsNoQc;

  const isQc = role === "qc";
  bQcDone.disabled = !isQc || isClosed || !!t.qcDoneAt;

  // Default workflow buttons
  wrap.appendChild(bRewash);
  wrap.appendChild(bNeedBy);
  wrap.appendChild(bWashing);
  wrap.appendChild(bWashed);

  if (canCpBook) wrap.appendChild(bCpBooked);
  if (canWtyBook) wrap.appendChild(bWtyBooked);

  if (canQcDecision) {
    wrap.appendChild(bRequestQc);
    wrap.appendChild(bNoQc);
  }

  if (isQc) wrap.appendChild(bQcDone);

  wrap.appendChild(bArchive);

  // ✅ Corrections buttons ONLY in Corrections tab (valet test mode)
  if (canUseCorrections(role, tab)) {
    wrap.appendChild(el("span", { className: "muted", text: " | " }));
    wrap.appendChild(bFixTag);
    wrap.appendChild(bFixRo);
    wrap.appendChild(bFixLoc);
    wrap.appendChild(bFixAdv);
  }

  td.appendChild(wrap);
  return td;
}

export async function handleTableClick({ e, role, tab = "", lastRows, msgEl }) {
  const btn = e.target.closest("button");
  if (!btn) return;

  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;

  const id = tr.getAttribute("data-id");
  const user = auth.currentUser;

  if (!user) {
    if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Not signed in."; }
    return;
  }

  const tRow = (lastRows || []).find(x => x.id === id) || {};
  const isRewash = isRewashTicket(tRow);
  const startedMs = (typeof tRow.washingStartedAtMs === "number") ? tRow.washingStartedAtMs : null;

  const caps = capsFor(role);

  try {
    setRowButtonsDisabled(tr, true);

    // ✅ Corrections actions (valet test mode)
    if (canUseCorrections(role, tab)) {
      const ref = doc(db, "washTickets", id);

      if (btn.classList.contains("btn-fix-tag")) {
        const next = await promptNonEmpty("Correct Tag:", tRow.tag || "");
        if (next === null) return;

        await updateDoc(ref, {
          tag: next,
          ...buildLastEditedPatch(role, user.uid, ["tag"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Tag corrected."; }
        return;
      }

      if (btn.classList.contains("btn-fix-ro")) {
        const next = await promptNonEmpty("Correct RO:", tRow.ro || "");
        if (next === null) return;

        await updateDoc(ref, {
          ro: next,
          ...buildLastEditedPatch(role, user.uid, ["ro"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "RO corrected."; }
        return;
      }

      if (btn.classList.contains("btn-fix-loc")) {
        const next = await promptNonEmpty("Correct Location:", tRow.location || "");
        if (next === null) return;

        await updateDoc(ref, {
          location: next,
          ...buildLastEditedPatch(role, user.uid, ["location"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Location corrected."; }
        return;
      }

      if (btn.classList.contains("btn-fix-adv")) {
        const next = await promptNonEmpty("Correct Advisor #:", tRow.advisorNumber || "");
        if (next === null) return;

        await updateDoc(ref, {
          advisorNumber: next,
          ...buildLastEditedPatch(role, user.uid, ["advisorNumber"])
        });

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Advisor # corrected."; }
        return;
      }
    }

    const canCpBook = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");
    const canWtyBook = (role === "booker" || role === "manager" || role === "admin");
    const canQcDecision = (role === "booker" || role === "advisor" || role === "manager" || role === "admin");

    if (btn.classList.contains("btn-cpbooked")) {
      if (!canCpBook) return;

      const ref = doc(db, "washTickets", id);
      await updateDoc(ref, {
        cpBookedAt: serverTimestamp(),
        cpBookedBy: user.uid,
        ...buildLastEditedPatch(role, user.uid, ["cpBookedAt", "cpBookedBy"])
      });

      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "CP booked saved."; }
      return;
    }

    if (btn.classList.contains("btn-wtybooked")) {
      if (!canWtyBook) return;

      const ref = doc(db, "washTickets", id);
      await updateDoc(ref, {
        wtyBookedAt: serverTimestamp(),
        wtyBookedBy: user.uid,
        ...buildLastEditedPatch(role, user.uid, ["wtyBookedAt", "wtyBookedBy"])
      });

      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "WTY booked saved."; }
      return;
    }

    if (btn.classList.contains("btn-requestqc")) {
      if (!canQcDecision) return;

      const assignedUid = await pickQcUserUid();
      if (!assignedUid) return;

      const ref = doc(db, "washTickets", id);
      await updateDoc(ref, {
        qcRequestedAt: serverTimestamp(),
        qcRequestedBy: user.uid,
        qcAssignedTo: assignedUid,
        ...buildLastEditedPatch(role, user.uid, ["qcRequestedAt", "qcRequestedBy", "qcAssignedTo"])
      });

      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "QC requested & assigned."; }
      return;
    }

    if (btn.classList.contains("btn-noqc")) {
      if (!canQcDecision) return;

      const ref = doc(db, "washTickets", id);
      await updateDoc(ref, {
        qcRequestedAt: serverTimestamp(),
        qcRequestedBy: user.uid,
        qcAssignedTo: NO_QC_TOKEN,
        ...buildLastEditedPatch(role, user.uid, ["qcRequestedAt", "qcRequestedBy", "qcAssignedTo"])
      });

      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Set to No QC Required."; }
      return;
    }

    if (btn.classList.contains("btn-qcdone")) {
      if (role !== "qc") return;

      const ref = doc(db, "washTickets", id);
      await updateDoc(ref, {
        qcDoneAt: serverTimestamp(),
        qcDoneBy: user.uid,
        ...buildLastEditedPatch("qc", user.uid, ["qcDoneAt", "qcDoneBy"])
      });

      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "QC marked complete."; }
      return;
    }

    if (btn.classList.contains("btn-rewash")) {
      if (!caps.canRewash) return;

      const ms = await pickDateTimeMs("Request rewash by what time?");
      if (ms === null) return;
      if (!Number.isFinite(ms)) {
        if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Invalid date/time."; }
        return;
      }

      await requestRewashWithNeedBy(id, user, role, ms);
      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Rewash requested."; }
      return;
    }

    if (btn.classList.contains("btn-needby")) {
      if (!caps.canNeedBy) return;

      const ms = await pickDateTimeMs("Set Need By date/time:");
      if (ms === null) return;
      if (!Number.isFinite(ms)) {
        if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Invalid date/time."; }
        return;
      }

      await setNeedBy(id, user, ms);
      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Need By saved."; }
      return;
    }

    if (btn.classList.contains("btn-washing")) {
      if (!caps.canWashOps) return;

      await setTicketStatus(id, "washing", user, role, { isRewash });

      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Marked as washing."; }
      return;
    }

    if (btn.classList.contains("btn-washed")) {
      if (!caps.canWashOps) return;

      await setTicketStatus(id, "washed", user, role, {
        isRewash,
        washingStartedAtMs: startedMs
      });

      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Marked as washed."; }
      return;
    }

    if (btn.classList.contains("btn-archive")) {
      if (!caps.canArchive) return;
      await setTicketStatus(id, "closed", user, role);
      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Archived (closed)."; }
      return;
    }
  } catch (err) {
    console.error(err);
    if (msgEl) { msgEl.className = "err"; msgEl.textContent = err?.message || "Error updating ticket."; }
  } finally {
    setRowButtonsDisabled(tr, false);
  }
}