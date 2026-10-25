import { AMOUNT_RANGES, CONGRESS_MEMBERS, CONGRESS_TRADES } from '../data/congress';
import type { CongressMember, CongressTrade, TradeSide } from '../data/congress';
import { DEMO_FUNDS, type Fund } from '../data/funds';
import { DEMO_STOCKS, HOLDINGS, STOCKS_DEMO_TODAY, type Holding, type Stock, type StockMarket } from '../data/stocks';
import type { Messages } from '../i18n/en';

// Stocks page: daily candles drawn from a seed, the fair price per holding period, congress filings and fund
// holdings. Pure functions over the Demo data, so the page and the tests read the same rules.

export type StockTab = 'analysis' | 'congress' | 'funds';

/** Congress filings are US-only, so Taiwan has no congress tab. */
export const tabsFor = (market: StockMarket): StockTab[] =>
  market === 'us' ? ['analysis', 'congress', 'funds'] : ['analysis', 'funds'];

export const stockName = (t: Messages, stock: Stock) => (t.lang === 'zh-Hant' ? stock.name.zh : stock.name.en);
export const fundName = (t: Messages, fund: Fund) => (t.lang === 'zh-Hant' ? fund.name.zh : fund.name.en);
export const stockByCode = (code: string, stocks = DEMO_STOCKS) => stocks.find((s) => s.code === code);

/** Code or name (either language), within one market; an empty query lists the whole market. */
export function searchStocks(market: StockMarket, query: string, stocks = DEMO_STOCKS): Stock[] {
  const q = query.trim().toLowerCase();
  return stocks.filter(
    (s) =>
      s.market === market &&
      (s.code.toLowerCase().includes(q) || s.name.en.toLowerCase().includes(q) || s.name.zh.includes(q)),
  );
}

/** KLineChart's built-in indicators the page offers: MA and BOLL on the candles, the rest in panes below. */
export const MAIN_INDICATORS = ['MA', 'BOLL'] as const;
export const SUB_INDICATORS = ['VOL', 'MACD', 'KDJ', 'RSI'] as const;
export type StockIndicator = (typeof MAIN_INDICATORS)[number] | (typeof SUB_INDICATORS)[number];
export const INDICATORS: StockIndicator[] = [...MAIN_INDICATORS, ...SUB_INDICATORS];
export const DEFAULT_INDICATORS: StockIndicator[] = ['MA', 'VOL'];

// ---- Fair price ----

export function fairOf(stock: Stock, holding: Holding): { price: number; chance: number } {
  const i = HOLDINGS.indexOf(holding);
  return { price: stock.fair[i], chance: stock.chance[i] };
}

/** NT$ with up to two decimals (1,085 or 38.75); US$ always with two (262.35). */
export function formatPrice(market: StockMarket, value: number): string {
  return value.toLocaleString(
    'en-US',
    market === 'tw' ? { maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
}

export const formatChance = (chance: number) => `${chance.toFixed(1)}%`;

/** "到 1,400 的機率 56.7%" or "56.7% to reach 1,400" for the holding period. */
export function chanceText(t: Messages, stock: Stock, holding: Holding): string {
  const { price, chance } = fairOf(stock, holding);
  return t.stocks.chance(formatPrice(stock.market, price), formatChance(chance));
}

// ---- Daily candles ----

export interface Candle {
  /** UTC midnight of the trading day. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const CANDLE_YEARS = 3;

const DAY_MS = 86_400_000;
export const dayStart = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Weekdays after `from`, up to and including `to`, as UTC midnights; holidays are not modelled. */
export function weekdays(from: string, to: string): number[] {
  const days: number[] = [];
  for (let ms = dayStart(from) + DAY_MS; ms <= dayStart(to); ms += DAY_MS) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(ms);
  }
  return days;
}

/** Seeded uniform numbers in [0, 1) (mulberry32): the same seed gives the same sequence every time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * About three years of weekday candles ending on `today`: a seeded random walk around the stock's typical daily
 * move, scaled so the last close is the current price; prices to two decimals, high and low around open and close.
 */
export function dailyCandles(
  stock: Pick<Stock, 'seed' | 'price' | 'volatility' | 'volume'>,
  today = STOCKS_DEMO_TODAY,
): Candle[] {
  const [year, rest] = [Number(today.slice(0, 4)), today.slice(4)];
  const days = weekdays(`${year - CANDLE_YEARS}${rest}`, today);
  const random = seededRandom(stock.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const move = stock.volatility;
  let previous = 1;
  const raw = days.map((timestamp) => {
    const open = previous * (1 + gauss() * move * 0.3);
    const close = open * Math.exp(gauss() * move);
    const high = Math.max(open, close) * (1 + Math.abs(gauss()) * move * 0.5);
    const low = Math.min(open, close) * (1 - Math.abs(gauss()) * move * 0.5);
    previous = close;
    return { timestamp, open, high, low, close, volume: Math.round(stock.volume * Math.exp(gauss() * 0.35)) };
  });
  const scale = stock.price / raw[raw.length - 1].close;
  return raw.map((c, i) => {
    const open = cents(c.open * scale);
    const close = i === raw.length - 1 ? stock.price : cents(c.close * scale);
    return {
      timestamp: c.timestamp,
      open,
      high: Math.max(cents(c.high * scale), open, close),
      low: Math.min(cents(c.low * scale), open, close),
      close,
      volume: c.volume,
    };
  });
}

// ---- Congress filings ----

/** "$1,001 – $15,000", the report's own brackets. */
export function amountText(bracket: number): string {
  const [low, high] = AMOUNT_RANGES[bracket];
  return `$${low.toLocaleString('en-US')} – $${high.toLocaleString('en-US')}`;
}

export interface MemberRow {
  member: CongressMember;
  trades: number;
  lastFiled: string;
}

/** Members with their number of trades and latest filing day; the most recent filer first. */
export function congressMembers(members = CONGRESS_MEMBERS, trades = CONGRESS_TRADES): MemberRow[] {
  return members
    .map((member) => {
      const own = trades.filter((trade) => trade.memberId === member.id);
      return {
        member,
        trades: own.length,
        lastFiled:
          own
            .map((trade) => trade.filedOn)
            .sort()
            .at(-1) ?? '',
      };
    })
    .sort((a, b) => b.lastFiled.localeCompare(a.lastFiled) || a.member.name.localeCompare(b.member.name));
}

/** One member's trades, newest trade day first (then newest filing). */
export function memberTrades(memberId: string, trades = CONGRESS_TRADES): CongressTrade[] {
  return trades
    .filter((trade) => trade.memberId === memberId)
    .sort((a, b) => b.tradedOn.localeCompare(a.tradedOn) || b.filedOn.localeCompare(a.filedOn));
}

export interface TradeMark {
  /** UTC midnight of the trade day, as the candles. */
  timestamp: number;
  side: TradeSide;
  tradedOn: string;
  filedOn: string;
  amount: string;
}

/** Chart marks for one member on one stock: every trade day, buys and sells kept apart, oldest first. */
export function tradeMarks(memberId: string, code: string, trades = CONGRESS_TRADES): TradeMark[] {
  return trades
    .filter((trade) => trade.memberId === memberId && trade.code === code)
    .sort((a, b) => a.tradedOn.localeCompare(b.tradedOn))
    .map((trade) => ({
      timestamp: dayStart(trade.tradedOn),
      side: trade.side,
      tradedOn: trade.tradedOn,
      filedOn: trade.filedOn,
      amount: amountText(trade.amount),
    }));
}

// ---- Fund holdings ----

export interface HoldingRow {
  /** Null for the "others" line: everything outside the Demo stocks, not clickable. */
  stock: Stock | null;
  weight: number;
}

const tenths = (weight: number) => Math.round(weight * 10);

/** A fund's holdings, largest weight first, then one "others" line so the weights add up to 100%. */
export function fundHoldings(fund: Fund, stocks = DEMO_STOCKS): HoldingRow[] {
  const rows = Object.entries(fund.holdings)
    .map(([code, weight]) => ({ stock: stockByCode(code, stocks)!, weight }))
    .sort((a, b) => b.weight - a.weight || a.stock.code.localeCompare(b.stock.code));
  const listed = rows.reduce((sum, row) => sum + tenths(row.weight), 0);
  return [...rows, { stock: null, weight: (1000 - listed) / 10 }];
}

/** The funds holding one stock, largest weight first. */
export function fundsHolding(code: string, funds = DEMO_FUNDS): { fund: Fund; weight: number }[] {
  return funds
    .filter((fund) => fund.holdings[code] !== undefined)
    .map((fund) => ({ fund, weight: fund.holdings[code] }))
    .sort((a, b) => b.weight - a.weight || a.fund.code.localeCompare(b.fund.code));
}

/** Fund code or name (either language), within one market. */
export function searchFunds(market: StockMarket, query: string, funds = DEMO_FUNDS): Fund[] {
  const q = query.trim().toLowerCase();
  return funds.filter(
    (f) =>
      f.market === market &&
      (f.code.toLowerCase().includes(q) || f.name.en.toLowerCase().includes(q) || f.name.zh.includes(q)),
  );
}
