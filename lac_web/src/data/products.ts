/**
 * What each signal product contains. The TG side keeps adding items (a new sport, a new city);
 * an item only reaches customers after staff approve it and publish a new product version.
 *
 * A published version never changes. Publishing the next version takes the old one off the
 * store, but members who bought the old one keep exactly what they bought until it expires.
 */

import type { Messages } from '../i18n/en';
import type { ProductId } from './catalog';
import type { BillingPeriod } from './plans';

export type SignalProduct = 'all' | ProductId;

export const SIGNAL_PRODUCTS: SignalProduct[] = ['all', 'weather', 'crypto', 'forex', 'future', 'sport'];

export type ItemStatus = 'pending' | 'approved' | 'rejected';

export interface Item {
  id: string;
  product: ProductId;
  name: { en: string; zh: string };
  status: ItemStatus;
  /** When the TG side first sent signals for it. */
  seenAt: string;
}

export const INITIAL_ITEMS: Item[] = [
  { id: 'london', product: 'weather', name: { en: 'London', zh: '倫敦' }, status: 'approved', seenAt: 'Jul 20, 2026' },
  { id: 'nyc', product: 'weather', name: { en: 'New York', zh: '紐約' }, status: 'approved', seenAt: 'Jul 20, 2026' },
  { id: 'seoul', product: 'weather', name: { en: 'Seoul', zh: '首爾' }, status: 'pending', seenAt: 'Oct 20, 2026' },
  { id: 'btc5m', product: 'crypto', name: { en: 'BTC 5m', zh: 'BTC 5 分鐘' }, status: 'approved', seenAt: 'Jul 22, 2026' },
  { id: 'eth15m', product: 'crypto', name: { en: 'ETH 15m', zh: 'ETH 15 分鐘' }, status: 'approved', seenAt: 'Jul 22, 2026' },
  { id: 'eurusd', product: 'forex', name: { en: 'EUR/USD', zh: 'EUR/USD' }, status: 'approved', seenAt: 'Jul 25, 2026' },
  { id: 'gold', product: 'future', name: { en: 'Gold', zh: '黃金' }, status: 'approved', seenAt: 'Jul 25, 2026' },
  { id: 'soccer', product: 'sport', name: { en: 'Soccer', zh: '足球' }, status: 'approved', seenAt: 'Jul 18, 2026' },
  { id: 'basketball', product: 'sport', name: { en: 'Basketball', zh: '籃球' }, status: 'approved', seenAt: 'Sep 24, 2026' },
  { id: 'baseball', product: 'sport', name: { en: 'Baseball', zh: '棒球' }, status: 'pending', seenAt: 'Oct 19, 2026' },
];

export interface Version {
  id: string;
  product: SignalProduct;
  number: number;
  items: string[];
  /** Empty until prices are decided; the store shows [$xx]. */
  prices: Partial<Record<BillingPeriod, string>>;
  /** ISO days. */
  publishedOn: string;
  retiredOn: string | null;
}

const v = (product: SignalProduct, number: number, items: string[], publishedOn: string, retiredOn: string | null = null): Version => ({
  id: `${product}-v${number}`,
  product,
  number,
  items,
  prices: {},
  publishedOn,
  retiredOn,
});

export const INITIAL_VERSIONS: Version[] = [
  v('all', 1, ['london', 'nyc', 'btc5m', 'eth15m', 'eurusd', 'gold', 'soccer'], '2026-08-01', '2026-10-01'),
  v('all', 2, ['london', 'nyc', 'btc5m', 'eth15m', 'eurusd', 'gold', 'soccer', 'basketball'], '2026-10-01'),
  v('weather', 1, ['london', 'nyc'], '2026-08-01'),
  v('crypto', 1, ['btc5m', 'eth15m'], '2026-08-01'),
  v('forex', 1, ['eurusd'], '2026-08-01'),
  v('future', 1, ['gold'], '2026-08-01'),
  v('sport', 1, ['soccer'], '2026-08-01', '2026-10-01'),
  v('sport', 2, ['soccer', 'basketball'], '2026-10-01'),
];

/** The version on the store now; every product always has one. */
export const liveVersion = (versions: Version[], product: SignalProduct) =>
  versions.find((x) => x.product === product && !x.retiredOn)!;

/** Approved items a product can hold: its own, or every product's for the bundle. */
export const itemsFor = (items: Item[], product: SignalProduct) =>
  items.filter((item) => item.status === 'approved' && (product === 'all' || item.product === product));

export const productName = (t: Messages, product: SignalProduct) =>
  product === 'all' ? t.plans.all.name : t.products[product];

export const versionLabel = (t: Messages, version: Version) => `${productName(t, version.product)} v${version.number}`;

export const itemName = (t: Messages, item: Item) => (t.lang === 'zh-Hant' ? item.name.zh : item.name.en);

export const itemNames = (t: Messages, items: Item[], ids: string[]) =>
  ids.map((id) => items.find((item) => item.id === id)).flatMap((item) => (item ? [itemName(t, item)] : []));

/** Demo "today", so the sample dates stay meaningful whenever the demo is opened. */
export const DEMO_TODAY = '2026-10-22';

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
