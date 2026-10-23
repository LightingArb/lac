import { Page, PageHeader } from '../components/ui/Page';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { activityText } from '../data/backend';
import { logText } from '../data/withdrawals';
import { useT } from '../i18n';
import type { AdminProps } from './AdminApp';
import { ContentTab } from './ContentTab';
import { StaffTab } from './StaffTab';
import { useTab } from './useTab';
import styles from './Admin.module.css';
import local from './StaffTab.module.css';

const TABS = ['content', 'admins', 'activity'] as const;

export function SystemPage({ backend: b }: AdminProps) {
  const t = useT();
  const st = t.admin.system;
  const [tab, setTab] = useTab(TABS);
  const options = TABS.map((value) => ({ value, label: st.tabs[value] }));

  return (
    <Page label={st.title}>
      <PageHeader title={st.title} description={st.description} />
      <div className={styles.tabs}>
        <SegmentedControl label={st.title} options={options} value={tab} onChange={setTab} />
      </div>
      {tab === 'content' && <ContentTab />}
      {tab === 'admins' && <StaffTab />}
      {tab === 'activity' && <ActivityTab backend={b} />}
    </Page>
  );
}

function ActivityTab({ backend: b }: Pick<AdminProps, 'backend'>) {
  const t = useT();
  // Staff steps on withdrawals live in each request's own log; everything else in the activity table.
  const entries = [
    ...b.activity.map((a) => ({ at: a.at, by: a.by, text: activityText(t, b, a) })),
    ...b.withdrawals.flatMap((w) =>
      w.log
        .filter((entry) => entry.by !== w.user)
        .map((entry) => ({ at: entry.at, by: entry.by, text: t.admin.activity.withdrawal(w.id, logText(t, w, entry)) })),
    ),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));

  return (
    <>
      <p className={styles.footnote}>{t.admin.admins.activityNote}</p>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={i}>
                <td className={local.when}>{t.date(entry.at)}</td>
                <td className={local.who}>{entry.by}</td>
                <td>{entry.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
