import { useEffect, useState } from 'react';

export type DataMode = 'demo' | 'live';
export interface LiveCategory { id: string; label: string; count: number }
export interface LiveEvent {
  event_id: string; slug: string; title: string; image_url: string | null;
  volume_24h: string | null; volume_total: string | null; liquidity: string | null;
  end_at: string | null; observed_at: string;
  description?: string | null; resolution_source?: string | null;
  preview?: { market_id: string; group_title: string | null; question: string; label: string; midpoint: string | null; best_ask: string | null }[];
}
export interface LiveOutcome {
  market_id: string; question: string; group_title: string | null; description: string | null;
  resolution_source: string | null; end_at: string | null; accepting_orders: boolean | null;
  enable_order_book: boolean | null; outcome_index: number; label: string; asset_id: string | null;
  best_bid: string | null; best_ask: string | null; midpoint: string | null;
  last_trade_price: string | null; quote_observed_at: string | null; mid_observed_at: string | null;
}
export interface History {
  coverage: { status: 'success' | 'error'; point_count: number | null; requested_start: string; requested_end: string; checked_at: string } | null;
  points: { minute_at: string; source_at: string; price: string; resolution_seconds: number }[];
}
export function useLive<T>(url: string | null, refresh = 0) {
  const [value, setValue] = useState<{ url: string; data: T | null; error: string | null }>({ url: '', data: null, error: null });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Live request failed');
        if (!controller.signal.aborted) setValue({ url, data: body, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setValue({ url, data: null, error: error instanceof Error ? error.message : 'Live request failed' });
      }
    };
    void read();
    const timer = refresh ? window.setInterval(() => { if (!document.hidden) void read(); }, refresh) : null;
    return () => { controller.abort(); if (timer !== null) window.clearInterval(timer); };
  }, [url, refresh]);
  return value.url === url ? { data: value.data, error: value.error } : { data: null, error: null };
}
export const percent = (value: string | null) => value === null ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
export const cents = (value: string | null) => value === null ? 'Unavailable' : `${(Number(value) * 100).toFixed(1)}¢`;
export const amount = (value: string | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(Number(value));
export const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZoneName: 'short' }) : '—';
