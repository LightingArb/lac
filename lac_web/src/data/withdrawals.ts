/**
 * Referral-earnings withdrawals. A member asks for a payout, an admin approves or rejects it,
 * then pays it by hand from the treasury wallet and records the transaction hash.
 *
 *   pending ──approve──▶ approved ──mark paid──▶ paid
 *      └──────reject───────┴──────▶ rejected (amount returns to the member's balance)
 */

import type { Messages } from '../i18n/en';
import type { AdminRole } from './admin';
import { dollars } from './referral';

export type Network = 'usdt-trc20' | 'usdc-polygon';

export interface NetworkDef {
  value: Network;
  label: string;
  placeholder: string;
  address: RegExp;
  txHash: RegExp;
  explorer: string;
}

export const NETWORKS: NetworkDef[] = [
  {
    value: 'usdt-trc20',
    label: 'USDT · TRC20',
    placeholder: 'T…',
    address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    txHash: /^[0-9a-fA-F]{64}$/,
    explorer: 'https://tronscan.org/#/transaction/',
  },
  {
    value: 'usdc-polygon',
    label: 'USDC · Polygon',
    placeholder: '0x…',
    address: /^0x[0-9a-fA-F]{40}$/,
    txHash: /^0x[0-9a-fA-F]{64}$/,
    explorer: 'https://polygonscan.com/tx/',
  },
];

export const network = (value: Network) => NETWORKS.find((n) => n.value === value)!;

/** Placeholder until the withdrawal rules are decided. */
export const MIN_WITHDRAWAL_CENTS = 5000;

export type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export type LogAction = 'requested' | 'approved' | 'rejected' | 'paid';

export interface LogEntry {
  at: string;
  /** Member email or admin name. */
  by: string;
  action: LogAction;
}

export interface Withdrawal {
  id: string;
  user: string;
  amountCents: number;
  network: Network;
  address: string;
  requestedAt: string;
  status: WithdrawalStatus;
  txHash?: string;
  reason?: string;
  log: LogEntry[];
}

/** The signed-in demo customer. */
export const ME = 'you@example.com';
/** The signed-in demo admin and their role. */
export const ADMIN_ME = 'Jamie';
export const ADMIN_ROLE: AdminRole = 'Finance';

/** Commission already credited to each member's balance (closed months). */
export const SETTLED_EARNINGS: Record<string, number> = {
  [ME]: 284560,
  'alex.chen@gmail.com': 196400,
  'morgan.lee@outlook.com': 88250,
  'sam.rivera@proton.me': 21480,
  'kai.wu@gmail.com': 9720,
};

const TRX_ME = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
const TRX_MORGAN = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const TRX_KAI = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const POLY_ALEX = '0x8f3a5c21b9e04d7a6c1f2e9b0d4a7c3e5f6141c2';
const POLY_SAM = '0x2b7e91c4d5a30f6e8b1c9d2a4f7e3b6c0a5d8e19';

const log = (at: string, by: string, action: LogAction): LogEntry => ({ at, by, action });

export const INITIAL_WITHDRAWALS: Withdrawal[] = [
  {
    id: 'W-1046',
    user: ME,
    amountCents: 30000,
    network: 'usdt-trc20',
    address: TRX_ME,
    requestedAt: 'Oct 19, 2026 21:14',
    status: 'pending',
    log: [log('Oct 19, 2026 21:14', ME, 'requested')],
  },
  {
    id: 'W-1045',
    user: 'sam.rivera@proton.me',
    amountCents: 9500,
    network: 'usdc-polygon',
    address: POLY_SAM,
    requestedAt: 'Oct 20, 2026 09:02',
    status: 'pending',
    log: [log('Oct 20, 2026 09:02', 'sam.rivera@proton.me', 'requested')],
  },
  {
    id: 'W-1044',
    user: 'morgan.lee@outlook.com',
    amountCents: 52000,
    network: 'usdt-trc20',
    address: TRX_MORGAN,
    requestedAt: 'Oct 18, 2026 16:40',
    status: 'approved',
    log: [
      log('Oct 18, 2026 16:40', 'morgan.lee@outlook.com', 'requested'),
      log('Oct 19, 2026 10:05', ADMIN_ME, 'approved'),
    ],
  },
  {
    id: 'W-1043',
    user: 'alex.chen@gmail.com',
    amountCents: 124000,
    network: 'usdc-polygon',
    address: POLY_ALEX,
    requestedAt: 'Oct 18, 2026 11:23',
    status: 'pending',
    log: [log('Oct 18, 2026 11:23', 'alex.chen@gmail.com', 'requested')],
  },
  {
    id: 'W-1041',
    user: ME,
    amountCents: 25000,
    network: 'usdc-polygon',
    address: '0x8f3a5c21b9e04d7a6c1f2e9b0d4a7c3e5f61',
    requestedAt: 'Oct 12, 2026 08:51',
    status: 'rejected',
    reason: 'The wallet address is incomplete. Please submit a new request.',
    log: [
      log('Oct 12, 2026 08:51', ME, 'requested'),
      log('Oct 12, 2026 15:30', ADMIN_ME, 'rejected'),
    ],
  },
  {
    id: 'W-1039',
    user: 'kai.wu@gmail.com',
    amountCents: 6000,
    network: 'usdt-trc20',
    address: TRX_KAI,
    requestedAt: 'Oct 3, 2026 19:12',
    status: 'paid',
    txHash: '9c1e5b2f7a0d4e3c8b6a1f9e2d7c4b0a5e8f3d6c1b9a2e7f4d0c8b5a3e6f1d29',
    log: [
      log('Oct 3, 2026 19:12', 'kai.wu@gmail.com', 'requested'),
      log('Oct 4, 2026 10:11', ADMIN_ME, 'approved'),
      log('Oct 4, 2026 10:26', ADMIN_ME, 'paid'),
    ],
  },
  {
    id: 'W-1038',
    user: ME,
    amountCents: 40000,
    network: 'usdt-trc20',
    address: TRX_ME,
    requestedAt: 'Sep 30, 2026 22:05',
    status: 'paid',
    txHash: '4f8a2c6e1b9d3f7a5c0e8b2d6f4a1c9e7b3d5f0a8c2e6b4d1f9a7c3e5b0d8f61',
    log: [
      log('Sep 30, 2026 22:05', ME, 'requested'),
      log('Oct 1, 2026 09:40', ADMIN_ME, 'approved'),
      log('Oct 1, 2026 09:58', ADMIN_ME, 'paid'),
    ],
  },
];

export interface Balance {
  settled: number;
  pending: number;
  paid: number;
  available: number;
}

/** Pending and approved requests are held; rejected ones go back to the available balance. */
export function balanceOf(list: Withdrawal[], user: string): Balance {
  const mine = list.filter((w) => w.user === user);
  const sum = (statuses: WithdrawalStatus[]) =>
    mine.filter((w) => statuses.includes(w.status)).reduce((total, w) => total + w.amountCents, 0);
  const settled = SETTLED_EARNINGS[user] ?? 0;
  const pending = sum(['pending', 'approved']);
  const paid = sum(['paid']);
  return { settled, pending, paid, available: settled - pending - paid };
}

/** Dollar text such as "120.50" to cents; NaN when it isn't a positive amount with at most 2 decimals. */
export function parseAmount(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return NaN;
  return Math.round(Number(trimmed) * 100);
}

export interface WithdrawalDraft {
  amountCents: number;
  network: Network;
  address: string;
}

export interface DraftErrors {
  amount?: 'empty' | 'min' | 'max';
  address?: 'empty' | 'invalid';
}

export function validateDraft(draft: WithdrawalDraft, availableCents: number): DraftErrors {
  const errors: DraftErrors = {};
  if (!Number.isFinite(draft.amountCents) || draft.amountCents <= 0) errors.amount = 'empty';
  else if (draft.amountCents < MIN_WITHDRAWAL_CENTS) errors.amount = 'min';
  else if (draft.amountCents > availableCents) errors.amount = 'max';
  if (!draft.address.trim()) errors.address = 'empty';
  else if (!network(draft.network).address.test(draft.address.trim())) errors.address = 'invalid';
  return errors;
}

export function nowStamp(date = new Date()): string {
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

export function requestWithdrawal(list: Withdrawal[], user: string, draft: WithdrawalDraft, at: string): Withdrawal[] {
  const next = Math.max(0, ...list.map((w) => Number(w.id.slice(2)))) + 1;
  const item: Withdrawal = {
    id: `W-${next}`,
    user,
    amountCents: draft.amountCents,
    network: draft.network,
    address: draft.address.trim(),
    requestedAt: at,
    status: 'pending',
    log: [log(at, user, 'requested')],
  };
  return [item, ...list];
}

export type ReviewAction = { type: 'approve' } | { type: 'reject'; reason: string } | { type: 'paid'; txHash: string };

const ALLOWED: Record<ReviewAction['type'], WithdrawalStatus[]> = {
  approve: ['pending'],
  reject: ['pending', 'approved'],
  paid: ['approved'],
};

/** Applies an admin decision; requests in any other state are left unchanged. */
export function reviewWithdrawal(
  list: Withdrawal[],
  id: string,
  action: ReviewAction,
  by: string,
  at: string,
): Withdrawal[] {
  return list.map((w) => {
    if (w.id !== id || !ALLOWED[action.type].includes(w.status)) return w;
    if (action.type === 'approve') return { ...w, status: 'approved', log: [...w.log, log(at, by, 'approved')] };
    if (action.type === 'reject')
      return { ...w, status: 'rejected', reason: action.reason, log: [...w.log, log(at, by, 'rejected')] };
    return { ...w, status: 'paid', txHash: action.txHash, log: [...w.log, log(at, by, 'paid')] };
  });
}

export const shortAddress = (address: string) =>
  address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

export function logText(t: Messages, w: Withdrawal, entry: LogEntry): string {
  switch (entry.action) {
    case 'requested':
      return t.withdrawal.log.requested(dollars(w.amountCents));
    case 'approved':
      return t.withdrawal.log.approved;
    case 'rejected':
      return t.withdrawal.log.rejected(w.reason ?? '');
    case 'paid':
      return t.withdrawal.log.paid;
  }
}
