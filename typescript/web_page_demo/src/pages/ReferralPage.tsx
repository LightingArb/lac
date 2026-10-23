import { useState } from 'react';
import { WithdrawDialog } from '../components/WithdrawDialog';
import { WithdrawalStatusBadge } from '../components/WithdrawalStatusBadge';
import { Button } from '../components/ui/Button';
import { Page, PageHeader } from '../components/ui/Page';
import { TextField } from '../components/ui/TextField';
import {
  REFERRED_TRADERS,
  YOUR_RATE,
  dollars,
  earnings,
  normalizeRate,
  referralLink,
  type Agent,
} from '../data/referral';
import {
  ME,
  MIN_WITHDRAWAL_CENTS,
  balanceOf,
  network,
  shortAddress,
  type Withdrawal,
  type WithdrawalDraft,
} from '../data/withdrawals';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import styles from './ReferralPage.module.css';

interface ReferralPageProps {
  code: string;
  agents: Agent[];
  onAgentsChange: (agents: Agent[]) => void;
  withdrawals: Withdrawal[];
  onWithdraw: (draft: WithdrawalDraft) => void;
}

export function ReferralPage({ code, agents, onAgentsChange, withdrawals, onWithdraw }: ReferralPageProps) {
  const t = useT();
  const r = t.referral;
  const [copied, setCopied] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const balance = balanceOf(withdrawals, ME);
  const mine = withdrawals.filter((w) => w.user === ME);
  const link = referralLink(code);
  const total =
    agents.reduce((sum, a) => sum + earnings(a.feesCents, YOUR_RATE - a.rate), 0) +
    REFERRED_TRADERS.reduce((sum, trader) => sum + earnings(trader.feesCents, YOUR_RATE), 0);
  const stats = [
    { label: r.yourRate, value: `${YOUR_RATE}%` },
    { label: r.directAgents, value: agents.length },
    { label: r.referredTraders, value: REFERRED_TRADERS.length },
    { label: r.earnedMonth, value: dollars(total) },
  ];
  const first = agents[0];

  const copy = () => {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
  };

  return (
    <Page label={r.title}>
      <PageHeader title={r.title} description={r.description} />

      <div className={styles.linkPanel}>
        <TextField label={r.link} labelStyle="caps" value={link} readOnly className={styles.linkField} />
        <Button onClick={copy}>{copied ? r.copied : r.copyLink}</Button>
        <span className={styles.code}>
          <span className={styles.codeLabel}>{r.code}</span>
          <span className={styles.codeValue}>{code}</span>
        </span>
      </div>

      <div className={styles.balance}>
        <div className={styles.balanceMain}>
          <span className={styles.statLabel}>{r.available}</span>
          <span className={styles.balanceValue}>{dollars(balance.available)}</span>
        </div>
        <div className={styles.balanceItem}>
          <span className={styles.statLabel}>{r.pending}</span>
          <span className={styles.balanceSmall}>{dollars(balance.pending)}</span>
        </div>
        <div className={styles.balanceItem}>
          <span className={styles.statLabel}>{r.withdrawn}</span>
          <span className={styles.balanceSmall}>{dollars(balance.paid)}</span>
        </div>
        <Button className={styles.withdraw} onClick={() => setWithdrawOpen(true)}>
          {r.withdraw}
        </Button>
      </div>

      <div className={styles.stats}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.card}>
            <span className={styles.statLabel}>{stat.label}</span>
            <span className={styles.statValue}>{stat.value}</span>
          </div>
        ))}
      </div>

      <div className={styles.tableSection}>
        <h2 className={styles.sectionTitle}>{r.myAgents}</h2>
        <span className={styles.footnote}>{r.agentsNote}</span>
        <div className={styles.tableScroll}>
          <table className={cx(styles.table, styles.agents)}>
            <thead>
              <tr>
                <th>{r.agent}</th>
                <th>{r.joined}</th>
                <th>{r.members}</th>
                <th>{r.theirRate}</th>
                <th>{r.yourCut}</th>
                <th>{r.lineFees}</th>
                <th>{r.yourEarnings}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => (
                <tr key={agent.name}>
                  <td>{agent.name}</td>
                  <td>{t.date(agent.joined)}</td>
                  <td>{agent.members}</td>
                  <td>
                    <input
                      aria-label={r.rateLabel(agent.name)}
                      className={styles.rate}
                      type="number"
                      min={0}
                      max={YOUR_RATE}
                      step={1}
                      value={agent.rate}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value))
                          onAgentsChange(
                            agents.map((a, i) => (i === index ? { ...a, rate: normalizeRate(value) } : a)),
                          );
                      }}
                    />{' '}
                    %
                  </td>
                  <td>{YOUR_RATE - agent.rate}%</td>
                  <td>{dollars(agent.feesCents)}</td>
                  <td className={styles.share}>{dollars(earnings(agent.feesCents, YOUR_RATE - agent.rate))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.splitPanel}>
          <span>{r.splitTitle(first.name)}</span>
          <div className={styles.split} aria-label={r.split}>
            <span style={{ width: '20%', background: '#e2e8f0' }}>{r.lacShare(20)}</span>
            <span style={{ width: `${YOUR_RATE - first.rate}%`, background: '#c7d2fe' }} />
            <span style={{ width: `${first.rate}%`, background: '#a7f3d0' }} />
          </div>
          <div className={styles.splitLabels}>
            <span>{r.lacShare(20)}</span>
            <span>{r.youShare(YOUR_RATE - first.rate)}</span>
            <span>{r.agentShare(first.rate)}</span>
          </div>
        </div>
        <p className={styles.footnote}>{r.rules}</p>
      </div>

      <div className={styles.tableSection}>
        <h2 className={styles.sectionTitle}>{r.referredTraders}</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{r.trader}</th>
                <th>{r.joined}</th>
                <th>{r.status}</th>
                <th className={styles.num}>{r.feesGenerated}</th>
                <th className={styles.num}>{r.yourShare}</th>
              </tr>
            </thead>
            <tbody>
              {REFERRED_TRADERS.map((trader) => (
                <tr key={trader.user}>
                  <td>{trader.user}</td>
                  <td className={styles.joined}>{t.date(trader.joined)}</td>
                  <td>
                    <span className={cx(styles.status, trader.active ? styles.statusActive : styles.statusIdle)}>
                      {trader.active ? r.active : r.signedUp}
                    </span>
                  </td>
                  <td className={styles.num}>{dollars(trader.feesCents)}</td>
                  <td className={cx(styles.num, styles.share)}>{dollars(earnings(trader.feesCents, YOUR_RATE))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.tableSection}>
        <h2 className={styles.sectionTitle}>{r.withdrawals}</h2>
        <span className={styles.footnote}>{r.withdrawalsNote(dollars(MIN_WITHDRAWAL_CENTS))}</span>
        <div className={styles.tableScroll}>
          <table className={cx(styles.table, styles.withdrawals)}>
            <thead>
              <tr>
                <th>{r.requested}</th>
                <th className={styles.num}>{r.amount}</th>
                <th>{r.to}</th>
                <th>{r.status}</th>
                <th>{r.details}</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((w) => {
                const net = network(w.network);
                return (
                  <tr key={w.id}>
                    <td>
                      {t.date(w.requestedAt)}
                      <span className={styles.sub}>{w.id}</span>
                    </td>
                    <td className={cx(styles.num, styles.share)}>{dollars(w.amountCents)}</td>
                    <td>
                      {net.label}
                      <span className={cx(styles.sub, styles.mono)} title={w.address}>
                        {shortAddress(w.address)}
                      </span>
                    </td>
                    <td>
                      <WithdrawalStatusBadge status={w.status} />
                    </td>
                    <td className={styles.details}>
                      {w.status === 'paid' && w.txHash && (
                        <a href={net.explorer + w.txHash} target="_blank" rel="noopener noreferrer" className={styles.mono}>
                          {shortAddress(w.txHash)}
                        </a>
                      )}
                      {w.status === 'rejected' && w.reason}
                      {w.status === 'pending' && r.waiting}
                      {w.status === 'approved' && r.onTheWay}
                    </td>
                  </tr>
                );
              })}
              {mine.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    {r.noWithdrawals}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {withdrawOpen && (
        <WithdrawDialog
          availableCents={balance.available}
          onSubmit={onWithdraw}
          onClose={() => setWithdrawOpen(false)}
        />
      )}
    </Page>
  );
}
