// File: public/js/ui/render.js
// Purpose: Renders one ticket row, including placeholder cells for split action columns

// public/js/ui/render.js

import { auth, db } from "../firebase.js";
import { capsFor } from "./roles.js";
import { el } from "./dom.js";
import { formatCell } from "./formatters.js";
import { fmtCreated, fmtTs, fmtTime } from "../rosWash.js";
import {
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function renderRow(t, role, cols, etaMap) {
  const caps = capsFor(role);
  const tr = el("tr", { "data-id": t.id });

  cols.forEach((c) => {

       // ✅ Split action placeholders (presentation only, no logic change)
    if (
      c.key === "requestRewash" ||
      c.key === "setNeedByAction" ||
      c.key === "startWash" ||
      c.key === "markComplete" ||
      c.key === "cpBookedAction" ||
      c.key === "wtyBookedAction" ||
      c.key === "requestQc" ||
      c.key === "noQc" ||
      c.key === "qcDoneAction" ||
      c.key === "archiveAction"
    ) {
      const td = el("td");
      td.dataset.col = c.key;
      td.setAttribute("data-action-key", c.key);
      tr.appendChild(td);
      return;
    }


    // ✅ RO is now ALWAYS read-only everywhere
    if (c.key === "ro") {
      tr.appendChild(
        el("td", { text: t.ro || "" })
      );
      return;
    }


    // booked / qc indicators
    if (c.key === "cpBooked" || c.key === "wtyBooked" || c.key === "qcDone") {

      const td = el("td");

      let at = null;
      let by = "";

      if (c.key === "cpBooked") {
        at = t.cpBookedAt;
        by = t.cpBookedBy || "";
      }

      if (c.key === "wtyBooked") {
        at = t.wtyBookedAt;
        by = t.wtyBookedBy || "";
      }

      if (c.key === "qcDone") {
        at = t.qcDoneAt;
        by = t.qcDoneBy || "";
      }

      const isDone = !!at;

      td.textContent = isDone ? "✅" : "";

      if (isDone) {

        const when = fmtTs(at) || "";

        td.title =
          `By: ${by || "unknown"}${when ? " — " + when : ""}`;

        td.style.cursor = "help";

      }

      tr.appendChild(td);

      return;

    }


    // default rendering
    tr.appendChild(

      el("td", {

        text: formatCell({

          key: c.key,
          t,
          etaMap,
          fmtCreated,
          fmtTs,
          fmtTime

        })

      })

    );

  });

  return tr;

}