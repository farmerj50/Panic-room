// Optimal one-to-one assignment (Hungarian / Kuhn-Munkres), maximizing the
// total affinity. Pairs with affinity <= minAffinity are never matched.
// Sizes here are tiny (the detector returns at most 25 boxes), so O(n³) is fine.
export function assignMaxAffinity(affinity: number[][], minAffinity: number): Array<[number, number]> {
  const rows = affinity.length;
  const cols = rows ? affinity[0].length : 0;
  if (!rows || !cols) return [];
  const n = Math.max(rows, cols);
  const BIG = 1e6;
  // Square cost matrix (1-indexed for the classic potentials formulation).
  const cost: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < n; j += 1) {
      const a = i < rows && j < cols ? affinity[i][j] : 0;
      row.push(a > minAffinity ? 1 - a : BIG);
    }
    cost.push(row);
  }

  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const pairs: Array<[number, number]> = [];
  for (let j = 1; j <= n; j += 1) {
    const i = p[j] - 1;
    const c = j - 1;
    if (i < rows && c < cols && affinity[i][c] > minAffinity) pairs.push([i, c]);
  }
  return pairs;
}
