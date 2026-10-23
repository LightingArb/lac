import type { IconName } from '../components/ui/Icon';
import type { Messages } from '../i18n/en';
import type { ProductId } from './catalog';

export type BillingPeriod = 'monthly' | 'quarterly' | 'yearly';

export const BILLING_PERIODS: BillingPeriod[] = ['monthly', 'quarterly', 'yearly'];

export type PlanId = 'prediction' | 'all' | ProductId | 'stocks';

export interface PlanDef {
  id: PlanId;
  icon: IconName;
  tone: { bg: string; fg: string };
  /** Paid plans show the billing period after the price. */
  recurring: boolean;
  kind: 'free' | 'bundle' | 'paid' | 'soon';
}

const NEUTRAL = { bg: '#F1F5F9', fg: '#334155' };

const signalPlan = (id: ProductId, icon: IconName, tone: PlanDef['tone']): PlanDef => ({
  id,
  icon,
  tone,
  recurring: true,
  kind: 'paid',
});

export const PLANS: PlanDef[] = [
  { id: 'prediction', icon: 'prediction', tone: NEUTRAL, recurring: false, kind: 'free' },
  { id: 'all', icon: 'signal', tone: { bg: '#1D4ED8', fg: '#FFFFFF' }, recurring: true, kind: 'bundle' },
  signalPlan('weather', 'weather', { bg: '#E0F2FE', fg: '#075985' }),
  signalPlan('crypto', 'crypto', { bg: '#FEF3C7', fg: '#92400E' }),
  signalPlan('forex', 'forex', { bg: '#E0E7FF', fg: '#3730A3' }),
  signalPlan('future', 'future', { bg: '#FFEDD5', fg: '#9A3412' }),
  signalPlan('sport', 'sports', { bg: '#DCFCE7', fg: '#166534' }),
  { id: 'stocks', icon: 'stocks', tone: NEUTRAL, recurring: false, kind: 'soon' },
];

export interface PlanText {
  name: string;
  tag?: string;
  tagline: string;
  features: string[];
}

export function planText(t: Messages, id: PlanId): PlanText {
  if (id === 'prediction' || id === 'all' || id === 'stocks') return t.plans[id];
  const name = t.products[id];
  return { name, tagline: t.plans.taglines[id], features: t.plans.signalFeatures(name) };
}

/** Prices are not decided yet. */
export function planPrice(t: Messages, plan: PlanDef): string {
  if (plan.kind === 'free') return t.plans.free;
  if (plan.kind === 'soon') return t.plans.soon;
  return '[$xx]';
}

/** A member's plan; null is the free Prediction plan. */
export type Subscription = { plan: PlanId; period: BillingPeriod } | null;

export function subscriptionLabel(t: Messages, sub: Subscription): string {
  return sub ? `${planText(t, sub.plan).name} · ${t.plans.billing[sub.period]}` : t.plans.free;
}
