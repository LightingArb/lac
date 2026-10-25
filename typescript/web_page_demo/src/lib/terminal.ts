import type { MarketEvent, Outcome } from '../data/catalog';
import type { Account, Order, Position } from '../data/terminal';
import { EVENTS_BY_ID, findOutcome, sideLabel } from './markets';

// Trading terminal arithmetic, kept apart from the screen. Money is USDC, rounded to cents.

export function round2(n: number): number {
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
}

/** Current price of one share: the Demo Yes/No price of that outcome, or the payout once resolved. */
export function currentPrice(position: Position, events: Record<string, MarketEvent> = EVENTS_BY_ID): number | null {
  if (position.settledPrice !== undefined) return position.settledPrice;
  const outcome = findOutcome(events[position.eventId], position.outcomeId);
  return position.side === 'yes' ? outcome.yes : outcome.no;
}

/** What the position is worth now: shares × current price. */
export function positionValue(shares: number, price: number | null): number | null {
  return price === null ? null : round2(shares * price);
}

export function positionCost(position: Position): number {
  return round2(position.shares * position.avgCost);
}

/** Unrealized profit or loss: value − cost, and that as a percent of cost. */
export function positionPnl(
  position: Position,
  price: number | null,
): { amount: number; percent: number | null } | null {
  if (price === null) return null;
  const cost = position.shares * position.avgCost;
  const gain = position.shares * price - cost;
  return { amount: round2(gain), percent: cost > 0 ? round2((gain / cost) * 100) : null };
}

/** Cash held by resting buy orders: price × shares not yet filled. Sell orders hold shares, not cash. */
export function reservedCash(orders: Order[]): number {
  return round2(orders.filter((o) => o.action === 'buy').reduce((sum, o) => sum + o.price * (o.shares - o.filled), 0));
}

export interface PositionRow {
  position: Position;
  event: MarketEvent;
  outcome: Outcome;
  sideLabel: string;
  price: number | null;
  value: number | null;
  pnl: { amount: number; percent: number | null } | null;
  /** Resolved and won: the shares can be redeemed for USDC. */
  redeemable: boolean;
}

export function positionRow(position: Position, events: Record<string, MarketEvent> = EVENTS_BY_ID): PositionRow {
  const event = events[position.eventId];
  const price = currentPrice(position, events);
  return {
    position,
    event,
    outcome: findOutcome(event, position.outcomeId),
    sideLabel: sideLabel(event, position.side),
    price,
    value: positionValue(position.shares, price),
    pnl: positionPnl(position, price),
    redeemable: position.settledPrice !== undefined && position.settledPrice > 0,
  };
}

export interface AccountSummary {
  /** Cash, USDC. */
  balance: number;
  /** Cash plus what every position is worth now. */
  equity: number;
  /** Cash minus what resting buy orders hold. */
  available: number;
  /** Sum of every position's profit or loss. */
  unrealized: number;
}

export function accountSummary(account: Account, events: Record<string, MarketEvent> = EVENTS_BY_ID): AccountSummary {
  const rows = account.positions.map((p) => positionRow(p, events));
  return {
    balance: round2(account.cash),
    equity: round2(account.cash + rows.reduce((sum, r) => sum + (r.value ?? 0), 0)),
    available: round2(account.cash - reservedCash(account.orders)),
    unrealized: round2(rows.reduce((sum, r) => sum + (r.pnl?.amount ?? 0), 0)),
  };
}

/** e.g. 0x12ab…89cd */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
