/**
 * Uniform grid for 2D neighbor queries. Cell size should be >= max search radius
 * so that all pairs within `maxDist` are found using a 3×3 cell neighborhood.
 */

export function forEachNeighborPairWithinDistance(
  xs: Float32Array | number[],
  ys: Float32Array | number[],
  count: number,
  maxDist: number,
  callback: (i: number, j: number, dist: number) => void
): void {
  if (count <= 1 || maxDist <= 0) return;

  const cell = maxDist;
  const grid = new Map<string, number[]>();

  for (let i = 0; i < count; i++) {
    const cx = Math.floor(xs[i] / cell);
    const cy = Math.floor(ys[i] / cell);
    const key = `${cx},${cy}`;
    let arr = grid.get(key);
    if (!arr) {
      arr = [];
      grid.set(key, arr);
    }
    arr.push(i);
  }

  const maxD2 = maxDist * maxDist;

  for (let i = 0; i < count; i++) {
    const px = xs[i];
    const py = ys[i];
    const cx = Math.floor(px / cell);
    const cy = Math.floor(py / cell);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(`${cx + ox},${cy + oy}`);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const j = bucket[k];
          if (j <= i) continue;
          const dx = px - xs[j];
          const dy = py - ys[j];
          const d2 = dx * dx + dy * dy;
          if (d2 < maxD2 && d2 > 0) {
            callback(i, j, Math.sqrt(d2));
          }
        }
      }
    }
  }
}
