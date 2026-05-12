// File: public/js/ui/render.js
// Purpose: Renders one ticket row, including Foreman assigned-tech dropdown and split action placeholders.

import { db } from "../firebase.js";
import { el } from "./dom.js";
import { formatCell } from "./formatters.js";
import { fmtCreated, fmtTs, fmtTime } from "../rosWash.js";
import {
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function renderRow(t, role, cols, etaMap) {
  const tr = el("tr", { "data-id": t.id });

  cols.forEach((c) => {
    if (
      c.key === "requestRewash" ||
      c.key === "pickupRequestAction" ||
      c.key === "pickupClaimAction" ||
      c.key === "setNeedByAction" ||
      c.key === "startWash" ||
      c.key === "markComplete" ||
      c.key === "cpBookedAction" ||
      c.key === "wtyBookedAction" ||
      c.key === "requestQc" ||
      c.key === "noQc" ||
      c.key === "qcDoneAction" ||
      c.key === "archiveAction" ||
      c.key === "removeWashQueueAction"
    ) {
      const td = el("td");
      td.dataset.col = c.key;
      td.setAttribute("data-action-key", c.key);
      tr.appendChild(td);
      return;
    }

    if (c.key === "ro") {
      tr.appendChild(el("td", { text: t.ro || "" }));
      return;
    }

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
        td.title = `By: ${by || "unknown"}${when ? " — " + when : ""}`;
        td.style.cursor = "help";
      }

      tr.appendChild(td);
      return;
    }

    if (c.key === "assignedTech" && role === "foreman") {
      const td = el("td");
      const select = document.createElement("select");

      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "--";
      select.appendChild(empty);

      const techList = ["Alex", "John", "Mike"];

      techList.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (t.assignedTech === name) opt.selected = true;
        select.appendChild(opt);
      });

      select.onchange = async () => {
        try {
          await updateDoc(doc(db, "ros", t.id), {
            assignedTech: select.value,
            updatedAt: serverTimestamp(),
          });
        } catch (e) {
          console.error(e);
        }
      };

      td.appendChild(select);
      tr.appendChild(td);
      return;
    }

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