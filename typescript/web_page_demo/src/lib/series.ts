// Deterministic placeholder price history so charts look real until history comes from the API.

const POINTS = 96;
const cache = new Map<string, number[]>();

function seededRandom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 96 prices (0–1) that wander toward and end at `end`. Stable per `key`. */
export function priceSeries(key: string, end: number): number[] {
  const cached = cache.get(key);
  if (cached) return cached;

  const random = seededRandom(key);
  const points: number[] = [];
  let v = Math.min(0.92, Math.max(0.04, end + (random() - 0.5) * 0.5));
  for (let i = 0; i < POINTS; i++) {
    const t = i / (POINTS - 1);
    v += (end - v) * (0.02 + 0.1 * t) + (random() - 0.5) * 0.06 * (1 - 0.6 * t);
    if (random() < 0.03) v += (random() - 0.5) * 0.18 * (1 - t);
    v = Math.min(0.99, Math.max(0.01, v));
    points.push(v);
  }
  points[POINTS - 1] = end;
  cache.set(key, points);
  return points;
}
