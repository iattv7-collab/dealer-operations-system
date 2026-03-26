// public/datetimePicker.js
// Modal date+time picker with governed hours + increments.
// Returns ms (number) or null if cancelled.

function pad2(n) { return String(n).padStart(2, "0"); }

function parseHM(hm) {
  // "HH:MM" -> minutes since midnight
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  return h * 60 + mi;
}

function minutesToHM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { h, m };
}

function fmtTimeLabel(h, m) {
  let hh = h;
  const ap = hh >= 12 ? "PM" : "AM";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${pad2(m)} ${ap}`;
}

function msToParts(ms) {
  const d = ms ? new Date(ms) : new Date();
  return {
    yyyy: d.getFullYear(),
    mm: d.getMonth() + 1,
    dd: d.getDate(),
    h: d.getHours(),
    min: d.getMinutes()
  };
}

function toDateInputValue(yyyy, mm, dd) {
  return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
}

export function formatNoYearDateTime(ms) {
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

export function formatNoYearDate(mmddyyyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(mmddyyyy || "").trim());
  if (!m) return "";
  return `${m[1]}/${m[2]}`;
}

function dayHoursFor(schedule, yyyy, mm, dd) {
  // schedule:
  // { monFri:{start:"07:30", end:"19:00"}, sat:{start:"08:00", end:"15:00"}, sun:null }
  if (!schedule) return null;

  const d = new Date(yyyy, mm - 1, dd);
  const dow = d.getDay(); // 0 Sun, 1 Mon ... 6 Sat

  if (dow === 0) return schedule.sun || null;
  if (dow === 6) return schedule.sat || null;
  return schedule.monFri || null;
}

function buildTimeOptionsForHours(stepMin, startMin, endMin) {
  // endMin is inclusive for selection if it lands exactly on step
  const out = [];
  if (startMin == null || endMin == null) return out;
  if (endMin < startMin) return out;

  // snap start to step boundary upward
  const startSnap = Math.ceil(startMin / stepMin) * stepMin;
  const endSnap = Math.floor(endMin / stepMin) * stepMin;

  for (let m = startSnap; m <= endSnap; m += stepMin) {
    out.push(minutesToHM(m));
  }
  return out;
}

function nearestStepMinute(minute, stepMin) {
  return Math.round(minute / stepMin) * stepMin;
}

function clampToRange(minute, startMin, endMin) {
  if (minute < startMin) return startMin;
  if (minute > endMin) return endMin;
  return minute;
}

/**
 * pickDateTimeMs(titleText, initialMs, stepMin, opts)
 * opts.showNow: boolean (default false)
 * opts.schedule: { monFri:{start,end}, sat:{start,end}, sun:null|{start,end} }
 *   start/end are "HH:MM" in 24h time.
 */
export function pickDateTimeMs(titleText = "Pick date/time", initialMs = null, stepMin = 5, opts = {}) {
  const showNow = !!opts.showNow;
  const schedule = opts.schedule || null;

  return new Promise((resolve) => {
    if (!document.getElementById("__rt_dt_styles")) {
      const st = document.createElement("style");
      st.id = "__rt_dt_styles";
      st.textContent = `
        .rtp-backdrop{
          position:fixed; inset:0; background:rgba(0,0,0,.35);
          display:flex; align-items:center; justify-content:center;
          z-index:99999;
        }
        .rtp-modal{
          background:#fff; border:1px solid #cfcfcf; border-radius:12px;
          width:min(520px, calc(100vw - 24px));
          box-shadow:0 10px 30px rgba(0,0,0,.25);
          font-family:"Times New Roman", Times, serif;
          padding:14px;
        }
        .rtp-title{
          font-weight:bold; font-size:18px; margin-bottom:10px;
          background:#0b3d91; color:#fff;
          padding:10px 12px; border-radius:10px;
        }
        .rtp-row{ display:flex; gap:10px; align-items:center; margin:10px 0; }
        .rtp-row label{ width:90px; }
        .rtp-row input, .rtp-row select{
          font-family:"Times New Roman", Times, serif;
          padding:8px 10px;
          border:1px solid #c8d0d9; border-radius:8px;
          font-size:16px;
        }
        .rtp-actions{ display:flex; justify-content:flex-end; gap:10px; margin-top:14px; }
        .rtp-btn{
          font-family:"Times New Roman", Times, serif;
          padding:8px 12px; border-radius:10px;
          border:1px solid #888; background:#fff; cursor:pointer;
        }
        .rtp-btn.primary{ background:#0b3d91; color:#fff; border-color:#0b3d91; }
        .rtp-note{ margin-top:6px; font-size:14px; color:#444; }
      `;
      document.head.appendChild(st);
    }

    const initial = msToParts(initialMs);

    const backdrop = document.createElement("div");
    backdrop.className = "rtp-backdrop";

    const modal = document.createElement("div");
    modal.className = "rtp-modal";

    const title = document.createElement("div");
    title.className = "rtp-title";
    title.textContent = titleText;

    const row1 = document.createElement("div");
    row1.className = "rtp-row";
    const labDate = document.createElement("label");
    labDate.textContent = "Date:";
    const inpDate = document.createElement("input");
    inpDate.type = "date";
    inpDate.value = toDateInputValue(initial.yyyy, initial.mm, initial.dd);
    row1.appendChild(labDate);
    row1.appendChild(inpDate);

    const row2 = document.createElement("div");
    row2.className = "rtp-row";
    const labTime = document.createElement("label");
    labTime.textContent = "Time:";
    const selTime = document.createElement("select");
    row2.appendChild(labTime);
    row2.appendChild(selTime);

    if (showNow) {
      const btnNow = document.createElement("button");
      btnNow.className = "rtp-btn";
      btnNow.type = "button";
      btnNow.textContent = "Now";
      btnNow.onclick = () => {
        const d = new Date();
        inpDate.value = toDateInputValue(d.getFullYear(), d.getMonth() + 1, d.getDate());
        // will refresh options and select closest within range
        refreshTimes(true);
      };
      row2.appendChild(btnNow);
    }

    const note = document.createElement("div");
    note.className = "rtp-note";

    const actions = document.createElement("div");
    actions.className = "rtp-actions";

    const btnCancel = document.createElement("button");
    btnCancel.className = "rtp-btn";
    btnCancel.type = "button";
    btnCancel.textContent = "Cancel";

    const btnOk = document.createElement("button");
    btnOk.className = "rtp-btn primary";
    btnOk.type = "button";
    btnOk.textContent = "OK";

    function close(val) {
      backdrop.remove();
      resolve(val);
    }

    btnCancel.onclick = () => close(null);

    function getSelectedDateParts() {
      const dv = inpDate.value; // YYYY-MM-DD
      if (!dv) return null;
      const [yyyy, mm, dd] = dv.split("-").map(Number);
      if (!yyyy || !mm || !dd) return null;
      return { yyyy, mm, dd };
    }

    function refreshTimes(fromNowButton = false) {
      const dp = getSelectedDateParts();
      selTime.innerHTML = "";

      if (!dp) {
        note.textContent = "";
        btnOk.disabled = true;
        return;
      }

      const hours = dayHoursFor(schedule, dp.yyyy, dp.mm, dp.dd);

      // If no schedule provided, fall back to full day (legacy)
      let startMin = 0;
      let endMin = 23 * 60 + 59;
      let closed = false;

      if (schedule) {
        if (!hours) {
          closed = true;
        } else {
          const s = parseHM(hours.start);
          const e = parseHM(hours.end);
          if (s == null || e == null) closed = true;
          else {
            startMin = s;
            endMin = e;
          }
        }
      }

      if (closed) {
        const o = document.createElement("option");
        o.value = "";
        o.textContent = "Closed";
        selTime.appendChild(o);
        selTime.disabled = true;
        btnOk.disabled = true;
        note.textContent = "Closed on this day.";
        return;
      }

      const optsTime = buildTimeOptionsForHours(stepMin, startMin, endMin);

      if (!optsTime.length) {
        const o = document.createElement("option");
        o.value = "";
        o.textContent = "No times";
        selTime.appendChild(o);
        selTime.disabled = true;
        btnOk.disabled = true;
        note.textContent = "No valid times for this day.";
        return;
      }

      selTime.disabled = false;
      btnOk.disabled = false;

      // Decide initial selection:
      // If this refresh was triggered by Now, use current time.
      // Else use initialMs time if same date, otherwise use start time.
      let targetMin;
      if (fromNowButton) {
        const d = new Date();
        targetMin = d.getHours() * 60 + d.getMinutes();
      } else {
        targetMin = initial.h * 60 + initial.min;
      }

      // snap and clamp
      targetMin = nearestStepMinute(targetMin, stepMin);
      targetMin = clampToRange(targetMin, startMin, endMin);

      // build options
      optsTime.forEach(({ h, m }) => {
        const o = document.createElement("option");
        o.value = `${h}:${m}`;
        o.textContent = fmtTimeLabel(h, m);
        if (h * 60 + m === targetMin) o.selected = true;
        selTime.appendChild(o);
      });

      // note
      if (schedule) {
        const sh = pad2(Math.floor(startMin / 60));
        const sm = pad2(startMin % 60);
        const eh = pad2(Math.floor(endMin / 60));
        const em = pad2(endMin % 60);
        note.textContent = `Allowed hours: ${sh}:${sm} – ${eh}:${em}`;
      } else {
        note.textContent = "";
      }
    }

    inpDate.addEventListener("change", () => refreshTimes(false));

    btnOk.onclick = () => {
      const dp = getSelectedDateParts();
      if (!dp) return close(null);
      if (!selTime.value) return close(null);

      const [hh, mi] = selTime.value.split(":").map(Number);
      const d = new Date(dp.yyyy, dp.mm - 1, dp.dd, hh, mi, 0, 0);
      close(d.getTime());
    };

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });

    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);

    modal.appendChild(title);
    modal.appendChild(row1);
    modal.appendChild(row2);
    modal.appendChild(note);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // initial load
    refreshTimes(false);

    setTimeout(() => inpDate.focus(), 0);
  });
}