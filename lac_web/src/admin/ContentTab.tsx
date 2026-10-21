import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Panel } from '../components/ui/Panel';
import { Switch } from '../components/ui/Switch';
import { TextField } from '../components/ui/TextField';
import { USDT_PROVIDERS, methodList } from '../data/providers';
import { useT } from '../i18n';
import styles from './Admin.module.css';
import local from './ContentTab.module.css';

const LEGAL = [
  { key: 'terms', updated: 'Oct 1, 2026' },
  { key: 'privacy', updated: 'Oct 1, 2026' },
  { key: 'risk', updated: 'Sep 20, 2026' },
] as const;

export function ContentTab() {
  const t = useT();
  const ct = t.admin.content;
  const [providers, setProviders] = useState(USDT_PROVIDERS.map((p) => ({ ...p, shown: true })));
  // null until edited, so the default follows the language.
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerOn, setBannerOn] = useState(false);
  const [saved, setSaved] = useState(false);
  const bannerText = banner ?? ct.bannerDefault;

  const move = (index: number, by: number) =>
    setProviders((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  return (
    <div className={local.stack}>
      <p className={styles.footnote}>{ct.description}</p>

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.panelTitle}>{ct.partners}</h2>
          <span className={styles.footnote}>{ct.partnersNote}</span>
        </div>
        <ul className={local.list}>
          {providers.map((p, i) => (
            <li key={p.name} className={local.item}>
              <span className={local.logo}>{p.abbr}</span>
              <span className={local.info}>
                <span className={styles.strong}>{p.name}</span>
                <span className={styles.sub}>
                  {methodList(t, p.methods)} · {p.url}
                </span>
              </span>
              <IconButton
                label={ct.moveUp(p.name)}
                icon="chevronLeft"
                className={local.up}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <IconButton
                label={ct.moveDown(p.name)}
                icon="chevronRight"
                className={local.down}
                disabled={i === providers.length - 1}
                onClick={() => move(i, 1)}
              />
              <Switch
                label={p.shown ? ct.shown : ct.hidden}
                checked={p.shown}
                onChange={(shown) => setProviders((list) => list.map((x) => (x.name === p.name ? { ...x, shown } : x)))}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <h2 className={styles.panelTitle}>{ct.banner}</h2>
        <TextField
          label={ct.text}
          value={bannerText}
          onChange={(e) => {
            setBanner(e.target.value);
            setSaved(false);
          }}
        />
        <div className={styles.toolbar}>
          <Switch label={bannerOn ? ct.shownOnSite : ct.hidden} checked={bannerOn} onChange={setBannerOn} />
          <Button onClick={() => setSaved(true)}>{t.common.save}</Button>
          {saved && <span className={styles.saved}>{ct.saved}</span>}
        </div>
        {bannerOn && bannerText.trim() && <div className={local.preview}>{bannerText}</div>}
      </Panel>

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.panelTitle}>{ct.legal}</h2>
          <span className={styles.footnote}>{ct.legalNote}</span>
        </div>
        {LEGAL.map((page) => (
          <div key={page.key} className={local.legal}>
            <span>
              <span className={styles.strong}>{t.settings[page.key]}</span>
              <span className={styles.sub}>{ct.updated(t.date(page.updated))}</span>
            </span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
