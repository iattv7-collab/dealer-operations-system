// public/js/ui/columnCatalog.js
// Column Catalog = single source of truth for what columns exist,
// how they render, and which roles are allowed to edit them.
//
// NOTE: "visible" is controlled by manager/user prefs.
// NOTE: "editable" is ultimately enforced by role safety rules below.


// Roles in your system (adjust if needed)
export const VIEW_KEYS = ["wash", "staff", "advisor", "manager", "admin", "valet", "dropoff", "booker", "qc"];

export const ROLES = ["wash", "staff", "advisor", "manager", "admin", "valet", "dropoff", "booker", "qc"];

/**
 * Column definition format:
 * key: unique id used everywhere
 * label: header text
 * field: ticket field name (if direct field)
 * type: rendering hint (text, time, badge, etc.)
 * editRoles: which roles can edit this column's underlying field (safety rail)
 */
export const COLUMN_CATALOG = {
  tag: {
    key: "tag",
    label: "Tag",
    field: "tag",
    type: "text",
    editRoles: ["advisor", "manager", "admin"], // keep strict
  },

  ro: {
    key: "ro",
    label: "RO",
    field: "ro",
    type: "text",
    editRoles: ["advisor", "manager", "admin"],
  },

  stock: {
    key: "stock",
    label: "Stock",
    field: "stock",
    type: "text",
    editRoles: ["advisor", "manager", "admin"],
  },

  location: {
    key: "location",
    label: "Location",
    field: "location",
    type: "text",
    editRoles: ["wash", "staff", "valet", "advisor", "manager", "admin"],
  },

  status: {
    key: "status",
    label: "Status",
    field: "status",
    type: "badge",
    editRoles: ["wash", "staff", "manager", "admin"], // advisors/valet read-only
  },

  advisor: {
    key: "advisor",
    label: "Advisor",
    // We will store both advisorId + advisorName later; display uses advisorName
    field: "advisorName",
    type: "text",
    editRoles: ["manager", "admin"],
  },

  needBy: {
    key: "needBy",
    label: "Need By",
    // you likely have needByAtMs + needBy (string). Display can use needBy.
    field: "needBy",
    type: "time",
    editRoles: ["advisor", "manager", "admin"],
  },

  eta: {
    key: "eta",
    label: "ETA",
    field: "scheduledEndAtMs",
    type: "time",
    editRoles: [], // system-only
  },

  priority: {
    key: "priority",
    label: "Priority",
    field: "priorityType",
    type: "text",
    editRoles: ["manager", "admin"],
  },

  notes: {
    key: "notes",
    label: "Notes",
    field: "notes",
    type: "text",
    editRoles: ["wash", "staff", "advisor", "manager", "admin"], // valet optional later
  },

  created: {
    key: "created",
    label: "Created",
    field: "createdAtMs",
    type: "time",
    editRoles: [], // system-only
  },

  // ✅ ADDED (you referenced updatedAt in defaults but it did not exist)
  updatedAt: {
    key: "updatedAt",
    label: "Last Update",
    field: "updatedAt",
    type: "time",
    editRoles: [],
  },

  washed: {
    key: "washed",
    label: "Washed",
    field: "washedAtMs",
    type: "time",
    editRoles: [], // system-only
  },

  cycleType: {
    key: "cycleType",
    label: "Type",
    field: "cycleType",
    type: "text",
    editRoles: ["manager", "admin"],
  },

  needByRisk: {
    key: "needByRisk",
    label: "Need By Risk",
    field: "needByRisk",
    type: "text",
    editRoles: [], // system-only (computed)
  },

  bay: {
    key: "bay",
    label: "Bay",
    field: "bay",
    type: "text",
    editRoles: ["wash", "staff", "manager", "admin"],
  },

  cpBooked: {
    key: "cpBooked",
    label: "CP Booked",
    field: "cpBooked",
    type: "badge",
    editRoles: ["booker", "manager", "admin"],
  },

  wtyBooked: {
    key: "wtyBooked",
    label: "WTY Booked",
    field: "wtyBooked",
    type: "badge",
    editRoles: ["booker", "manager", "admin"],
  },

  qcDone: {
    key: "qcDone",
    label: "QC Done",
    field: "qcDoneAt",
    type: "badge",
    editRoles: ["qc", "manager", "admin"],
  },

  // ✅ Your actual Actions key is _actions (not "actions")
  _actions: {
    key: "_actions",
    label: "Actions",
    field: null,
    type: "actions",
    editRoles: [], // buttons are handled elsewhere
  },

  // Add more columns later safely without touching views.
};

// Role default columns per VIEW (your base “A B C” per role-view)
export const DEFAULT_COLUMNS_BY_VIEW = {
  admin: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "bay",
    "priority", // ✅ moved near Bay/Notes
    "notes",
    "washed",   // ✅ moved early so it's not stuck far right
    "updatedAt",
    "_actions",
  ],

  manager: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "bay",
    "priority",
    "notes",
    "washed",
    "updatedAt",
    "_actions",
  ],

  advisor: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "bay",
    "priority",
    "notes",
    "washed",
    "_actions",
  ],

  wash: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "bay",
    "priority",
    "notes",
    "washed",
    "_actions",
  ],

  staff: [
    "tag",
    "ro",
    "advisor",
    "status",
    "location",
    "bay",
    "priority",
    "notes",
    "washed",
    "_actions",
  ],

  valet: [
    "tag",
    "ro",
    "advisor",
    "status",
    "location",
    "bay",
    "priority",
    "notes",
    "washed",
    "_actions",
  ],

    booker: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "priority",

    "cpBooked",
    "wtyBooked",
    "qcDone",

    "notes",
    "washed",
    "updatedAt",
    "_actions",
  ],

  qc: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "priority",

    "qcDone",

    "notes",
    "updatedAt",
    "_actions",
  ],
};

// Helpers
export function allColumnKeys() {
  return Object.keys(COLUMN_CATALOG);
}

export function getColumnDef(key) {
  return COLUMN_CATALOG[key] || null;
}

export function roleCanEditColumn(role, colKey) {
  const def = getColumnDef(colKey);
  if (!def) return false;
  return (def.editRoles || []).includes(role);
}