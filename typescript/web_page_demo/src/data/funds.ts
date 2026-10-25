import type { StockMarket } from './stocks';

// Sample fund holdings for the Stocks page in Demo mode. Fund codes and names are real; the weights are made up.
// Only stocks in data/stocks.ts are listed; the rest of each fund is one "others" line (see lib/stocks.ts).

export interface Fund {
  code: string;
  market: StockMarket;
  name: { en: string; zh: string };
  /** ISO day the holdings are as of. */
  asOf: string;
  /** Weight (%) per stock code, one decimal. */
  holdings: Record<string, number>;
}

export const DEMO_FUNDS: Fund[] = [
  {
    code: '0050',
    market: 'tw',
    name: { en: 'Yuanta Taiwan Top 50 ETF', zh: '元大台灣50' },
    asOf: '2026-09-30',
    holdings: {
      '2330': 58.2,
      '2317': 4.6,
      '2454': 4.1,
      '2308': 2.3,
      '2382': 1.6,
      '2881': 1.9,
      '2882': 1.6,
      '2412': 1.2,
      '1301': 0.5,
      '2303': 1.0,
    },
  },
  {
    code: '006208',
    market: 'tw',
    name: { en: 'Fubon Taiwan 50 ETF', zh: '富邦台50' },
    asOf: '2026-09-30',
    holdings: {
      '2330': 57.9,
      '2317': 4.7,
      '2454': 4.2,
      '2308': 2.2,
      '2382': 1.6,
      '2881': 1.9,
      '2882': 1.5,
      '2412': 1.2,
      '1301': 0.5,
      '2303': 1.0,
    },
  },
  {
    code: '0056',
    market: 'tw',
    name: { en: 'Yuanta Taiwan High Dividend ETF', zh: '元大高股息' },
    asOf: '2026-09-30',
    holdings: { '2382': 3.4, '2303': 3.1, '2882': 2.6, '2881': 2.2, '1301': 1.8, '2412': 1.5 },
  },
  {
    code: '00878',
    market: 'tw',
    name: { en: 'Cathay Sustainable High Dividend ETF', zh: '國泰永續高股息' },
    asOf: '2026-09-30',
    holdings: { '2882': 4.3, '2881': 4.1, '2303': 3.8, '2412': 3.2, '2308': 2.4, '2317': 2.1 },
  },
  {
    code: 'SPY',
    market: 'us',
    name: { en: 'SPDR S&P 500 ETF Trust', zh: 'SPDR S&P 500 ETF Trust' },
    asOf: '2026-09-30',
    holdings: {
      NVDA: 7.6,
      MSFT: 6.7,
      AAPL: 6.4,
      AMZN: 3.9,
      META: 2.9,
      AVGO: 2.6,
      GOOGL: 2.3,
      TSLA: 2.1,
      JPM: 1.5,
      XOM: 0.9,
    },
  },
  {
    code: 'QQQ',
    market: 'us',
    name: { en: 'Invesco QQQ Trust', zh: 'Invesco QQQ Trust' },
    asOf: '2026-09-30',
    holdings: { NVDA: 9.8, MSFT: 8.6, AAPL: 8.2, AMZN: 5.5, AVGO: 5.3, META: 3.6, TSLA: 3.3, GOOGL: 2.9 },
  },
  {
    code: 'VTI',
    market: 'us',
    name: { en: 'Vanguard Total Stock Market ETF', zh: 'Vanguard Total Stock Market ETF' },
    asOf: '2026-09-30',
    holdings: {
      NVDA: 6.5,
      MSFT: 5.8,
      AAPL: 5.5,
      AMZN: 3.4,
      META: 2.5,
      AVGO: 2.2,
      GOOGL: 2.0,
      TSLA: 1.8,
      JPM: 1.3,
      XOM: 0.8,
    },
  },
  {
    code: 'XLK',
    market: 'us',
    name: { en: 'Technology Select Sector SPDR Fund', zh: 'Technology Select Sector SPDR Fund' },
    asOf: '2026-09-30',
    holdings: { NVDA: 14.6, MSFT: 12.9, AAPL: 12.3, AVGO: 5.1 },
  },
];
