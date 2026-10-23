import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Page, PageHeader } from '../components/ui/Page';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { AGENT_TREE, MONTHS, flattenTree, lineFees, lineMembers, nodeEarnings, type PaymentStatus } from '../data/admin';
import { memberByCode, versionById } from '../data/backend';
import { versionLabel } from '../data/products';
import { dollars } from '../data/referral';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import type { AdminProps } from './AdminApp';
import { useTab } from './useTab';
import styles from './Admin.module.css';
import local from './FinancePage.module.css';

const TABS = ['reports', 'payments', 'agents'] as const;

export function FinancePage(props: AdminProps) {
  const t = useT();
  const ft = t.admin.finance;
  const [tab, setTab] = useTab(TABS);
  const options = TABS.map((value) => ({ value, label: ft.tabs[value] }));

  return (
    <Page label={ft.title}>
      <PageHeader title={ft.title} description={ft.description} />
      <div className={styles.tabs}>
        <SegmentedControl label={ft.title} options={options} value={tab} onChange={setTab} />
      </div>
      {tab === 'reports' && <ReportsTab {...props} />}
      {tab === 'payments' && <PaymentsTab {...props} />}
      {tab === 'agents' && <AgentsTab />}
    </Page>
  );
}

function ReportsTab({ backend: b }: AdminProps) {
  const t = useT();
  const ft = t.admin.finance;
  const rt = t.admin.reports;
  const fees = lineFees(AGENT_TREE);
  const owed = b.withdrawals.filter((w) => w.status === 'pending' || w.status === 'approved');
  const kpis = [
    { label: ft.fees, value: dollars(fees), note: ft.feesNote },
    { label: ft.lacShare, value: dollars(Math.round(fees * 0.2)), note: ft.lacShareNote },
    { label: ft.subscriptions, value: dollars(MONTHS[0].subscriptionsCents), note: ft.subscriptionsNote },
    {
      label: ft.owed,
      value: dollars(owed.reduce((sum, w) => sum + w.amountCents, 0)),
      note: ft.owedNote(owed.length),
    },
  ];

  return (
    <>
      <div className={styles.kpis}>
        {kpis.map((k) => (
          <div key={k.label} className={styles.kpi}>
            <span className={styles.kpiLabel}>{k.label}</span>
            <span className={styles.kpiValue}>{k.value}</span>
            <span className={styles.kpiNote}>{k.note}</span>
          </div>
        ))}
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{rt.month}</th>
              <th className={styles.num}>{rt.builderFees}</th>
              <th className={styles.num}>{rt.lacShare}</th>
              <th className={styles.num}>{rt.agentLines}</th>
              <th className={styles.num}>{rt.subscriptions}</th>
              <th className={styles.num}>{rt.withdrawalsPaid}</th>
              <th className={styles.num}>{rt.income}</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m) => {
              const lac = Math.round(m.builderFeesCents * 0.2);
              return (
                <tr key={`${m.year}-${m.month}`}>
                  <td className={styles.strong}>{rt.monthLabel(m.year, m.month, m.toDate)}</td>
                  <td className={styles.num}>{dollars(m.builderFeesCents)}</td>
                  <td className={styles.num}>{dollars(lac)}</td>
                  <td className={styles.num}>{dollars(m.builderFeesCents - lac)}</td>
                  <td className={styles.num}>{dollars(m.subscriptionsCents)}</td>
                  <td className={styles.num}>{dollars(m.withdrawalsPaidCents)}</td>
                  <td className={cx(styles.num, styles.strong)}>{dollars(lac + m.subscriptionsCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.footnote}>{rt.footnote}</p>
    </>
  );
}

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = { paid: 'success', refunded: 'neutral', failed: 'danger' };
type Filter = PaymentStatus | 'all';

function PaymentsTab({ backend: b, dispatch }: AdminProps) {
  const t = useT();
  const pt = t.admin.payments;
  const [filter, setFilter] = useState<Filter>('all');
  const shown = filter === 'all' ? b.payments : b.payments.filter((p) => p.status === filter);
  const options = [
    { value: 'all' as Filter, label: t.common.all },
    ...(['paid', 'failed', 'refunded'] as const).map((s) => ({ value: s as Filter, label: pt.status[s] })),
  ];

  return (
    <>
      <p className={styles.footnote}>{pt.note}</p>
      <SegmentedControl label={pt.statusGroup} size="sm" options={options} value={filter} onChange={setFilter} />
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{pt.payment}</th>
              <th>{t.admin.col.member}</th>
              <th>{t.admin.col.product}</th>
              <th className={styles.num}>{t.admin.col.amount}</th>
              <th>{t.admin.col.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const m = memberByCode(b, p.member);
              return (
                <tr key={p.id}>
                  <td>
                    <span className={styles.strong}>{p.id}</span>
                    <span className={styles.sub}>{t.date(p.date)}</span>
                  </td>
                  <td>
                    <Link to={`/admin/members/${p.member}`}>{m?.email ?? p.member}</Link>
                  </td>
                  <td>{pt.period(versionLabel(t, versionById(b, p.versionId)), t.plans.billing[p.period])}</td>
                  <td className={cx(styles.num, styles.strong)}>{dollars(p.amountCents)}</td>
                  <td>
                    <Badge tone={PAYMENT_TONE[p.status]}>{pt.status[p.status]}</Badge>
                  </td>
                  <td className={styles.num}>
                    {p.status === 'paid' && (
                      <Button
                        variant="secondary"
                        className={styles.smallButton}
                        onClick={() => dispatch({ type: 'refund', id: p.id })}
                      >
                        {pt.refund}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AgentsTab() {
  const t = useT();
  const a = t.admin.agents;
  const rows = flattenTree(AGENT_TREE);
  const total = lineFees(AGENT_TREE);
  const paidOut = rows.reduce((sum, r) => sum + nodeEarnings(r.node), 0);

  return (
    <>
      <p className={styles.footnote}>{a.description}</p>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{a.agent}</th>
              <th>{t.admin.col.code}</th>
              <th className={styles.num}>{t.admin.col.rate}</th>
              <th className={styles.num}>{a.lineMembers}</th>
              <th className={styles.num}>{a.lineFees}</th>
              <th className={styles.num}>{a.earnings}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node, depth, upline }) => (
              <tr key={node.code} className={cx(depth === 0 && local.root)}>
                <td>
                  <span className={local.name} style={{ paddingLeft: depth * 22 }}>
                    {depth > 0 && <span className={local.elbow} aria-hidden="true" />}
                    {depth === 0 ? (
                      <span className={styles.strong}>{t.admin.name(node.name)}</span>
                    ) : (
                      <Link to={`/admin/members/${node.code}`} className={styles.rowLink}>
                        {t.admin.name(node.name)}
                      </Link>
                    )}
                  </span>
                  {upline && (
                    <span className={styles.sub} style={{ paddingLeft: depth * 22 + 16 }}>
                      {a.gets(node.rate, t.admin.name(upline.name))}
                    </span>
                  )}
                </td>
                <td className={styles.mono}>{node.code}</td>
                <td className={styles.num}>{depth === 0 ? '100%' : `${node.rate}%`}</td>
                <td className={styles.num}>{lineMembers(node)}</td>
                <td className={styles.num}>{dollars(lineFees(node))}</td>
                <td className={cx(styles.num, styles.strong)}>{dollars(nodeEarnings(node))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={local.total}>
              <td colSpan={4}>{a.allLines}</td>
              <td className={styles.num}>{dollars(total)}</td>
              <td className={styles.num}>{dollars(paidOut)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.footnote}>{a.footnote}</p>
    </>
  );
}
