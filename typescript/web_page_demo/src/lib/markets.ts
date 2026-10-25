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
import { DEMO_ACCOUNT } from '../data/terminal';
import type { Messages } from '../i18n/en';

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
  /** Signal or terminal position picked on the right; highlighted in the event detail. */
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
  /** 1: listed under the item above it (a league under its sport). */
  depth?: number;
}

/** One Yes or No button of one outcome, marked yellow in the event detail. */
export interface Highlight {
  id: string;
  eventId: string;
  outcomeId: string;
  side: Side;
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
  /** The picked signal or position, only when it belongs to the selected event. */
  highlight: Highlight | null;
}

export const EVENTS_BY_ID: Record<string, MarketEvent> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

export function findOutcome(event: MarketEvent, outcomeId: string): Outcome {
  return event.rows.find((r) => r.id === outcomeId) ?? event.rows[0];
}

/** LAC fair value of one side of an outcome. */
export function fairValue(outcome: Outcome, side: Side): number {
  const fairYes = outcome.fair ?? outcome.yes!;
  return side === 'yes' ? fairYes : 1 - fairYes;
}

/** Button text of a side: Yes/No on multi-outcome events, the event's own names (Up, Lakers…) on binary ones. */
export function sideLabel(event: MarketEvent, side: Side): string {
  const multi = event.kind === 'multi';
  if (side === 'yes') return multi ? 'Yes' : (event.yesLabel ?? 'Yes');
  return multi ? 'No' : (event.noLabel ?? 'No');
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
    const entry = (s.side === 'yes' ? outcome.yes : outcome.no)!;
    const fair = fairValue(outcome, s.side);
    return { ...s, entry, fair, ev: fair - entry };
  });
}

/** Everything the Prediction and Signal pages show, derived from UI state. */
export function deriveWorkspace(
  mode: WorkspaceMode,
  state: WorkspaceState,
  plan: Record<ProductId, boolean>,
  t: Messages,
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
      label: t.categories[c.id],
      icon: c.icon,
      count:
        c.id === 'trending' ? EVENTS.filter((e) => e.trending).length : EVENTS.filter((e) => e.cat === c.id).length,
      active: !searching && active === c.id,
    }));
    const events = searching
      ? EVENTS.filter(matches)
      : EVENTS.filter((e) => (active === 'trending' ? e.trending : e.cat === active));
    const selected = EVENTS_BY_ID[state.predictionEventId] ?? EVENTS[0];
    // Prediction has no signals; only a terminal position opened from Signal is marked here.
    const position = DEMO_ACCOUNT.positions.find((p) => p.id === state.highlightId) ?? null;
    return {
      ...shared,
      categories,
      activeCategory: active,
      categoryLabel: t.categories[active],
      events,
      emptyText: t.markets.noMatch,
      selected,
      highlight: position && position.eventId === selected.id ? position : null,
    };
  }

  const active: SignalCategoryId =
    state.signalCategory === 'trending' || visibleIds.has(state.signalCategory) ? state.signalCategory : 'trending';
  const categories = [CATEGORIES[0], ...visibleProducts].map((c) => ({
    id: c.id,
    label: c.id === 'trending' ? t.categories.trending : t.products[c.id as ProductId],
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
  const picked: Highlight | null =
    signals.find((s) => s.id === state.highlightId) ??
    DEMO_ACCOUNT.positions.find((p) => p.id === state.highlightId) ??
    null;

  return {
    ...shared,
    categories,
    activeCategory: active,
    categoryLabel: active === 'trending' ? t.categories.trending : t.products[active],
    events,
    emptyText: visibleProducts.length ? t.markets.noMatch : t.markets.noPlan,
    selected,
    highlight: picked && selected && picked.eventId === selected.id ? picked : null,
  };
}

/** Signal lists an event when LAC covers it and its product has signals in the customer's plan right now. */
export function signalCovers(eventId: string, plan: Record<ProductId, boolean>): boolean {
  const product = EVENTS_BY_ID[eventId]?.lac?.product;
  return !!product && plan[product] && priceSignals(plan).some((s) => s.product === product);
}

/**
 * A terminal position whose event Signal can't list opens on the Prediction page instead, with the same
 * Yes/No button marked. The category stays when it lists the event; otherwise the event's own category.
 */
export function focusPrediction(state: WorkspaceState, cell: Highlight): Partial<WorkspaceState> {
  const event = EVENTS_BY_ID[cell.eventId];
  const active = state.predictionCategory;
  const listed = active === 'trending' ? event.trending : active === event.cat;
  return {
    predictionEventId: cell.eventId,
    highlightId: cell.id,
    predictionCategory: listed ? active : (event.cat ?? 'trending'),
    query: '',
  };
}

/**
 * Signal page: a click on a signal or a terminal position opens its event and marks its button.
 * The category stays when it lists that event (Trending lists every event with signals); otherwise Trending.
 */
export function focusHighlight(ws: Workspace, cell: Highlight): Partial<WorkspaceState> {
  const active = ws.activeCategory as SignalCategoryId;
  const keep = active === 'trending' || active === EVENTS_BY_ID[cell.eventId].lac?.product;
  return { signalEventId: cell.eventId, highlightId: cell.id, signalCategory: keep ? active : 'trending', query: '' };
}
