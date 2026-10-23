export type Language = 'en' | 'zh-Hant';
export type Theme = 'light' | 'dark';

export interface Preferences {
  language: Language;
  theme: Theme;
}

export const DEFAULT_PREFERENCES: Preferences = { language: 'en', theme: 'light' };

export const LANGUAGES: { value: Language; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'zh-Hant', label: '繁體中文', short: '繁中' },
];

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
