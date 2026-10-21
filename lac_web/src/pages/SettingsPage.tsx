import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Page, PageHeader } from '../components/ui/Page';
import { Panel } from '../components/ui/Panel';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { TextField } from '../components/ui/TextField';
import { LANGUAGES, THEMES, type Preferences } from '../data/preferences';
import { normalizeReferralCode, referralLink } from '../data/referral';
import styles from './SettingsPage.module.css';

interface SettingsPageProps {
  referralCode: string;
  onReferralCodeChange: (code: string) => void;
  preferences: Preferences;
  onPreferencesChange: (preferences: Preferences) => void;
}

export function SettingsPage({ referralCode, onReferralCodeChange, preferences, onPreferencesChange }: SettingsPageProps) {
  const [draft, setDraft] = useState(referralCode);
  const [saved, setSaved] = useState(false);
  const canSave = draft !== '' && draft !== referralCode;

  return (
    <Page label="Settings" width="narrow">
      <PageHeader title="Settings" className={styles.header} />

      <Panel>
        <h2 className={styles.sectionTitle}>Profile</h2>
        <TextField label="Email" type="email" value="you@example.com" readOnly />
        <TextField label="Display name" type="text" placeholder="Your name" />
      </Panel>

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Referral code</h2>
          <span className={styles.hint}>Used in your referral link. Letters and numbers only, up to 16.</span>
        </div>
        <div className={styles.inline}>
          <TextField
            label="Code"
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
            Save
          </Button>
        </div>
        <span className={styles.hint}>
          Your link: <strong className={styles.link}>{referralLink(referralCode)}</strong>
        </span>
        {saved && <span className={styles.saved}>Saved. Your referral link now uses this code.</span>}
      </Panel>

      <Panel>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Telegram</h2>
          <span className={styles.hint}>Link your Telegram account to receive LAC signals there.</span>
        </div>
        <div className={styles.inline}>
          <TextField label="Telegram UID" type="text" inputMode="numeric" placeholder="e.g. 123456789" className={styles.grow} />
          <Button>Link Telegram</Button>
        </div>
        <a href="https://t.me/" target="_blank" rel="noopener noreferrer" className={styles.textLink}>
          Telegram support
        </a>
      </Panel>

      <Panel>
        <h2 className={styles.sectionTitle}>Preferences</h2>
        <div className={styles.prefRow}>
          <span className={styles.prefLabel}>Language</span>
          <SegmentedControl
            label="Language"
            options={LANGUAGES}
            value={preferences.language}
            onChange={(language) => onPreferencesChange({ ...preferences, language })}
          />
        </div>
        <div className={styles.prefRow}>
          <span className={styles.prefLabel}>Theme</span>
          <SegmentedControl
            label="Theme"
            options={THEMES}
            value={preferences.theme}
            onChange={(theme) => onPreferencesChange({ ...preferences, theme })}
          />
        </div>
      </Panel>

      <Panel className={styles.legal}>
        <h2 className={styles.sectionTitle}>Legal</h2>
        <a href="#terms" className={styles.legalLink}>
          Terms of service
        </a>
        <a href="#privacy" className={styles.legalLink}>
          Privacy policy
        </a>
        <a href="#risk" className={styles.legalLink}>
          Risk disclosure
        </a>
      </Panel>
    </Page>
  );
}
