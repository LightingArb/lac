export const DEFAULT_REFERRAL_CODE = 'LAC8X2';
export const REFERRAL_CODE_MAX = 16;

export function referralLink(code: string): string {
  return `https://lac.example/r/${code}`;
}

/** Uppercase letters and digits only, capped at the max length. */
export function normalizeReferralCode(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, REFERRAL_CODE_MAX);
}

export const YOUR_RATE = 80;
export interface Agent {
  name: string;
  joined: string;
  members: number;
  rate: number;
  feesCents: number;
}
export const MY_AGENTS: Agent[] = [
  { name: 'Alex Chen', joined: 'Oct 1, 2026', members: 12, rate: 55, feesCents: 124000 },
  { name: 'Morgan Lee', joined: 'Oct 4, 2026', members: 8, rate: 40, feesCents: 68000 },
  { name: 'Sam Rivera', joined: 'Oct 8, 2026', members: 5, rate: 30, feesCents: 32000 },
];
export const REFERRED_TRADERS = [
  { user: 'ka***@gmail.com', joined: 'Oct 2, 2026', active: true, feesCents: 14260 },
  { user: 'jt***@outlook.com', joined: 'Oct 5, 2026', active: true, feesCents: 8810 },
  { user: 'mi***@gmail.com', joined: 'Oct 9, 2026', active: false, feesCents: 0 },
  { user: 'ro***@proton.me', joined: 'Oct 14, 2026', active: true, feesCents: 3145 },
];
export const normalizeRate = (value: number) => Math.min(YOUR_RATE, Math.max(0, Math.trunc(value)));
export const earnings = (feesCents: number, rate: number) => Math.round((feesCents * rate) / 100);
export const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
