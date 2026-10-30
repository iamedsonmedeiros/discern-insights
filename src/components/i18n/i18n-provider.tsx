"use client";

import { createContext, useState, useCallback, useEffect, ReactNode } from 'react';
import translations from './translations';
import type { Locale, TranslationKey } from './translations';

const LOCALE_KEY = 'discern-locale';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, replacements?: { [key: string]: string | number }) => string;
}

export const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('pt-BR');

  useEffect(() => {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (saved === 'en' || saved === 'pt-BR') setLocaleState(saved);
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(LOCALE_KEY, next);
  };

  const t = useCallback((key: TranslationKey, replacements?: { [key: string]: string | number }) => {
    let translation = translations[locale][key] || translations['en'][key] || key;
    
    if (replacements) {
        Object.entries(replacements).forEach(([key, value]) => {
            translation = translation.replace(`{{${key}}}`, String(value));
        });
    }

    return translation;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}
