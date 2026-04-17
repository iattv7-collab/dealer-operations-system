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
    editRoles: [],
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
    key: "advisorNumber",
    label: "Advisor",
    // We will store both advisorId + advisorName later; display uses advisorNumber for now.
    field: "advisorNumber",
    type: "text",
    editRoles: ["manager", "admin", "valet"], // valet can assign advisor on dropoff
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

  // 🔥 SPLIT ACTION COLUMNS

  requestRewash: {
    key: "requestRewash",
    label: "Rewash",
    field: null,
    type: "action",
    editRoles: [],
  },

  pickupRequestAction: {
    key: "pickupRequestAction",
    label: "Pickup",
    field: null,
    type: "action",
    editRoles: [],
  },

  pickupClaimAction: {
    key: "pickupClaimAction",
    label: "Claim",
    field: null,
    type: "action",
    editRoles: [],
  },

  setNeedByAction: {
    key: "setNeedByAction",
    label: "Need By",
    field: null,
    type: "action",
    editRoles: [],
  },

  startWash: {
    key: "startWash",
    label: "Start",
    field: null,
    type: "action",
    editRoles: [],
  },

  markComplete: {
    key: "markComplete",
    label: "Done",
    field: null,
    type: "action",
    editRoles: [],
  },

  cpBookedAction: {
    key: "cpBookedAction",
    label: "CP",
    field: null,
    type: "action",
    editRoles: [],
  },

  wtyBookedAction: {
    key: "wtyBookedAction",
    label: "WTY",
    field: null,
    type: "action",
    editRoles: [],
  },

  requestQc: {
    key: "requestQc",
    label: "QC Req",
    field: null,
    type: "action",
    editRoles: [],
  },

  noQc: {
    key: "noQc",
    label: "No QC",
    field: null,
    type: "action",
    editRoles: [],
  },

  qcDoneAction: {
    key: "qcDoneAction",
    label: "QC Done",
    field: null,
    type: "action",
    editRoles: [],
  },

  archiveAction: {
    key: "archiveAction",
    label: "Archive",
    field: null,
    type: "action",
    editRoles: [],
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
    "priority",
    "notes",
    "washed",
    "updatedAt",
    "requestRewash",
    "pickupRequestAction",
    "setNeedByAction",
    "startWash",
    "markComplete",
    "cpBookedAction",
    "wtyBookedAction",
    "requestQc",
    "noQc",
    "qcDoneAction",
    "archiveAction",
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
    "requestRewash",
    "pickupRequestAction",
    "setNeedByAction",
    "startWash",
    "markComplete",
    "cpBookedAction",
    "wtyBookedAction",
    "requestQc",
    "noQc",
    "qcDoneAction",
    "archiveAction",
  ],

  advisor: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "notes",
    "priority",
    "washed",
    "pickupRequestAction",
    "requestRewash",
    "cpBookedAction",
    "requestQc",
    "noQc",
  ],

  wash: [
    "tag",
    "ro",
    "advisor",
    "needBy",
    "location",
    "notes",
    "priority",
    "startWash",
    "markComplete",
    "requestRewash",
    "pickupRequestAction",
  ],

  staff: [
    "tag",
    "ro",
    "location",
    "notes",
    "priority",
  ],

  valet: [
    "tag",
    "ro",
    "location",
    "notes",
    "pickupClaimAction",
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
    "cpBookedAction",
    "wtyBookedAction",
    "requestQc",
    "noQc",
  ],

  qc: [
    "tag",
    "ro",
    "advisor",
    "status",
    "needBy",
    "location",
    "notes",
    "qcDone",
    "qcDoneAction",
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