// public/modules/utils.js

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtDateMMDDYYYY(d) {
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const yy = d.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

function dateInputToMMDDYYYY(val) {
  if (!val) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
  if (!m) return "";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function mmddyyyyToDateInput(val) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(val || "").trim());
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function parseHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, mi };
}

function addDaysAtTime(baseMs, days, hhmm) {
  const t = parseHHMM(hhmm) || { h: 10, mi: 0 };
  const d = new Date(baseMs);
  d.setDate(d.getDate() + Number(days || 0));
  d.setHours(t.h, t.mi, 0, 0);
  return d.getTime();
}

function fmtDue(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  let h = d.getHours();
  const m = pad2(d.getMinutes());
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${mm}/${dd} ${h}:${m} ${ap}`;
}

function firstNameFromCustomer(full) {
  const s = String(full || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  return parts[0] || "";
}

function renderTemplate(tpl, ctx) {
  return String(tpl || "")
    .replaceAll("{firstName}", ctx.firstName || "")
    .replaceAll("{name}", ctx.name || "")
    .replaceAll("{ro}", ctx.ro || "")
    .replaceAll("{model}", ctx.model || "");
}

function smsHref(phone, body) {
  const p = String(phone || "").replace(/[^\d+]/g, "");
  const b = encodeURIComponent(String(body || ""));
  return `sms:${p}?&body=${b}`;
}

export {
  pad2,
  fmtDateMMDDYYYY,
  dateInputToMMDDYYYY,
  mmddyyyyToDateInput,
  parseHHMM,
  addDaysAtTime,
  fmtDue,
  firstNameFromCustomer,
  renderTemplate,
  smsHref
};