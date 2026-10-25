import type { MarketEvent, Side } from './catalog';

// Demo trading account, shown on the Account page and in the Signal page's terminal column. Polymarket gives an
// account as one record per buy, sell, market resolution, redemption, deposit, withdrawal and reward, plus the
// orders still resting; positions, history, funds and the balance are all worked out from these (lib/account.ts).
// Open positions point at Demo events in catalog.ts (current prices come from there); closed ones may point at a
// past market below, which has a title only. Times are UTC instants; the screen shows them in local time.

/** The Demo clock: "today" on the Account page, and the time of every Demo action (close, redeem). */
export const ACCOUNT_DEMO_NOW = '2026-10-21T13:00:00Z';

/** Fee on a Demo close, as a share of what the sale brings in. */
export const DEMO_FEE_RATE = 0.01;

/** A buy or a sell that filled; the fee (builder fee included) is USDC on top of price × shares. */
export interface Fill {
  id: string;
  at: string;
  kind: 'buy' | 'sell';
  eventId: string;
  outcomeId: string;
  side: Side;
  /** Price per share, 0–1. */
  price: number;
  shares: number;
  fee: number;
}

/** A market resolved: one side of the outcome won (pays 1 a share), the other lost (pays 0). */
export interface Resolution {
  id: string;
  at: string;
  kind: 'resolve';
  eventId: string;
  outcomeId: string;
  winner: Side;
}

/** Winning shares turned into USDC, 1 a share. */
export interface Redemption {
  id: string;
  at: string;
  kind: 'redeem';
  eventId: string;
  outcomeId: string;
  side: Side;
  shares: number;
}

/** Money in or out of the wallet that is not a trade. */
export interface Transfer {
  id: string;
  at: string;
  kind: 'deposit' | 'withdraw' | 'reward';
  /** USDC, always positive; a withdrawal takes it out. */
  amount: number;
}

export type AccountRecord = Fill | Resolution | Redemption | Transfer;
export type RecordKind = AccountRecord['kind'];

export interface Order {
  id: string;
  eventId: string;
  outcomeId: string;
  action: 'buy' | 'sell';
  side: Side;
  /** Limit price, 0–1. */
  price: number;
  shares: number;
  filled: number;
  placedAt: string;
}

export interface Account {
  /** A connected wallet, shortened on screen. */
  address: string;
  records: AccountRecord[];
  /** Orders still resting on the book. */
  orders: Order[];
}

/** A market that has closed and left the Demo catalog: enough to name it in the history. */
export type PastMarket = Pick<MarketEvent, 'id' | 'title' | 'kind' | 'yesLabel' | 'noLabel'> & {
  rows: { id: string; label: string }[];
};

export const PAST_MARKETS: PastMarket[] = [
  { id: 'fed-mar', title: 'Fed decision in March?', kind: 'multi', rows: [{ id: 'hold', label: 'No change' }] },
  { id: 'liv-ars', title: 'Liverpool vs. Arsenal', kind: 'multi', rows: [{ id: 'ars', label: 'Arsenal' }] },
  {
    id: 'london-oct10',
    title: 'Highest temperature in London on October 10?',
    kind: 'multi',
    rows: [{ id: 'c15', label: '15°C' }],
  },
  {
    id: 'nyc-oct19',
    title: 'Highest temperature in New York on October 19?',
    kind: 'multi',
    rows: [{ id: 'f64', label: '64–65°F' }],
  },
  {
    id: 'gold-oct20',
    title: 'Gold (GC) Up or Down on October 20?',
    kind: 'binary',
    yesLabel: 'Up',
    noLabel: 'Down',
    rows: [{ id: 'ud', label: 'Gold daily settle' }],
  },
];

const fill = (
  id: string,
  at: string,
  kind: Fill['kind'],
  [eventId, outcomeId, side]: [string, string, Side],
  price: number,
  shares: number,
  fee: number,
): Fill => ({ id, at, kind, eventId, outcomeId, side, price, shares, fee });

// Oldest first. Today (Oct 21) has buys, sells, a redemption and a reward; Mar 1 – Mar 21 is the worked example of
// the rules (buy 100 at 40¢, sell 60 at 55¢ for +$9, the market resolves Yes, redeem 40 for +$24: +$33 in all).
export const DEMO_ACCOUNT: Account = {
  address: '0x12ab7c4e9f0d3b8a61e5c2f47d90b3a6e18f89cd',
  records: [
    { id: 'r1', at: '2026-02-27T10:00:00Z', kind: 'deposit', amount: 1000 },
    fill('r2', '2026-03-01T14:00:00Z', 'buy', ['fed-mar', 'hold', 'yes'], 0.4, 100, 0),
    fill('r3', '2026-03-05T15:30:00Z', 'sell', ['fed-mar', 'hold', 'yes'], 0.55, 60, 0),
    { id: 'r4', at: '2026-03-20T08:00:00Z', kind: 'resolve', eventId: 'fed-mar', outcomeId: 'hold', winner: 'yes' },
    {
      id: 'r5',
      at: '2026-03-21T09:00:00Z',
      kind: 'redeem',
      eventId: 'fed-mar',
      outcomeId: 'hold',
      side: 'yes',
      shares: 40,
    },
    { id: 'r6', at: '2026-09-30T12:00:00Z', kind: 'reward', amount: 12.4 },
    fill('r7', '2026-10-03T09:00:00Z', 'buy', ['liv-ars', 'ars', 'yes'], 0.4, 200, 0.8),
    { id: 'r8', at: '2026-10-04T18:00:00Z', kind: 'resolve', eventId: 'liv-ars', outcomeId: 'ars', winner: 'no' },
    fill('r9', '2026-10-09T10:00:00Z', 'buy', ['london-oct10', 'c15', 'yes'], 0.2, 300, 0.6),
    fill('r10', '2026-10-10T09:00:00Z', 'sell', ['london-oct10', 'c15', 'yes'], 0.31, 300, 0.93),
    { id: 'r11', at: '2026-10-18T08:00:00Z', kind: 'deposit', amount: 1000 },
    fill('r12', '2026-10-19T02:05:00Z', 'buy', ['london', 'c17', 'yes'], 0.34, 300, 1.02),
    fill('r13', '2026-10-19T02:20:00Z', 'buy', ['nyc', 'f66', 'yes'], 0.25, 400, 1),
    fill('r14', '2026-10-19T03:00:00Z', 'buy', ['nyc-oct19', 'f64', 'yes'], 0.3, 200, 0.6),
    fill('r15', '2026-10-19T08:40:00Z', 'buy', ['shutdown', 'yn', 'yes'], 0.22, 300, 0.66),
    fill('r16', '2026-10-19T14:00:00Z', 'buy', ['gold-oct20', 'ud', 'yes'], 0.52, 100, 0.52),
    fill('r17', '2026-10-20T01:15:00Z', 'buy', ['arsenal', 'ars', 'yes'], 0.46, 300, 1.38),
    fill('r18', '2026-10-20T03:40:00Z', 'buy', ['lakers', 'ml', 'no'], 0.52, 250, 1.3),
    { id: 'r19', at: '2026-10-20T04:00:00Z', kind: 'resolve', eventId: 'nyc-oct19', outcomeId: 'f64', winner: 'no' },
    fill('r20', '2026-10-20T08:05:00Z', 'buy', ['london', 'c14', 'no'], 0.91, 150, 1.37),
    { id: 'r21', at: '2026-10-20T14:30:00Z', kind: 'withdraw', amount: 200 },
    fill('r22', '2026-10-20T18:00:00Z', 'buy', ['eurusd', 'ud', 'yes'], 0.5, 150, 0.75),
    { id: 'r23', at: '2026-10-20T21:00:00Z', kind: 'resolve', eventId: 'gold-oct20', outcomeId: 'ud', winner: 'yes' },
    fill('r24', '2026-10-21T04:30:00Z', 'sell', ['nyc', 'f66', 'yes'], 0.27, 100, 0.27),
    fill('r25', '2026-10-21T07:45:00Z', 'sell', ['eurusd', 'ud', 'yes'], 0.46, 150, 0.69),
    { id: 'r26', at: '2026-10-21T08:00:00Z', kind: 'reward', amount: 3.25 },
    fill('r27', '2026-10-21T09:05:00Z', 'buy', ['london', 'c17', 'yes'], 0.39, 200, 0.78),
    {
      id: 'r28',
      at: '2026-10-21T09:20:00Z',
      kind: 'redeem',
      eventId: 'gold-oct20',
      outcomeId: 'ud',
      side: 'yes',
      shares: 100,
    },
    fill('r29', '2026-10-21T10:00:00Z', 'buy', ['eth', 'ud', 'no'], 0.5, 120, 0.6),
    // London's high had passed 14°C by noon, so "14°C or below" resolved No early: those No shares wait to be redeemed.
    { id: 'r30', at: '2026-10-21T11:00:00Z', kind: 'resolve', eventId: 'london', outcomeId: 'c14', winner: 'no' },
    fill('r31', '2026-10-21T11:30:00Z', 'buy', ['arsenal', 'ars', 'yes'], 0.54, 100, 0.54),
    fill('r32', '2026-10-21T12:20:00Z', 'buy', ['btc', 'ud', 'yes'], 0.45, 200, 0.9),
    // Bought back after the 07:45 sale closed it: a new position.
    fill('r33', '2026-10-21T12:40:00Z', 'buy', ['eurusd', 'ud', 'yes'], 0.47, 100, 0.47),
  ],
  orders: [
    {
      id: 'o1',
      eventId: 'arsenal',
      outcomeId: 'ars',
      action: 'buy',
      side: 'yes',
      price: 0.54,
      shares: 300,
      filled: 100,
      placedAt: '2026-10-21T11:28:00Z',
    },
    {
      id: 'o2',
      eventId: 'nyc',
      outcomeId: 'f70',
      action: 'buy',
      side: 'no',
      price: 0.82,
      shares: 100,
      filled: 0,
      placedAt: '2026-10-21T10:40:00Z',
    },
    {
      id: 'o3',
      eventId: 'london',
      outcomeId: 'c17',
      action: 'sell',
      side: 'yes',
      price: 0.48,
      shares: 200,
      filled: 0,
      placedAt: '2026-10-21T10:10:00Z',
    },
    {
      id: 'o4',
      eventId: 'london',
      outcomeId: 'c18',
      action: 'buy',
      side: 'yes',
      price: 0.15,
      shares: 200,
      filled: 0,
      placedAt: '2026-10-21T12:15:00Z',
    },
  ],
};

/** A wallet with nothing in it, for the empty states. */
export const EMPTY_ACCOUNT: Account = { ...DEMO_ACCOUNT, records: [], orders: [] };
