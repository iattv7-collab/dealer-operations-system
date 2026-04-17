// public/js/ui/columns.js
import { DEFAULT_COLUMNS_BY_VIEW, getColumnDef } from "./columnCatalog.js";

/**
 * Build column defs from keys
 * Filters out unknown keys safely
 */
export function buildColumnsFromKeys(keys) {
  const out = [];

  (keys || []).forEach((k) => {
    const def = getColumnDef(k);
    if (def) {
      out.push({
        key: def.key,
        label: def.label
      });
    }
  });

  return out;
}

/**
 * Core function:
 * Builds columns for a view using:
 * - saved admin/user-selected columns IF they exist
 * - otherwise falls back to system defaults
 */
export function colsForView(viewKey, extraKeys = []) {
  const normalizedView = String(viewKey || "staff").toLowerCase();

  const defaults = DEFAULT_COLUMNS_BY_VIEW[normalizedView] || [];
  const saved = Array.isArray(extraKeys) ? extraKeys.filter(Boolean) : [];

  // NEW BEHAVIOR:
  // If admin/user has saved at least one column, that saved list is the source of truth.
  // Otherwise use the default preset.
  const chosenKeys = saved.length > 0 ? saved : defaults;

  /**
   * HARD BLOCK RULE
   * Only manager and admin can see "Last Update" column
   * Even if saved config tries to add it
   */
  const blocked = new Set();

  if (normalizedView !== "manager" && normalizedView !== "admin") {
    blocked.add("updatedAt");
  }

  const finalKeys = [...new Set(chosenKeys)].filter((k) => !blocked.has(k));

  return buildColumnsFromKeys(finalKeys);
}

/**
 * Compatibility wrapper used by ticketsUI.js
 */
export function colsForRole(role, extraKeys = []) {
  const normalizedRole = String(role || "staff").toLowerCase();
  return colsForView(normalizedRole, extraKeys);
}