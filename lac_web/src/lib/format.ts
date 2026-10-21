/** Price in cents, e.g. 0.42 → "42¢". */
export function cents(p: number | null): string {
  if (p === null) return '—';
  const c = Math.round(p * 100);
  if (c < 1) return '<1¢';
  if (c > 99) return '>99¢';
  return `${c}¢`;
}

/** Payout multiple for a winning share bought at `p`, e.g. 0.25 → "×4.0". */
export function multiplier(p: number | null): string {
  if (p === null || p <= 0) return '—';
  const m = 1 / p;
  return `×${m >= 10 ? String(Math.round(m)) : m.toFixed(1)}`;
}

/** Implied probability, e.g. 0.42 → "42%". */
export function chance(p: number | null): string {
  if (p === null) return '—';
  const c = Math.round(p * 100);
  if (c < 1) return '<1%';
  if (c > 99) return '>99%';
  return `${c}%`;
}

export function money(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

export function timeLeft(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function sinceUpdate(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

/** How far fair value sits above or below price, e.g. "+28.6%". */
export function edge(fair: number, price: number): string {
  const d = ((fair - price) / price) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

export function price(p: number): string {
  return p.toFixed(2);
}

export function count(n: number): string {
  return n.toLocaleString('en-US');
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
