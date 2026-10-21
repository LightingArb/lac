import { NavLink } from 'react-router';
import { LANGUAGES, type Language } from '../../data/preferences';
import { cx } from '../../lib/cx';
import type { CategoryItem } from '../../lib/markets';
import type { DataMode } from '../../lib/live';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import styles from './Sidebar.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV_TOP: NavItem[] = [
  { to: '/prediction', label: 'Prediction', icon: 'prediction' },
  { to: '/signal', label: 'Signal', icon: 'signal' },
];

const NAV_BOTTOM: NavItem[] = [
  { to: '/stocks', label: 'Stocks', icon: 'stocks' },
  { to: '/products', label: 'Products', icon: 'products' },
  { to: '/referral', label: 'Referral rewards', icon: 'gift' },
];

const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: 'gear' };

interface SidebarProps {
  /** `drawer`: always expanded, fills the mobile drawer, and its toggle closes the drawer. */
  variant?: 'panel' | 'drawer';
  open: boolean;
  onToggle: () => void;
  /** Called on every nav click; the app clears the search there. */
  onNavigate: () => void;
  onBuyUsdt: () => void;
  /** Null outside the Prediction and Signal pages. */
  categories: CategoryItem[] | null;
  categoryHeading: string;
  onPickCategory: (id: string) => void;
  language: Language;
  dataMode: DataMode;
  onDataMode: (mode: DataMode) => void;
}

export function Sidebar(props: SidebarProps) {
  return props.open || props.variant === 'drawer' ? <ExpandedSidebar {...props} /> : <CollapsedSidebar {...props} />;
}

function Logo() {
  return (
    <span className={styles.logo}>
      <Icon name="logo" strokeWidth={2} />
    </span>
  );
}

function ModeSwitch({ dataMode, onDataMode }: Pick<SidebarProps, 'dataMode' | 'onDataMode'>) {
  return <div className={styles.modeSwitch} role="group" aria-label="Data mode">
    {(['demo', 'live'] as const).map(mode => <button key={mode} type="button" aria-pressed={dataMode === mode}
      onClick={() => onDataMode(mode)}>{mode === 'demo' ? 'Demo' : 'Live'}</button>)}
  </div>;
}

function ExpandedSidebar({
  variant = 'panel',
  onToggle,
  onNavigate,
  onBuyUsdt,
  categories,
  categoryHeading,
  onPickCategory,
  language,
  dataMode,
  onDataMode,
}: SidebarProps) {
  const lang = LANGUAGES.find((l) => l.value === language) ?? LANGUAGES[0];
  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) => cx(styles.item, isActive && styles.itemActive)}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </NavLink>
  );

  const inDrawer = variant === 'drawer';

  return (
    <nav aria-label="Main navigation" className={cx(styles.sidebar, inDrawer && styles.inDrawer)}>
      <div className={styles.brand}>
        <Logo />
        <span className={styles.brandText}>
          <span className={styles.brandName}>LAC</span>
          <span className={styles.brandTagline}>Prediction terminal</span>
          <ModeSwitch dataMode={dataMode} onDataMode={onDataMode} />
        </span>
        {inDrawer ? (
          <IconButton label="Close menu" icon="close" strokeWidth={2} onClick={onToggle} />
        ) : (
          <IconButton label="Collapse menu" icon="panelLeft" onClick={onToggle} />
        )}
      </div>

      <div className={styles.group}>
        {NAV_TOP.map(link)}
        <button type="button" aria-haspopup="dialog" className={cx(styles.item, styles.buy)} onClick={onBuyUsdt}>
          <Icon name="usdt" />
          <span>Buy USDT</span>
        </button>
        {NAV_BOTTOM.map(link)}
      </div>

      {categories && (
        <div className={styles.group}>
          <span className={styles.groupHeading}>{categoryHeading}</span>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.active}
              className={cx(styles.item, c.active && styles.categoryActive)}
              onClick={() => onPickCategory(c.id)}
            >
              <Icon name={c.icon} />
              <span className={styles.categoryLabel}>{c.label}</span>
              <span className={styles.categoryCount}>{c.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        {link(SETTINGS)}
        <div className={styles.account}>
          <Button variant="dark" className={styles.signIn}>
            <Icon name="user" size={18} />
            <span>Sign in</span>
          </Button>
          <button type="button" className={styles.language} aria-label={`Language: ${lang.label}`}>
            {lang.short}
          </button>
        </div>
      </div>
    </nav>
  );
}

function CollapsedSidebar({ onToggle, onNavigate, onBuyUsdt, categories, onPickCategory, dataMode, onDataMode }: SidebarProps) {
  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={onNavigate}
      aria-label={item.label}
      title={item.label}
      className={({ isActive }) => cx(styles.railItem, isActive && styles.railItemActive)}
    >
      <Icon name={item.icon} />
    </NavLink>
  );

  return (
    <nav aria-label="Main navigation" className={styles.rail}>
      <Logo />
      <ModeSwitch dataMode={dataMode} onDataMode={onDataMode} />
      <IconButton label="Expand menu" icon="panelLeft" onClick={onToggle} />
      {NAV_TOP.map(link)}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Buy USDT"
        title="Buy USDT"
        className={cx(styles.railItem, styles.buy)}
        onClick={onBuyUsdt}
      >
        <Icon name="usdt" />
      </button>
      {NAV_BOTTOM.map(link)}
      {categories && (
        <>
          <span className={styles.railDivider} />
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={c.label}
              title={c.label}
              aria-pressed={c.active}
              className={cx(styles.railItem, c.active && styles.railItemActive)}
              onClick={() => onPickCategory(c.id)}
            >
              <Icon name={c.icon} />
            </button>
          ))}
        </>
      )}
      <span className={styles.railSpacer} />
      {link(SETTINGS)}
    </nav>
  );
}
