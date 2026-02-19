// public/js/ui/sort.js

function hasNeedBy(t) {
  return typeof t?.needByAtMs === "number" && t.needByAtMs > 0;
}

function isRewash(t) {
  return String(t?.priorityType || "").toLowerCase() === "rewash";
}

/**
 * Active queue sort:
 * 1) Any ticket with a real NeedBy time goes first (soonest NeedBy first)
 * 2) Then rewashes (no NeedBy) (older first)
 * 3) Then everyone else by arrival at wash (createdAtMs)
 *
 * IMPORTANT: Waiters are NOT forced ahead of NeedBy anymore.
 * This matches your rule: NeedBy is king, arrival order matters.
 */
export function sortActiveQueue(a, b) {
  const aNeed = hasNeedBy(a);
  const bNeed = hasNeedBy(b);

  if (aNeed !== bNeed) return aNeed ? -1 : 1;

  if (aNeed && bNeed) {
    // both have NeedBy => earliest deadline first
    return (a.needByAtMs || 0) - (b.needByAtMs || 0);
  }

  const aRe = isRewash(a);
  const bRe = isRewash(b);
  if (aRe !== bRe) return aRe ? -1 : 1;

  const ac = typeof a?.createdAtMs === "number" ? a.createdAtMs : 0;
  const bc = typeof b?.createdAtMs === "number" ? b.createdAtMs : 0;
  return ac - bc;
}
