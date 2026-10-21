import { createContext, useContext, type ReactNode } from 'react';
import type { Language } from '../data/preferences';
import { en, type Messages } from './en';
import { zh } from './zh';

export type { Messages };

export const MESSAGES: Record<Language, Messages> = { en, 'zh-Hant': zh };

const I18n = createContext<Messages>(en);

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <I18n.Provider value={MESSAGES[language]}>{children}</I18n.Provider>;
}

/** Copy for the current language. */
export const useT = () => useContext(I18n);
