import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '../components/ui/Badge';
import { Page, PageHeader } from '../components/ui/Page';
import { TextField } from '../components/ui/TextField';
import { entitlementStatus, versionById } from '../data/backend';
import { versionLabel } from '../data/products';
import { dollars } from '../data/referral';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import type { AdminProps } from './AdminApp';
import styles from './Admin.module.css';

export function MembersPage({ backend: b }: AdminProps) {
  const t = useT();
  const mt = t.admin.members;
  const c = t.admin.col;
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q
    ? b.members.filter((m) => [m.email, m.name, m.code, m.referredBy].some((v) => v.toLowerCase().includes(q)))
    : b.members;

  const products = (code: string) =>
    b.entitlements
      .filter((e) => e.member === code && entitlementStatus(e) === 'active')
      .map((e) => versionLabel(t, versionById(b, e.versionId)));

  return (
    <Page label={mt.title}>
      <PageHeader title={mt.title} description={mt.description} />

      <div className={styles.toolbar}>
        <TextField
          label={t.common.search}
          type="search"
          placeholder={mt.placeholder}
          className={styles.grow}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{c.member}</th>
              <th>{c.joined}</th>
              <th>{mt.products}</th>
              <th>{c.code}</th>
              <th>{c.referredBy}</th>
              <th className={styles.num}>{c.rate}</th>
              <th className={styles.num}>{mt.fees}</th>
              <th>{c.status}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const list = products(m.code);
              return (
                <tr key={m.code} className={styles.clickRow} onClick={() => navigate(`/admin/members/${m.code}`)}>
                  <td>
                    <Link to={`/admin/members/${m.code}`} className={styles.rowLink} onClick={(e) => e.stopPropagation()}>
                      {t.admin.name(m.name)}
                    </Link>
                    <span className={styles.sub}>{m.email}</span>
                  </td>
                  <td>{t.date(m.joined)}</td>
                  <td className={cx(!list.length && styles.muted)}>{list.length ? list.join(', ') : '—'}</td>
                  <td className={styles.mono}>{m.code}</td>
                  <td className={styles.mono}>{m.referredBy}</td>
                  <td className={styles.num}>{m.rate === null ? '—' : `${m.rate}%`}</td>
                  <td className={styles.num}>{dollars(m.feesCents)}</td>
                  <td>
                    <Badge tone={m.status === 'active' ? 'success' : 'danger'}>
                      {m.status === 'active' ? mt.active : mt.suspended}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  {mt.noMatch}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.footnote}>{mt.footnote}</p>
    </Page>
  );
}
