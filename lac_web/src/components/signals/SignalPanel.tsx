import { useState } from 'react';
import type { Product, ProductId } from '../../data/catalog';
import { cx } from '../../lib/cx';
import type { PricedSignal } from '../../lib/markets';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { SignalCard } from './SignalCard';
import styles from './SignalPanel.module.css';

type SortId = 'latest' | 'ev' | 'roi' | 'depth' | 'expiry';

const SORTS: { id: SortId; label: string; key: (s: PricedSignal) => number }[] = [
  { id: 'latest', label: 'Latest', key: (s) => s.updatedSec },
  { id: 'ev', label: 'EV ↓', key: (s) => -s.ev },
  { id: 'roi', label: 'ROI ↓', key: (s) => -(s.ev / s.entry) },
  { id: 'depth', label: 'Depth ↓', key: (s) => -s.depth },
  { id: 'expiry', label: 'Expiry ↑', key: (s) => s.minutesLeft },
];

interface SignalPanelProps {
  /** `drawer`: never collapses, fills the mobile drawer, and its toggle closes the drawer. */
  variant?: 'aside' | 'drawer';
  open: boolean;
  onToggle: () => void;
  signals: PricedSignal[];
  products: Product[];
  activeId: string | null;
  onSelect: (signal: PricedSignal) => void;
}

export function SignalPanel({ variant = 'aside', open, onToggle, signals, products, activeId, onSelect }: SignalPanelProps) {
  const [tab, setTab] = useState<'all' | ProductId>('all');
  const [sort, setSort] = useState<SortId>('latest');
  const inDrawer = variant === 'drawer';

  if (!open && !inDrawer) {
    return (
      <aside aria-label="LAC signals" className={styles.collapsed}>
        <IconButton label="Expand signals" icon="panelRight" onClick={onToggle} />
        <span className={styles.verticalLabel}>SIGNALS · {signals.length}</span>
      </aside>
    );
  }

  const activeTab = tab === 'all' || products.some((p) => p.id === tab) ? tab : 'all';
  const tabs = [{ id: 'all' as const, label: 'All' }, ...products];
  const sortKey = SORTS.find((s) => s.id === sort)!.key;
  const list = signals
    .filter((s) => activeTab === 'all' || s.product === activeTab)
    .sort((a, b) => sortKey(a) - sortKey(b));

  return (
    <aside aria-label="LAC signals" className={cx(styles.panel, inDrawer && styles.inDrawer)}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Icon name="signal" strokeWidth={2} className={styles.titleIcon} />
          <h2 className={styles.title}>Signal</h2>
          <IconButton label="Search signals" icon="search" strokeWidth={2} />
          {inDrawer ? (
            <IconButton label="Close signals" icon="close" strokeWidth={2} onClick={onToggle} />
          ) : (
            <IconButton label="Collapse signals" icon="panelRight" onClick={onToggle} />
          )}
        </div>
        <div role="group" aria-label="Signal product" className={styles.tabs}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={activeTab === t.id}
              className={cx(styles.tab, activeTab === t.id && styles.tabActive)}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Sort signals" className={styles.sorts}>
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sort === s.id}
              className={cx(styles.sort, sort === s.id && styles.sortActive)}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.list}>
        {list.length === 0 && <p className={styles.empty}>No signals right now.</p>}
        {list.map((s) => (
          <SignalCard key={s.id} signal={s} active={s.id === activeId} onSelect={() => onSelect(s)} />
        ))}
      </div>

      <div className={styles.footer}>
        <span>Per page 10</span>
        <span>{list.length ? `1–${list.length} / ${list.length}` : '0 / 0'}</span>
        <span className={styles.pager}>
          <IconButton label="Previous page" icon="chevronLeft" iconSize={16} strokeWidth={2} variant="outline" disabled />
          <IconButton label="Next page" icon="chevronRight" iconSize={16} strokeWidth={2} variant="outline" disabled />
        </span>
      </div>
    </aside>
  );
}
