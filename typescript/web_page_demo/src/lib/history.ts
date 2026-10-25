/** Null buckets break the path; no price is invented across a missing minute/day. */
export function historyPath(points: (number | null)[], times: number[], start: number, end: number): string {
  return points.map((price, i) => {
    if (price === null) return '';
    const xy = `${((times[i] - start) / Math.max(1, end - start)) * 100},${(1 - price) * 100}`;
    return i === 0 || points[i - 1] === null ? `M${xy} L${xy}` : `L${xy}`;
  }).join(' ');
}
