import { Link, NavLink, Navigate, Route, Routes } from 'react-router';
import { Badge } from '../components/ui/Badge';
import { Icon, type IconName } from '../components/ui/Icon';
import type { Backend, BackendAction } from '../data/backend';
import { LANGUAGES, type Language } from '../data/preferences';
import { ADMIN_ME, ADMIN_ROLE } from '../data/withdrawals';
import { useT, type Messages } from '../i18n';
import { cx } from '../lib/cx';
import { FinancePage } from './FinancePage';
import { InboxPage, inboxCount } from './InboxPage';
import { MemberPage } from './MemberPage';
import { MembersPage } from './MembersPage';
import { ProductsPage } from './ProductsPage';
import { SystemPage } from './SystemPage';
import { WithdrawalsPage } from './WithdrawalsPage';
import styles from './Admin.module.css';

const NAV: { to: string; key: keyof Messages['admin']['nav']; icon: IconName }[] = [
  { to: '/admin', key: 'inbox', icon: 'dashboard' },
  { to: '/admin/members', key: 'members', icon: 'users' },
  { to: '/admin/products', key: 'products', icon: 'tag' },
  { to: '/admin/withdrawals', key: 'withdrawals', icon: 'wallet' },
  { to: '/admin/finance', key: 'finance', icon: 'receipt' },
  { to: '/admin/system', key: 'system', icon: 'shield' },
];

export interface AdminProps {
  backend: Backend;
  dispatch: (action: BackendAction) => void;
}

interface AdminAppProps extends AdminProps {
  language: Language;
  onToggleLanguage: () => void;
}

/**
 * LAC staff back office, organised by the work staff do rather than by table.
 * In production it is a separate site with its own sign-in; here it shares the demo backend.
 */
export function AdminApp({ backend, dispatch, language, onToggleLanguage }: AdminAppProps) {
  const t = useT();
  const current = LANGUAGES.find((l) => l.value === language) ?? LANGUAGES[0];
  const other = LANGUAGES.find((l) => l.value !== language) ?? LANGUAGES[0];
  const counts: Partial<Record<keyof Messages['admin']['nav'], number>> = {
    inbox: inboxCount(backend),
    withdrawals: backend.withdrawals.filter((w) => w.status === 'pending').length,
  };
  const props = { backend, dispatch };

  return (
    <div className={styles.shell}>
      <nav aria-label={t.admin.brand} className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <Icon name="logo" strokeWidth={2} />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>LAC</span>
            <span className={styles.brandTagline}>{t.admin.brand}</span>
          </span>
        </div>

        <div className={styles.nav}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) => cx(styles.navItem, isActive && styles.navActive)}
            >
              <Icon name={item.icon} />
              <span>{t.admin.nav[item.key]}</span>
              {!!counts[item.key] && <span className={styles.navCount}>{counts[item.key]}</span>}
            </NavLink>
          ))}
        </div>

        <div className={styles.sidebarFooter}>
          <span className={styles.who}>
            {t.admin.signedIn(ADMIN_ME, t.admin.roles[ADMIN_ROLE])} <Badge>{t.common.demo}</Badge>
          </span>
          <div className={styles.footerRow}>
            <Link to="/settings" className={styles.navItem}>
              <Icon name="chevronLeft" />
              <span>{t.admin.backToSite}</span>
            </Link>
            <button
              type="button"
              className={styles.language}
              aria-label={t.nav.switchLanguage(other.label)}
              title={t.nav.switchLanguage(other.label)}
              onClick={onToggleLanguage}
            >
              {current.short}
            </button>
          </div>
        </div>
      </nav>

      <main className={styles.main}>
        <Routes>
          <Route index element={<InboxPage {...props} />} />
          <Route path="members" element={<MembersPage {...props} />} />
          <Route path="members/:code" element={<MemberPage {...props} />} />
          <Route path="products" element={<ProductsPage {...props} />} />
          <Route path="withdrawals" element={<WithdrawalsPage {...props} />} />
          <Route path="finance" element={<FinancePage {...props} />} />
          <Route path="system" element={<SystemPage {...props} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
