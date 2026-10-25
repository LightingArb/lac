import { NavLink } from 'react-router';
import { LANGUAGES, type Language } from '../../data/preferences';
import { useT, type Messages } from '../../i18n';
import { cx } from '../../lib/cx';
import type { CategoryItem } from '../../lib/markets';
import type { DataMode } from '../../lib/live';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import styles from './Sidebar.module.css';

type NavKey = keyof Messages['nav'];

interface NavItem {
  to: string;
  key: NavKey & ('prediction' | 'signal' | 'sports' | 'stocks' | 'products' | 'referral' | 'settings');
  icon: IconName;
}

const NAV_TOP: NavItem[] = [
  { to: '/prediction', key: 'prediction', icon: 'prediction' },
  { to: '/signal', key: 'signal', icon: 'signal' },
  { to: '/sports', key: 'sports', icon: 'sports' },
];

const NAV_BOTTOM: NavItem[] = [
  { to: '/stocks', key: 'stocks', icon: 'stocks' },
  { to: '/products', key: 'products', icon: 'products' },
  { to: '/referral', key: 'referral', icon: 'gift' },
];

const SETTINGS: NavItem = { to: '/settings', key: 'settings', icon: 'gear' };

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
  onToggleLanguage: () => void;
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
  const t = useT();
  return (
    <div className={styles.modeSwitch} role="group" aria-label={t.nav.dataMode}>
      {(['demo', 'live'] as const).map((mode) => (
        <button key={mode} type="button" aria-pressed={dataMode === mode} onClick={() => onDataMode(mode)}>
          {t.common[mode]}
        </button>
      ))}
    </div>
  );
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
  onToggleLanguage,
  dataMode,
  onDataMode,
}: SidebarProps) {
  const t = useT();
  const lang = LANGUAGES.find((l) => l.value === language) ?? LANGUAGES[0];
  const other = LANGUAGES.find((l) => l.value !== language) ?? LANGUAGES[0];
  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) => cx(styles.item, isActive && styles.itemActive)}
    >
      <Icon name={item.icon} />
      <span>{t.nav[item.key]}</span>
    </NavLink>
  );

  const inDrawer = variant === 'drawer';

  return (
    <nav aria-label={t.nav.mainNav} className={cx(styles.sidebar, inDrawer && styles.inDrawer)}>
      <div className={styles.brand}>
        <Logo />
        <span className={styles.brandText}>
          <span className={styles.brandName}>LAC</span>
          <span className={styles.brandTagline}>{t.nav.tagline}</span>
          <ModeSwitch dataMode={dataMode} onDataMode={onDataMode} />
        </span>
        {inDrawer ? (
          <IconButton label={t.nav.closeMenu} icon="close" strokeWidth={2} onClick={onToggle} />
        ) : (
          <IconButton label={t.nav.collapse} icon="panelLeft" onClick={onToggle} />
        )}
      </div>

      <div className={styles.group}>
        {NAV_TOP.map(link)}
        <button type="button" aria-haspopup="dialog" className={cx(styles.item, styles.buy)} onClick={onBuyUsdt}>
          <Icon name="usdt" />
          <span>{t.nav.buyUsdt}</span>
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
              className={cx(styles.item, !!c.depth && styles.subItem, c.active && styles.categoryActive)}
              onClick={() => onPickCategory(c.id)}
            >
              {c.depth ? <span className={styles.subDot} /> : <Icon name={c.icon} />}
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
            <span>{t.nav.signIn}</span>
          </Button>
          <button
            type="button"
            className={styles.language}
            aria-label={t.nav.switchLanguage(other.label)}
            title={t.nav.switchLanguage(other.label)}
            onClick={onToggleLanguage}
          >
            {lang.short}
          </button>
        </div>
      </div>
    </nav>
  );
}

function CollapsedSidebar({ onToggle, onNavigate, onBuyUsdt, categories, onPickCategory, dataMode, onDataMode }: SidebarProps) {
  const t = useT();
  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={onNavigate}
      aria-label={t.nav[item.key]}
      title={t.nav[item.key]}
      className={({ isActive }) => cx(styles.railItem, isActive && styles.railItemActive)}
    >
      <Icon name={item.icon} />
    </NavLink>
  );

  return (
    <nav aria-label={t.nav.mainNav} className={styles.rail}>
      <Logo />
      <ModeSwitch dataMode={dataMode} onDataMode={onDataMode} />
      <IconButton label={t.nav.expand} icon="panelLeft" onClick={onToggle} />
      {NAV_TOP.map(link)}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t.nav.buyUsdt}
        title={t.nav.buyUsdt}
        className={cx(styles.railItem, styles.buy)}
        onClick={onBuyUsdt}
      >
        <Icon name="usdt" />
      </button>
      {NAV_BOTTOM.map(link)}
      {categories && (
        <>
          <span className={styles.railDivider} />
          {categories.filter((c) => !c.depth).map((c) => (
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
