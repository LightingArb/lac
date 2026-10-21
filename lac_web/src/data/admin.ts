/** Demo data for the back office. Everything here stands in for tables the outsourced backend owns. */

import type { BillingPeriod } from './plans';
import type { SignalProduct } from './products';
import { earnings } from './referral';

/** Shown as "you" in the demo; the dictionaries give it a per-language name. */
export const YOU = 'You (demo customer)';

export type MemberStatus = 'active' | 'suspended';

export interface Member {
  email: string;
  name: string;
  joined: string;
  /** Referral code of the upline, or LAC for members who joined without one. */
  referredBy: string;
  code: string;
  /** Builder-fee rate set by the upline; null for members with no agents below them. */
  rate: number | null;
  /** Builder fees from this member's own trades this month. */
  feesCents: number;
  status: MemberStatus;
}

export const MEMBERS: Member[] = [
  { email: 'you@example.com', name: YOU, joined: 'Sep 2, 2026', referredBy: 'LAC', code: 'LAC8X2', rate: 80, feesCents: 4120, status: 'active' },
  { email: 'alex.chen@gmail.com', name: 'Alex Chen', joined: 'Oct 1, 2026', referredBy: 'LAC8X2', code: 'ALEXC', rate: 55, feesCents: 2210, status: 'active' },
  { email: 'karen.liu@gmail.com', name: 'Karen Liu', joined: 'Oct 2, 2026', referredBy: 'LAC8X2', code: 'KAREN', rate: null, feesCents: 14260, status: 'active' },
  { email: 'morgan.lee@outlook.com', name: 'Morgan Lee', joined: 'Oct 4, 2026', referredBy: 'LAC8X2', code: 'MORGAN', rate: 40, feesCents: 0, status: 'active' },
  { email: 'jtorres@outlook.com', name: 'J. Torres', joined: 'Oct 5, 2026', referredBy: 'LAC8X2', code: 'JTORRES', rate: null, feesCents: 8810, status: 'active' },
  { email: 'sam.rivera@proton.me', name: 'Sam Rivera', joined: 'Oct 8, 2026', referredBy: 'LAC8X2', code: 'SAMR', rate: 30, feesCents: 640, status: 'active' },
  { email: 'mika.s@gmail.com', name: 'Mika S.', joined: 'Oct 9, 2026', referredBy: 'LAC8X2', code: 'MIKAS', rate: null, feesCents: 0, status: 'active' },
  { email: 'priya.n@gmail.com', name: 'Priya Nair', joined: 'Oct 10, 2026', referredBy: 'ALEXC', code: 'PRIYA', rate: 35, feesCents: 0, status: 'active' },
  { email: 'rosa.m@proton.me', name: 'Rosa M.', joined: 'Oct 14, 2026', referredBy: 'LAC8X2', code: 'ROSAM', rate: null, feesCents: 3145, status: 'active' },
  { email: 'kai.wu@gmail.com', name: 'Kai Wu', joined: 'Aug 21, 2026', referredBy: 'LAC', code: 'KAIWU', rate: 80, feesCents: 1890, status: 'active' },
  { email: 'taylor.b@gmail.com', name: 'Taylor Brooks', joined: 'Aug 14, 2026', referredBy: 'LAC', code: 'TAYLORB', rate: 80, feesCents: 0, status: 'active' },
  { email: 'jordan.p@icloud.com', name: 'Jordan Park', joined: 'Sep 18, 2026', referredBy: 'TAYLORB', code: 'JORDANP', rate: 60, feesCents: 5320, status: 'active' },
  { email: 'leo.k@gmail.com', name: 'Leo K.', joined: 'Sep 25, 2026', referredBy: 'KAIWU', code: 'LEOK', rate: null, feesCents: 0, status: 'suspended' },
];

/**
 * One line of the agent tree. The root is LAC itself at 100%: every agent keeps its own rate
 * minus the rate it gives each direct agent, so the shares along any line add up to 100%.
 */
export interface AgentNode {
  name: string;
  code: string;
  rate: number;
  /** Members referred directly who are not agents themselves. */
  traders: number;
  /** Builder fees this month from those direct traders. */
  ownFeesCents: number;
  children: AgentNode[];
}

export const AGENT_TREE: AgentNode = {
  name: 'LAC (official)',
  code: 'LAC',
  rate: 100,
  traders: 0,
  ownFeesCents: 0,
  children: [
    {
      name: YOU,
      code: 'LAC8X2',
      rate: 80,
      traders: 4,
      ownFeesCents: 26215,
      children: [
        {
          name: 'Alex Chen',
          code: 'ALEXC',
          rate: 55,
          traders: 8,
          ownFeesCents: 94000,
          children: [{ name: 'Priya Nair', code: 'PRIYA', rate: 35, traders: 3, ownFeesCents: 30000, children: [] }],
        },
        { name: 'Morgan Lee', code: 'MORGAN', rate: 40, traders: 8, ownFeesCents: 68000, children: [] },
        { name: 'Sam Rivera', code: 'SAMR', rate: 30, traders: 5, ownFeesCents: 32000, children: [] },
      ],
    },
    { name: 'Kai Wu', code: 'KAIWU', rate: 80, traders: 6, ownFeesCents: 41200, children: [] },
    {
      name: 'Taylor Brooks',
      code: 'TAYLORB',
      rate: 80,
      traders: 7,
      ownFeesCents: 52300,
      children: [{ name: 'Jordan Park', code: 'JORDANP', rate: 60, traders: 2, ownFeesCents: 18750, children: [] }],
    },
  ],
};

export const lineFees = (node: AgentNode): number =>
  node.ownFeesCents + node.children.reduce((sum, child) => sum + lineFees(child), 0);

export const lineMembers = (node: AgentNode): number =>
  node.traders + node.children.reduce((sum, child) => sum + 1 + lineMembers(child), 0);

/** This month's earnings: own rate on direct traders plus the rate gap on each direct agent's line. */
export const nodeEarnings = (node: AgentNode): number =>
  earnings(node.ownFeesCents, node.rate) +
  node.children.reduce((sum, child) => sum + earnings(lineFees(child), node.rate - child.rate), 0);

export interface FlatAgent {
  node: AgentNode;
  depth: number;
  upline: AgentNode | null;
}

export function flattenTree(node: AgentNode, depth = 0, upline: AgentNode | null = null): FlatAgent[] {
  return [{ node, depth, upline }, ...node.children.flatMap((child) => flattenTree(child, depth + 1, node))];
}

/** Access to one product version for a period. Bought, granted by staff, or redeemed from a code. */
export interface Entitlement {
  id: string;
  /** Member code. */
  member: string;
  versionId: string;
  /** ISO days. */
  start: string;
  expires: string;
  source: 'purchase' | 'manual' | 'code';
  /** Payment id or redeem code behind it. */
  ref?: string;
  revoked: boolean;
}

const ent = (id: string, member: string, versionId: string, start: string, expires: string, source: Entitlement['source'], ref?: string, revoked = false): Entitlement => ({
  id,
  member,
  versionId,
  start,
  expires,
  source,
  ref,
  revoked,
});

export const INITIAL_ENTITLEMENTS: Entitlement[] = [
  ent('E-301', 'KAIWU', 'all-v1', '2026-08-21', '2026-11-21', 'purchase', 'P-2198'),
  ent('E-302', 'LAC8X2', 'all-v1', '2026-09-02', '2026-12-02', 'purchase', 'P-2199'),
  ent('E-303', 'JORDANP', 'forex-v1', '2026-09-18', '2026-10-18', 'purchase', 'P-2197'),
  ent('E-304', 'TAYLORB', 'sport-v1', '2026-09-25', '2026-10-25', 'manual'),
  ent('E-305', 'ALEXC', 'crypto-v1', '2026-10-01', '2026-11-01', 'purchase', 'P-2200'),
  ent('E-306', 'ALEXC', 'crypto-v1', '2026-10-01', '2026-11-01', 'purchase', 'P-2201', true),
  ent('E-307', 'KAREN', 'weather-v1', '2026-10-02', '2026-11-02', 'purchase', 'P-2202'),
  ent('E-308', 'JTORRES', 'all-v2', '2026-10-05', '2027-10-05', 'purchase', 'P-2203'),
  ent('E-309', 'SAMR', 'weather-v1', '2026-10-08', '2027-01-08', 'purchase', 'P-2204'),
  ent('E-310', 'PRIYA', 'weather-v1', '2026-10-12', '2026-11-11', 'code', 'LAC-WX7Q-4M2K'),
  ent('E-311', 'ROSAM', 'sport-v2', '2026-10-20', '2026-11-20', 'purchase', 'P-2207'),
];

export interface RedeemCode {
  code: string;
  product: SignalProduct;
  days: number;
  used: number;
  limit: number;
  expires: string;
}

export const REDEEM_CODES: RedeemCode[] = [
  { code: 'LAC-WX7Q-4M2K', product: 'weather', days: 30, used: 3, limit: 10, expires: 'Dec 31, 2026' },
  { code: 'LAC-A11S-PR0M', product: 'all', days: 7, used: 50, limit: 50, expires: 'Nov 30, 2026' },
  { code: 'LAC-CRY3-TEST', product: 'crypto', days: 30, used: 0, limit: 1, expires: 'Oct 1, 2026' },
];

export const CODE_DAYS = [7, 30, 90, 365];

export type PaymentStatus = 'paid' | 'refunded' | 'failed';

export interface Payment {
  id: string;
  date: string;
  /** Member code. */
  member: string;
  versionId: string;
  period: BillingPeriod;
  amountCents: number;
  status: PaymentStatus;
}

const pay = (id: string, date: string, member: string, versionId: string, period: BillingPeriod, amountCents: number, status: PaymentStatus): Payment => ({
  id,
  date,
  member,
  versionId,
  period,
  amountCents,
  status,
});

export const PAYMENTS: Payment[] = [
  pay('P-2207', 'Oct 20, 2026', 'ROSAM', 'sport-v2', 'monthly', 2900, 'paid'),
  pay('P-2206', 'Oct 19, 2026', 'JORDANP', 'forex-v1', 'monthly', 2900, 'failed'),
  pay('P-2205', 'Oct 14, 2026', 'ROSAM', 'sport-v2', 'monthly', 2900, 'failed'),
  pay('P-2204', 'Oct 8, 2026', 'SAMR', 'weather-v1', 'quarterly', 7900, 'paid'),
  pay('P-2203', 'Oct 5, 2026', 'JTORRES', 'all-v2', 'yearly', 79000, 'paid'),
  pay('P-2202', 'Oct 2, 2026', 'KAREN', 'weather-v1', 'monthly', 2900, 'paid'),
  pay('P-2201', 'Oct 1, 2026', 'ALEXC', 'crypto-v1', 'monthly', 2900, 'refunded'),
  pay('P-2200', 'Oct 1, 2026', 'ALEXC', 'crypto-v1', 'monthly', 2900, 'paid'),
  pay('P-2199', 'Sep 2, 2026', 'LAC8X2', 'all-v1', 'quarterly', 22900, 'paid'),
  pay('P-2197', 'Sep 18, 2026', 'JORDANP', 'forex-v1', 'monthly', 2900, 'paid'),
  pay('P-2198', 'Aug 21, 2026', 'KAIWU', 'all-v1', 'quarterly', 22900, 'paid'),
];

export type AdminRole = 'Owner' | 'Finance' | 'Support' | 'Content';

export interface AdminAccount {
  name: string;
  email: string;
  role: AdminRole;
  twoFactor: boolean;
  lastActive: string;
}

export const ADMINS: AdminAccount[] = [
  { name: 'Remy', email: 'remy@lac.example', role: 'Owner', twoFactor: true, lastActive: 'Oct 21, 2026' },
  { name: 'Jamie', email: 'jamie@lac.example', role: 'Finance', twoFactor: true, lastActive: 'Oct 21, 2026' },
  { name: 'Chris', email: 'chris@lac.example', role: 'Support', twoFactor: false, lastActive: 'Oct 17, 2026' },
];

export const ROLES: AdminRole[] = ['Owner', 'Finance', 'Support', 'Content'];

export type PermissionId = 'viewMembers' | 'suspend' | 'access' | 'review' | 'pay' | 'refund' | 'products' | 'content' | 'admins';

export const PERMISSIONS: { id: PermissionId; roles: AdminRole[] }[] = [
  { id: 'viewMembers', roles: ['Owner', 'Finance', 'Support'] },
  { id: 'suspend', roles: ['Owner', 'Support'] },
  { id: 'access', roles: ['Owner', 'Support'] },
  { id: 'review', roles: ['Owner', 'Finance'] },
  { id: 'pay', roles: ['Owner', 'Finance'] },
  { id: 'refund', roles: ['Owner', 'Finance'] },
  { id: 'products', roles: ['Owner'] },
  { id: 'content', roles: ['Owner', 'Content'] },
  { id: 'admins', roles: ['Owner'] },
];

export interface MonthReport {
  year: number;
  month: number;
  toDate: boolean;
  builderFeesCents: number;
  subscriptionsCents: number;
  withdrawalsPaidCents: number;
}

export const MONTHS: MonthReport[] = [
  { year: 2026, month: 10, toDate: true, builderFeesCents: lineFees(AGENT_TREE), subscriptionsCents: 120400, withdrawalsPaidCents: 46000 },
  { year: 2026, month: 9, toDate: false, builderFeesCents: 298140, subscriptionsCents: 96200, withdrawalsPaidCents: 51200 },
  { year: 2026, month: 8, toDate: false, builderFeesCents: 187520, subscriptionsCents: 61800, withdrawalsPaidCents: 23500 },
  { year: 2026, month: 7, toDate: false, builderFeesCents: 92310, subscriptionsCents: 30400, withdrawalsPaidCents: 0 },
];
