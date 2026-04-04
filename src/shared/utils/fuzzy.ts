export function fuzzyScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return 1;
  if (t.length === 0) return 0;
  if (q === t) return 1;

  const index = t.indexOf(q);
  if (index !== -1) {
    // Earlier matches score slightly higher; cap so exact stays on top.
    const positionPenalty = index / t.length;
    return 0.9 - positionPenalty * 0.1;
  }

  return subsequenceScore(q, t);
}

export function fuzzyMatch(query: string, target: string, threshold = 0.3): boolean {
  return fuzzyScore(query, target) >= threshold;
}

function subsequenceScore(query: string, target: string): number {
  let qi = 0;
  let matched = 0;
  let contiguous = 0;
  let bestRun = 0;
  let lastIndex = -1;

  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target[ti] === query[qi]) {
      matched += 1;
      if (ti === lastIndex + 1) {
        contiguous += 1;
        bestRun = Math.max(bestRun, contiguous);
      } else {
        contiguous = 1;
        bestRun = Math.max(bestRun, contiguous);
      }
      lastIndex = ti;
      qi += 1;
    }
  }

  if (matched < query.length) return 0;
  const completeness = matched / query.length;
  const contiguity = bestRun / query.length;
  // Keep subsequence scores strictly below substring matches (<0.8).
  return Math.min(0.79, 0.4 * completeness + 0.39 * contiguity);
}
