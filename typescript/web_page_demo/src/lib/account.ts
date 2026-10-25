import type { MarketEvent, Side } from '../data/catalog';
import {
  DEMO_FEE_RATE,
  PAST_MARKETS,
  type Account,
  type AccountRecord,
  type Fill,
  type Order,
  type Redemption,
  type Resolution,
  type Transfer,
} from '../data/terminal';
import { EVENTS_BY_ID, findOutcome, sideLabel } from './markets';

// Account arithmetic, kept apart from the screen and shared by the Account page and the Signal terminal. Polymarket
// gives one record per trade, resolution, redemption and transfer; it never says what a position made, what the
// balance is or which positions are closed. This file works all of that out from the records, by fixed rules:
//   - Average cost is weighted, and buy fees are part of the cost.
//   - Selling part of a position realizes that part's profit (the sell fee comes off it); the rest keeps its average.
//   - A lost resolution closes the position at once (0 a share). A won one waits for redemption (1 a share): until
//     then the position stays open, marked redeemable, and is worth 1 a share.
//   - A position runs from holding 0 shares to holding some, until back to 0. Buying again after that opens a new one.
//   - Deposits, withdrawals and rewards move the balance only; they are not trading profit.
// Money is USDC, rounded to cents on the way out.

export function round2(n: number): number {
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
}

/** e.g. 0x12ab…89cd */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export type CloseMethod = 'sell' | 'resolve' | 'redeem';
type PositionRecord = Fill | Resolution | Redemption;

/** One record of a position, with the profit it realized (sells, a lost resolution, redemptions). */
export interface PositionStep {
  record: PositionRecord;
  realized: number | null;
}

/** A position, open or closed. Its id, event, outcome and side also mark its Yes/No button on Signal/Prediction. */
export interface Position {
  id: string;
  eventId: string;
  outcomeId: string;
  side: Side;
  openedAt: number;
  /** Shares held now; 0 once closed. */
  shares: number;
  /** What the shares held now cost, buy fees included. */
  cost: number;
  /** Shares bought over the position's life. */
  bought: number;
  realized: number;
  fees: number;
  /** Resolved and won: waiting for redemption at 1 a share. */
  redeemable: boolean;
  closedAt: number | null;
  /** How the shares went: sold, lost at resolution, redeemed; one or several. */
  methods: CloseMethod[];
  steps: PositionStep[];
}

/** A line of the funds log: money in or out that is not a trade, and the balance right after it. */
export interface FundsRow {
  record: Transfer | Redemption;
  amount: number;
  balance: number;
}

/** Profit made real at one moment (a sell, a lost resolution, a redemption). */
export interface Realization {
  at: number;
  amount: number;
  positionId: string;
}

/** Everything the records add up to. Lists are newest first, except `realizations` and `fills` (oldest first). */
export interface Ledger {
  cash: number;
  open: Position[];
  closed: Position[];
  funds: FundsRow[];
  realizations: Realization[];
  fills: Fill[];
  /** Every record, newest first. */
  records: AccountRecord[];
}

const positionKey = (eventId: string, outcomeId: string, side: Side) => `${eventId}/${outcomeId}/${side}`;
const at = (record: { at: string }) => Date.parse(record.at);

/** Plays the records back in time order (records at the same moment in the order given). */
export function ledger(account: Account): Ledger {
  const sorted = account.records
    .map((record, i) => ({ record, i }))
    .sort((a, b) => at(a.record) - at(b.record) || a.i - b.i);
  const held = new Map<string, Position>();
  const closed: Position[] = [];
  const funds: FundsRow[] = [];
  const realizations: Realization[] = [];
  const fills: Fill[] = [];
  let cash = 0;
  let opened = 0;

  const realize = (position: Position, record: PositionRecord, amount: number, method: CloseMethod, shares: number) => {
    position.realized += amount;
    position.steps.push({ record, realized: round2(amount) });
    realizations.push({ at: at(record), amount, positionId: position.id });
    if (!position.methods.includes(method)) position.methods.push(method);
    // The part of the cost that went with the shares; a position closed in full has none left.
    position.cost = position.shares === shares ? 0 : position.cost - (position.cost * shares) / position.shares;
    position.shares -= shares;
    if (position.shares === 0) {
      position.closedAt = at(record);
      closed.push(position);
      held.delete(positionKey(position.eventId, position.outcomeId, position.side));
    }
  };
  const holding = (record: Fill | Redemption) => {
    const position = held.get(positionKey(record.eventId, record.outcomeId, record.side));
    if (!position || position.shares < record.shares) throw new Error(`${record.id}: more shares than held`);
    return position;
  };

  for (const { record } of sorted) {
    switch (record.kind) {
      case 'buy': {
        const key = positionKey(record.eventId, record.outcomeId, record.side);
        let position = held.get(key);
        if (!position) {
          position = {
            id: `p${++opened}`,
            eventId: record.eventId,
            outcomeId: record.outcomeId,
            side: record.side,
            openedAt: at(record),
            shares: 0,
            cost: 0,
            bought: 0,
            realized: 0,
            fees: 0,
            redeemable: false,
            closedAt: null,
            methods: [],
            steps: [],
          };
          held.set(key, position);
        }
        const spent = record.price * record.shares + record.fee;
        cash -= spent;
        position.shares += record.shares;
        position.cost += spent;
        position.bought += record.shares;
        position.fees += record.fee;
        position.steps.push({ record, realized: null });
        fills.push(record);
        break;
      }
      case 'sell': {
        const position = holding(record);
        const received = record.price * record.shares - record.fee;
        const cost =
          position.shares === record.shares ? position.cost : (position.cost * record.shares) / position.shares;
        cash += received;
        position.fees += record.fee;
        fills.push(record);
        realize(position, record, received - cost, 'sell', record.shares);
        break;
      }
      case 'resolve':
        for (const position of [...held.values()]) {
          if (position.eventId !== record.eventId || position.outcomeId !== record.outcomeId) continue;
          if (position.side === record.winner) {
            position.redeemable = true;
            position.steps.push({ record, realized: null });
          } else realize(position, record, -position.cost, 'resolve', position.shares);
        }
        break;
      case 'redeem': {
        const position = holding(record);
        if (!position.redeemable) throw new Error(`${record.id}: redeems an unresolved position`);
        const cost =
          position.shares === record.shares ? position.cost : (position.cost * record.shares) / position.shares;
        cash += record.shares;
        realize(position, record, record.shares - cost, 'redeem', record.shares);
        funds.push({ record, amount: record.shares, balance: round2(cash) });
        break;
      }
      default: {
        const amount = record.kind === 'withdraw' ? -record.amount : record.amount;
        cash += amount;
        funds.push({ record, amount, balance: round2(cash) });
      }
    }
  }
  const byNewest = (a: Position, b: Position) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt);
  return {
    cash: round2(cash),
    open: [...held.values()].sort(byNewest),
    closed: closed.sort(byNewest),
    funds: funds.reverse(),
    realizations,
    fills,
    records: sorted.map((s) => s.record).reverse(),
  };
}

// ---- What a record or position points at ----

/** A market by name: a Demo event that is still listed (with prices), or a past one (title only). */
export interface MarketName {
  title: string;
  outcome: string;
  side: string;
  /** Still in the Demo catalog: has a price, and opens on Signal or Prediction. */
  listed: boolean;
}

export function marketName(
  eventId: string,
  outcomeId: string,
  side: Side,
  events: Record<string, MarketEvent> = EVENTS_BY_ID,
): MarketName {
  const event = events[eventId];
  if (event)
    return {
      title: event.title,
      outcome: findOutcome(event, outcomeId).label,
      side: sideLabel(event, side),
      listed: true,
    };
  const past = PAST_MARKETS.find((m) => m.id === eventId);
  if (!past) return { title: eventId, outcome: outcomeId, side, listed: false };
  const outcome = past.rows.find((r) => r.id === outcomeId)?.label ?? outcomeId;
  return { title: past.title, outcome, side: sideLabel(past, side), listed: false };
}

/** A share's price now: 1 once won and waiting for redemption, else the Demo price of that side. */
export function currentPrice(position: Position, events: Record<string, MarketEvent> = EVENTS_BY_ID): number | null {
  if (position.redeemable) return 1;
  const event = events[position.eventId];
  if (!event) return null;
  const outcome = findOutcome(event, position.outcomeId);
  return position.side === 'yes' ? outcome.yes : outcome.no;
}

export interface PositionView {
  position: Position;
  market: MarketName;
  avgCost: number;
  price: number | null;
  value: number | null;
  /** Value − cost, and that as a percent of cost. */
  pnl: { amount: number; percent: number | null } | null;
}

export function positionView(position: Position, events: Record<string, MarketEvent> = EVENTS_BY_ID): PositionView {
  const price = currentPrice(position, events);
  const value = price === null ? null : position.shares * price;
  const gain = value === null ? null : value - position.cost;
  return {
    position,
    market: marketName(position.eventId, position.outcomeId, position.side, events),
    avgCost: position.shares ? position.cost / position.shares : 0,
    price,
    value: value === null ? null : round2(value),
    pnl:
      gain === null
        ? null
        : { amount: round2(gain), percent: position.cost > 0 ? round2((gain / position.cost) * 100) : null },
  };
}

/** Cash held by resting buy orders: price × shares not filled yet. Sell orders hold shares, not cash. */
export function reservedCash(orders: Order[]): number {
  return round2(orders.filter((o) => o.action === 'buy').reduce((sum, o) => sum + o.price * (o.shares - o.filled), 0));
}

export interface AccountSummary {
  /** Every cash movement in the records, added up. */
  balance: number;
  /** Balance plus what every open position is worth now (redeemable ones at 1 a share). */
  equity: number;
  /** Balance minus what resting buy orders hold. */
  available: number;
  /** What the open positions are worth now minus what they cost. */
  unrealized: number;
}

/** The four account numbers; the Account page and the Signal terminal both show these. */
export function accountSummary(account: Account, events: Record<string, MarketEvent> = EVENTS_BY_ID): AccountSummary {
  const book = ledger(account);
  const views = book.open.map((p) => positionView(p, events));
  const worth = views.reduce((sum, v) => sum + (v.value ?? 0), 0);
  const cost = views.reduce((sum, v) => sum + (v.value === null ? 0 : v.position.cost), 0);
  return {
    balance: book.cash,
    equity: round2(book.cash + worth),
    available: round2(book.cash - reservedCash(account.orders)),
    unrealized: round2(worth - cost),
  };
}

// ---- Overview: a period and what happened in it ----

export type PeriodKind = 'today' | 'week' | 'month' | 'custom';
export const PERIOD_KINDS: PeriodKind[] = ['today', 'week', 'month', 'custom'];

/** Instants in ms, both ends included. */
export interface Period {
  from: number;
  to: number;
}

const DAY = 86_400_000;

/** Midnight starting a local calendar day (ISO 2026-10-21), in the viewer's time zone. */
export function localDayStart(iso: string, plusDays = 0): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d + plusDays).getTime();
}

/** The local calendar day (ISO) an instant falls on, in the viewer's time zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Today: from local midnight to now. Last week: the 7 days back from now; last month: the 30 days back. Custom: from
 * the start of the first day to the end of the last, both days included.
 */
export function periodRange(kind: PeriodKind, now: number, custom?: { from: string; to: string }): Period {
  if (kind === 'today') return { from: localDayStart(localDay(now)), to: now };
  if (kind === 'week') return { from: now - 7 * DAY, to: now };
  if (kind === 'month' || !custom) return { from: now - 30 * DAY, to: now };
  const [first, last] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
  return { from: localDayStart(first), to: localDayStart(last, 1) - 1 };
}

export interface Overview {
  /** Profit realized inside the period, whole positions or parts of them. */
  realized: number;
  /** Positions closed in full inside the period: made money, lost money. */
  closed: number;
  wins: number;
  losses: number;
  /** Price × shares of every buy and sell filled inside the period. */
  volume: number;
  fees: number;
  /** Realized profit added up, from 0 at the start of the period. */
  curve: { at: number; value: number }[];
}

export function overview(book: Ledger, period: Period): Overview {
  const inside = (ms: number) => ms >= period.from && ms <= period.to;
  const closed = book.closed.filter((p) => inside(p.closedAt!));
  const fills = book.fills.filter((f) => inside(at(f)));
  let total = 0;
  const curve = [{ at: period.from, value: 0 }];
  for (const r of book.realizations.filter((x) => inside(x.at))) {
    total += r.amount;
    curve.push({ at: r.at, value: round2(total) });
  }
  curve.push({ at: period.to, value: round2(total) });
  return {
    realized: round2(total),
    closed: closed.length,
    wins: closed.filter((p) => round2(p.realized) > 0).length,
    losses: closed.filter((p) => round2(p.realized) < 0).length,
    volume: round2(fills.reduce((sum, f) => sum + f.price * f.shares, 0)),
    fees: round2(fills.reduce((sum, f) => sum + f.fee, 0)),
    curve,
  };
}

// ---- Demo actions: each adds a record (or drops an order); nothing leaves the page ----

export interface CloseQuote {
  /** What a share sells for now (Demo: the side's current price). */
  price: number;
  fee: number;
  /** What the sale brings in after the fee. */
  proceeds: number;
  /** Proceeds − cost. */
  pnl: number;
}

/** Closing sells every share at the current price; the fee is the Demo rate on the sale. */
export function closeQuote(view: PositionView): CloseQuote | null {
  if (view.price === null || view.position.redeemable) return null;
  const gross = view.price * view.position.shares;
  const fee = round2(gross * DEMO_FEE_RATE);
  return { price: view.price, fee, proceeds: round2(gross - fee), pnl: round2(gross - fee - view.position.cost) };
}

const nextId = (account: Account) => `r${account.records.length + 1}`;
const openPosition = (account: Account, positionId: string) => {
  const position = ledger(account).open.find((p) => p.id === positionId);
  if (!position) throw new Error(`${positionId} is not open`);
  return position;
};

/**
 * Confirmed close: a sell of every share at the quoted price. The position's resting sell orders go first, since the
 * shares they hold are sold too.
 */
export function closePosition(
  account: Account,
  positionId: string,
  now: string,
  events: Record<string, MarketEvent> = EVENTS_BY_ID,
): Account {
  const position = openPosition(account, positionId);
  const quote = closeQuote(positionView(position, events));
  if (!quote) throw new Error(`${positionId} has no price to close at`);
  const { eventId, outcomeId, side, shares } = position;
  const sell: Fill = {
    id: nextId(account),
    at: now,
    kind: 'sell',
    eventId,
    outcomeId,
    side,
    price: quote.price,
    shares,
    fee: quote.fee,
  };
  const orders = account.orders.filter(
    (o) => !(o.action === 'sell' && o.eventId === eventId && o.outcomeId === outcomeId && o.side === side),
  );
  return { ...account, records: [...account.records, sell], orders };
}

/** Redeem every share of a won position for 1 USDC each. */
export function redeemPosition(account: Account, positionId: string, now: string): Account {
  const { eventId, outcomeId, side, shares, redeemable } = openPosition(account, positionId);
  if (!redeemable) throw new Error(`${positionId} is not redeemable`);
  const redeem: Redemption = { id: nextId(account), at: now, kind: 'redeem', eventId, outcomeId, side, shares };
  return { ...account, records: [...account.records, redeem] };
}

/** Delete a resting order: what it held is available again. */
export function cancelOrder(account: Account, orderId: string): Account {
  return { ...account, orders: account.orders.filter((o) => o.id !== orderId) };
}
