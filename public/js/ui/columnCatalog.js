// public/js/ui/columnCatalog.js
// Column Catalog = single source of truth for what columns exist,
// how they render, and which roles are allowed to edit them.
//
// NOTE: "visible" is controlled by manager/user prefs.
// NOTE: "editable" is ultimately enforced by role safety rules below.

export const VIEW_KEYS = ["wash", "staff", "advisor", "manager", "admin", "valet", "dropoff", "booker", "qc", "valet"];

// Roles in your system (adjust if needed)
export const ROLES = ["wash", "staff", "advisor", "manager", "admin", "valet", "dropoff", "booker", "qc", "valet"];

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
  advisor: ["tag", "ro", "advisor", "needBy", "status", "eta", "notes"],
  wash: ["tag", "status", "location", "priority", "eta"],
  manager: ["tag", "ro", "advisor", "priority", "needBy", "status", "location", "eta", "notes"],
  booker: ["tag", "ro", "advisor", "status", "cpBooked", "wtyBooked", "eta", "notes"],
  qc: ["tag", "status", "washed", "qcDone", "eta", "notes"],
  dropoff: ["tag", "ro", "advisor", "location", "priority", "needBy", "status", "notes", "created"],
  admin: ["tag", "ro", "advisor", "priority", "needBy", "status", "location", "eta", "notes"],
  staff: ["tag", "status", "location", "priority", "eta"],
  valet: ["tag", "status", "location", "priority", "eta"],
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