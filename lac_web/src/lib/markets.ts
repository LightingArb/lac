import type { IconName } from '../components/ui/Icon';
import {
  CATEGORIES,
  EVENTS,
  PRODUCTS,
  SIGNALS,
  type CategoryId,
  type MarketEvent,
  type Outcome,
  type Product,
  type ProductId,
  type Side,
  type Signal,
} from '../data/catalog';

export type WorkspaceMode = 'prediction' | 'signal';
export type SignalCategoryId = 'trending' | ProductId;

export interface PricedSignal extends Signal {
  /** Market price of the signalled side. */
  entry: number;
  /** LAC fair value of the signalled side. */
  fair: number;
  /** Expected value per share: fair − entry. */
  ev: number;
}

export interface WorkspaceState {
  predictionCategory: CategoryId;
  signalCategory: SignalCategoryId;
  predictionEventId: string;
  signalEventId: string;
  /** Signal picked in the signal panel; highlighted in the event detail. */
  highlightId: string | null;
  query: string;
}

export const INITIAL_WORKSPACE: WorkspaceState = {
  predictionCategory: 'trending',
  signalCategory: 'trending',
  predictionEventId: 'fed',
  signalEventId: 'london',
  highlightId: null,
  query: '',
};

export interface CategoryItem {
  id: string;
  label: string;
  icon: IconName;
  count: number;
  active: boolean;
}

export interface Workspace {
  mode: WorkspaceMode;
  searching: boolean;
  categories: CategoryItem[];
  activeCategory: string;
  categoryLabel: string;
  events: MarketEvent[];
  emptyText: string;
  selected: MarketEvent | null;
  signals: PricedSignal[];
  visibleProducts: Product[];
  signalCountByEvent: Record<string, number>;
  signalByCell: Record<string, PricedSignal>;
  /** The picked signal, only when it belongs to the selected event. */
  highlight: PricedSignal | null;
}

export const EVENTS_BY_ID: Record<string, MarketEvent> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

export function findOutcome(event: MarketEvent, outcomeId: string): Outcome {
  return event.rows.find((r) => r.id === outcomeId) ?? event.rows[0];
}

/** LAC fair value of one side of an outcome. */
export function fairValue(outcome: Outcome, side: Side): number {
  const fairYes = outcome.fair ?? outcome.yes;
  return side === 'yes' ? fairYes : 1 - fairYes;
}

export function cellKey(eventId: string, outcomeId: string, side: Side): string {
  return `${eventId}/${outcomeId}/${side}`;
}

export function marketAnchorId(eventId: string, outcomeId: string): string {
  return `mk-${eventId}-${outcomeId}`;
}

export function priceSignals(plan: Record<ProductId, boolean>): PricedSignal[] {
  return SIGNALS.filter((s) => plan[s.product]).map((s) => {
    const outcome = findOutcome(EVENTS_BY_ID[s.eventId], s.outcomeId);
    const entry = s.side === 'yes' ? outcome.yes : outcome.no;
    const fair = fairValue(outcome, s.side);
    return { ...s, entry, fair, ev: fair - entry };
  });
}

/** Everything the Prediction and Signal pages show, derived from UI state. */
export function deriveWorkspace(
  mode: WorkspaceMode,
  state: WorkspaceState,
  plan: Record<ProductId, boolean>,
): Workspace {
  const query = state.query.trim().toLowerCase();
  const searching = query !== '';
  const matches = (e: MarketEvent) => e.title.toLowerCase().includes(query);

  const signals = priceSignals(plan);
  const signalCountByEvent: Record<string, number> = {};
  const signalByCell: Record<string, PricedSignal> = {};
  for (const s of signals) {
    signalCountByEvent[s.eventId] = (signalCountByEvent[s.eventId] ?? 0) + 1;
    signalByCell[cellKey(s.eventId, s.outcomeId, s.side)] = s;
  }
  const visibleProducts = PRODUCTS.filter((p) => plan[p.id] && signals.some((s) => s.product === p.id));
  const visibleIds = new Set<string>(visibleProducts.map((p) => p.id));
  const covered = EVENTS.filter((e) => e.lac && visibleIds.has(e.lac.product));

  const shared = { mode, searching, signals, visibleProducts, signalCountByEvent, signalByCell };

  if (mode === 'prediction') {
    const active = state.predictionCategory;
    const categories = CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      count: c.id === 'trending' ? EVENTS.filter((e) => e.trending).length : EVENTS.filter((e) => e.cat === c.id).length,
      active: !searching && active === c.id,
    }));
    const events = searching
      ? EVENTS.filter(matches)
      : EVENTS.filter((e) => (active === 'trending' ? e.trending : e.cat === active));
    return {
      ...shared,
      categories,
      activeCategory: active,
      categoryLabel: CATEGORIES.find((c) => c.id === active)?.label ?? 'Trending',
      events,
      emptyText: 'No events match this search.',
      selected: EVENTS_BY_ID[state.predictionEventId] ?? EVENTS[0],
      highlight: null,
    };
  }

  const active: SignalCategoryId =
    state.signalCategory === 'trending' || visibleIds.has(state.signalCategory) ? state.signalCategory : 'trending';
  const categories = [CATEGORIES[0], ...visibleProducts].map((c) => ({
    id: c.id,
    label: c.label,
    icon: c.icon,
    count:
      c.id === 'trending'
        ? covered.filter((e) => signalCountByEvent[e.id]).length
        : covered.filter((e) => e.lac?.product === c.id).length,
    active: !searching && active === c.id,
  }));
  const events = searching
    ? covered.filter(matches)
    : covered.filter((e) => (active === 'trending' ? signalCountByEvent[e.id] : e.lac?.product === active));

  const candidate = EVENTS_BY_ID[state.signalEventId];
  const selected =
    candidate?.lac && visibleIds.has(candidate.lac.product) ? candidate : (events[0] ?? covered[0] ?? null);
  const picked = signals.find((s) => s.id === state.highlightId) ?? null;

  return {
    ...shared,
    categories,
    activeCategory: active,
    categoryLabel: active === 'trending' ? 'Trending' : (visibleProducts.find((p) => p.id === active)?.label ?? ''),
    events,
    emptyText: visibleProducts.length ? 'No events match this search.' : 'No signal categories in this plan right now.',
    selected,
    highlight: picked && selected && picked.eventId === selected.id ? picked : null,
  };
}
