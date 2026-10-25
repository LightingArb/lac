/**
 * The demo's stand-in for the backend: every table the site and the back office share, and
 * every staff action as one reducer step. The outsourced backend owns the real versions of
 * these rules; the tests pin them down.
 */

import type { Messages } from '../i18n/en';
import {
  INITIAL_ENTITLEMENTS,
  MEMBERS,
  PAYMENTS,
  REDEEM_CODES,
  type Entitlement,
  type Member,
  type MemberStatus,
  type Payment,
  type RedeemCode,
} from './admin';
import type { ProductId } from './catalog';
import type { BillingPeriod } from './plans';
import {
  DEMO_TODAY,
  INITIAL_ITEMS,
  INITIAL_VERSIONS,
  addDays,
  itemName,
  liveVersion,
  versionLabel,
  type Item,
  type SignalProduct,
  type Version,
} from './products';
import { dollars } from './referral';
import {
  ADMIN_ME,
  INITIAL_WITHDRAWALS,
  ME,
  requestWithdrawal,
  reviewWithdrawal,
  type ReviewAction,
  type Withdrawal,
  type WithdrawalDraft,
} from './withdrawals';

export type ActivityKind =
  | 'approvedItem'
  | 'rejectedItem'
  | 'published'
  | 'granted'
  | 'expiry'
  | 'upgraded'
  | 'revoked'
  | 'refunded'
  | 'suspended'
  | 'restored'
  | 'createdCode'
  | 'disabledCode';

export interface Activity {
  at: string;
  by: string;
  kind: ActivityKind;
  /** Item, version, entitlement, payment or code id. */
  subject: string;
  /** Member code the action touched, for the member's own history. */
  member?: string;
  /** Extra value: the new expiry, or the version upgraded from. */
  detail?: string;
}

export type CodeRow = RedeemCode & { disabled?: boolean };

export interface Backend {
  withdrawals: Withdrawal[];
  items: Item[];
  versions: Version[];
  members: Member[];
  entitlements: Entitlement[];
  payments: Payment[];
  codes: CodeRow[];
  activity: Activity[];
}

export const INITIAL_BACKEND: Backend = {
  withdrawals: INITIAL_WITHDRAWALS,
  items: INITIAL_ITEMS,
  versions: INITIAL_VERSIONS,
  members: MEMBERS,
  entitlements: INITIAL_ENTITLEMENTS,
  payments: PAYMENTS,
  codes: REDEEM_CODES,
  activity: [
    { at: 'Oct 16, 2026 14:20', by: 'Remy', kind: 'createdCode', subject: 'LAC-WX7Q-4M2K' },
    { at: 'Oct 9, 2026 18:02', by: 'Chris', kind: 'suspended', subject: 'LEOK', member: 'LEOK' },
    { at: 'Oct 1, 2026 16:45', by: 'Jamie', kind: 'refunded', subject: 'P-2201', member: 'ALEXC' },
    { at: 'Oct 1, 2026 10:00', by: 'Remy', kind: 'published', subject: 'sport-v2' },
    { at: 'Oct 1, 2026 10:00', by: 'Remy', kind: 'published', subject: 'all-v2' },
    { at: 'Sep 25, 2026 11:30', by: 'Remy', kind: 'granted', subject: 'E-304', member: 'TAYLORB' },
    { at: 'Sep 25, 2026 09:12', by: 'Remy', kind: 'approvedItem', subject: 'basketball' },
  ],
};

export type BackendAction =
  | { type: 'withdraw'; draft: WithdrawalDraft }
  | { type: 'reviewWithdrawal'; id: string; action: ReviewAction }
  | { type: 'reviewItem'; id: string; approve: boolean }
  | { type: 'publish'; product: SignalProduct; items: string[]; prices: Partial<Record<BillingPeriod, string>> }
  | { type: 'grant'; member: string; product: SignalProduct; days: number }
  | { type: 'setExpiry'; id: string; expires: string }
  | { type: 'upgrade'; id: string }
  | { type: 'revoke'; id: string }
  | { type: 'refund'; id: string }
  | { type: 'setMemberStatus'; member: string; status: MemberStatus }
  | { type: 'createCode'; code: RedeemCode }
  | { type: 'disableCode'; code: string };

/** Every action carries when it happened and which staff member did it. */
export type Stamped = BackendAction & { at: string; by?: string };

export const memberByEmail = (b: Backend, email: string) => b.members.find((m) => m.email === email);
export const memberByCode = (b: Backend, code: string) => b.members.find((m) => m.code === code);
export const versionById = (b: Backend, id: string) => b.versions.find((x) => x.id === id)!;

export type EntitlementStatus = 'active' | 'expired' | 'revoked';

export function entitlementStatus(e: Entitlement, today = DEMO_TODAY): EntitlementStatus {
  if (e.revoked) return 'revoked';
  return e.expires < today ? 'expired' : 'active';
}

/** What a member sees now: the products of the items in the versions they hold, and which sports (Sport items). */
export interface Access {
  products: ProductId[];
  /** Sport item ids, e.g. ['soccer']; the same codes as a sport signal's sport. */
  sports: string[];
}

export function memberAccess(b: Backend, member: string, today = DEMO_TODAY): Access {
  const held = new Set(
    b.entitlements
      .filter((e) => e.member === member && entitlementStatus(e, today) === 'active')
      .flatMap((e) => versionById(b, e.versionId).items),
  );
  const items = b.items.filter((item) => held.has(item.id));
  return {
    products: [...new Set(items.map((item) => item.product))],
    sports: items.filter((item) => item.product === 'sport').map((item) => item.id),
  };
}

/** The entitlement check of the Signal and Sports pages: the product, and for Sport only the sports held. */
export function canSee(access: Access, product: ProductId, sport: string | null): boolean {
  return (
    access.products.includes(product) && (product !== 'sport' || (sport !== null && access.sports.includes(sport)))
  );
}

const nextId = (prefix: string, ids: string[]) =>
  `${prefix}-${Math.max(0, ...ids.map((id) => Number(id.split('-')[1]) || 0)) + 1}`;

export function backendReducer(b: Backend, a: Stamped): Backend {
  const by = a.by ?? ADMIN_ME;
  const log = (entry: Omit<Activity, 'at' | 'by'>) => [{ at: a.at, by, ...entry }, ...b.activity];

  switch (a.type) {
    case 'withdraw':
      return { ...b, withdrawals: requestWithdrawal(b.withdrawals, ME, a.draft, a.at) };

    case 'reviewWithdrawal': {
      const w = b.withdrawals.find((x) => x.id === a.id);
      const member = w && memberByEmail(b, w.user);
      // A suspended member's payout can only be rejected.
      if (member?.status === 'suspended' && a.action.type !== 'reject') return b;
      return { ...b, withdrawals: reviewWithdrawal(b.withdrawals, a.id, a.action, by, a.at) };
    }

    case 'reviewItem': {
      const item = b.items.find((x) => x.id === a.id);
      if (!item || item.status !== 'pending') return b;
      return {
        ...b,
        items: b.items.map((x) => (x.id === a.id ? { ...x, status: a.approve ? 'approved' : 'rejected' } : x)),
        activity: log({ kind: a.approve ? 'approvedItem' : 'rejectedItem', subject: a.id }),
      };
    }

    case 'publish': {
      if (!a.items.length) return b;
      const current = liveVersion(b.versions, a.product);
      const next: Version = {
        id: `${a.product}-v${current.number + 1}`,
        product: a.product,
        number: current.number + 1,
        items: a.items,
        prices: a.prices,
        publishedOn: DEMO_TODAY,
        retiredOn: null,
      };
      return {
        ...b,
        versions: [...b.versions.map((x) => (x.id === current.id ? { ...x, retiredOn: DEMO_TODAY } : x)), next],
        activity: log({ kind: 'published', subject: next.id }),
      };
    }

    case 'grant': {
      const id = nextId('E', b.entitlements.map((e) => e.id));
      const entitlement: Entitlement = {
        id,
        member: a.member,
        versionId: liveVersion(b.versions, a.product).id,
        start: DEMO_TODAY,
        expires: addDays(DEMO_TODAY, a.days),
        source: 'manual',
        revoked: false,
      };
      return {
        ...b,
        entitlements: [...b.entitlements, entitlement],
        activity: log({ kind: 'granted', subject: id, member: a.member }),
      };
    }

    case 'setExpiry': {
      const e = b.entitlements.find((x) => x.id === a.id);
      if (!e || e.revoked || a.expires <= e.start) return b;
      return {
        ...b,
        entitlements: b.entitlements.map((x) => (x.id === a.id ? { ...x, expires: a.expires } : x)),
        activity: log({ kind: 'expiry', subject: a.id, member: e.member, detail: a.expires }),
      };
    }

    case 'upgrade': {
      const e = b.entitlements.find((x) => x.id === a.id);
      if (!e || e.revoked) return b;
      const live = liveVersion(b.versions, versionById(b, e.versionId).product);
      if (live.id === e.versionId) return b;
      return {
        ...b,
        entitlements: b.entitlements.map((x) => (x.id === a.id ? { ...x, versionId: live.id } : x)),
        activity: log({ kind: 'upgraded', subject: a.id, member: e.member, detail: e.versionId }),
      };
    }

    case 'revoke': {
      const e = b.entitlements.find((x) => x.id === a.id);
      if (!e || e.revoked) return b;
      return {
        ...b,
        entitlements: b.entitlements.map((x) => (x.id === a.id ? { ...x, revoked: true } : x)),
        activity: log({ kind: 'revoked', subject: a.id, member: e.member }),
      };
    }

    case 'refund': {
      const p = b.payments.find((x) => x.id === a.id);
      if (!p || p.status !== 'paid') return b;
      // Refunding takes back what the payment bought.
      return {
        ...b,
        payments: b.payments.map((x) => (x.id === a.id ? { ...x, status: 'refunded' } : x)),
        entitlements: b.entitlements.map((e) => (e.ref === a.id ? { ...e, revoked: true } : e)),
        activity: log({ kind: 'refunded', subject: a.id, member: p.member }),
      };
    }

    case 'setMemberStatus': {
      const m = memberByCode(b, a.member);
      if (!m || m.status === a.status) return b;
      return {
        ...b,
        members: b.members.map((x) => (x.code === a.member ? { ...x, status: a.status } : x)),
        activity: log({ kind: a.status === 'suspended' ? 'suspended' : 'restored', subject: a.member, member: a.member }),
      };
    }

    case 'createCode':
      return { ...b, codes: [a.code, ...b.codes], activity: log({ kind: 'createdCode', subject: a.code.code }) };

    case 'disableCode':
      return {
        ...b,
        codes: b.codes.map((c) => (c.code === a.code ? { ...c, disabled: true } : c)),
        activity: log({ kind: 'disabledCode', subject: a.code }),
      };
  }
}

/** One readable line per staff action, in the current language. */
export function activityText(t: Messages, b: Backend, entry: Activity): string {
  const at = t.admin.activity;
  const member = entry.member ? (memberByCode(b, entry.member)?.email ?? entry.member) : '';
  const entitlementLabel = (id: string) => {
    const e = b.entitlements.find((x) => x.id === id);
    return e ? versionLabel(t, versionById(b, e.versionId)) : id;
  };
  switch (entry.kind) {
    case 'approvedItem':
    case 'rejectedItem': {
      const item = b.items.find((x) => x.id === entry.subject);
      return at[entry.kind](item ? itemName(t, item) : entry.subject);
    }
    case 'published':
      return at.published(versionLabel(t, versionById(b, entry.subject)));
    case 'granted':
      return at.granted(member, entitlementLabel(entry.subject));
    case 'expiry':
      return at.expiry(member, entitlementLabel(entry.subject), t.day(entry.detail ?? ''));
    case 'upgraded':
      return at.upgraded(member, versionLabel(t, versionById(b, entry.detail!)), entitlementLabel(entry.subject));
    case 'revoked':
      return at.revoked(member, entitlementLabel(entry.subject));
    case 'refunded': {
      const p = b.payments.find((x) => x.id === entry.subject);
      return at.refunded(entry.subject, p ? dollars(p.amountCents) : '');
    }
    case 'suspended':
    case 'restored':
      return at[entry.kind](member);
    case 'createdCode':
    case 'disabledCode':
      return at[entry.kind](entry.subject);
  }
}
