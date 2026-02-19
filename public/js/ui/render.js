// public/js/ui/render.js

import { auth, db } from "../firebase.js";
import { capsFor } from "./roles.js";
import { el } from "./dom.js";
import { formatCell } from "./formatters.js";
import { fmtCreated, fmtTs, fmtTime } from "../washTickets.js";
import {
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function renderRow(t, role, cols, etaMap) {
  const caps = capsFor(role);
  const tr = el("tr", { "data-id": t.id });

  cols.forEach((c) => {
    // ✅ Actions placeholder in the correct column spot
    if (c.key === "_actions") {
      const td = el("td");
      td.dataset.col = "actions";           // used by dom.js CSS
      td.setAttribute("data-actions-cell", "1"); // easy to find later
      tr.appendChild(td);
      return;
    }

    if (c.key === "ro") {
      const status = String(t.status || "").toLowerCase();
      const isClosed = status === "closed";

      if (caps.canEditRO && !isClosed) {
        const td = el("td");
        const inp = el("input", {
          type: "text",
          className: "ro-input",
          value: t.ro || "",
          "data-ro-input": "1"
        });

        inp.addEventListener("blur", async () => {
          const user = auth.currentUser;
          if (!user) return;

          const val = String(inp.value || "").trim();
          const ref = doc(db, "washTickets", t.id);

          await updateDoc(ref, {
            ro: val,
            updatedAt: serverTimestamp()
          });
        });

        td.appendChild(inp);
        tr.appendChild(td);
        return;
      }

      tr.appendChild(el("td", { text: t.ro || "" }));
      return;
    }

    if (c.key === "cpBooked" || c.key === "wtyBooked" || c.key === "qcDone") {
      const td = el("td");

      let at = null;
      let by = "";

      if (c.key === "cpBooked") { at = t.cpBookedAt; by = t.cpBookedBy || ""; }
      if (c.key === "wtyBooked") { at = t.wtyBookedAt; by = t.wtyBookedBy || ""; }
      if (c.key === "qcDone") { at = t.qcDoneAt; by = t.qcDoneBy || ""; }

      const isDone = !!at;
      td.textContent = isDone ? "✅" : "";

      if (isDone) {
        const when = fmtTs(at) || "";
        td.title = `By: ${by || "unknown"}${when ? " — " + when : ""}`;
        td.style.cursor = "help";
      }

      tr.appendChild(td);
      return;
    }

    // default
    tr.appendChild(
      el("td", {
        text: formatCell({ key: c.key, t, etaMap, fmtCreated, fmtTs, fmtTime })
      })
    );
  });

  return tr;
}
