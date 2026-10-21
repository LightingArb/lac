import type { IconName } from '../components/ui/Icon';

export type BillingPeriod = 'monthly' | 'quarterly' | 'yearly';

export const BILLING_OPTIONS: { value: BillingPeriod; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export const PERIOD_SUFFIX: Record<BillingPeriod, string> = {
  monthly: '/ month',
  quarterly: '/ quarter',
  yearly: '/ year',
};

export interface PlanDef {
  name: string;
  icon: IconName;
  tone: { bg: string; fg: string };
  tag?: string;
  tagline: string;
  price: string;
  /** Paid plans show the billing period after the price. */
  recurring: boolean;
  features: string[];
  cta: string;
  kind: 'free' | 'bundle' | 'paid' | 'soon';
}

const NEUTRAL = { bg: '#F1F5F9', fg: '#334155' };

function signalPlan(name: string, icon: IconName, tone: PlanDef['tone'], tagline: string): PlanDef {
  return {
    name,
    icon,
    tone,
    tagline,
    price: '[$xx]',
    recurring: true,
    features: [
      `${name} in the Signal page`,
      'Signals marked on the market table',
      `${name} signal feed`,
      `Telegram alerts · ${name}`,
    ],
    cta: 'Subscribe',
    kind: 'paid',
  };
}

export const PLANS: PlanDef[] = [
  {
    name: 'Prediction',
    icon: 'prediction',
    tone: NEUTRAL,
    tagline: 'Every Polymarket market, cleaned and charted.',
    price: 'Free',
    recurring: false,
    features: ['All Polymarket events and markets', 'Price charts and full history', 'Buy USDT through partner sites'],
    cta: 'Included',
    kind: 'free',
  },
  {
    name: 'All signals',
    icon: 'signal',
    tone: { bg: '#1D4ED8', fg: '#FFFFFF' },
    tag: 'Best value',
    tagline: 'Every LAC signal market in one plan.',
    price: '[$xx]',
    recurring: true,
    features: [
      'Weather, Crypto, Forex, Future and Sport',
      'Signals marked on the market table',
      'Full positive-EV signal feed',
      'Telegram alerts for all five',
    ],
    cta: 'Subscribe',
    kind: 'bundle',
  },
  signalPlan('Weather', 'weather', { bg: '#E0F2FE', fg: '#075985' }, 'Daily high and low temperature markets.'),
  signalPlan('Crypto', 'crypto', { bg: '#FEF3C7', fg: '#92400E' }, 'Up/Down markets from 5 minutes to 1 day.'),
  signalPlan('Forex', 'forex', { bg: '#E0E7FF', fg: '#3730A3' }, 'Currency pair Up/Down markets.'),
  signalPlan('Future', 'future', { bg: '#FFEDD5', fg: '#9A3412' }, 'Commodity and stock-index markets.'),
  signalPlan('Sport', 'sports', { bg: '#DCFCE7', fg: '#166534' }, 'Match markets across major leagues.'),
  {
    name: 'Stocks',
    icon: 'stocks',
    tone: NEUTRAL,
    tagline: 'Taiwan and US stock screener.',
    price: 'Soon',
    recurring: false,
    features: ['Taiwan and US stocks', 'Details to be announced'],
    cta: 'Coming soon',
    kind: 'soon',
  },
];
