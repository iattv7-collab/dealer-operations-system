// public/js/ui/columns.js

const MASTER_COLS = [
  { key: "tag", label: "Tag" },
  { key: "ro", label: "RO" },
  { key: "priority", label: "Priority" },
  { key: "cycleType", label: "Type" },
  { key: "needBy", label: "need By" },
  { key: "needByRisk", label: "Need By Risk" }, // ✅ NEW
  { key: "eta", label: "ETA (Finish)" },
  { key: "bay", label: "Bay" },
  { key: "location", label: "Location" },
  { key: "status", label: "Status" },
  { key: "created", label: "Created" },
  { key: "washed", label: "Last Washed" },
  { key: "cpBooked", label: "CP Booked" },
  { key: "wtyBooked", label: "WTY Booked" },
  { key: "qcDone", label: "QC Done" },
  { key: "notes", label: "Notes" },
  { key: "_actions", label: "Actions" },

];

const VISIBLE_COLS_BY_ROLE = {
  dropoff: ["tag", "ro", "priority", "eta", "location", "status", "created", "notes", "_actions"],
  staff: ["tag", "ro", "priority", "eta", "location", "status", "created", "notes", "_actions"],

  wash: ["tag", "ro", "priority", "cycleType", "needBy", "needByRisk", "eta", "bay", "location", "status", "created", "washed", "notes", "_actions"],

  advisor: ["tag", "ro", "priority", "needBy", "needByRisk", "eta", "bay", "location", "status", "created", "washed", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],

  booker: ["tag", "ro", "status", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],
  qc: ["tag", "ro", "location", "status", "qcDone", "notes", "_actions"],

  manager: ["tag", "ro", "priority", "needBy", "needByRisk", "eta", "bay", "location", "status", "created", "washed", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],
  admin: ["tag", "ro", "priority", "needBy", "needByRisk", "eta", "bay", "location", "status", "created", "washed", "cpBooked", "wtyBooked", "qcDone", "notes", "_actions"],
};

export function colsForRole(role) {
  const keys = VISIBLE_COLS_BY_ROLE[role] || VISIBLE_COLS_BY_ROLE.staff;
  return MASTER_COLS.filter(c => keys.includes(c.key));
}
