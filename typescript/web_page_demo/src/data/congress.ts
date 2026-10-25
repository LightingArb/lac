import { addDays } from './products';

// Sample congressional trade filings for the Stocks page in Demo mode (US stocks only). Every member is FICTIONAL:
// a made-up trade under a real person's name would read as a real record. Tickers are in data/stocks.ts; trade
// dates are weekdays inside the candles' three years, filed 1 to 45 days later.

export type Chamber = 'senate' | 'house';
export type Party = 'D' | 'R' | 'I';
export type TradeSide = 'buy' | 'sell';

/** Amount brackets of the congressional periodic transaction report, in US$. */
export const AMOUNT_RANGES: [number, number][] = [
  [1001, 15000],
  [15001, 50000],
  [50001, 100000],
  [100001, 250000],
  [250001, 500000],
  [500001, 1000000],
  [1000001, 5000000],
];

export interface CongressMember {
  id: string;
  name: string;
  chamber: Chamber;
  party: Party;
}

export interface CongressTrade {
  id: string;
  memberId: string;
  code: string;
  side: TradeSide;
  /** ISO days. */
  tradedOn: string;
  filedOn: string;
  /** Index into AMOUNT_RANGES. */
  amount: number;
}

export const CONGRESS_MEMBERS: CongressMember[] = [
  { id: 'avery-linwood', name: 'Avery Linwood', chamber: 'senate', party: 'D' },
  { id: 'morgan-ellery', name: 'Morgan Ellery', chamber: 'house', party: 'R' },
  { id: 'dana-whitcombe', name: 'Dana Whitcombe', chamber: 'house', party: 'D' },
  { id: 'elliot-varga', name: 'Elliot Varga', chamber: 'senate', party: 'R' },
  { id: 'riley-okonjo', name: 'Riley Okonjo', chamber: 'house', party: 'I' },
];

/** One member's filings: [ticker, trade day, days until filed, buy or sell, amount bracket]. */
type Filing = [string, string, number, TradeSide, number];

const filings = (memberId: string, rows: Filing[]): CongressTrade[] =>
  rows.map(([code, tradedOn, days, side, amount], i) => ({
    id: `${memberId}-${i + 1}`,
    memberId,
    code,
    side,
    tradedOn,
    filedOn: addDays(tradedOn, days),
    amount,
  }));

export const CONGRESS_TRADES: CongressTrade[] = [
  ...filings('avery-linwood', [
    ['NVDA', '2024-01-17', 28, 'buy', 1],
    ['NVDA', '2024-06-12', 30, 'sell', 1],
    ['NVDA', '2025-02-04', 41, 'buy', 2],
    ['AAPL', '2025-05-20', 22, 'buy', 0],
    ['MSFT', '2025-09-16', 35, 'buy', 1],
    ['NVDA', '2026-04-08', 27, 'sell', 2],
    ['AAPL', '2026-08-11', 19, 'sell', 0],
  ]),
  ...filings('morgan-ellery', [
    ['XOM', '2023-12-05', 44, 'buy', 0],
    ['XOM', '2024-03-19', 31, 'buy', 1],
    ['JPM', '2024-07-23', 12, 'buy', 0],
    ['XOM', '2024-11-13', 40, 'sell', 1],
    ['TSLA', '2025-03-11', 25, 'buy', 0],
    ['TSLA', '2025-06-24', 18, 'sell', 0],
    ['JPM', '2025-10-07', 33, 'sell', 0],
    ['XOM', '2026-01-21', 29, 'buy', 2],
    ['AVGO', '2026-05-05', 45, 'buy', 0],
    ['XOM', '2026-09-15', 16, 'sell', 1],
  ]),
  ...filings('dana-whitcombe', [
    ['META', '2024-02-07', 38, 'buy', 1],
    ['AMZN', '2024-05-14', 20, 'buy', 0],
    ['META', '2024-10-09', 26, 'buy', 0],
    ['GOOGL', '2025-01-28', 30, 'buy', 1],
    ['META', '2025-04-22', 43, 'sell', 2],
    ['AMZN', '2025-08-19', 14, 'sell', 0],
    ['GOOGL', '2025-12-03', 21, 'buy', 0],
    ['META', '2026-03-17', 36, 'buy', 1],
    ['AVGO', '2026-07-14', 24, 'buy', 0],
    ['GOOGL', '2026-09-29', 10, 'sell', 1],
    ['META', '2026-10-06', 9, 'sell', 0],
  ]),
  ...filings('elliot-varga', [
    ['AVGO', '2024-04-16', 34, 'buy', 3],
    ['AVGO', '2025-07-08', 42, 'sell', 3],
    ['JPM', '2026-02-24', 27, 'buy', 1],
  ]),
  ...filings('riley-okonjo', [
    ['TSLA', '2023-11-14', 30, 'buy', 0],
    ['AAPL', '2024-01-30', 18, 'buy', 0],
    ['TSLA', '2024-08-06', 29, 'buy', 1],
    ['MSFT', '2024-12-17', 35, 'buy', 0],
    ['TSLA', '2025-01-14', 22, 'sell', 1],
    ['AAPL', '2025-04-08', 44, 'buy', 1],
    ['NVDA', '2025-06-03', 17, 'buy', 0],
    ['TSLA', '2025-09-09', 38, 'buy', 0],
    ['MSFT', '2025-11-18', 26, 'sell', 0],
    ['NVDA', '2026-01-06', 31, 'sell', 0],
    ['TSLA', '2026-02-10', 23, 'sell', 0],
    ['AMZN', '2026-05-27', 40, 'buy', 1],
    ['TSLA', '2026-06-30', 15, 'buy', 0],
    ['AAPL', '2026-09-01', 20, 'sell', 1],
  ]),
];
