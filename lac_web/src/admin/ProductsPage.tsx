import { useState } from 'react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Page, PageHeader } from '../components/ui/Page';
import { Panel } from '../components/ui/Panel';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { TextField } from '../components/ui/TextField';
import { CODE_DAYS } from '../data/admin';
import { entitlementStatus, type CodeRow } from '../data/backend';
import { BILLING_PERIODS, type BillingPeriod } from '../data/plans';
import {
  SIGNAL_PRODUCTS,
  itemName,
  itemNames,
  itemsFor,
  liveVersion,
  productName,
  versionLabel,
  type SignalProduct,
} from '../data/products';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import type { AdminProps } from './AdminApp';
import { useTab } from './useTab';
import styles from './Admin.module.css';
import local from './ProductsPage.module.css';

const TABS = ['products', 'items', 'codes'] as const;

export function ProductsPage(props: AdminProps) {
  const t = useT();
  const pt = t.admin.products;
  const [tab, setTab] = useTab(TABS);
  const pending = props.backend.items.filter((i) => i.status === 'pending').length;
  const options = TABS.map((value) => ({
    value,
    label: value === 'items' && pending ? `${pt.tabs.items} ${pending}` : pt.tabs[value],
  }));

  return (
    <Page label={pt.title}>
      <PageHeader title={pt.title} description={pt.description} />
      <div className={styles.tabs}>
        <SegmentedControl label={pt.title} options={options} value={tab} onChange={setTab} />
      </div>
      {tab === 'products' && <ProductsTab {...props} />}
      {tab === 'items' && <ItemsTab {...props} />}
      {tab === 'codes' && <CodesTab {...props} />}
    </Page>
  );
}

const join = (t: ReturnType<typeof useT>, names: string[]) => names.join(t.lang === 'zh-Hant' ? '、' : ', ');

function ProductsTab({ backend: b, dispatch }: AdminProps) {
  const t = useT();
  const pt = t.admin.products;
  const [editing, setEditing] = useState<SignalProduct | null>(null);
  const holders = (versionId: string) =>
    b.entitlements.filter((e) => e.versionId === versionId && entitlementStatus(e) === 'active').length;

  return (
    <div className={local.cards}>
      {SIGNAL_PRODUCTS.map((product) => {
        const live = liveVersion(b.versions, product);
        const waiting = itemsFor(b.items, product).filter((i) => !live.items.includes(i.id));
        const older = b.versions.filter((x) => x.product === product && x.retiredOn).sort((x, y) => y.number - x.number);
        return (
          <Panel key={product}>
            <div className={local.cardHead}>
              <h2 className={styles.panelTitle}>{productName(t, product)}</h2>
              <Badge tone="info">{pt.onSale(live.number)}</Badge>
              <span className={local.spacer} />
              {editing !== product && (
                <Button variant={waiting.length ? 'primary' : 'secondary'} className={styles.smallButton} onClick={() => setEditing(product)}>
                  {pt.newVersion(live.number + 1)}
                </Button>
              )}
            </div>
            <span className={styles.sub}>
              {pt.published(t.day(live.publishedOn))} · {pt.holders(holders(live.id))}
            </span>
            <div className={local.chips}>
              {itemNames(t, b.items, live.items).map((name) => (
                <span key={name} className={local.chip}>
                  {name}
                </span>
              ))}
            </div>
            <span className={local.prices}>
              {BILLING_PERIODS.map((p) => `${t.plans.billing[p]} ${live.prices[p] ? `$${live.prices[p]}` : '[$xx]'}`).join(' · ')}
            </span>
            {waiting.length > 0 && (
              <p className={local.waiting}>{pt.waiting(join(t, waiting.map((i) => itemName(t, i))))}</p>
            )}

            {editing === product && (
              <VersionEditor product={product} backend={b} dispatch={dispatch} onDone={() => setEditing(null)} />
            )}

            {older.length > 0 && (
              <div className={local.history}>
                <span className={styles.fieldLabel}>{pt.history}</span>
                {older.map((x) => (
                  <span key={x.id} className={styles.sub}>
                    v{x.number} · {t.day(x.publishedOn)} – {t.day(x.retiredOn!)} · {pt.holders(holders(x.id))} ·{' '}
                    {join(t, itemNames(t, b.items, x.items))}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function VersionEditor({
  product,
  backend: b,
  dispatch,
  onDone,
}: AdminProps & { product: SignalProduct; onDone: () => void }) {
  const t = useT();
  const pt = t.admin.products;
  const live = liveVersion(b.versions, product);
  const available = itemsFor(b.items, product);
  // Start from what is on sale plus anything approved since.
  const [picked, setPicked] = useState<string[]>(available.map((i) => i.id));
  const [prices, setPrices] = useState<Partial<Record<BillingPeriod, string>>>(live.prices);
  const [error, setError] = useState(false);
  const groups = product === 'all' ? (['weather', 'crypto', 'forex', 'future', 'sport'] as const) : [product];

  return (
    <div className={local.editor}>
      <h3 className={local.editorTitle}>{pt.editor(versionLabel(t, { ...live, number: live.number + 1 }))}</h3>
      <span className={styles.fieldLabel}>{pt.pick}</span>
      {groups.map((group) => (
        <div key={group} className={local.group}>
          {product === 'all' && <span className={styles.sub}>{t.products[group as Exclude<SignalProduct, 'all'>]}</span>}
          <div className={local.checks}>
            {available
              .filter((i) => i.product === group)
              .map((i) => (
                <label key={i.id} className={local.check}>
                  <input
                    type="checkbox"
                    checked={picked.includes(i.id)}
                    onChange={(e) => {
                      setError(false);
                      setPicked((list) => (e.target.checked ? [...list, i.id] : list.filter((id) => id !== i.id)));
                    }}
                  />
                  {itemName(t, i)}
                  {!live.items.includes(i.id) && <Badge tone="info">{pt.isNew}</Badge>}
                </label>
              ))}
          </div>
        </div>
      ))}
      <span className={styles.fieldLabel}>{pt.prices}</span>
      <div className={styles.toolbar}>
        {BILLING_PERIODS.map((p) => (
          <TextField
            key={p}
            label={t.plans.billing[p]}
            inputMode="decimal"
            placeholder="$xx"
            className={local.price}
            value={prices[p] ?? ''}
            onChange={(e) => setPrices((all) => ({ ...all, [p]: e.target.value.replace(/[^\d.]/g, '') }))}
          />
        ))}
      </div>
      <p className={styles.footnote}>{pt.publishNote(live.number)}</p>
      {error && <span className={local.error}>{pt.needItem}</span>}
      <div className={local.buttons}>
        <Button
          onClick={() => {
            if (!picked.length) return setError(true);
            // Keep the item order the same as the item list.
            const items = available.map((i) => i.id).filter((id) => picked.includes(id));
            dispatch({ type: 'publish', product, items, prices });
            onDone();
          }}
        >
          {pt.publish(live.number + 1)}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

function ItemsTab({ backend: b, dispatch }: AdminProps) {
  const t = useT();
  const pt = t.admin.products;
  const tone = { pending: 'warning', approved: 'success', rejected: 'neutral' } as const;
  const sorted = [...b.items].sort((x, y) => Number(y.status === 'pending') - Number(x.status === 'pending'));

  return (
    <>
      <p className={styles.footnote}>{pt.itemsNote}</p>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{pt.item}</th>
              <th>{t.admin.col.product}</th>
              <th>{pt.seen}</th>
              <th>{t.admin.col.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              const inLive = SIGNAL_PRODUCTS.map((p) => liveVersion(b.versions, p)).filter((x) => x.items.includes(item.id));
              return (
                <tr key={item.id}>
                  <td className={styles.strong}>{itemName(t, item)}</td>
                  <td>{t.products[item.product]}</td>
                  <td>{t.date(item.seenAt)}</td>
                  <td>
                    <Badge tone={tone[item.status]}>{pt.itemStatus[item.status]}</Badge>
                    {item.status === 'approved' && (
                      <span className={styles.sub}>
                        {inLive.length ? pt.inVersion(join(t, inLive.map((x) => versionLabel(t, x)))) : pt.notInProduct}
                      </span>
                    )}
                  </td>
                  <td>
                    {item.status === 'pending' && (
                      <div className={local.buttons}>
                        <Button className={styles.smallButton} onClick={() => dispatch({ type: 'reviewItem', id: item.id, approve: true })}>
                          {pt.approve}
                        </Button>
                        <Button
                          variant="secondary"
                          className={styles.smallButton}
                          onClick={() => dispatch({ type: 'reviewItem', id: item.id, approve: false })}
                        >
                          {pt.reject}
                        </Button>
                      </div>
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

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => {
  const part = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  return `LAC-${part()}-${part()}`;
};

type CodeStatus = 'active' | 'usedUp' | 'expired' | 'disabled';
const CODE_TONE = { active: 'success', usedUp: 'neutral', expired: 'neutral', disabled: 'danger' } as const;

function codeStatus(c: CodeRow): CodeStatus {
  if (c.disabled) return 'disabled';
  if (c.used >= c.limit) return 'usedUp';
  if (Date.parse(c.expires) < Date.now()) return 'expired';
  return 'active';
}

function CodesTab({ backend: b, dispatch }: AdminProps) {
  const t = useT();
  const pt = t.admin.products;
  const [product, setProduct] = useState<SignalProduct>('all');
  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState('10');

  const create = () => {
    const expires = new Date(Date.now() + 90 * 86400000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    dispatch({
      type: 'createCode',
      code: { code: randomCode(), product, days, used: 0, limit: Math.max(1, Math.trunc(Number(limit) || 1)), expires },
    });
  };

  return (
    <Panel>
      <p className={styles.footnote}>{pt.codesNote}</p>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t.admin.col.product}</span>
          <select className={styles.select} value={product} onChange={(e) => setProduct(e.target.value as SignalProduct)}>
            {SIGNAL_PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {productName(t, p)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{pt.gives}</span>
          <select className={styles.select} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {CODE_DAYS.map((d) => (
              <option key={d} value={d}>
                {pt.days(d)}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label={pt.maxUses}
          inputMode="numeric"
          className={local.uses}
          value={limit}
          onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))}
        />
        <Button onClick={create}>{pt.create}</Button>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{pt.code}</th>
              <th>{t.admin.col.product}</th>
              <th>{pt.gives}</th>
              <th className={styles.num}>{pt.used}</th>
              <th>{pt.expires}</th>
              <th>{t.admin.col.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {b.codes.map((c) => {
              const status = codeStatus(c);
              return (
                <tr key={c.code}>
                  <td className={styles.mono}>{c.code}</td>
                  <td>{productName(t, c.product)}</td>
                  <td>{pt.days(c.days)}</td>
                  <td className={styles.num}>
                    {c.used} / {c.limit}
                  </td>
                  <td>{t.date(c.expires)}</td>
                  <td>
                    <Badge tone={CODE_TONE[status]}>{pt.codeStatus[status]}</Badge>
                  </td>
                  <td className={cx(styles.num)}>
                    {status === 'active' && (
                      <Button
                        variant="secondary"
                        className={styles.smallButton}
                        onClick={() => dispatch({ type: 'disableCode', code: c.code })}
                      >
                        {pt.disable}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
