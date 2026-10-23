import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { WithdrawalStatusBadge } from '../components/WithdrawalStatusBadge';
import { Button } from '../components/ui/Button';
import { Page, PageHeader } from '../components/ui/Page';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { TextField } from '../components/ui/TextField';
import { dollars } from '../data/referral';
import { memberByEmail, type Backend } from '../data/backend';
import { balanceOf, logText, network, shortAddress, type Withdrawal, type WithdrawalStatus } from '../data/withdrawals';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import type { ReviewAction } from '../data/withdrawals';
import type { AdminProps } from './AdminApp';
import styles from './Admin.module.css';
import local from './WithdrawalsPage.module.css';

type Filter = WithdrawalStatus | 'all';

export function WithdrawalsPage({ backend, dispatch }: AdminProps) {
  const { withdrawals } = backend;
  const [params] = useSearchParams();
  const linked = withdrawals.find((w) => w.id === params.get('id'));
  const t = useT();
  const wt = t.admin.withdrawals;
  const c = t.admin.col;
  // A link from the inbox or a member page opens that request under its own status.
  const [filter, setFilter] = useState<Filter>(linked?.status ?? 'pending');
  const shown = filter === 'all' ? withdrawals : withdrawals.filter((w) => w.status === filter);
  const [selectedId, setSelectedId] = useState<string | null>(linked?.id ?? shown[0]?.id ?? null);
  const selected = withdrawals.find((w) => w.id === selectedId) ?? null;

  const count = (status: WithdrawalStatus) => withdrawals.filter((w) => w.status === status).length;
  const options = [
    ...(['pending', 'approved', 'paid', 'rejected'] as const).map((status) => ({
      value: status as Filter,
      label: `${t.withdrawal.status[status]} ${count(status)}`,
    })),
    { value: 'all' as Filter, label: t.common.all },
  ];

  return (
    <Page label={wt.title}>
      <PageHeader title={wt.title} description={wt.description} />

      <div className={local.filters}>
        <SegmentedControl
          label={wt.statusGroup}
          size="sm"
          options={options}
          value={filter}
          onChange={(next) => {
            setFilter(next);
            const list = next === 'all' ? withdrawals : withdrawals.filter((w) => w.status === next);
            setSelectedId(list[0]?.id ?? null);
          }}
        />
      </div>

      <div className={local.split}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{c.request}</th>
                <th>{c.member}</th>
                <th className={styles.num}>{c.amount}</th>
                <th>{c.to}</th>
                <th>{c.status}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((w) => (
                <tr
                  key={w.id}
                  className={cx(styles.clickRow, w.id === selectedId && styles.selectedRow)}
                  onClick={() => setSelectedId(w.id)}
                >
                  <td>
                    <button type="button" className={local.rowLink} onClick={() => setSelectedId(w.id)}>
                      {w.id}
                    </button>
                    <span className={styles.sub}>{t.date(w.requestedAt)}</span>
                  </td>
                  <td>{w.user}</td>
                  <td className={cx(styles.num, styles.strong)}>{dollars(w.amountCents)}</td>
                  <td>
                    {network(w.network).label}
                    <span className={cx(styles.sub, styles.mono)}>{shortAddress(w.address)}</span>
                  </td>
                  <td>
                    <WithdrawalStatusBadge status={w.status} />
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    {wt.nothing}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected ? (
          <Detail
            key={selected.id}
            item={selected}
            backend={backend}
            onReview={(id, action) => dispatch({ type: 'reviewWithdrawal', id, action })}
          />
        ) : (
          <aside className={local.detail}>
            <span className={styles.muted}>{wt.select}</span>
          </aside>
        )}
      </div>
    </Page>
  );
}

interface DetailProps {
  item: Withdrawal;
  backend: Backend;
  onReview: (id: string, action: ReviewAction) => void;
}

function Detail({ item, backend, onReview }: DetailProps) {
  const t = useT();
  const wt = t.admin.withdrawals;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const net = network(item.network);
  const balance = balanceOf(backend.withdrawals, item.user);
  const member = memberByEmail(backend, item.user);
  // A suspended member's payout can only be rejected.
  const blocked = member?.status === 'suspended';

  const copy = () => {
    navigator.clipboard?.writeText(item.address).catch(() => {});
    setCopied(true);
  };

  const markPaid = () => {
    if (!net.txHash.test(txHash.trim())) {
      setError(wt.badHash(net.label));
      return;
    }
    onReview(item.id, { type: 'paid', txHash: txHash.trim() });
  };

  return (
    <aside className={local.detail} aria-label={wt.detail(item.id)}>
      <div className={local.detailHead}>
        <h2 className={styles.panelTitle}>{item.id}</h2>
        <WithdrawalStatusBadge status={item.status} />
      </div>

      <span className={local.amount}>{dollars(item.amountCents)}</span>

      <dl className={local.facts}>
        <dt>{t.admin.col.member}</dt>
        <dd>{member ? <Link to={`/admin/members/${member.code}`}>{item.user}</Link> : item.user}</dd>
        <dt>{wt.requested}</dt>
        <dd>{t.date(item.requestedAt)}</dd>
        <dt>{wt.network}</dt>
        <dd>{net.label}</dd>
        <dt>{wt.address}</dt>
        <dd>
          <span className={cx(styles.mono, local.address)}>{item.address}</span>
          <button type="button" className={styles.linkButton} onClick={copy}>
            {copied ? t.common.copied : t.common.copy}
          </button>
        </dd>
        <dt>{wt.balance}</dt>
        <dd>
          {wt.balanceLine(dollars(balance.settled), dollars(balance.paid), dollars(balance.pending))}
          <span className={cx(styles.sub, balance.available < 0 && local.bad)}>
            {balance.available < 0 ? wt.overdrawn : wt.availableNow(dollars(balance.available))}
          </span>
        </dd>
      </dl>

      {blocked && (item.status === 'pending' || item.status === 'approved') && (
        <p className={local.blocked}>{wt.suspended}</p>
      )}

      {rejecting ? (
        <div className={local.actions}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{wt.reason}</span>
            <textarea
              className={local.textarea}
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
            {error && <span className={local.bad}>{error}</span>}
          </label>
          <div className={local.buttons}>
            <Button
              className={local.danger}
              onClick={() => {
                if (!reason.trim()) setError(wt.writeReason);
                else onReview(item.id, { type: 'reject', reason: reason.trim() });
              }}
            >
              {wt.confirmReject}
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {item.status === 'pending' && (
            <div className={local.buttons}>
              <Button disabled={blocked} onClick={() => onReview(item.id, { type: 'approve' })}>
                {wt.approve}
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(true)}>
                {wt.reject}
              </Button>
            </div>
          )}
          {item.status === 'approved' && (
            <div className={local.actions}>
              <p className={local.step}>{wt.sendStep(dollars(item.amountCents), net.label)}</p>
              <TextField
                label={wt.txHash}
                autoComplete="off"
                spellCheck={false}
                inputClassName={styles.mono}
                value={txHash}
                error={error}
                onChange={(e) => {
                  setTxHash(e.target.value);
                  setError(undefined);
                }}
              />
              <div className={local.buttons}>
                <Button disabled={blocked} onClick={markPaid}>
                  {wt.markPaid}
                </Button>
                <Button variant="secondary" onClick={() => setRejecting(true)}>
                  {wt.reject}
                </Button>
              </div>
            </div>
          )}
          {item.status === 'paid' && item.txHash && (
            <p className={local.step}>
              {t.withdrawal.status.paid} ·{' '}
              <a href={net.explorer + item.txHash} target="_blank" rel="noopener noreferrer" className={styles.mono}>
                {shortAddress(item.txHash)}
              </a>
            </p>
          )}
          {item.status === 'rejected' && (
            <p className={local.step}>
              {t.withdrawal.status.rejected} · {item.reason}
            </p>
          )}
        </>
      )}

      <div className={local.history}>
        <span className={styles.fieldLabel}>{wt.history}</span>
        <ol className={local.log}>
          {item.log.map((entry, i) => (
            <li key={i}>
              <span>{logText(t, item, entry)}</span>
              <span className={styles.sub}>
                {t.date(entry.at)} · {entry.by}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
