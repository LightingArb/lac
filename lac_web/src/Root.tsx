import { useEffect, useReducer, useState } from 'react';
import { Route, Routes } from 'react-router';
import App from './App';
import { AdminApp } from './admin/AdminApp';
import { INITIAL_BACKEND, backendReducer, type BackendAction } from './data/backend';
import { DEFAULT_PREFERENCES, type Language, type Preferences } from './data/preferences';
import { nowStamp } from './data/withdrawals';
import { I18nProvider, MESSAGES } from './i18n';

const LANGUAGE_KEY = 'lac.language';

/** The chosen language is remembered in this browser; storage can be unavailable, so failures are ignored. */
function savedLanguage(): Language {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    if (value && value in MESSAGES) return value as Language;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return DEFAULT_PREFERENCES.language;
}

/**
 * Customer site and staff back office. They share the language and the demo backend
 * (withdrawals, products, members), so a change on one side shows on the other.
 */
export function Root() {
  const [preferences, setPreferences] = useState<Preferences>(() => ({
    ...DEFAULT_PREFERENCES,
    language: savedLanguage(),
  }));
  const [backend, apply] = useReducer(backendReducer, INITIAL_BACKEND);
  const dispatch = (action: BackendAction) => apply({ ...action, at: nowStamp() });
  const { language } = preferences;

  useEffect(() => {
    document.documentElement.lang = language === 'zh-Hant' ? 'zh-Hant-TW' : 'en';
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  }, [language]);

  const toggleLanguage = () =>
    setPreferences((prev) => ({ ...prev, language: prev.language === 'en' ? 'zh-Hant' : 'en' }));

  return (
    <I18nProvider language={language}>
      <Routes>
        <Route
          path="admin/*"
          element={
            <AdminApp
              backend={backend}
              dispatch={dispatch}
              language={language}
              onToggleLanguage={toggleLanguage}
            />
          }
        />
        <Route
          path="*"
          element={
            <App
              backend={backend}
              onWithdraw={(draft) => dispatch({ type: 'withdraw', draft })}
              preferences={preferences}
              onPreferencesChange={setPreferences}
              onToggleLanguage={toggleLanguage}
            />
          }
        />
      </Routes>
    </I18nProvider>
  );
}
