// Sample stocks for the Stocks page in Demo mode. Codes and names are real; every price and number is made up.
// Nothing else is stored: lib/stocks.ts draws each stock's daily candles and its earnings reports (the five numbers
// per holding period) from the stock's seed, ending on the Demo "today" at the current price.

export type StockMarket = 'tw' | 'us';

/** Holding periods: Q is a quarter (90 days on the chart), so Q+12 is three years. */
export const HOLDINGS = ['Q+1', 'Q+2', 'Q+4', 'Q+8', 'Q+12'] as const;
export type Holding = (typeof HOLDINGS)[number];
export const DEFAULT_HOLDING: Holding = 'Q+4';

/** Quarters in a holding period: Q+4 → 4. */
export const quarters = (holding: Holding) => Number(holding.slice(2));

/** Demo "today" (a Friday): the last candle, so the sample means the same whenever it is opened. */
export const STOCKS_DEMO_TODAY = '2026-10-23';

export interface Stock {
  code: string;
  market: StockMarket;
  name: { en: string; zh: string };
  /** Current price: the last close of the candles. */
  price: number;
  /** Generator inputs: seed, typical daily move and average daily volume. */
  seed: number;
  volatility: number;
  volume: number;
}

const stock = (
  market: StockMarket,
  code: string,
  [en, zh]: [string, string],
  price: number,
  [seed, volatility, volume]: [number, number, number],
): Stock => ({ code, market, name: { en, zh }, price, seed, volatility, volume });

// prettier-ignore
export const DEMO_STOCKS: Stock[] = [
  // Taiwan, in NT$; volume in shares.
  stock('tw', '2330', ['TSMC', '台積電'], 1085, [2330, 0.018, 32000000]),
  stock('tw', '2317', ['Hon Hai', '鴻海'], 212.5, [2317, 0.021, 48000000]),
  stock('tw', '2454', ['MediaTek', '聯發科'], 1390, [2454, 0.022, 6500000]),
  stock('tw', '2308', ['Delta Electronics', '台達電'], 985, [2308, 0.02, 7800000]),
  stock('tw', '2382', ['Quanta', '廣達'], 296, [2382, 0.025, 21000000]),
  stock('tw', '2881', ['Fubon Financial', '富邦金'], 88.6, [2881, 0.013, 26000000]),
  stock('tw', '2882', ['Cathay Financial', '國泰金'], 64.3, [2882, 0.013, 31000000]),
  stock('tw', '2412', ['Chunghwa Telecom', '中華電'], 128.5, [2412, 0.007, 7200000]),
  stock('tw', '1301', ['Formosa Plastics', '台塑'], 38.75, [1301, 0.019, 15000000]),
  stock('tw', '2303', ['UMC', '聯電'], 46.2, [2303, 0.02, 52000000]),
  // United States, in US$; volume in shares.
  stock('us', 'AAPL', ['Apple', 'Apple'], 262.35, [7101, 0.016, 52000000]),
  stock('us', 'MSFT', ['Microsoft', 'Microsoft'], 518.4, [7102, 0.015, 21000000]),
  stock('us', 'NVDA', ['NVIDIA', 'NVIDIA'], 186.9, [7103, 0.03, 180000000]),
  stock('us', 'AMZN', ['Amazon', 'Amazon'], 224.15, [7104, 0.02, 41000000]),
  stock('us', 'GOOGL', ['Alphabet', 'Alphabet'], 251.6, [7105, 0.019, 33000000]),
  stock('us', 'META', ['Meta Platforms', 'Meta Platforms'], 733.2, [7106, 0.022, 12000000]),
  stock('us', 'TSLA', ['Tesla', 'Tesla'], 438.5, [7107, 0.035, 95000000]),
  stock('us', 'JPM', ['JPMorgan Chase', 'JPMorgan Chase'], 298.7, [7108, 0.014, 9000000]),
  stock('us', 'XOM', ['Exxon Mobil', 'Exxon Mobil'], 113.4, [7109, 0.015, 15000000]),
  stock('us', 'AVGO', ['Broadcom', 'Broadcom'], 349.8, [7110, 0.026, 24000000]),
];

export const CURRENCY: Record<StockMarket, 'TWD' | 'USD'> = { tw: 'TWD', us: 'USD' };
