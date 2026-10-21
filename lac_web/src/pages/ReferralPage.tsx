import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Page, PageHeader } from '../components/ui/Page';
import { TextField } from '../components/ui/TextField';
import { REFERRAL_STATS, REFERRAL_STEPS, REFERRED_TRADERS, referralLink } from '../data/referral';
import { cx } from '../lib/cx';
import styles from './ReferralPage.module.css';

interface ReferralPageProps {
  code: string;
}

export function ReferralPage({ code }: ReferralPageProps) {
  const [copied, setCopied] = useState(false);
  const link = referralLink(code);

  const copy = () => {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
  };

  return (
    <Page label="Referral rewards">
      <PageHeader
        title="Referral rewards"
        description="Invite traders to LAC. When they sign up with your link, you earn [xx%] of the trading fees they generate."
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
        {REFERRAL_STATS.map((stat) => (
          <div key={stat.label} className={styles.card}>
            <span className={styles.statLabel}>{stat.label}</span>
            <span className={styles.statValue}>{stat.value}</span>
          </div>
        ))}
      </div>

      <ol className={styles.steps}>
        {REFERRAL_STEPS.map((step, i) => (
          <li key={step.title} className={cx(styles.card, styles.step)}>
            <span className={styles.stepNumber}>{i + 1}</span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>{step.title}</span>
              <span className={styles.stepBody}>{step.text}</span>
            </span>
          </li>
        ))}
      </ol>

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
                  <td className={styles.num}>{t.fees}</td>
                  <td className={cx(styles.num, styles.share)}>{t.share}</td>
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
