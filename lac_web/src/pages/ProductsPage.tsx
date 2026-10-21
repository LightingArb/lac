import { useState } from 'react';
import { Button, type ButtonVariant } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Page, PageHeader } from '../components/ui/Page';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { BILLING_OPTIONS, PERIOD_SUFFIX, PLANS, type BillingPeriod, type PlanDef } from '../data/plans';
import { cx } from '../lib/cx';
import styles from './ProductsPage.module.css';

const CTA_VARIANT: Record<PlanDef['kind'], ButtonVariant> = {
  free: 'muted',
  bundle: 'primary',
  paid: 'secondary',
  soon: 'muted',
};

export function ProductsPage() {
  const [billing, setBilling] = useState<BillingPeriod>('monthly');

  return (
    <Page label="Products">
      <div className={styles.intro}>
        <PageHeader
          className={styles.introText}
          title="Products"
          description="LAC model signals on the web and in Telegram. Pick one market or get them all."
        />
        <SegmentedControl label="Billing period" options={BILLING_OPTIONS} value={billing} onChange={setBilling} tone="strong" />
      </div>

      <div className={styles.grid}>
        {PLANS.map((plan) => (
          <div key={plan.name} className={cx(styles.plan, plan.kind === 'bundle' && styles.featured)}>
            <div className={styles.planHead}>
              <span className={styles.planIcon} style={{ background: plan.tone.bg, color: plan.tone.fg }}>
                <Icon name={plan.icon} size={20} />
              </span>
              <h2 className={styles.planName}>{plan.name}</h2>
              {plan.tag && <span className={styles.tag}>{plan.tag}</span>}
            </div>
            <p className={styles.tagline}>{plan.tagline}</p>
            <div className={styles.price}>
              <span className={styles.priceValue}>{plan.price}</span>
              {plan.recurring && <span className={styles.period}>{PERIOD_SUFFIX[billing]}</span>}
            </div>
            <ul className={styles.features}>
              {plan.features.map((feature) => (
                <li key={feature} className={styles.feature}>
                  <Icon name="check" size={16} strokeWidth={2.2} className={styles.check} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Button variant={CTA_VARIANT[plan.kind]} block disabled={plan.kind === 'free' || plan.kind === 'soon'}>
              {plan.cta}
            </Button>
          </div>
        ))}
      </div>

      <div className={styles.redeem}>
        <span className={styles.redeemText}>Have a code from a promotion or a partner? Redeem it to add days to a plan.</span>
        <Button variant="secondary">Redeem code</Button>
      </div>
    </Page>
  );
}
