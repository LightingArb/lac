import { useState } from 'react';
import { Button, type ButtonVariant } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Page, PageHeader } from '../components/ui/Page';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { BILLING_PERIODS, PLANS, planPrice, planText, type BillingPeriod, type PlanDef } from '../data/plans';
import { itemNames, liveVersion, type Item, type SignalProduct, type Version } from '../data/products';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import styles from './ProductsPage.module.css';

const CTA_VARIANT: Record<PlanDef['kind'], ButtonVariant> = {
  free: 'muted',
  bundle: 'primary',
  paid: 'secondary',
  soon: 'muted',
};

const SIGNAL_PLANS = new Set<string>(['all', 'weather', 'crypto', 'forex', 'future', 'sport']);

/** Plans are fixed; what each signal plan includes comes from the version on sale now. */
export function ProductsPage({ items, versions }: { items: Item[]; versions: Version[] }) {
  const t = useT();
  const includes = (id: string) =>
    SIGNAL_PLANS.has(id) ? itemNames(t, items, liveVersion(versions, id as SignalProduct).items).join(t.lang === 'zh-Hant' ? '、' : ', ') : null;
  const [billing, setBilling] = useState<BillingPeriod>('monthly');
  const billingOptions = BILLING_PERIODS.map((value) => ({ value, label: t.plans.billing[value] }));

  return (
    <Page label={t.productsPage.title}>
      <div className={styles.intro}>
        <PageHeader className={styles.introText} title={t.productsPage.title} description={t.productsPage.description} />
        <SegmentedControl
          label={t.productsPage.billing}
          options={billingOptions}
          value={billing}
          onChange={setBilling}
          tone="strong"
        />
      </div>

      <div className={styles.grid}>
        {PLANS.map((plan) => {
          const text = planText(t, plan.id);
          return (
            <div key={plan.id} className={cx(styles.plan, plan.kind === 'bundle' && styles.featured)}>
              <div className={styles.planHead}>
                <span className={styles.planIcon} style={{ background: plan.tone.bg, color: plan.tone.fg }}>
                  <Icon name={plan.icon} size={20} />
                </span>
                <h2 className={styles.planName}>{text.name}</h2>
                {text.tag && <span className={styles.tag}>{text.tag}</span>}
              </div>
              <p className={styles.tagline}>{text.tagline}</p>
              {includes(plan.id) && <p className={styles.includes}>{t.productsPage.includes(includes(plan.id)!)}</p>}
              <div className={styles.price}>
                <span className={styles.priceValue}>{planPrice(t, plan)}</span>
                {plan.recurring && <span className={styles.period}>{t.plans.suffix[billing]}</span>}
              </div>
              <ul className={styles.features}>
                {text.features.map((feature) => (
                  <li key={feature} className={styles.feature}>
                    <Icon name="check" size={16} strokeWidth={2.2} className={styles.check} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button variant={CTA_VARIANT[plan.kind]} block disabled={plan.kind === 'free' || plan.kind === 'soon'}>
                {t.plans.cta[plan.kind]}
              </Button>
            </div>
          );
        })}
      </div>

      <div className={styles.redeem}>
        <span className={styles.redeemText}>{t.productsPage.redeemText}</span>
        <Button variant="secondary">{t.productsPage.redeem}</Button>
      </div>
    </Page>
  );
}
