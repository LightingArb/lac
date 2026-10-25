import { AMOUNT_RANGES, CONGRESS_MEMBERS, CONGRESS_TRADES } from '../data/congress';
import type { CongressMember, CongressTrade, TradeSide } from '../data/congress';
import { DEMO_FUNDS, type Fund } from '../data/funds';
import { addDays } from '../data/products';
import {
  DEMO_STOCKS,
  HOLDINGS,
  STOCKS_DEMO_TODAY,
  quarters,
  type Holding,
  type Stock,
  type StockMarket,
} from '../data/stocks';
import type { Messages } from '../i18n/en';

// Stocks page: daily candles and earnings reports drawn from a seed, the range boxes on the chart, congress filings
// and fund holdings. Pure functions over the Demo data, so the page and the tests read the same rules.

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
export const DEFAULT_INDICATORS: StockIndicator[] = ['VOL'];

// ---- Prices ----

/** NT$ with up to two decimals (1,085 or 38.75); US$ always with two (262.35). */
export function formatPrice(market: StockMarket, value: number): string {
  return value.toLocaleString(
    'en-US',
    market === 'tw' ? { maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
}

/** Upside: fair price ÷ current price − 1. */
export const upside = (fair: number, price: number) => fair / price - 1;

/** Upside as a signed percent to one decimal: 1,400 on 1,085 → "+29.0%". */
export function upsideText(fair: number, price: number): string {
  const percent = upside(fair, price) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
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

/** The UTC midnight `count` weekdays after `timestamp` (a candle day): where the chart's candle grid continues. */
export function weekdaysAfter(timestamp: number, count: number): number {
  let ms = timestamp;
  for (let left = count; left > 0; ) {
    ms += DAY_MS;
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return ms;
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

// ---- Earnings reports and range boxes ----

/** Where the price may stand when a holding period ends, as modelled on one report day. */
export interface PriceRange {
  /** Bottom and top of the range: everything outside is an outlier. */
  lower: number;
  upper: number;
  /** Half of the outcomes end below it. */
  median: number;
  /** The average outcome (EV = 0). */
  fair: number;
}

export interface EarningsReport {
  /** ISO day the results came out: a weekday with a candle. */
  date: string;
  /** One range per holding period, in HOLDINGS order. */
  ranges: PriceRange[];
}

const roundPrice = (value: number) => (value >= 100 ? Math.round(value) : cents(value));

/**
 * About three years of earnings reports, 84 to 100 days apart (84 to 98 days on, moved to the next weekday), the last
 * one before `today`. Each report gives every holding period a range around that day's close: wider for a longer
 * holding period, the median and the fair price inside it. Seeded per stock, like the candles.
 */
export function earningsReports(
  stock: Stock,
  candles = dailyCandles(stock),
  today = STOCKS_DEMO_TODAY,
): EarningsReport[] {
  const random = seededRandom(stock.seed * 31 + 7);
  const closes = new Map(candles.map((c) => [isoDay(c.timestamp), c.close]));
  const tradingDay = (iso: string) => {
    let day = iso;
    while (!closes.has(day)) day = addDays(day, 1);
    return day;
  };
  // A quarter is about 63 trading days.
  const quarterMove = stock.volatility * Math.sqrt(63);
  const reports: EarningsReport[] = [];
  let date = tradingDay(addDays(isoDay(candles[0].timestamp), 20 + Math.floor(random() * 40)));
  while (date < today) {
    const base = closes.get(date)!;
    const width = 0.9 + 0.2 * random();
    const [down, up] = [0.85 + 0.3 * random(), 0.85 + 0.3 * random()];
    const drift = -0.008 + 0.033 * random();
    const [middle, fairShift] = [random(), random()];
    reports.push({
      date,
      ranges: HOLDINGS.map((holding) => {
        const q = quarters(holding);
        const spread = quarterMove * Math.sqrt(q) * width;
        const at = (shift: number) => roundPrice(base * Math.exp(drift * q + spread * shift));
        return { lower: at(-down), upper: at(up), median: at(0.15 * (middle - 0.5)), fair: at(0.04 + 0.1 * fairShift) };
      }),
    });
    const next = addDays(date, 84 + Math.floor(random() * 15));
    if (next >= today) break;
    date = tradingDay(next);
  }
  return reports;
}

const SERIES = new WeakMap<Stock, { candles: Candle[]; reports: EarningsReport[] }>();

/** A Demo stock's candles and reports, drawn once per stock. */
export function stockSeries(stock: Stock): { candles: Candle[]; reports: EarningsReport[] } {
  let series = SERIES.get(stock);
  if (!series) {
    const candles = dailyCandles(stock);
    series = { candles, reports: earningsReports(stock, candles) };
    SERIES.set(stock, series);
  }
  return series;
}

/** The list and the figures above the chart: the latest report's range for the holding period. */
export function latestRange(stock: Stock, holding: Holding): PriceRange {
  const reports = stockSeries(stock).reports;
  return reports[reports.length - 1].ranges[HOLDINGS.indexOf(holding)];
}

export interface RangeBox {
  /** The report day, and the day the box ends. */
  from: string;
  to: string;
  /** Candle indexes on the chart; the latest box's `end` lies past the last candle, in the space after today. */
  start: number;
  end: number;
  latest: boolean;
  range: PriceRange;
}

/**
 * One box per report for the holding period. A past report's box ends on the next report day, so boxes never
 * overlap, whatever the holding period; the latest report's box runs N × 90 days (Q+1 90 days, Q+12 1,080 days).
 */
export function rangeBoxes(reports: EarningsReport[], candles: Candle[], holding: Holding): RangeBox[] {
  const first = isoDay(candles[0].timestamp);
  // Candles are every weekday, so a day's index is the number of weekdays since the first candle.
  const index = (iso: string) => weekdays(first, iso).length;
  const i = HOLDINGS.indexOf(holding);
  return reports.map((report, n) => {
    const latest = n === reports.length - 1;
    const to = latest ? addDays(report.date, 90 * quarters(holding)) : reports[n + 1].date;
    return { from: report.date, to, start: index(report.date), end: index(to), latest, range: report.ranges[i] };
  });
}

/** Opening view, in candles: about the last year, and after the last candle the latest box's first ~3 months. */
export function openingView(candles: Candle[], reports: EarningsReport[]): { past: number; future: number } {
  const last = isoDay(candles[candles.length - 1].timestamp);
  return {
    past: weekdays(addDays(last, -365), last).length,
    future: weekdays(last, addDays(reports[reports.length - 1].date, 91)).length,
  };
}

/**
 * The chart's price axis: the range of the candles in view (KLineChart's own, with the indicators drawn on them),
 * widened to the latest box when it is in view. Past boxes don't widen it: a tall Q+8 or Q+12 box would squash the
 * candles, so the part of it beyond is cut off. `view` is the candle indexes on screen, after any drag or zoom.
 */
export function priceAxis(
  candles: { from: number; to: number },
  boxes: RangeBox[],
  view: { from: number; to: number },
): { from: number; to: number } {
  const latest = boxes.find((b) => b.latest);
  if (!latest || latest.end < view.from || latest.start > view.to) return { from: candles.from, to: candles.to };
  return { from: Math.min(candles.from, latest.range.lower), to: Math.max(candles.to, latest.range.upper) };
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
