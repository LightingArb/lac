import { useState } from 'react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Panel } from '../components/ui/Panel';
import { TextField } from '../components/ui/TextField';
import { ADMINS, PERMISSIONS, ROLES, type AdminAccount, type AdminRole } from '../data/admin';
import { useT } from '../i18n';
import styles from './Admin.module.css';
import local from './StaffTab.module.css';

export function StaffTab() {
  const t = useT();
  const at = t.admin.admins;
  const [admins, setAdmins] = useState<(AdminAccount & { invited?: boolean })[]>(ADMINS);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('Support');
  const [error, setError] = useState<string | undefined>();


  const invite = () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(at.enterEmail);
      return;
    }
    setAdmins((list) => [
      ...list,
      { name: email.trim().split('@')[0], email: email.trim(), role, twoFactor: false, lastActive: '—', invited: true },
    ]);
    setEmail('');
  };

  return (
    <div className={local.stack}>

      <Panel>
        <h2 className={styles.panelTitle}>{at.accounts}</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{at.admin}</th>
                <th>{at.role}</th>
                <th>{at.twoFactor}</th>
                <th>{at.lastActive}</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.email}>
                  <td>
                    <span className={styles.strong}>{a.name}</span>
                    <span className={styles.sub}>{a.email}</span>
                  </td>
                  <td>{t.admin.roles[a.role]}</td>
                  <td>
                    {a.invited ? (
                      <Badge tone="info">{at.invited}</Badge>
                    ) : (
                      <Badge tone={a.twoFactor ? 'success' : 'warning'}>{a.twoFactor ? at.on : at.off}</Badge>
                    )}
                  </td>
                  <td>{t.date(a.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.toolbar}>
          <TextField
            label={at.invite}
            type="email"
            placeholder="name@lac.example"
            className={styles.grow}
            value={email}
            error={error}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
          />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{at.role}</span>
            <select className={styles.select} value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t.admin.roles[r]}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={invite}>{at.send}</Button>
        </div>
      </Panel>

      <Panel>
        <h2 className={styles.panelTitle}>{at.roles}</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{at.permission}</th>
                {ROLES.map((r) => (
                  <th key={r} className={local.center}>
                    {t.admin.roles[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.id}>
                  <td>{at.permissions[p.id]}</td>
                  {ROLES.map((r) => (
                    <td key={r} className={local.center}>
                      {p.roles.includes(r) ? (
                        <span className={local.yes} aria-label={t.common.allowed}>
                          <Icon name="check" size={18} strokeWidth={2.2} />
                        </span>
                      ) : (
                        <span className={styles.muted} aria-label={t.common.notAllowed}>
                          —
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

    </div>
  );
}
