import { useEffect, useState } from 'react';
import { CATEGORIES, type EventCategoryId, type MarketEvent, type Outcome } from '../data/catalog';
import { useT } from '../i18n';
import type { Workspace } from './markets';

export type DataMode = 'demo' | 'live';
export interface LiveCategory {
  id: string;
  label: string;
  count: number;
}
export interface LiveEvent {
  event_id: string;
  slug: string;
  title: string;
  image_url: string | null;
  volume_24h: string | null;
  volume_total: string | null;
  liquidity: string | null;
  start_at: string | null;
  end_at: string | null;
  observed_at: string;
  tags: { slug: string; label: string }[];
  market_count: number;
  description?: string | null;
  resolution_source?: string | null;
  preview?: LiveOutcome[];
}
export interface LiveOutcome {
  liquidity: string | null;
  volume_total: string | null;
  market_id: string;
  question: string;
  group_title: string | null;
  description: string | null;
  resolution_source: string | null;
  end_at: string | null;
  accepting_orders: boolean | null;
  enable_order_book: boolean | null;
  outcome_index: number;
  label: string;
  asset_id: string | null;
  best_bid: string | null;
  best_ask: string | null;
  midpoint: string | null;
  last_trade_price: string | null;
  quote_observed_at: string | null;
  mid_observed_at: string | null;
}
export interface History {
  coverage: {
    status: 'success' | 'error';
    point_count: number | null;
    requested_start: string;
    requested_end: string;
    checked_at: string;
  } | null;
  points: { minute_at: string; source_at: string; price: string; resolution_seconds: number }[];
}
export function useLive<T>(url: string | null, refresh = 0) {
  const t = useT();
  const [value, setValue] = useState<{ url: string; data: T | null; error: string | null }>({
    url: '',
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    if (import.meta.env.MODE === 'static') {
      // The single-file build has no server behind it, so there is no live database to read.
      setValue({ url, data: null, error: t.app.liveNeedsServer });
      return;
    }
    const controller = new AbortController();
    let running = false;
    const read = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? t.app.liveFailed);
        if (!controller.signal.aborted) setValue({ url, data: body, error: null });
      } catch (error) {
        if (!controller.signal.aborted)
          setValue({ url, data: null, error: error instanceof Error ? error.message : t.app.liveFailed });
      } finally {
        running = false;
      }
    };
    void read();
    const timer = refresh
      ? window.setInterval(() => {
          if (!document.hidden) void read();
        }, refresh)
      : null;
    return () => {
      controller.abort();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [url, refresh, t]);
  return value.url === url ? { data: value.data, error: value.error } : { data: null, error: null };
}
const number = (value: string | null | undefined) => (value == null ? null : Number(value));
const date = (value: string | null, options: Intl.DateTimeFormatOptions, locale: string) =>
  value ? new Date(value).toLocaleString(locale, { ...options, timeZone: 'UTC' }) : '—';

/** Published fields mapped into the same presentation model as Demo. */
export function liveEvent(
  event: LiveEvent,
  outcomes = event.preview ?? [],
  marketCount = event.market_count,
  locale = 'en-US',
): MarketEvent {
  const grouped = new Map<string, LiveOutcome[]>();
  for (const item of outcomes) {
    const group = grouped.get(item.market_id) ?? [];
    group.push(item);
    grouped.set(item.market_id, group);
  }
  const rows: Outcome[] = [...grouped.values()].map((group) => {
    const ordered = [...group].sort((a, b) => a.outcome_index - b.outcome_index);
    const yes = ordered.find((item) => /^(yes|up)$/i.test(item.label)) ?? ordered[0];
    const no = ordered.find((item) => /^(no|down)$/i.test(item.label)) ?? ordered.find((item) => item !== yes);
    return {
      id: yes.market_id,
      label: yes.group_title || yes.question,
      yes: number(yes.midpoint),
      no: number(no?.midpoint),
      yesAsk: number(yes.best_ask),
      noAsk: number(no?.best_ask),
      yesAsset: yes.asset_id,
      noAsset: no?.asset_id ?? null,
      yesLabel: yes.label,
      noLabel: no?.label ?? '—',
      vol: number(yes.volume_total),
      liquidity: number(yes.liquidity),
    };
  });
  const category = CATEGORIES.find((item) => item.id !== 'trending' && event.tags.some((tag) => tag.slug === item.id));
  return {
    id: event.event_id,
    cat: (category?.id as EventCategoryId) ?? null,
    source: 'live',
    trending: false,
    title: event.title,
    abbr: event.title.slice(0, 3).toUpperCase(),
    imageUrl: event.image_url,
    tags: event.tags.map((tag) => tag.label),
    marketCount,
    observedAt: event.observed_at,
    open: date(event.start_at, { month: 'short', day: 'numeric' }, locale),
    start: date(event.start_at, { dateStyle: 'medium', timeStyle: 'short' }, locale) + (event.start_at ? ' UTC' : ''),
    end: date(event.end_at, { dateStyle: 'medium', timeStyle: 'short' }, locale) + (event.end_at ? ' UTC' : ''),
    endDate: date(event.end_at, { month: 'short', day: 'numeric' }, locale),
    endTime: date(event.end_at, { hour: 'numeric', minute: '2-digit' }, locale),
    vol24: number(event.volume_24h),
    volTotal: number(event.volume_total),
    kind: marketCount === 1 ? 'binary' : 'multi',
    yesLabel: rows[0]?.yesLabel,
    noLabel: rows[0]?.noLabel,
    rows,
    lac: null,
  };
}

interface Detail {
  event: LiveEvent;
  outcomes: LiveOutcome[];
  marketCount: number;
  nextMarket: { market_id: string; sort_order: number } | null;
}
interface PageState {
  scope: string;
  cursors: (string | null)[];
  selected: string | null;
  marketCursors: string[];
}

export function useLiveWorkspace(enabled: boolean, category: string, search: string) {
  const t = useT();
  const scope = `${enabled}:${category}:${search}`;
  const initial: PageState = { scope, cursors: [null], selected: null, marketCursors: [''] };
  const [stored, setStored] = useState<PageState>(initial);
  const state = stored.scope === scope ? stored : initial;
  const patch = (value: Partial<PageState>) => setStored({ ...state, ...value });
  const categories = useLive<{ categories: LiveCategory[] }>(enabled ? '/api/live/categories' : null, 600000);
  const cursor = state.cursors.at(-1);
  const list = useLive<{ events: LiveEvent[]; next: string | null }>(
    enabled
      ? `/api/live/events?tag=${encodeURIComponent(category)}&q=${encodeURIComponent(search)}${cursor ? `&cursor=${cursor}` : ''}`
      : null,
    30000,
  );
  const selectedId = state.selected ?? list.data?.events[0]?.event_id;
  const detail = useLive<Detail>(
    enabled && selectedId ? `/api/live/event?id=${selectedId}${state.marketCursors.at(-1)}` : null,
    30000,
  );
  const workspace: Workspace | null = enabled
    ? {
        mode: 'prediction',
        searching: !!search,
        activeCategory: category,
        categories:
          categories.data?.categories.map((item) => ({
            ...item,
            label: t.categories[item.id as keyof typeof t.categories] ?? item.label,
            icon: CATEGORIES.find((c) => c.id === item.id)!.icon,
            active: item.id === category,
          })) ?? [],
        categoryLabel: t.categories[category as keyof typeof t.categories] ?? '',
        events: list.data?.events.map((event) => liveEvent(event, undefined, undefined, t.locale)) ?? [],
        selected: detail.data
          ? liveEvent(detail.data.event, detail.data.outcomes, detail.data.marketCount, t.locale)
          : null,
        emptyText: list.error ?? (list.data ? t.markets.noMatch : t.markets.loadingLive),
        signals: [],
        visibleProducts: [],
        signalCountByEvent: {},
        signalByCell: {},
        highlight: null,
      }
    : null;
  return {
    workspace,
    error: list.error ?? detail.error ?? categories.error,
    pick: (event: MarketEvent) => patch({ selected: event.id, marketCursors: [''] }),
    page: state.cursors.length,
    hasNext: !!list.data?.next,
    next: () => {
      if (list.data?.next) patch({ cursors: [...state.cursors, list.data.next], selected: null, marketCursors: [''] });
    },
    previous: () => patch({ cursors: state.cursors.slice(0, -1), selected: null, marketCursors: [''] }),
    marketPage: state.marketCursors.length,
    marketCount: detail.data?.marketCount ?? 0,
    hasNextMarket: !!detail.data?.nextMarket,
    nextMarket: () => {
      const next = detail.data?.nextMarket;
      if (next)
        patch({
          marketCursors: [...state.marketCursors, `&after_id=${next.market_id}&after_order=${next.sort_order}`],
        });
    },
    previousMarket: () => patch({ marketCursors: state.marketCursors.slice(0, -1) }),
  };
}
