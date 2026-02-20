// public/js/ui/formatters.js

export function isRewashTicket(t) {
  return (
    t.priorityType === "rewash" ||
    (typeof t.rewashRequestedAtMs === "number" && t.rewashRequestedAtMs > 0)
  );
}

export function priorityLabel(t) {
  if (t.waiter === true) return "WAITer";

  if (typeof t.needByAtMs === "number" && t.needByAtMs > 0) {
    if (isRewashTicket(t)) return "REWASH";
    return "NEED BY";
  }

  if (isRewashTicket(t)) return "REWASH";
  return "NORMAL";
}

/**
 * Need-By Risk label:
 * - ON TIME  -> ETA <= NeedBy
 * - AT RISK  -> ETA is late but <= 15 minutes
 * - MISSED   -> ETA is late by more than 15 minutes
 */
export function needByRiskLabel(t, etaMap) {
  const needBy =
    typeof t.needByAtMs === "number" && t.needByAtMs > 0 ? t.needByAtMs : null;
  if (!needBy) return "";

  const eta = etaMap?.get(t.id);
  if (!eta) return "";

  const diff = eta - needBy; // positive = late

  if (diff <= 0) return "ON TIME";
  if (diff <= 15 * 60 * 1000) return "AT RISK";
  return "MISSED";
}

export function formatCell({ key, t, etaMap, fmtCreated, fmtTs, fmtTime }) {
  if (key === "tag") return t.tag || "";
  if (key === "ro") return t.ro || "";
  if (key === "priority") return priorityLabel(t);

  if (key === "cycleType") {
    const isRewash =
      t.isRewashCycle === true ||
      t.priorityType === "rewash" ||
      (typeof t.rewashRequestedAtMs === "number" && t.rewashRequestedAtMs > 0);

    return isRewash ? "REWASH" : "WASH";
  }

  if (key === "needBy") {
    return typeof t.needByAtMs === "number" && t.needByAtMs > 0
      ? fmtTime(t.needByAtMs)
      : "";
  }

  if (key === "eta") {
    const ms = etaMap?.get(t.id);
    return ms ? fmtTime(ms) : "";
  }

  // ✅ Need By Risk
  if (key === "needByRisk") {
    return needByRiskLabel(t, etaMap);
  }

  // ✅ Bay (pull from scheduler field)
  if (key === "bay") {
    const b = typeof t.scheduledBay === "number" ? t.scheduledBay : null;
    return b ? String(b) : "";
  }

  if (key === "location") return t.location || "";
  if (key === "status") return t.status || "";
  if (key === "created") return fmtCreated(t);
  if (key === "washed") return fmtTs(t.washedAt);
  if (key === "notes") return t.notes || "";
  return t[key] ?? "";
}