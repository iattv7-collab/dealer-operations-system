// public/js/ui/actions.js
import { auth, db } from "../firebase.js";
import { requestRewash, setTicketStatus, requestPickup, claimPickup, removeFromWashQueue } from "../rosWash.js";
import { pickDateTimeMs } from "./datetimePicker.js";
import { pickQcUserUid } from "./qcUsers.js";
import { capsFor } from "./roles.js";
import { isRewashTicket } from "./formatters.js";

import { computeEtaMap } from "./scheduler.js";
import { getSystemSettings } from "../settings.js";
import { el } from "./dom.js";

import { updateDoc, doc, serverTimestamp, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

/* -------------------------------------------
   Corrections helpers
--------------------------------------------*/
function canUseCorrectionsTab(tab) {
  return tab === "corrections";
}

function canFixField(correctionsPerms, key) {
  // correctionsPerms expected shape:
  // { tag: true/false, ro: true/false, location: true/false, advisorNumber: true/false }
  if (!correctionsPerms || typeof correctionsPerms !== "object") return false;
  return correctionsPerms[key] === true;
}

async function promptNonEmpty(label, currentVal = "") {
  const v = window.prompt(label, String(currentVal || ""));
  if (v === null) return null; // cancelled
  const out = String(v).trim();
  if (!out) return null;
  return out;
}

export async function requestRewashWithNeedBy(ticketId, user, role, needByMs) {
  await requestRewash(ticketId, user, role);

  if (Number.isFinite(needByMs)) {
    const ref = doc(db, "ros", ticketId);
    await updateDoc(ref, {
      needByAtMs: needByMs,
      needBySetBy: user.uid,
      ...buildLastEditedPatch(role, user.uid, ["needByAtMs", "needBySetBy"])
    });
  }
}

export async function setNeedBy(ticketId, user, needByMs, role = "unknown") {
  const ref = doc(db, "ros", ticketId);
  await updateDoc(ref, {
    priorityType: "needby",
    customerWaiting: false,
    washWaiterAtMs: null,
    needByAtMs: needByMs,
    needBySetBy: user.uid,
    ...buildLastEditedPatch(role, user.uid, [
      "priorityType",
      "customerWaiting",
      "washWaiterAtMs",
      "needByAtMs",
      "needBySetBy"
    ])
  });
}


export async function clearNeedBy(ticketId, user, role = "unknown") {
  const ref = doc(db, "ros", ticketId);
  await updateDoc(ref, {
    priorityType: "normal",
    needByAtMs: null,
    needBySetBy: null,
    ...buildLastEditedPatch(role, user.uid, ["priorityType", "needByAtMs", "needBySetBy"])
  });
}

export async function setWaiterStatus(ticketId, user, role = "unknown", isWaiter = true) {
  const ref = doc(db, "ros", ticketId);

  const patch = {
    customerWaiting: isWaiter,
    priorityType: isWaiter ? "waiter" : "normal",
    washWaiterAtMs: isWaiter ? Date.now() : null,
    ...buildLastEditedPatch(role, user.uid, [
      "customerWaiting",
      "priorityType",
      "washWaiterAtMs",
      "needByAtMs",
      "needBySetBy"
    ])
  };

  if (isWaiter) {
    patch.needByAtMs = null;
    patch.needBySetBy = null;
  }

  await updateDoc(ref, patch);
}

async function validateNeedByRequest({
  ticketId,
  needByMs,
  lastRows
}) {

  const sys = await getSystemSettings();

  const minutesPerCar =
    Number(sys?.washDurationMin || 15) +
    Number(sys?.bufferMin || 0);

  const baysOpen = Math.max(
    1,
    Number(sys?.effectiveBays || 1)
  );

  const simulated = (lastRows || []).map((r) => {
    const copy = { ...r };

    if (copy.id === ticketId) {
      copy.priorityType = "needby";
      copy.needByAtMs = needByMs;
    }

    return copy;
  });

  // Freeze existing protected tickets in their current order
  const existingNeedBy = simulated
    .filter((t) =>
      typeof t.needByAtMs === "number" &&
      t.needByAtMs > 0 &&
      t.id !== ticketId
    )
    .sort((a, b) => (a.needByAtMs || 0) - (b.needByAtMs || 0));

  const newNeedBy = simulated.find((t) => t.id === ticketId);

  const protectedTickets = [
    ...existingNeedBy,
    ...(newNeedBy ? [newNeedBy] : [])
  ].sort((a, b) => (a.needByAtMs || 0) - (b.needByAtMs || 0));

  const queue = simulated.slice();

  const scheduleOpts = {
    ...(sys || {}),
    baysOpen,
    minutesPerCar
  };

  const etaMap = computeEtaMap(queue, scheduleOpts);

  for (const t of queue) {

    if (
      typeof t.needByAtMs !== "number" ||
      t.needByAtMs <= 0
    ) {
      continue;
    }

    const eta = etaMap.get(t.id);

    if (!eta) continue;

    const etaMinute = Math.floor(Number(eta) / 60000);
    const needByMinute = Math.floor(Number(t.needByAtMs) / 60000);

    console.log("NEED BY CHECK", {
      ticket: t.id,
      eta,
      needByAtMs: t.needByAtMs,
      etaMinute,
      needByMinute
    });

    if (etaMinute > needByMinute) {

      return {
        ok: false,
        failedTicket: t,
        eta
      };
    }
  }

  return { ok: true };;
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

export function buildActionsCell({ t, role, tab = "", correctionsPerms = {}, splitMode = false }) {
  const caps = capsFor(role);

  const td = el("td");
  const wrap = el("div", { className: "row-actions" });

  const bRewash = el("button", { type: "button", className: "btn-rewash", text: "Request Rewash" });
  const bNeedBy = el("button", { type: "button", className: "btn-needby", text: "Set Need By" });

  const bWashing = el("button", { type: "button", className: "btn-washing", text: "Start Wash" });
  const bWashed = el("button", { type: "button", className: "btn-washed", text: "Mark Complete" });

  const bArchive = el("button", { type: "button", className: "btn-archive", text: "Archive" });

  const bRemoveWash = el("button", {
    type: "button",
    className: "btn-remove-wash",
    text: "Remove"
  });

  const bPickup = el("button", { type: "button", className: "btn-pickup", text: "Request Pickup" });

  const bPickupClaim = el("button", { type: "button", className: "btn-pickup-claim", text: "On The Way" });

  const bCpBooked = el("button", { type: "button", className: "btn-cpbooked", text: "CP Booked" });
  const bWtyBooked = el("button", { type: "button", className: "btn-wtybooked", text: "WTY Booked" });
  const bRequestQc = el("button", { type: "button", className: "btn-requestqc", text: "Request QC" });
  const bNoQc = el("button", { type: "button", className: "btn-noqc", text: "No QC Required" });

  const bQcDone = el("button", { type: "button", className: "btn-qcdone", text: "Mark QC Complete" });

  // Corrections buttons (tab-only)
  const bFixTag = el("button", { type: "button", className: "btn-fix-tag", text: "Fix Tag" });
  const bFixRo = el("button", { type: "button", className: "btn-fix-ro", text: "Fix RO" });
  const bFixLoc = el("button", { type: "button", className: "btn-fix-loc", text: "Fix Location" });
  const bFixAdv = el("button", { type: "button", className: "btn-fix-adv", text: "Fix Advisor #" });

  const status = String(t.status || "").toLowerCase();
  const isClosed = status === "closed";

  bRewash.disabled = isClosed || !(caps.canRewash && canRequestRewash(t));
  const isWaiter = t.customerWaiting === true;

  if (isWaiter && caps.canNeedBy) {
    bNeedBy.textContent = "Remove Waiter";
    bNeedBy.classList.add("btn-clear-waiter");
    bNeedBy.disabled = isClosed;
  } else {
    bNeedBy.disabled =
      isClosed ||
      !(caps.canNeedBy && (status === "queued" || status === "washing"));
  }
  bWashing.disabled = isClosed || !(caps.canWashOps && status === "queued");
  bWashed.disabled = isClosed || !(caps.canWashOps && status === "washing");
  bArchive.disabled = !(caps.canArchive && !isClosed);

  bRemoveWash.disabled =
    isClosed ||
    !(caps.canWashOps || role === "manager" || role === "admin");

  const pickupStatus = String(t.pickupStatus || "").toLowerCase();
  const pickupAlreadyActive = pickupStatus === "requested" || pickupStatus === "on_the_way";

  const canRequestPickup =
    role === "advisor" ||
    role === "booker" ||
    role === "manager" ||
    role === "admin" ||
    role === "wash";

  bPickup.disabled = isClosed || !canRequestPickup || pickupAlreadyActive;

  if (pickupStatus === "requested") {
    bPickup.textContent = "Pickup Requested";
  }

  if (pickupStatus === "on_the_way") {
    bPickup.textContent = "On The Way";
  }

  const canClaimPickup = role === "valet";
  const pickupCanBeClaimed = pickupStatus === "requested";

  bPickupClaim.disabled = isClosed || !canClaimPickup || !pickupCanBeClaimed;

  if (pickupStatus === "on_the_way") {
    bPickupClaim.textContent = "Claimed";
    bPickupClaim.disabled = true;
  }

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
  wrap.appendChild(bPickup);
  wrap.appendChild(bPickupClaim);

  if (canCpBook) wrap.appendChild(bCpBooked);
  if (canWtyBook) wrap.appendChild(bWtyBooked);

  if (canQcDecision) {
    wrap.appendChild(bRequestQc);
    wrap.appendChild(bNoQc);
  }

  if (isQc) wrap.appendChild(bQcDone);

  wrap.appendChild(bRemoveWash);
  wrap.appendChild(bArchive);

  // Corrections buttons ONLY in Corrections tab, and only for allowed fields
  if (canUseCorrectionsTab(tab)) {
    const showTag = canFixField(correctionsPerms, "tag");
    const showRo = canFixField(correctionsPerms, "ro");
    const showLoc = canFixField(correctionsPerms, "location");
    const showAdv = canFixField(correctionsPerms, "advisorNumber");

    if (showTag || showRo || showLoc || showAdv) {
      wrap.appendChild(el("span", { className: "muted", text: " | " }));
      if (showTag) wrap.appendChild(bFixTag);
      if (showRo) wrap.appendChild(bFixRo);
      if (showLoc) wrap.appendChild(bFixLoc);
      if (showAdv) wrap.appendChild(bFixAdv);
    }
  }

  if (splitMode) {
    const actionMap = {};

    if (wrap.contains(bRewash)) actionMap.requestRewash = bRewash;
    if (wrap.contains(bNeedBy)) actionMap.setNeedByAction = bNeedBy;
    if (wrap.contains(bWashing)) actionMap.startWash = bWashing;
    if (wrap.contains(bWashed)) actionMap.markComplete = bWashed;
    if (wrap.contains(bPickup)) actionMap.pickupRequestAction = bPickup;
    if (wrap.contains(bPickupClaim)) actionMap.pickupClaimAction = bPickupClaim;
    if (wrap.contains(bCpBooked)) actionMap.cpBookedAction = bCpBooked;
    if (wrap.contains(bWtyBooked)) actionMap.wtyBookedAction = bWtyBooked;
    if (wrap.contains(bRequestQc)) actionMap.requestQc = bRequestQc;
    if (wrap.contains(bNoQc)) actionMap.noQc = bNoQc;
    if (wrap.contains(bQcDone)) actionMap.qcDoneAction = bQcDone;
    if (wrap.contains(bRemoveWash)) {
      actionMap.removeWashQueueAction = bRemoveWash;
    }
    if (wrap.contains(bArchive)) actionMap.archiveAction = bArchive;

    return actionMap;
  }

  td.appendChild(wrap);
  return td;
}

export async function handleTableClick({ e, role, tab = "", lastRows, msgEl, correctionsPerms = {} }) {
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

    // Corrections actions (tab-only + per-field perms)
    if (canUseCorrectionsTab(tab)) {
      const ref = doc(db, "ros", id);

      if (btn.classList.contains("btn-fix-tag")) {
        if (!canFixField(correctionsPerms, "tag")) return;

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
        if (!canFixField(correctionsPerms, "ro")) return;

        const next = await promptNonEmpty("Correct RO:", tRow.ro || "");
        if (next === null) return;

        if (!/^\d+$/.test(next)) {
          if (msgEl) { msgEl.className = "err"; msgEl.textContent = "RO must be numeric."; }
          return;
        }

        if (next === id) {
          if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "RO unchanged."; }
          return;
        }

        const newRef = doc(db, "ros", next);
        const newSnap = await getDoc(newRef);
        if (newSnap.exists()) {
          if (msgEl) { msgEl.className = "err"; msgEl.textContent = `RO ${next} already exists.`; }
          return;
        }

        const oldSnap = await getDoc(ref);
        if (!oldSnap.exists()) {
          if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Original RO record not found."; }
          return;
        }

        const oldData = oldSnap.data();

        await setDoc(newRef, {
          ...oldData,
          ro: next,
          ...buildLastEditedPatch(role, user.uid, ["ro"])
        });

        await deleteDoc(ref);

        if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "RO corrected."; }
        return;
      }

      if (btn.classList.contains("btn-fix-loc")) {
        if (!canFixField(correctionsPerms, "location")) return;

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
        if (!canFixField(correctionsPerms, "advisorNumber")) return;

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

      const ref = doc(db, "ros", id);
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

      const ref = doc(db, "ros", id);
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

      const ref = doc(db, "ros", id);
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

      const ref = doc(db, "ros", id);
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

      const ref = doc(db, "ros", id);
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

      if (ms <= Date.now()) {
        await clearNeedBy(id, user, role);

        if (msgEl) {
          msgEl.className = "err";
          msgEl.textContent = "Past time rejected. Need By was cleared.";
        }
        return;
      }

      await requestRewashWithNeedBy(id, user, role, ms);
      if (msgEl) { msgEl.className = "ok"; msgEl.textContent = "Rewash requested."; }
      return;
    }

    if (btn.classList.contains("btn-needby")) {
      if (!caps.canNeedBy) return;

      if (btn.classList.contains("btn-clear-waiter")) {
        await setWaiterStatus(id, user, role, false);

        if (msgEl) {
          msgEl.className = "ok";
          msgEl.textContent = "Waiter removed.";
        }

        return;
      }

      const sys = await getSystemSettings();

      const ms = await pickDateTimeMs(
        "Set Need By date/time:",
        {
          mfOpen: sys?.mfOpen,
          mfClose: sys?.mfClose,
          satOpen: sys?.satOpen,
          satClose: sys?.satClose,
          sunOpen: sys?.sunOpen,
          sunClose: sys?.sunClose,
          minutesPerCar:
            Number(sys?.washDurationMin || 15) +
            Number(sys?.bufferMin || 0)
        }
      );
      if (ms === null) return;
      if (!Number.isFinite(ms)) {
        if (msgEl) { msgEl.className = "err"; msgEl.textContent = "Invalid date/time."; }
        return;
      }

      if (ms <= Date.now()) {
        if (msgEl) {
          msgEl.className = "err";
          msgEl.textContent = "You cannot select a past time.";
        }
        return;
      }

      const validation = await validateNeedByRequest({
        ticketId: id,
        needByMs: ms,
        lastRows
      });

      if (!validation.ok) {

        const etaText = new Date(validation.eta)
          .toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
          });

        const selectedText = new Date(ms)
          .toLocaleString([], {
            month: "numeric",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
          });

        alert(
          `That Need By time is not possible.\n\nSelected: ${selectedText}\nEarliest available completion: ${etaText}`
        );

        return;
      }

      await setNeedBy(id, user, ms, role);
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

    if (btn.classList.contains("btn-pickup")) {
      await requestPickup(id, user, role);
      if (msgEl) {
        msgEl.className = "ok";
        msgEl.textContent = "Pickup requested.";
      }
      return;
    }

    if (btn.classList.contains("btn-pickup-claim")) {
      const result = await claimPickup(id, user, role);
      if (msgEl) {
        msgEl.className = "ok";
        msgEl.textContent = result?.location
          ? `On the way. Location: ${result.location}`
          : "On the way. Location unknown.";
      }
      return;
    }


    if (btn.classList.contains("btn-remove-wash")) {

      if (!(caps.canWashOps || role === "manager" || role === "admin")) {
        return;
      }

      const ok = confirm(
        "Remove this vehicle from the wash queue?\n\nThis will clear its wash queue timing and queue position."
      );

      if (!ok) return;

      await removeFromWashQueue(id, user, role);

      if (msgEl) {
        msgEl.className = "ok";
        msgEl.textContent = "Vehicle removed from wash queue.";
      }

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