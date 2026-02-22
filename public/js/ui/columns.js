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
 * - system defaults
 * - manager/user assigned columns (extraKeys)
 */
export function colsForView(viewKey, extraKeys = []) {

  const normalizedView = String(viewKey || "staff").toLowerCase();

  // Default columns for that role/view
  const base = DEFAULT_COLUMNS_BY_VIEW[normalizedView] || [];

  // Merge defaults + extra keys (no duplicates)
  const merged = [
    ...new Set([
      ...(base || []),
      ...(extraKeys || [])
    ])
  ];

  /**
   * HARD BLOCK RULE
   * Only manager and admin can see "Last Update" column
   * Even if extraKeys tries to add it
   */
  const blocked = new Set();

  if (normalizedView !== "manager" && normalizedView !== "admin") {
    blocked.add("updatedAt");
  }

  const finalKeys = merged.filter(k => !blocked.has(k));

  return buildColumnsFromKeys(finalKeys);
}

/**
 * Compatibility wrapper used by ticketsUI.js
 * This is now fully functional with dynamic columns
 */
export function colsForRole(role, extraKeys = []) {

  const normalizedRole = String(role || "staff").toLowerCase();

  return colsForView(normalizedRole, extraKeys);
}