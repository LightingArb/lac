// Sample stocks for the Stocks page in Demo mode. Codes and names are real; every price and number is made up.
// Daily candles are not stored: lib/stocks.ts `dailyCandles` draws them from each stock's seed, ending on the
// Demo "today" at the current price.

export type StockMarket = 'tw' | 'us';

/** Holding periods: Q is a quarter, so Q+12 is three years. */
export const HOLDINGS = ['Q+1', 'Q+2', 'Q+4', 'Q+8', 'Q+12'] as const;
export type Holding = (typeof HOLDINGS)[number];
export const DEFAULT_HOLDING: Holding = 'Q+4';

/** Demo "today" (a Friday): the last candle, so the sample means the same whenever it is opened. */
export const STOCKS_DEMO_TODAY = '2026-10-23';

export interface Stock {
  code: string;
  market: StockMarket;
  name: { en: string; zh: string };
  /** Current price: the last close of the candles. */
  price: number;
  /** Fair price per holding period, in HOLDINGS order. */
  fair: number[];
  /** Chance (%) of reaching that fair price within the holding period, in HOLDINGS order. */
  chance: number[];
  /** Candle generator inputs: seed, typical daily move and average daily volume. */
  seed: number;
  volatility: number;
  volume: number;
}

const stock = (
  market: StockMarket,
  code: string,
  [en, zh]: [string, string],
  price: number,
  fair: number[],
  chance: number[],
  [seed, volatility, volume]: [number, number, number],
): Stock => ({ code, market, name: { en, zh }, price, fair, chance, seed, volatility, volume });

// prettier-ignore
export const DEMO_STOCKS: Stock[] = [
  // Taiwan, in NT$; volume in shares.
  stock('tw', '2330', ['TSMC', '台積電'], 1085, [1120, 1180, 1400, 1520, 1650], [61.2, 59.8, 56.7, 54.1, 52.3], [2330, 0.018, 32000000]),
  stock('tw', '2317', ['Hon Hai', '鴻海'], 212.5, [220, 228, 245, 262, 280], [58.3, 57.1, 55.2, 53.4, 51.7], [2317, 0.021, 48000000]),
  stock('tw', '2454', ['MediaTek', '聯發科'], 1390, [1350, 1420, 1500, 1620, 1750], [46.8, 52.4, 54.9, 53.6, 51.2], [2454, 0.022, 6500000]),
  stock('tw', '2308', ['Delta Electronics', '台達電'], 985, [1010, 1050, 1120, 1210, 1300], [57.5, 56.2, 54.8, 52.9, 50.6], [2308, 0.02, 7800000]),
  stock('tw', '2382', ['Quanta', '廣達'], 296, [305, 318, 340, 365, 390], [59.1, 57.7, 55.6, 53.2, 51.4], [2382, 0.025, 21000000]),
  stock('tw', '2881', ['Fubon Financial', '富邦金'], 88.6, [90, 92, 96, 101, 108], [62.4, 60.3, 58.1, 55.7, 53.9], [2881, 0.013, 26000000]),
  stock('tw', '2882', ['Cathay Financial', '國泰金'], 64.3, [65, 66.5, 69, 72, 76], [63.5, 61.2, 58.8, 56.4, 54.0], [2882, 0.013, 31000000]),
  stock('tw', '2412', ['Chunghwa Telecom', '中華電'], 128.5, [129, 130, 132, 135, 138], [66.1, 63.8, 61.5, 59.2, 57.3], [2412, 0.007, 7200000]),
  stock('tw', '1301', ['Formosa Plastics', '台塑'], 38.75, [37, 38, 41, 44, 48], [44.6, 49.3, 52.7, 51.8, 49.5], [1301, 0.019, 15000000]),
  stock('tw', '2303', ['UMC', '聯電'], 46.2, [47, 48.5, 51, 54, 58], [57.9, 56.3, 54.4, 52.6, 50.8], [2303, 0.02, 52000000]),
  // United States, in US$; volume in shares.
  stock('us', 'AAPL', ['Apple', 'Apple'], 262.35, [268, 275, 290, 310, 335], [59.4, 58.0, 56.1, 54.3, 52.6], [7101, 0.016, 52000000]),
  stock('us', 'MSFT', ['Microsoft', 'Microsoft'], 518.4, [530, 545, 575, 610, 650], [60.2, 58.7, 56.9, 54.8, 53.1], [7102, 0.015, 21000000]),
  stock('us', 'NVDA', ['NVIDIA', 'NVIDIA'], 186.9, [195, 205, 225, 250, 280], [56.8, 55.1, 53.4, 51.6, 49.9], [7103, 0.03, 180000000]),
  stock('us', 'AMZN', ['Amazon', 'Amazon'], 224.15, [230, 238, 255, 275, 300], [58.6, 57.2, 55.3, 53.5, 51.8], [7104, 0.02, 41000000]),
  stock('us', 'GOOGL', ['Alphabet', 'Alphabet'], 251.6, [258, 265, 280, 300, 325], [59.0, 57.6, 55.7, 53.9, 52.2], [7105, 0.019, 33000000]),
  stock('us', 'META', ['Meta Platforms', 'Meta Platforms'], 733.2, [745, 760, 800, 850, 910], [58.1, 56.9, 55.0, 53.1, 51.5], [7106, 0.022, 12000000]),
  stock('us', 'TSLA', ['Tesla', 'Tesla'], 438.5, [410, 420, 450, 480, 520], [47.2, 50.6, 52.3, 51.0, 49.4], [7107, 0.035, 95000000]),
  stock('us', 'JPM', ['JPMorgan Chase', 'JPMorgan Chase'], 298.7, [302, 308, 318, 332, 350], [61.7, 60.0, 57.9, 55.6, 53.6], [7108, 0.014, 9000000]),
  stock('us', 'XOM', ['Exxon Mobil', 'Exxon Mobil'], 113.4, [112, 114, 118, 122, 127], [52.3, 55.8, 56.4, 54.7, 52.9], [7109, 0.015, 15000000]),
  stock('us', 'AVGO', ['Broadcom', 'Broadcom'], 349.8, [360, 372, 395, 425, 460], [57.3, 55.9, 54.1, 52.4, 50.7], [7110, 0.026, 24000000]),
];

export const CURRENCY: Record<StockMarket, 'TWD' | 'USD'> = { tw: 'TWD', us: 'USD' };
