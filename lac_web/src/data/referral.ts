export const DEFAULT_REFERRAL_CODE = 'LAC8X2';
export const REFERRAL_CODE_MAX = 16;

export function referralLink(code: string): string {
  return `https://lac.example/r/${code}`;
}

/** Uppercase letters and digits only, capped at the max length. */
export function normalizeReferralCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, REFERRAL_CODE_MAX);
}

export const REFERRAL_STATS = [
  { label: 'Signed up', value: '12' },
  { label: 'Active traders', value: '5' },
  { label: 'Earned this month', value: '$[xx]' },
  { label: 'Total earned', value: '$[xx]' },
];

export const REFERRAL_STEPS = [
  { title: 'Share your link', text: 'Send it to friends or post it in your community.' },
  { title: 'They sign up and trade', text: 'Anyone who registers through your link is tied to you.' },
  { title: 'You earn a share', text: '[xx%] of the trading fees they generate, paid out [schedule].' },
];

export interface ReferredTrader {
  user: string;
  joined: string;
  active: boolean;
  fees: string;
  share: string;
}

export const REFERRED_TRADERS: ReferredTrader[] = [
  { user: 'ka***@gmail.com', joined: 'Oct 2, 2026', active: true, fees: '$142.60', share: '$[xx]' },
  { user: 'jt***@outlook.com', joined: 'Oct 5, 2026', active: true, fees: '$88.10', share: '$[xx]' },
  { user: 'mi***@gmail.com', joined: 'Oct 9, 2026', active: false, fees: '$0.00', share: '$[xx]' },
  { user: 'ro***@proton.me', joined: 'Oct 14, 2026', active: true, fees: '$31.45', share: '$[xx]' },
];
