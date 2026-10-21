import { useState } from 'react';
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
import { cx } from '../lib/cx';
import styles from './ReferralPage.module.css';

interface ReferralPageProps {
  code: string;
  agents: Agent[];
  onAgentsChange: (agents: Agent[]) => void;
}

export function ReferralPage({ code, agents, onAgentsChange }: ReferralPageProps) {
  const [copied, setCopied] = useState(false);
  const link = referralLink(code);
  const total =
    agents.reduce((sum, a) => sum + earnings(a.feesCents, YOUR_RATE - a.rate), 0) +
    REFERRED_TRADERS.reduce((sum, t) => sum + earnings(t.feesCents, YOUR_RATE), 0);
  const stats = [
    { label: 'Your rate', value: '80%' },
    { label: 'Direct agents', value: agents.length },
    { label: 'Referred traders', value: REFERRED_TRADERS.length },
    { label: 'Earned this month', value: dollars(total) },
  ];
  const first = agents[0];

  const copy = () => {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
  };

  return (
    <Page label="Referral rewards">
      <PageHeader
        title="Referral rewards"
        description="LAC takes 20% of builder fees. You receive 80% of the fees from everyone below you and decide how much to give each direct agent."
      />

      <div className={styles.linkPanel}>
        <TextField label="Your referral link" labelStyle="caps" value={link} readOnly className={styles.linkField} />
        <Button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>
        <span className={styles.code}>
          <span className={styles.codeLabel}>Code</span>
          <span className={styles.codeValue}>{code}</span>
        </span>
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
        <h2 className={styles.sectionTitle}>My agents</h2>
        <span className={styles.footnote}>
          Demo · October 2026 fees. Direct traders below are separate from agent lines.
        </span>
        <div className={styles.tableScroll}>
          <table className={cx(styles.table, styles.agents)}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Joined</th>
                <th>Members</th>
                <th>Their rate</th>
                <th>Your cut</th>
                <th>Line fees</th>
                <th>Your earnings</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => (
                <tr key={agent.name}>
                  <td>{agent.name}</td>
                  <td>{agent.joined}</td>
                  <td>{agent.members}</td>
                  <td>
                    <input
                      aria-label={`${agent.name} rate`}
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
          <span>Every $100 of builder fees from {first.name}'s line</span>
          <div className={styles.split} aria-label="Builder fee split">
            <span style={{ width: '20%', background: '#e2e8f0' }}>LAC $20</span>
            <span style={{ width: `${YOUR_RATE - first.rate}%`, background: '#c7d2fe' }} />
            <span style={{ width: `${first.rate}%`, background: '#a7f3d0' }} />
          </div>
          <div className={styles.splitLabels}>
            <span>LAC $20</span>
            <span>You ${YOUR_RATE - first.rate}</span>
            <span>Agent ${first.rate}</span>
          </div>
        </div>
        <p className={styles.footnote}>
          Everyone sits below LAC, which keeps 20%. You can only set the rate of your direct agents, up to your own
          rate. Your share is your rate minus the rate you give the next agent.
        </p>
      </div>

      <div className={styles.tableSection}>
        <h2 className={styles.sectionTitle}>Referred traders</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Trader</th>
                <th>Joined</th>
                <th>Status</th>
                <th className={styles.num}>Fees generated</th>
                <th className={styles.num}>Your share</th>
              </tr>
            </thead>
            <tbody>
              {REFERRED_TRADERS.map((t) => (
                <tr key={t.user}>
                  <td>{t.user}</td>
                  <td className={styles.joined}>{t.joined}</td>
                  <td>
                    <span className={cx(styles.status, t.active ? styles.statusActive : styles.statusIdle)}>
                      {t.active ? 'Active' : 'Signed up'}
                    </span>
                  </td>
                  <td className={styles.num}>{dollars(t.feesCents)}</td>
                  <td className={cx(styles.num, styles.share)}>{dollars(earnings(t.feesCents, YOUR_RATE))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.footnote}>Payouts: [schedule and method]</p>
      </div>
    </Page>
  );
}
