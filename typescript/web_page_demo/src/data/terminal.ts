import type { Side } from './catalog';

// Demo trading account shown in the Signal page's terminal column. Every position, order
// and trade points at a Demo event in catalog.ts that the Signal page lists (its product has
// signals), so a click can open it; current prices come from that event.

export interface Position {
  id: string;
  eventId: string;
  outcomeId: string;
  side: Side;
  shares: number;
  /** Average cost per share, 0–1. */
  avgCost: number;
  /** Set once the market is resolved: what one share pays out (1 won, 0 lost). */
  settledPrice?: number;
}

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

export type TradeKind = 'buy' | 'sell' | 'redeem' | 'deposit' | 'withdraw';

export interface Trade {
  id: string;
  at: string;
  kind: TradeKind;
  /** Market trades only; deposits and withdrawals have no market. */
  eventId?: string;
  outcomeId?: string;
  side?: Side;
  price?: number;
  shares?: number;
  /** USDC moved; buys and withdrawals are money out. */
  amount: number;
}

export interface Account {
  /** A connected wallet, shortened on screen. */
  address: string;
  /** Cash in the wallet, USDC. */
  cash: number;
  positions: Position[];
  orders: Order[];
  /** Newest first. */
  trades: Trade[];
}

export const DEMO_ACCOUNT: Account = {
  address: '0x12ab7c4e9f0d3b8a61e5c2f47d90b3a6e18f89cd',
  cash: 986.5,
  positions: [
    { id: 'p1', eventId: 'london', outcomeId: 'c17', side: 'yes', shares: 500, avgCost: 0.36 },
    { id: 'p2', eventId: 'nyc', outcomeId: 'f66', side: 'yes', shares: 300, avgCost: 0.25 },
    { id: 'p3', eventId: 'arsenal', outcomeId: 'ars', side: 'yes', shares: 400, avgCost: 0.48 },
    { id: 'p4', eventId: 'lakers', outcomeId: 'ml', side: 'no', shares: 250, avgCost: 0.52 },
    { id: 'p5', eventId: 'london', outcomeId: 'c14', side: 'no', shares: 150, avgCost: 0.91, settledPrice: 1 },
    { id: 'p6', eventId: 'btc', outcomeId: 'ud', side: 'yes', shares: 200, avgCost: 0.45 },
    { id: 'p7', eventId: 'eth', outcomeId: 'ud', side: 'no', shares: 120, avgCost: 0.5 },
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
      placedAt: 'Oct 21, 2026 19:28',
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
      placedAt: 'Oct 21, 2026 18:40',
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
      placedAt: 'Oct 21, 2026 18:10',
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
      placedAt: 'Oct 21, 2026 20:15',
    },
  ],
  trades: [
    { id: 't15', at: 'Oct 21, 2026 20:45', kind: 'withdraw', amount: -200 },
    {
      id: 't14',
      at: 'Oct 21, 2026 20:20',
      kind: 'buy',
      eventId: 'btc',
      outcomeId: 'ud',
      side: 'yes',
      price: 0.45,
      shares: 200,
      amount: -90,
    },
    {
      id: 't13',
      at: 'Oct 21, 2026 19:30',
      kind: 'buy',
      eventId: 'arsenal',
      outcomeId: 'ars',
      side: 'yes',
      price: 0.54,
      shares: 100,
      amount: -54,
    },
    {
      id: 't12',
      at: 'Oct 21, 2026 18:05',
      kind: 'buy',
      eventId: 'london',
      outcomeId: 'c17',
      side: 'yes',
      price: 0.39,
      shares: 200,
      amount: -78,
    },
    {
      id: 't11',
      at: 'Oct 21, 2026 17:20',
      kind: 'redeem',
      eventId: 'gold',
      outcomeId: 'ud',
      side: 'no',
      price: 1,
      shares: 100,
      amount: 100,
    },
    {
      id: 't10',
      at: 'Oct 21, 2026 15:00',
      kind: 'buy',
      eventId: 'eth',
      outcomeId: 'ud',
      side: 'no',
      price: 0.5,
      shares: 120,
      amount: -60,
    },
    {
      id: 't9',
      at: 'Oct 21, 2026 12:30',
      kind: 'sell',
      eventId: 'nyc',
      outcomeId: 'f66',
      side: 'yes',
      price: 0.27,
      shares: 100,
      amount: 27,
    },
    {
      id: 't8',
      at: 'Oct 20, 2026 16:05',
      kind: 'buy',
      eventId: 'london',
      outcomeId: 'c14',
      side: 'no',
      price: 0.91,
      shares: 150,
      amount: -136.5,
    },
    {
      id: 't7',
      at: 'Oct 20, 2026 11:40',
      kind: 'buy',
      eventId: 'lakers',
      outcomeId: 'ml',
      side: 'no',
      price: 0.52,
      shares: 250,
      amount: -130,
    },
    {
      id: 't6',
      at: 'Oct 20, 2026 09:15',
      kind: 'buy',
      eventId: 'arsenal',
      outcomeId: 'ars',
      side: 'yes',
      price: 0.46,
      shares: 300,
      amount: -138,
    },
    { id: 't5', at: 'Oct 20, 2026 08:30', kind: 'deposit', amount: 1000 },
    {
      id: 't4',
      at: 'Oct 19, 2026 14:02',
      kind: 'buy',
      eventId: 'gold',
      outcomeId: 'ud',
      side: 'no',
      price: 0.52,
      shares: 100,
      amount: -52,
    },
    {
      id: 't3',
      at: 'Oct 19, 2026 10:20',
      kind: 'buy',
      eventId: 'nyc',
      outcomeId: 'f66',
      side: 'yes',
      price: 0.25,
      shares: 400,
      amount: -100,
    },
    {
      id: 't2',
      at: 'Oct 19, 2026 10:05',
      kind: 'buy',
      eventId: 'london',
      outcomeId: 'c17',
      side: 'yes',
      price: 0.34,
      shares: 300,
      amount: -102,
    },
    { id: 't1', at: 'Oct 18, 2026 09:12', kind: 'deposit', amount: 1000 },
  ],
};

/** A wallet with nothing in it, for the empty states. */
export const EMPTY_ACCOUNT: Account = { ...DEMO_ACCOUNT, cash: 0, positions: [], orders: [], trades: [] };
