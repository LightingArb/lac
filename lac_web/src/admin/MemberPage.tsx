import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { WithdrawalStatusBadge } from '../components/WithdrawalStatusBadge';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Page } from '../components/ui/Page';
import { Panel } from '../components/ui/Panel';
import type { Entitlement, Member } from '../data/admin';
import { CODE_DAYS } from '../data/admin';
import {
  activityText,
  entitlementStatus,
  memberByCode,
  versionById,
  type EntitlementStatus,
} from '../data/backend';
import {
  SIGNAL_PRODUCTS,
  itemNames,
  liveVersion,
  productName,
  versionLabel,
  type SignalProduct,
} from '../data/products';
import { dollars } from '../data/referral';
import { balanceOf, logText } from '../data/withdrawals';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import type { AdminProps } from './AdminApp';
import styles from './Admin.module.css';
import local from './MemberPage.module.css';

const ACCESS_TONE: Record<EntitlementStatus, BadgeTone> = { active: 'success', expired: 'neutral', revoked: 'danger' };
const PAYMENT_TONE = { paid: 'success', refunded: 'neutral', failed: 'danger' } as const;

export function MemberPage({ backend: b, dispatch }: AdminProps) {
  const t = useT();
  const mt = t.admin.member;
  const { code = '' } = useParams();
  const member = memberByCode(b, code);

  if (!member)
    return (
      <Page label={mt.back}>
        <BackLink />
        <p className={styles.muted}>{mt.notFound}</p>
      </Page>
    );

  const balance = balanceOf(b.withdrawals, member.email);
  const access = b.entitlements.filter((e) => e.member === code);
  const payments = b.payments.filter((p) => p.member === code);
  const withdrawals = b.withdrawals.filter((w) => w.user === member.email);
  const suspended = member.status === 'suspended';
  const history = [
    ...b.activity.filter((a) => a.member === code).map((a) => ({ at: a.at, by: a.by, text: activityText(t, b, a) })),
    ...withdrawals.flatMap((w) =>
      w.log
        .filter((entry) => entry.by !== w.user)
        .map((entry) => ({ at: entry.at, by: entry.by, text: t.admin.activity.withdrawal(w.id, logText(t, w, entry)) })),
    ),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));

  return (
    <Page label={t.admin.name(member.name)}>
      <BackLink />

      <div className={local.head}>
        <div className={local.title}>
          <h1 className={local.name}>{t.admin.name(member.name)}</h1>
          <Badge tone={suspended ? 'danger' : 'success'}>
            {suspended ? t.admin.members.suspended : t.admin.members.active}
          </Badge>
          <span className={local.ids}>
            {member.email} · <span className={styles.mono}>{member.code}</span>
          </span>
        </div>
        <Button
          variant="secondary"
          className={cx(!suspended && local.dangerText)}
          onClick={() =>
            dispatch({ type: 'setMemberStatus', member: code, status: suspended ? 'active' : 'suspended' })
          }
        >
          {suspended ? mt.restore : mt.suspend}
        </Button>
      </div>
      {suspended && <p className={local.warning}>{mt.suspendedNote}</p>}

      <div className={local.facts}>
        <Fact label={mt.joined} value={t.date(member.joined)} />
        <Fact
          label={mt.referredBy}
          value={
            member.referredBy === 'LAC' ? (
              t.admin.name('LAC (official)')
            ) : (
              <Link to={`/admin/members/${member.referredBy}`}>{member.referredBy}</Link>
            )
          }
        />
        <Fact label={mt.rate} value={member.rate === null ? '—' : `${member.rate}%`} />
        <Fact label={mt.fees} value={dollars(member.feesCents)} />
        <Fact
          label={mt.balance}
          value={dollars(balance.available)}
          note={mt.balanceLine(dollars(balance.available), dollars(balance.pending), dollars(balance.paid))}
        />
      </div>

      <AccessPanel member={member} access={access} backend={b} dispatch={dispatch} />

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.panelTitle}>{mt.payments}</h2>
          <span className={styles.footnote}>{mt.refundNote}</span>
        </div>
        {payments.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className={styles.strong}>{p.id}</span>
                      <span className={styles.sub}>{t.date(p.date)}</span>
                    </td>
                    <td>{t.admin.payments.period(versionLabel(t, versionById(b, p.versionId)), t.plans.billing[p.period])}</td>
                    <td className={cx(styles.num, styles.strong)}>{dollars(p.amountCents)}</td>
                    <td>
                      <Badge tone={PAYMENT_TONE[p.status]}>{t.admin.payments.status[p.status]}</Badge>
                    </td>
                    <td className={styles.num}>
                      {p.status === 'paid' && (
                        <Button
                          variant="secondary"
                          className={styles.smallButton}
                          onClick={() => dispatch({ type: 'refund', id: p.id })}
                        >
                          {t.admin.payments.refund}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <span className={styles.muted}>{mt.noPayments}</span>
        )}
      </Panel>

      <div className={local.pair}>
        <Panel>
          <h2 className={styles.panelTitle}>{mt.withdrawals}</h2>
          {withdrawals.length ? (
            <ul className={local.list}>
              {withdrawals.map((w) => (
                <li key={w.id}>
                  <Link to={`/admin/withdrawals?id=${w.id}`} className={local.listLink}>
                    <span>
                      <span className={styles.strong}>
                        {w.id} · {dollars(w.amountCents)}
                      </span>
                      <span className={styles.sub}>{t.date(w.requestedAt)}</span>
                    </span>
                    <WithdrawalStatusBadge status={w.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <span className={styles.muted}>{mt.noWithdrawals}</span>
          )}
        </Panel>

        <Panel>
          <h2 className={styles.panelTitle}>{mt.line}</h2>
          <span className={styles.fieldLabel}>{mt.upline}</span>
          <Upline member={member} backend={b} />
          <span className={styles.fieldLabel}>{mt.downline}</span>
          <Downline code={code} backend={b} />
        </Panel>
      </div>

      <Panel>
        <h2 className={styles.panelTitle}>{mt.history}</h2>
        {history.length ? (
          <ol className={local.log}>
            {history.map((entry, i) => (
              <li key={i}>
                <span>{entry.text}</span>
                <span className={styles.sub}>
                  {t.date(entry.at)} · {entry.by}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <span className={styles.muted}>{mt.noHistory}</span>
        )}
      </Panel>
    </Page>
  );
}

function BackLink() {
  const t = useT();
  return (
    <Link to="/admin/members" className={local.back}>
      <Icon name="chevronLeft" size={16} strokeWidth={2} />
      {t.admin.member.back}
    </Link>
  );
}

function Fact({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className={local.fact}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={local.factValue}>{value}</span>
      {note && <span className={styles.kpiNote}>{note}</span>}
    </div>
  );
}

function AccessPanel({
  member,
  access,
  backend: b,
  dispatch,
}: AdminProps & { member: Member; access: Entitlement[] }) {
  const t = useT();
  const mt = t.admin.member;
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [product, setProduct] = useState<SignalProduct>('all');
  const [days, setDays] = useState(30);

  const source = (e: Entitlement) =>
    e.source === 'manual' ? mt.sources.manual : mt.sources[e.source](e.ref ?? '');

  return (
    <Panel>
      <div className={styles.sectionHead}>
        <h2 className={styles.panelTitle}>{mt.access}</h2>
        <span className={styles.footnote}>{mt.accessNote}</span>
      </div>

      {access.length ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t.admin.col.product}</th>
                <th>{mt.includes}</th>
                <th>{mt.period}</th>
                <th>{mt.source}</th>
                <th>{t.admin.col.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {access.map((e) => {
                const version = versionById(b, e.versionId);
                const live = liveVersion(b.versions, version.product);
                const status = entitlementStatus(e);
                return (
                  <tr key={e.id}>
                    <td>
                      <span className={styles.strong}>{versionLabel(t, version)}</span>
                      {live.id !== version.id && (
                        <span className={styles.sub}>
                          <Badge tone="warning">{mt.older}</Badge>
                        </span>
                      )}
                    </td>
                    <td className={local.items}>
                      {itemNames(t, b.items, version.items).join(t.lang === 'zh-Hant' ? '、' : ', ')}
                    </td>
                    <td className={local.period}>
                      {editing === e.id ? (
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>{mt.newEnd}</span>
                          <input
                            type="date"
                            className={local.date}
                            min={e.start}
                            value={date}
                            onChange={(event) => setDate(event.target.value)}
                          />
                        </label>
                      ) : (
                        <>
                          {t.day(e.start)} → {t.day(e.expires)}
                        </>
                      )}
                    </td>
                    <td className={local.source}>{source(e)}</td>
                    <td>
                      <Badge tone={ACCESS_TONE[status]}>{mt.status[status]}</Badge>
                    </td>
                    <td>
                      <div className={local.actions}>
                        {editing === e.id ? (
                          <>
                            <Button
                              className={styles.smallButton}
                              disabled={!date || date <= e.start}
                              onClick={() => {
                                dispatch({ type: 'setExpiry', id: e.id, expires: date });
                                setEditing(null);
                              }}
                            >
                              {t.common.save}
                            </Button>
                            <Button variant="secondary" className={styles.smallButton} onClick={() => setEditing(null)}>
                              {t.common.cancel}
                            </Button>
                          </>
                        ) : (
                          status !== 'revoked' && (
                            <>
                              {live.id !== version.id && (
                                <Button className={styles.smallButton} onClick={() => dispatch({ type: 'upgrade', id: e.id })}>
                                  {mt.upgrade(live.number)}
                                </Button>
                              )}
                              <Button
                                variant="secondary"
                                className={styles.smallButton}
                                onClick={() => {
                                  setEditing(e.id);
                                  setDate(e.expires);
                                }}
                              >
                                {mt.changeEnd}
                              </Button>
                              {status === 'active' && (
                                <Button
                                  variant="secondary"
                                  className={cx(styles.smallButton, local.dangerText)}
                                  onClick={() => dispatch({ type: 'revoke', id: e.id })}
                                >
                                  {mt.revoke}
                                </Button>
                              )}
                            </>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <span className={styles.muted}>{mt.noAccess}</span>
      )}

      <div className={local.grant}>
        <span className={styles.fieldLabel}>{mt.grant}</span>
        <div className={styles.toolbar}>
          <select
            aria-label={t.admin.col.product}
            className={styles.select}
            value={product}
            onChange={(e) => setProduct(e.target.value as SignalProduct)}
          >
            {SIGNAL_PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {productName(t, p)} v{liveVersion(b.versions, p).number}
              </option>
            ))}
          </select>
          <select
            aria-label={mt.period}
            className={styles.select}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {CODE_DAYS.map((d) => (
              <option key={d} value={d}>
                {mt.days(d)}
              </option>
            ))}
          </select>
          <Button onClick={() => dispatch({ type: 'grant', member: member.code, product, days })}>{mt.grantButton}</Button>
        </div>
        <span className={styles.footnote}>{mt.grantNote}</span>
      </div>
    </Panel>
  );
}

function Upline({ member, backend: b }: { member: Member; backend: AdminProps['backend'] }) {
  const t = useT();
  const chain: { code: string; name: string }[] = [];
  let current = member.referredBy;
  while (current && current !== 'LAC') {
    const m = memberByCode(b, current);
    if (!m) break;
    chain.unshift({ code: m.code, name: m.name });
    current = m.referredBy;
  }
  return (
    <div className={local.chain}>
      <span>{t.admin.name('LAC (official)')}</span>
      {chain.map((m) => (
        <span key={m.code} className={local.chainStep}>
          <Icon name="chevronRight" size={14} strokeWidth={2} />
          <Link to={`/admin/members/${m.code}`}>{t.admin.name(m.name)}</Link>
        </span>
      ))}
      <span className={local.chainStep}>
        <Icon name="chevronRight" size={14} strokeWidth={2} />
        <strong>{t.admin.name(member.name)}</strong>
      </span>
    </div>
  );
}

function Downline({ code, backend: b }: { code: string; backend: AdminProps['backend'] }) {
  const t = useT();
  const list = b.members.filter((m) => m.referredBy === code);
  if (!list.length) return <span className={styles.muted}>{t.admin.member.nobody}</span>;
  return (
    <div className={local.chips}>
      {list.map((m) => (
        <Link key={m.code} to={`/admin/members/${m.code}`} className={local.chip}>
          {t.admin.name(m.name)}
          {m.rate !== null && <span className={styles.muted}> · {m.rate}%</span>}
        </Link>
      ))}
    </div>
  );
}
