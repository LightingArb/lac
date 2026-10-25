import { Fragment, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { cx } from '../../lib/cx';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import styles from './TopBar.module.css';

interface TopBarProps {
  /** Breadcrumb trail, e.g. ["Prediction", "Trending"]. */
  trail: string[];
  /** Selected event title, shown bold at the end of the trail. */
  current: string | null;
  /** Shown on the Prediction and Signal pages only. */
  search: { value: string; onChange: (value: string) => void } | null;
  /** Phone layout: opens the navigation drawer. */
  onOpenMenu?: () => void;
  /** Narrow screens on the Signal page: opens the signals drawer. */
  signals?: { count: number; onOpen: () => void } | null;
  /** Screens too narrow for the terminal column (Signal page, Demo): opens the terminal drawer. */
  onOpenTerminal?: (() => void) | null;
  /** Search placeholder and accessible name; defaults to searching markets. */
  searchLabel?: string;
  /** Page controls at the right end, after the search (Sports: odds format). */
  actions?: ReactNode;
}

export function TopBar({ trail, current, search, onOpenMenu, signals, onOpenTerminal, searchLabel, actions }: TopBarProps) {
  const t = useT();
  return (
    <div className={styles.topBar}>
      {onOpenMenu && <IconButton label={t.nav.openMenu} icon="menu" aria-haspopup="dialog" onClick={onOpenMenu} />}
      <nav aria-label={t.topBar.breadcrumb} className={cx(styles.breadcrumb, current && styles.hasCurrent)}>
        {trail.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 && <Separator />}
            <span className={styles.crumb}>{crumb}</span>
          </Fragment>
        ))}
        {current && (
          <>
            <Separator />
            <span className={styles.current} aria-current="page">
              {current}
            </span>
          </>
        )}
      </nav>
      {signals && (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t.topBar.signalCount(signals.count)}
          className={styles.signalsButton}
          onClick={signals.onOpen}
        >
          <Icon name="signal" size={18} strokeWidth={2} />
          <span>{signals.count}</span>
        </button>
      )}
      {onOpenTerminal && (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t.topBar.terminal}
          className={styles.signalsButton}
          onClick={onOpenTerminal}
        >
          <Icon name="wallet" size={18} strokeWidth={2} />
          <span>{t.topBar.terminalButton}</span>
        </button>
      )}
      {search && (
        <>
          <IconButton label={t.topBar.filter} icon="filter" variant="outline" />
          <label className={styles.search}>
            <Icon name="search" size={18} strokeWidth={2} />
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={searchLabel ?? t.topBar.search}
              aria-label={searchLabel ?? t.topBar.search}
              className={styles.searchInput}
            />
          </label>
        </>
      )}
      {actions}
    </div>
  );
}

function Separator() {
  return <Icon name="chevronRight" size={16} strokeWidth={2} className={styles.separator} />;
}
