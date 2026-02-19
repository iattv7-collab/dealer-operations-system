// public/js/ui/datetimePicker.js

export async function pickDateTimeMs(titleText) {
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
      .dtp-row input{ font-family:inherit; font-size:16px; padding:6px 8px; }
      .dtp-preview{ margin-top:8px; color:#444; }
      .dtp-actions{ margin-top:12px; display:flex; gap:10px; justify-content:flex-end; }
      .dtp-actions button{ font-family:inherit; font-size:16px; padding:6px 10px; }
      .dtp-muted{ color:#666; font-size:14px; }
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

    const input = document.createElement("input");
    input.type = "datetime-local";
    input.step = "60";

    const hint = document.createElement("div");
    hint.className = "dtp-muted";
    hint.textContent = "Pick date & time, then Save.";

    row.appendChild(input);
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

    function updatePreview() {
      const raw = input.value;
      if (!raw) { preview.textContent = "Selected: —"; return; }
      const ms = new Date(raw).getTime();
      if (!Number.isFinite(ms)) { preview.textContent = "Selected: (invalid)"; return; }
      preview.textContent = "Selected: " + new Date(ms).toLocaleString("en-US", {
        year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit"
      });
    }
    input.addEventListener("input", updatePreview);

    function close(val) { backdrop.remove(); resolve(val); }
    cancelBtn.addEventListener("click", () => close(null));

    saveBtn.addEventListener("click", () => {
      const raw = input.value;
      const ms = raw ? new Date(raw).getTime() : NaN;
      if (!raw || !Number.isFinite(ms)) {
        preview.textContent = "Selected: Please pick a valid date/time.";
        return;
      }
      close(ms);
    });

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(null); });

    window.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") {
        window.removeEventListener("keydown", onKey);
        close(null);
      }
    });

    input.focus();
  });
}
