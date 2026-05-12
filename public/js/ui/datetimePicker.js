// public/js/ui/datetimePicker.js

export async function pickDateTimeMs(
  titleText = "Select date & time",
  scheduleOpts = {}
) {
  if (!document.getElementById("__dtpicker_styles")) {
    const st = document.createElement("style");
    st.id = "__dtpicker_styles";
    st.textContent = `
      .dtp-backdrop{
        position:fixed; inset:0; background:rgba(0,0,0,.35);
        display:flex; align-items:center; justify-content:center;
        z-index:9999;
      }
      .dtp-modal{
        background:#fff; border:1px solid #ccc; border-radius:10px;
        padding:14px; width:min(420px, calc(100vw - 24px));
        box-shadow:0 10px 30px rgba(0,0,0,.25);
        font-family:"Times New Roman", Times, serif;
      }
      .dtp-title{ font-weight:bold; margin-bottom:10px; }
      .dtp-row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      .dtp-row input, .dtp-row select{
        font-family:inherit; font-size:16px; padding:6px 8px;
      }
      .dtp-preview{ margin-top:8px; color:#444; }
      .dtp-actions{ margin-top:12px; display:flex; gap:10px; justify-content:flex-end; }
      .dtp-actions button{ font-family:inherit; font-size:16px; padding:6px 10px; }
      .dtp-muted{ color:#666; font-size:14px; }
      .dtp-row label{ font-size:14px; color:#444; }
    `;
    document.head.appendChild(st);
  }

  return await new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dtp-backdrop";

    const modal = document.createElement("div");
    modal.className = "dtp-modal";

    const title = document.createElement("div");
    title.className = "dtp-title";
    title.textContent = titleText;

    const row = document.createElement("div");
    row.className = "dtp-row";

    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Date";

    const dateInput = document.createElement("input");
    dateInput.type = "date";

    const timeLabel = document.createElement("label");
    timeLabel.textContent = "Time";

    const timeSelect = document.createElement("select");

    const hint = document.createElement("div");
    hint.className = "dtp-muted";
    hint.textContent = "Pick date & time, then Save.";

    row.appendChild(dateLabel);
    row.appendChild(dateInput);
    row.appendChild(timeLabel);
    row.appendChild(timeSelect);
    row.appendChild(hint);

    const preview = document.createElement("div");
    preview.className = "dtp-preview";
    preview.textContent = "Selected: —";

    const actions = document.createElement("div");
    actions.className = "dtp-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    modal.appendChild(title);
    modal.appendChild(row);
    modal.appendChild(preview);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    function pad2(n) {
      return String(n).padStart(2, "0");
    }

    // Default date = today (local)
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    dateInput.value = todayStr;

    function parseHHMM(v) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ""));
      if (!m) return null;

      return {
        h: Number(m[1]),
        m: Number(m[2])
      };
    }

    function buildSlotsForDate(dateStr) {

      const d = new Date(`${dateStr}T00:00:00`);
      const day = d.getDay();

      let openStr = "07:30";
      let closeStr = "19:00";

      if (day === 6) {
        openStr = scheduleOpts.satOpen || "08:00";
        closeStr = scheduleOpts.satClose || "15:00";
      } else if (day === 0) {
        openStr = scheduleOpts.sunOpen || "00:00";
        closeStr = scheduleOpts.sunClose || "00:00";
      } else {
        openStr = scheduleOpts.mfOpen || "07:30";
        closeStr = scheduleOpts.mfClose || "19:00";
      }

      const open = parseHHMM(openStr);
      const close = parseHHMM(closeStr);

      if (!open || !close) return [];

      const slotMinutes =
        Number(scheduleOpts.minutesPerCar || 15);

      const openMs = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        open.h,
        open.m,
        0,
        0
      ).getTime();

      const closeMs = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        close.h,
        close.m,
        0,
        0
      ).getTime();

      const slots = [];

      for (
        let ms = openMs + slotMinutes * 60000;
        ms <= closeMs;
        ms += slotMinutes * 60000
      ) {

        const dt = new Date(ms);

        const hh = String(dt.getHours()).padStart(2, "0");
        const mm = String(dt.getMinutes()).padStart(2, "0");

        slots.push(`${hh}:${mm}`);
      }

      return slots;
    }

    function buildTimeOptions() {
      timeSelect.innerHTML = "";

      const baseDate = dateInput.value;
      const isToday = baseDate === todayStr;

      const slots = buildSlotsForDate(baseDate);

      // Suggest next slot as default
      const nowMs = Date.now();
      let firstValidValue = null;
      let suggestedValue = null;

      slots.forEach((t) => {
        const ms = new Date(`${baseDate}T${t}:00`).getTime();
        const past = isToday && Number.isFinite(ms) && ms <= nowMs;

        if (past) return;

        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;

        if (!firstValidValue) {
          firstValidValue = t;
        }

        timeSelect.appendChild(opt);
      });

      // Try to keep existing selection; else pick suggested/first valid; else first slot
      const current = timeSelect.dataset.currentValue || "";
      const exists = slots.includes(current);

      if (exists) {
        timeSelect.value = current;
      } else if (firstValidValue) {
        timeSelect.value = firstValidValue;
      } else {
        timeSelect.value = firstValidValue || "";
      }

      // Store current
      timeSelect.dataset.currentValue = timeSelect.value;
    }

    function computeMs() {
      const d = dateInput.value;
      const t = timeSelect.value;

      if (!d || !t) return NaN;

      const [year, month, day] = d.split("-").map(Number);
      const [hour, minute] = t.split(":").map(Number);

      return new Date(
        year,
        month - 1,
        day,
        hour,
        minute,
        0,
        0
      ).getTime();
    }

    function updatePreview() {
      const ms = computeMs();
      if (!Number.isFinite(ms)) {
        preview.textContent = "Selected: —";
        return;
      }
      preview.textContent =
        "Selected: " +
        new Date(ms).toLocaleString("en-US", {
          month: "numeric",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
    }

    function close(val) {
      // cleanup key listener
      window.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(val);
    }

    function onKey(e) {
      if (e.key === "Escape") close(null);
    }

    cancelBtn.addEventListener("click", () => close(null));

    saveBtn.addEventListener("click", () => {
      const ms = computeMs();

      if (!Number.isFinite(ms)) {
        preview.textContent = "Selected: Please pick a valid date/time.";
        return;
      }

      if (ms <= Date.now()) {
        alert("You cannot select a past time.");
        preview.textContent = "Selected: Past time not allowed.";
        return;
      }

      close(ms);
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });

    dateInput.addEventListener("input", () => {
      buildTimeOptions();
      updatePreview();
    });

    timeSelect.addEventListener("change", () => {
      timeSelect.dataset.currentValue = timeSelect.value;
      updatePreview();
    });

    window.addEventListener("keydown", onKey);

    // init
    buildTimeOptions();
    updatePreview();

    dateInput.focus();
  });
}