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
 */
export function needByRiskLabel(t, etaMap) {
  const needBy =
    typeof t.needByAtMs === "number" && t.needByAtMs > 0 ? t.needByAtMs : null;
  if (!needBy) return "";

  const eta = etaMap?.get(t.id);
  if (!eta) return "";

  const diff = eta - needBy;

  if (diff <= 0) return "ON TIME";
  if (diff <= 15 * 60 * 1000) return "AT RISK";
  return "MISSED";
}

/* -----------------------------
   DATE/TIME DISPLAY (GLOBAL RULE)
------------------------------ */

function toMs(v) {
  if (!v) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return null;
}

function startOfDayMs(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function fmtClock(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

export function fmtShortWhen(msLike, nowMs = Date.now()) {
  const ms = toMs(msLike);
  if (!ms) return "";

  const d = new Date(ms);
  const now = new Date(nowMs);

  const d0 = startOfDayMs(d);
  const n0 = startOfDayMs(now);

  const oneDay = 24 * 60 * 60 * 1000;
  const dayDiff = Math.round((d0 - n0) / oneDay);

  if (dayDiff === 0) return `Today ${fmtClock(d)}`;
  if (dayDiff === 1) return `Tomorrow ${fmtClock(d)}`;

  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${md} ${fmtClock(d)}`;
}

/* -----------------------------
   CELL FORMATTER (GLOBAL VIEW)
------------------------------ */

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
      ? fmtShortWhen(t.needByAtMs)
      : "";
  }

  if (key === "eta") {
    const ms = etaMap?.get(t.id);
    return ms ? fmtShortWhen(ms) : "";
  }

  if (key === "needByRisk") {
    return needByRiskLabel(t, etaMap);
  }

  if (key === "bay") {
    const b = typeof t.scheduledBay === "number" ? t.scheduledBay : null;
    return b ? String(b) : "";
  }

    if (key === "location") {
    const moving = String(t.moveStatus || "").toLowerCase() === "moving";
    const loc = t.location || "";

    if (moving) {
      return loc ? `${loc} (Moving)` : "Moving";
    }

    return loc;
  }
  if (key === "status") return t.status || "";

  if (key === "created") {
    const ms = toMs(t.createdAtMs) ?? toMs(t.createdAt);
    return ms ? fmtShortWhen(ms) : (fmtCreated ? fmtCreated(t) : "");
  }

  if (key === "washed") {
    const ms = toMs(t.washedAtMs) ?? toMs(t.washedAt);
    return ms ? fmtShortWhen(ms) : (fmtTs ? fmtTs(t.washedAt) : "");
  }

  /* ✅ LAST UPDATE (GLOBAL FORMAT APPLIED) */
  if (key === "updatedAt") {

    const ms = toMs(t.updatedAtMs) ?? toMs(t.updatedAt);

    if (!ms) return "";

    const when = fmtShortWhen(ms);

    const who =
      t.updatedByName ||
      t.updatedByEmail ||
      t.updatedByDisplayName ||
      "";

    const shortWho =
      who && who.includes("@")
        ? who.split("@")[0]
        : who;

    return shortWho
      ? `${shortWho} · ${when}`
      : when;
  }

  if (key === "notes") return t.notes || "";

  return t[key] ?? "";
}