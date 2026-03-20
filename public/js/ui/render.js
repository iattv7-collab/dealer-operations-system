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

    // ✅ Actions placeholder in the correct column spot
    if (c.key === "_actions") {
      const td = el("td");
      td.dataset.col = "actions";
      td.setAttribute("data-actions-cell", "1");
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