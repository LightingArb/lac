import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { Button, buttonClass } from '../components/ui/Button';
import { Page, PageHeader } from '../components/ui/Page';
import { Panel } from '../components/ui/Panel';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { TextField } from '../components/ui/TextField';
import { LANGUAGES, THEMES, type Preferences } from '../data/preferences';
import { useT } from '../i18n';
import { normalizeReferralCode, referralLink } from '../data/referral';
import styles from './SettingsPage.module.css';

// Legal pages are not written yet; keep the links from changing the route.
const noPage = (e: MouseEvent<HTMLAnchorElement>) => e.preventDefault();

interface SettingsPageProps {
  referralCode: string;
  onReferralCodeChange: (code: string) => void;
  preferences: Preferences;
  onPreferencesChange: (preferences: Preferences) => void;
}

export function SettingsPage({
  referralCode,
  onReferralCodeChange,
  preferences,
  onPreferencesChange,
}: SettingsPageProps) {
  const t = useT();
  const st = t.settings;
  const themes = THEMES.map((theme) => ({ value: theme.value, label: st.themes[theme.value] }));
  const [walletConnected, setWalletConnected] = useState(false);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [draft, setDraft] = useState(referralCode);
  const [saved, setSaved] = useState(false);
  const canSave = draft !== '' && draft !== referralCode;

  return (
    <Page label={st.title} width="narrow">
      <PageHeader title={st.title} className={styles.header} />

      <Panel>
        <h2 className={styles.sectionTitle}>{st.profile}</h2>
        <TextField label={st.email} type="email" value="you@example.com" readOnly />
        <TextField label={st.displayName} type="text" placeholder={st.namePlaceholder} />
      </Panel>

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{st.referralCode}</h2>
          <span className={styles.hint}>{st.codeHint}</span>
        </div>
        <div className={styles.inline}>
          <TextField
            label={st.code}
            value={draft}
            autoComplete="off"
            className={styles.grow}
            inputClassName={styles.codeInput}
            onChange={(e) => {
              setDraft(normalizeReferralCode(e.target.value));
              setSaved(false);
            }}
          />
          <Button
            disabled={!canSave}
            onClick={() => {
              onReferralCodeChange(draft);
              setSaved(true);
            }}
          >
            {t.common.save}
          </Button>
        </div>
        <span className={styles.hint}>
          {st.yourLink} <strong className={styles.link}>{referralLink(referralCode)}</strong>
        </span>
        {saved && <span className={styles.saved}>{st.codeSaved}</span>}
      </Panel>

      <Panel>
        <h2 className={styles.sectionTitle}>{st.trading}</h2>
        <p className={styles.hint}>{st.tradingHint}</p>
        <div className={styles.prefRow}>
          <span>
            <strong>{st.wallet}</strong>
            <br />
            {walletConnected ? st.connected('0x8f3a…41c2') : st.notConnected}
          </span>
          <Button
            variant={walletConnected ? 'secondary' : 'primary'}
            onClick={() => {
              setWalletConnected(!walletConnected);
              setTradingEnabled(false);
            }}
          >
            {walletConnected ? st.disconnect : st.connect}
          </Button>
        </div>
        <div className={styles.prefRow}>
          <span>
            <strong>{st.tradingKey}</strong>
            <br />
            {tradingEnabled ? st.tradingOn('019a…c3f1') : walletConnected ? st.tradingOff : st.needWallet}
          </span>
          {!tradingEnabled && (
            <Button disabled={!walletConnected} onClick={() => setTradingEnabled(true)}>
              {st.enableTrading}
            </Button>
          )}
        </div>
        <span className={styles.hint}>{st.signNote}</span>
        <span className={styles.hint}>{st.tradingDemo}</span>
      </Panel>

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{st.telegram}</h2>
          <span className={styles.hint}>{st.telegramHint}</span>
        </div>
        <div className={styles.inline}>
          <TextField
            label={st.telegramUid}
            type="text"
            inputMode="numeric"
            placeholder={st.uidPlaceholder}
            className={styles.grow}
          />
          <Button>{st.linkTelegram}</Button>
        </div>
        <a href="https://t.me/" target="_blank" rel="noopener noreferrer" className={styles.textLink}>
          {st.telegramSupport}
        </a>
      </Panel>

      <Panel>
        <h2 className={styles.sectionTitle}>{st.preferences}</h2>
        <div className={styles.prefRow}>
          <span className={styles.prefLabel}>{st.language}</span>
          <SegmentedControl
            label={st.language}
            options={LANGUAGES}
            value={preferences.language}
            onChange={(language) => onPreferencesChange({ ...preferences, language })}
          />
        </div>
        <div className={styles.prefRow}>
          <span className={styles.prefLabel}>{st.theme}</span>
          <SegmentedControl
            label={st.theme}
            options={themes}
            value={preferences.theme}
            onChange={(theme) => onPreferencesChange({ ...preferences, theme })}
          />
        </div>
      </Panel>

      <Panel className={styles.legal}>
        <h2 className={styles.sectionTitle}>{st.legal}</h2>
        <a href="#terms" className={styles.legalLink} onClick={noPage}>
          {st.terms}
        </a>
        <a href="#privacy" className={styles.legalLink} onClick={noPage}>
          {st.privacy}
        </a>
        <a href="#risk" className={styles.legalLink} onClick={noPage}>
          {st.risk}
        </a>
      </Panel>

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{st.office}</h2>
          <span className={styles.hint}>{st.officeHint}</span>
        </div>
        <Link to="/admin" className={buttonClass('dark', false, styles.officeLink)}>
          {st.openOffice}
        </Link>
      </Panel>
    </Page>
  );
}
