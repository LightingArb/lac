import type { IconName } from '../components/ui/Icon';

// Sample market data from the design. Replace with API data when the backend is ready.

export type EventCategoryId = 'politics' | 'sports' | 'finance' | 'crypto' | 'esports' | 'geopolitics' | 'weather';
export type CategoryId = 'trending' | EventCategoryId;
export type ProductId = 'weather' | 'crypto' | 'forex' | 'future' | 'sport';
export type Side = 'yes' | 'no';

/** Names come from the dictionaries (t.categories, t.products). */
export interface Category {
  id: CategoryId;
  icon: IconName;
}

export interface Product {
  id: ProductId;
  icon: IconName;
}

export interface Outcome {
  id: string;
  label: string;
  /** Market price of YES, 0–1. */
  yes: number | null;
  /** Market price of NO, 0–1. */
  no: number | null;
  yesAsk?: number | null;
  noAsk?: number | null;
  yesIndex?: number;
  noIndex?: number;
  yesAsset?: string | null;
  noAsset?: string | null;
  yesLabel?: string;
  noLabel?: string;
  liquidity?: number | null;
  /** LAC fair value of YES, 0–1. Only on events LAC covers. */
  fair?: number;
  vol: number | null;
}

export interface MatchInfo {
  teamA: string;
  teamB: string;
  aAbbr: string;
  bAbbr: string;
  scoreA: string;
  scoreB: string;
  mapText: string;
}

export interface MarketEvent {
  id: string;
  cat: EventCategoryId | null;
  source?: 'demo' | 'live';
  imageUrl?: string | null;
  marketCount?: number;
  observedAt?: string;
  trending: boolean;
  title: string;
  abbr: string;
  tags: string[];
  /** Short label for when the market opened; used on the "All" chart axis. */
  open: string;
  start: string;
  end: string;
  endDate: string;
  endTime: string;
  vol24: number | null;
  volTotal: number | null;
  /** `multi`: several outcomes, each with Yes/No. `binary`: one outcome with two named sides. */
  kind: 'multi' | 'binary';
  yesLabel?: string;
  noLabel?: string;
  /** Set when LAC publishes fair values for this event; Sport events also carry the sport (classification_path). */
  lac: { product: ProductId; path: string; sport?: string } | null;
  rows: Outcome[];
  match?: MatchInfo;
  liveMatch?: {
    teams: { name: string | null; abbreviation: string | null }[];
    score: string | null;
    live: boolean | null;
    ended: boolean | null;
    period: string | null;
    elapsed: string | null;
    starts: string;
    probabilities: (number | null)[] | null;
  };
}

export interface Signal {
  id: string;
  product: ProductId;
  /** Shown after the product name, e.g. "London" in "Weather · London". */
  market: string;
  /** Sport signals: the sport code (classification_path), which the customer must hold. */
  sport?: string;
  title: string;
  sideLabel: string;
  side: Side;
  eventId: string;
  outcomeId: string;
  /** Average cost to fill at the quoted depth. */
  avg: number;
  depth: number;
  updatedSec: number;
  minutesLeft: number;
}

export const CATEGORIES: Category[] = [
  { id: 'trending', icon: 'trending' },
  { id: 'politics', icon: 'politics' },
  { id: 'sports', icon: 'sports' },
  { id: 'finance', icon: 'finance' },
  { id: 'crypto', icon: 'crypto' },
  { id: 'esports', icon: 'esports' },
  { id: 'geopolitics', icon: 'globe' },
  { id: 'weather', icon: 'weather' },
];

export const PRODUCTS: Product[] = [
  { id: 'weather', icon: 'weather' },
  { id: 'crypto', icon: 'crypto' },
  { id: 'forex', icon: 'forex' },
  { id: 'future', icon: 'future' },
  { id: 'sport', icon: 'sports' },
];

export const PRODUCT_ICONS: Record<ProductId, IconName> = {
  weather: 'weather',
  crypto: 'crypto',
  forex: 'forex',
  future: 'future',
  sport: 'sports',
};

export const CATEGORY_TONES: Record<EventCategoryId, { bg: string; fg: string }> = {
  finance: { bg: '#E0E7FF', fg: '#3730A3' },
  weather: { bg: '#E0F2FE', fg: '#075985' },
  crypto: { bg: '#FEF3C7', fg: '#92400E' },
  sports: { bg: '#DCFCE7', fg: '#166534' },
  esports: { bg: '#FCE7F3', fg: '#9D174D' },
  politics: { bg: '#EDE9FE', fg: '#5B21B6' },
  geopolitics: { bg: '#E2E8F0', fg: '#334155' },
};

export const EVENTS: MarketEvent[] = [
  {
    id: 'fed',
    cat: 'finance',
    trending: true,
    title: 'Fed decision in October?',
    abbr: 'FED',
    tags: ['Finance', 'Fed', 'Interest rates', 'Economy'],
    open: 'Jun 18',
    start: 'Jun 18, 2026 07:34',
    end: 'Oct 29, 2026 11:59',
    endDate: 'Oct 29',
    endTime: '11:59 AM',
    vol24: 2720000,
    volTotal: 49950000,
    kind: 'multi',
    lac: null,
    rows: [
      { id: 'hold', label: 'No change', yes: 0.86, no: 0.15, liquidity: 7800000, vol: 31200000 },
      { id: 'cut25', label: '25 bps decrease', yes: 0.13, no: 0.88, liquidity: 3225000, vol: 12900000 },
      { id: 'hike25', label: '25 bps increase', yes: 0.004, no: 0.997, liquidity: 1462500, vol: 5850000 },
    ],
  },
  {
    id: 'london',
    cat: 'weather',
    trending: true,
    title: 'Highest temperature in London on October 21?',
    abbr: 'LON',
    tags: ['Weather', 'London', 'EGLC', 'Daily high'],
    open: 'Oct 18',
    start: 'Oct 18, 2026 12:00',
    end: 'Oct 21, 2026 23:59',
    endDate: 'Oct 21',
    endTime: '11:59 PM',
    vol24: 184300,
    volTotal: 612800,
    kind: 'multi',
    lac: { product: 'weather', path: 'United Kingdom · Daily high · London · EGLC' },
    rows: [
      { id: 'c14', label: '14°C or below', yes: 0.03, no: 0.98, fair: 0.02, liquidity: 5350, vol: 21400 },
      { id: 'c15', label: '15°C', yes: 0.08, no: 0.93, fair: 0.07, liquidity: 12000, vol: 48000 },
      { id: 'c16', label: '16°C', yes: 0.19, no: 0.82, fair: 0.18, liquidity: 24050, vol: 96200 },
      { id: 'c17', label: '17°C', yes: 0.42, no: 0.59, fair: 0.54, liquidity: 47125, vol: 188500 },
      { id: 'c18', label: '18°C', yes: 0.17, no: 0.84, fair: 0.16, liquidity: 35675, vol: 142700 },
      { id: 'c19', label: '19°C or higher', yes: 0.11, no: 0.88, fair: 0.03, liquidity: 29000, vol: 116000 },
    ],
  },
  {
    id: 'valorant',
    cat: 'esports',
    trending: true,
    title: 'Valorant: LOUD vs. Team Vitality (BO5)',
    abbr: 'VAL',
    tags: ['Esports', 'Valorant', 'VCT Champions'],
    open: 'Oct 21',
    start: 'Oct 21, 2026 14:30',
    end: 'Oct 21, 2026 20:30',
    endDate: 'Oct 21',
    endTime: '8:30 PM',
    vol24: 1120000,
    volTotal: 1710000,
    kind: 'binary',
    yesLabel: 'LOUD',
    noLabel: 'Vitality',
    lac: null,
    rows: [{ id: 'win', label: 'Match winner', yes: 0.53, no: 0.48, liquidity: 427500, vol: 1710000 }],
    match: {
      teamA: 'LOUD',
      teamB: 'Team Vitality',
      aAbbr: 'LD',
      bAbbr: 'TV',
      scoreA: '1',
      scoreB: '1',
      mapText: 'Map 3 · BO5',
    },
  },
  {
    id: 'btc',
    cat: 'crypto',
    trending: true,
    title: 'Bitcoin Up or Down — Oct 21, 9:00–9:05 PM ET',
    abbr: 'BTC',
    tags: ['Crypto', 'Bitcoin', '5 min', 'Up or Down'],
    open: '8:00 PM',
    start: 'Oct 21, 2026 21:00',
    end: 'Oct 21, 2026 21:05',
    endDate: 'Oct 21',
    endTime: '9:05 PM',
    vol24: 412900,
    volTotal: 412900,
    kind: 'binary',
    yesLabel: 'Up',
    noLabel: 'Down',
    lac: { product: 'crypto', path: 'BTC · 5m' },
    rows: [{ id: 'ud', label: 'BTC 9:00–9:05 PM ET', yes: 0.38, no: 0.63, fair: 0.47, liquidity: 103225, vol: 412900 }],
  },
  {
    id: 'arsenal',
    cat: 'sports',
    trending: true,
    title: 'Arsenal vs. Chelsea',
    abbr: 'EPL',
    tags: ['Sports', 'Soccer', 'Premier League'],
    open: 'Oct 15',
    start: 'Oct 22, 2026 19:00',
    end: 'Oct 22, 2026 21:00',
    endDate: 'Oct 22',
    endTime: '9:00 PM',
    vol24: 1060000,
    volTotal: 3480000,
    kind: 'multi',
    lac: { product: 'sport', path: 'Soccer · Premier League', sport: 'soccer' },
    rows: [
      { id: 'ars', label: 'Arsenal', yes: 0.55, no: 0.46, fair: 0.61, liquidity: 475000, vol: 1900000 },
      { id: 'draw', label: 'Draw', yes: 0.24, no: 0.77, fair: 0.23, liquidity: 200000, vol: 800000 },
      { id: 'che', label: 'Chelsea', yes: 0.23, no: 0.78, fair: 0.16, liquidity: 195000, vol: 780000 },
    ],
  },
  {
    id: 'nyc',
    cat: 'weather',
    trending: false,
    title: 'Highest temperature in New York on October 21?',
    abbr: 'NYC',
    tags: ['Weather', 'New York', 'KLGA', 'Daily high'],
    open: 'Oct 18',
    start: 'Oct 18, 2026 12:00',
    end: 'Oct 21, 2026 23:59',
    endDate: 'Oct 21',
    endTime: '11:59 PM',
    vol24: 97600,
    volTotal: 340200,
    kind: 'multi',
    lac: { product: 'weather', path: 'United States · Daily high · New York · KLGA' },
    rows: [
      { id: 'f63', label: '63°F or below', yes: 0.05, no: 0.96, fair: 0.04, liquidity: 3075, vol: 12300 },
      { id: 'f64', label: '64–65°F', yes: 0.18, no: 0.83, fair: 0.17, liquidity: 13775, vol: 55100 },
      { id: 'f66', label: '66–67°F', yes: 0.21, no: 0.8, fair: 0.3, liquidity: 19450, vol: 77800 },
      { id: 'f68', label: '68–69°F', yes: 0.33, no: 0.68, fair: 0.32, liquidity: 22600, vol: 90400 },
      { id: 'f70', label: '70–71°F', yes: 0.17, no: 0.84, fair: 0.12, liquidity: 15250, vol: 61000 },
      { id: 'f72', label: '72°F or higher', yes: 0.06, no: 0.95, fair: 0.05, liquidity: 4725, vol: 18900 },
    ],
  },
  {
    id: 'eth',
    cat: 'crypto',
    trending: false,
    title: 'Ethereum Up or Down — Oct 21, 9:00–9:15 PM ET',
    abbr: 'ETH',
    tags: ['Crypto', 'Ethereum', '15 min', 'Up or Down'],
    open: '8:00 PM',
    start: 'Oct 21, 2026 21:00',
    end: 'Oct 21, 2026 21:15',
    endDate: 'Oct 21',
    endTime: '9:15 PM',
    vol24: 156400,
    volTotal: 156400,
    kind: 'binary',
    yesLabel: 'Up',
    noLabel: 'Down',
    lac: { product: 'crypto', path: 'ETH · 15m' },
    rows: [{ id: 'ud', label: 'ETH 9:00–9:15 PM ET', yes: 0.56, no: 0.44, fair: 0.49, liquidity: 39100, vol: 156400 }],
  },
  {
    id: 'eurusd',
    cat: 'finance',
    trending: false,
    title: 'EUR/USD Up or Down on October 22?',
    abbr: 'EUR',
    tags: ['Finance', 'Forex', 'EUR/USD', 'Daily'],
    open: 'Oct 21',
    start: 'Oct 21, 2026 17:00',
    end: 'Oct 22, 2026 17:00',
    endDate: 'Oct 22',
    endTime: '5:00 PM',
    vol24: 38200,
    volTotal: 64900,
    kind: 'binary',
    yesLabel: 'Up',
    noLabel: 'Down',
    lac: { product: 'forex', path: 'EUR/USD · 1d' },
    rows: [{ id: 'ud', label: 'EUR/USD daily close', yes: 0.46, no: 0.55, fair: 0.45, liquidity: 16225, vol: 64900 }],
  },
  {
    id: 'gold',
    cat: 'finance',
    trending: false,
    title: 'Gold (GC) Up or Down on October 21?',
    abbr: 'GC',
    tags: ['Finance', 'Commodities', 'Gold', 'Daily'],
    open: 'Oct 20',
    start: 'Oct 20, 2026 18:00',
    end: 'Oct 21, 2026 17:00',
    endDate: 'Oct 21',
    endTime: '5:00 PM',
    vol24: 29500,
    volTotal: 51300,
    kind: 'binary',
    yesLabel: 'Up',
    noLabel: 'Down',
    lac: { product: 'future', path: 'Commodities · Gold · 1d' },
    rows: [{ id: 'ud', label: 'Gold daily settle', yes: 0.5, no: 0.51, fair: 0.44, liquidity: 12825, vol: 51300 }],
  },
  {
    id: 'lakers',
    cat: 'sports',
    trending: false,
    title: 'Lakers vs. Celtics',
    abbr: 'NBA',
    tags: ['Sports', 'Basketball', 'NBA'],
    open: 'Oct 14',
    start: 'Oct 21, 2026 19:30',
    end: 'Oct 21, 2026 22:00',
    endDate: 'Oct 21',
    endTime: '10:00 PM',
    vol24: 642000,
    volTotal: 1210000,
    kind: 'binary',
    yesLabel: 'Lakers',
    noLabel: 'Celtics',
    lac: { product: 'sport', path: 'Basketball · NBA', sport: 'basketball' },
    rows: [{ id: 'ml', label: 'Moneyline', yes: 0.43, no: 0.58, fair: 0.37, liquidity: 302500, vol: 1210000 }],
  },
  {
    id: 'shutdown',
    cat: 'politics',
    trending: false,
    title: 'US government shutdown by November 1?',
    abbr: 'GOV',
    tags: ['Politics', 'US', 'Congress'],
    open: 'Sep 2',
    start: 'Sep 2, 2026 09:00',
    end: 'Nov 1, 2026 23:59',
    endDate: 'Nov 1',
    endTime: '11:59 PM',
    vol24: 318400,
    volTotal: 4020000,
    kind: 'binary',
    yesLabel: 'Yes',
    noLabel: 'No',
    lac: null,
    rows: [{ id: 'yn', label: 'Shutdown by Nov 1', yes: 0.18, no: 0.83, liquidity: 1005000, vol: 4020000 }],
  },
  {
    id: 'ceasefire',
    cat: 'geopolitics',
    trending: false,
    title: 'Russia × Ukraine ceasefire in 2026?',
    abbr: 'GEO',
    tags: ['Geopolitics', 'Russia', 'Ukraine'],
    open: 'Jan 3',
    start: 'Jan 3, 2026 09:00',
    end: 'Dec 31, 2026 23:59',
    endDate: 'Dec 31',
    endTime: '11:59 PM',
    vol24: 207100,
    volTotal: 18600000,
    kind: 'binary',
    yesLabel: 'Yes',
    noLabel: 'No',
    lac: null,
    rows: [{ id: 'yn', label: 'Ceasefire in 2026', yes: 0.12, no: 0.89, liquidity: 4650000, vol: 18600000 }],
  },
];

export const SIGNALS: Signal[] = [
  {
    id: 's1',
    product: 'weather',
    market: 'London',
    title: 'Daily high · London 17°C',
    sideLabel: 'YES',
    side: 'yes',
    eventId: 'london',
    outcomeId: 'c17',
    avg: 0.47,
    depth: 2400,
    updatedSec: 32,
    minutesLeft: 493,
  },
  {
    id: 's2',
    product: 'weather',
    market: 'London',
    title: 'Daily high · London 19°C or higher',
    sideLabel: 'NO',
    side: 'no',
    eventId: 'london',
    outcomeId: 'c19',
    avg: 0.9,
    depth: 3100,
    updatedSec: 32,
    minutesLeft: 493,
  },
  {
    id: 's3',
    product: 'weather',
    market: 'New York',
    title: 'Daily high · New York 66–67°F',
    sideLabel: 'YES',
    side: 'yes',
    eventId: 'nyc',
    outcomeId: 'f66',
    avg: 0.24,
    depth: 1200,
    updatedSec: 64,
    minutesLeft: 880,
  },
  {
    id: 's4',
    product: 'weather',
    market: 'New York',
    title: 'Daily high · New York 70–71°F',
    sideLabel: 'NO',
    side: 'no',
    eventId: 'nyc',
    outcomeId: 'f70',
    avg: 0.85,
    depth: 900,
    updatedSec: 64,
    minutesLeft: 880,
  },
  {
    id: 's5',
    product: 'crypto',
    market: 'BTC',
    title: 'BTC · 5m Up/Down',
    sideLabel: 'UP',
    side: 'yes',
    eventId: 'btc',
    outcomeId: 'ud',
    avg: 0.42,
    depth: 4800,
    updatedSec: 120,
    minutesLeft: 319,
  },
  {
    id: 's6',
    product: 'crypto',
    market: 'ETH',
    title: 'ETH · 15m Up/Down',
    sideLabel: 'DOWN',
    side: 'no',
    eventId: 'eth',
    outcomeId: 'ud',
    avg: 0.47,
    depth: 2100,
    updatedSec: 75,
    minutesLeft: 329,
  },
  {
    id: 's7',
    product: 'future',
    market: 'Gold',
    title: 'Gold (GC) · D1 Up/Down',
    sideLabel: 'DOWN',
    side: 'no',
    eventId: 'gold',
    outcomeId: 'ud',
    avg: 0.53,
    depth: 900,
    updatedSec: 240,
    minutesLeft: 74,
  },
  {
    id: 's8',
    product: 'sport',
    market: 'Soccer',
    sport: 'soccer',
    title: 'Arsenal vs. Chelsea · Arsenal',
    sideLabel: 'YES',
    side: 'yes',
    eventId: 'arsenal',
    outcomeId: 'ars',
    avg: 0.57,
    depth: 5200,
    updatedSec: 45,
    minutesLeft: 1754,
  },
  {
    id: 's9',
    product: 'sport',
    market: 'Soccer',
    sport: 'soccer',
    title: 'Arsenal vs. Chelsea · Chelsea',
    sideLabel: 'NO',
    side: 'no',
    eventId: 'arsenal',
    outcomeId: 'che',
    avg: 0.8,
    depth: 1800,
    updatedSec: 45,
    minutesLeft: 1754,
  },
  {
    id: 's10',
    product: 'sport',
    market: 'Basketball',
    sport: 'basketball',
    title: 'Lakers vs. Celtics · Celtics',
    sideLabel: 'CELTICS',
    side: 'no',
    eventId: 'lakers',
    outcomeId: 'ml',
    avg: 0.6,
    depth: 3400,
    updatedSec: 120,
    minutesLeft: 374,
  },
];
