// public/js/ui/roles.js

export const TAB_DEFS_BY_ROLE = {
  wash: [
    { id: "active", label: "Active", statuses: ["queued", "washing"] },
    { id: "washed", label: "Washed", statuses: ["washed"] },
  ],
  default: [
    { id: "active", label: "Active", statuses: ["queued", "washing"] },
    { id: "washed", label: "Washed", statuses: ["washed"] },
    { id: "closed", label: "Closed", statuses: ["closed"] },

    // future tabs
    { id: "pickup", label: "Pickup", statuses: null },
    { id: "slots", label: "Swap/Slots", statuses: null },
    { id: "history", label: "History", statuses: null }
  ]
};

export function tabDefsForRole(role) {
  return TAB_DEFS_BY_ROLE[role] || TAB_DEFS_BY_ROLE.default;
}

export const ROLE_CAPS = {
  dropoff: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },
  staff: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },

  booker: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },
  qc: { canNeedBy: false, canRewash: false, canWashOps: false, canArchive: false, canEditRO: false },

  wash: { canNeedBy: false, canRewash: false, canWashOps: true, canArchive: false, canEditRO: false },

  advisor: { canNeedBy: true, canRewash: true, canWashOps: false, canArchive: false, canEditRO: true },

  manager: { canNeedBy: true, canRewash: true, canWashOps: true, canArchive: true, canEditRO: true },
  admin: { canNeedBy: true, canRewash: true, canWashOps: true, canArchive: true, canEditRO: true }
};

export function capsFor(role) {
  return ROLE_CAPS[role] || ROLE_CAPS.staff;
}
