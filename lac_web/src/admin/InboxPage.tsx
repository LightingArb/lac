import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '../components/ui/Page';
import { entitlementStatus, memberByCode, versionById, type Backend } from '../data/backend';
import { DEMO_TODAY, daysBetween, itemName, versionLabel } from '../data/products';
import { dollars } from '../data/referral';
import { useT } from '../i18n';
import type { AdminProps } from './AdminApp';
import styles from './Admin.module.css';
import local from './InboxPage.module.css';

/** What needs a person right now. */
function inboxLists(b: Backend) {
  const withdrawals = b.withdrawals.filter((w) => w.status === 'pending');
  const items = b.items.filter((i) => i.status === 'pending');
  const expiring = b.entitlements.filter((e) => {
    const left = daysBetween(DEMO_TODAY, e.expires);
    return entitlementStatus(e) === 'active' && left <= 7;
  });
  // A failed payment stays on the list until the member pays for the same version later.
  const failed = b.payments.filter(
    (p) =>
      p.status === 'failed' &&
      !b.payments.some(
        (q) => q.status === 'paid' && q.member === p.member && q.versionId === p.versionId && Date.parse(q.date) > Date.parse(p.date),
      ),
  );
  return { withdrawals, items, expiring, failed };
}

export const inboxCount = (b: Backend) => Object.values(inboxLists(b)).reduce((sum, list) => sum + list.length, 0);

export function InboxPage({ backend: b }: AdminProps) {
  const t = useT();
  const it = t.admin.inbox;
  const lists = inboxLists(b);
  const total = inboxCount(b);

  return (
    <Page label={it.title}>
      <PageHeader title={it.title} description={it.description} />
      {total === 0 && <p className={styles.muted}>{it.clear}</p>}

      <div className={local.grid}>
        <Box title={it.withdrawals} count={lists.withdrawals.length}>
          {lists.withdrawals.map((w) => (
            <Row
              key={w.id}
              to={`/admin/withdrawals?id=${w.id}`}
              main={`${w.id} · ${dollars(w.amountCents)}`}
              sub={`${w.user} · ${t.date(w.requestedAt)}`}
              action={it.review}
            />
          ))}
        </Box>

        <Box title={it.items} count={lists.items.length}>
          {lists.items.map((item) => (
            <Row
              key={item.id}
              to="/admin/products?tab=items"
              main={itemName(t, item)}
              sub={it.seen(t.products[item.product], t.date(item.seenAt))}
              action={it.review}
            />
          ))}
        </Box>

        <Box title={it.expiring} count={lists.expiring.length}>
          {lists.expiring.map((e) => {
            const m = memberByCode(b, e.member);
            return (
              <Row
                key={e.id}
                to={`/admin/members/${e.member}`}
                main={`${t.admin.name(m?.name ?? e.member)} · ${versionLabel(t, versionById(b, e.versionId))}`}
                sub={`${it.endsIn(daysBetween(DEMO_TODAY, e.expires))} · ${t.day(e.expires)}`}
                action={it.open}
              />
            );
          })}
        </Box>

        <Box title={it.failed} count={lists.failed.length}>
          {lists.failed.map((p) => {
            const m = memberByCode(b, p.member);
            return (
              <Row
                key={p.id}
                to={`/admin/members/${p.member}`}
                main={`${t.admin.name(m?.name ?? p.member)} · ${dollars(p.amountCents)}`}
                sub={`${p.id} · ${versionLabel(t, versionById(b, p.versionId))} · ${t.date(p.date)}`}
                action={it.open}
              />
            );
          })}
        </Box>
      </div>
    </Page>
  );
}

function Box({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className={local.box} aria-label={title}>
      <div className={local.boxHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        <span className={count ? local.count : local.zero}>{count}</span>
      </div>
      {count ? <div className={local.rows}>{children}</div> : <span className={local.none}>—</span>}
    </section>
  );
}

function Row({ to, main, sub, action }: { to: string; main: string; sub: string; action: string }) {
  return (
    <Link to={to} className={local.row}>
      <span className={local.text}>
        <span className={styles.strong}>{main}</span>
        <span className={styles.sub}>{sub}</span>
      </span>
      <span className={local.action}>{action}</span>
    </Link>
  );
}

