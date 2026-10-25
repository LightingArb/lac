import { useState } from 'react';
import type { Product, ProductId } from '../../data/catalog';
import { useT } from '../../i18n';
import { cx } from '../../lib/cx';
import type { PricedSignal } from '../../lib/markets';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { SignalCard } from './SignalCard';
import styles from './SignalPanel.module.css';

type SortId = 'latest' | 'ev' | 'roi' | 'depth' | 'expiry';

const SORTS: { id: SortId; key: (s: PricedSignal) => number }[] = [
  { id: 'latest', key: (s) => s.updatedSec },
  { id: 'ev', key: (s) => -s.ev },
  { id: 'roi', key: (s) => -s.roi },
  { id: 'depth', key: (s) => -s.depth },
  { id: 'expiry', key: (s) => s.minutesLeft },
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
  /** Sports page: one line per sport the customer doesn't hold, giving only a count; a click opens Products. */
  locked?: { id: string; text: string }[];
  onLocked?: () => void;
  /** Replaces "No signals right now" (Live: LAC has no signals there yet). */
  emptyText?: string;
}

export function SignalPanel({
  variant = 'aside',
  open,
  onToggle,
  signals,
  products,
  activeId,
  onSelect,
  locked = [],
  onLocked,
  emptyText,
}: SignalPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<'all' | ProductId>('all');
  const [sort, setSort] = useState<SortId>('latest');
  const inDrawer = variant === 'drawer';

  if (!open && !inDrawer) {
    return (
      <aside aria-label={t.signals.panel} className={styles.collapsed}>
        <IconButton label={t.signals.expand} icon="panelRight" onClick={onToggle} />
        <span className={styles.verticalLabel}>{t.signals.vertical(signals.length)}</span>
      </aside>
    );
  }

  const activeTab = tab === 'all' || products.some((p) => p.id === tab) ? tab : 'all';
  const tabs = [
    { id: 'all' as const, label: t.common.all },
    ...products.map((p) => ({ id: p.id, label: t.products[p.id] })),
  ];
  const sortKey = SORTS.find((s) => s.id === sort)!.key;
  const list = signals
    .filter((s) => activeTab === 'all' || s.product === activeTab)
    .sort((a, b) => sortKey(a) - sortKey(b));

  return (
    <aside aria-label={t.signals.panel} className={cx(styles.panel, inDrawer && styles.inDrawer)}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Icon name="signal" strokeWidth={2} className={styles.titleIcon} />
          <h2 className={styles.title}>{t.signals.title}</h2>
          <IconButton label={t.signals.search} icon="search" strokeWidth={2} />
          {inDrawer ? (
            <IconButton label={t.signals.close} icon="close" strokeWidth={2} onClick={onToggle} />
          ) : (
            <IconButton label={t.signals.collapse} icon="panelRight" onClick={onToggle} />
          )}
        </div>
        <div role="group" aria-label={t.signals.productGroup} className={styles.tabs}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={activeTab === item.id}
              className={cx(styles.tab, activeTab === item.id && styles.tabActive)}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t.signals.sortGroup} className={styles.sorts}>
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sort === s.id}
              className={cx(styles.sort, sort === s.id && styles.sortActive)}
              onClick={() => setSort(s.id)}
            >
              {t.signals.sorts[s.id]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.list}>
        {list.length === 0 && locked.length === 0 && <p className={styles.empty}>{emptyText ?? t.signals.none}</p>}
        {locked.map((line) => (
          <button key={line.id} type="button" className={styles.locked} onClick={onLocked}>
            <Icon name="lock" size={16} strokeWidth={2} />
            <span className={styles.lockedText}>{line.text}</span>
            <Icon name="arrowRight" size={16} strokeWidth={2} />
          </button>
        ))}
        {list.map((s) => (
          <SignalCard key={s.id} signal={s} active={s.id === activeId} onSelect={() => onSelect(s)} />
        ))}
      </div>

      <div className={styles.footer}>
        <span>{t.signals.perPage}</span>
        <span>{list.length ? `1–${list.length} / ${list.length}` : '0 / 0'}</span>
        <span className={styles.pager}>
          <IconButton label={t.signals.previousPage} icon="chevronLeft" iconSize={16} strokeWidth={2} variant="outline" disabled />
          <IconButton label={t.signals.nextPage} icon="chevronRight" iconSize={16} strokeWidth={2} variant="outline" disabled />
        </span>
      </div>
    </aside>
  );
}
