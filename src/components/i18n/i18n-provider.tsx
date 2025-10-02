"use client";

import { createContext, useState, useCallback, ReactNode } from 'react';
import translations from './translations';
import type { Locale, TranslationKey } from './translations';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, replacements?: { [key: string]: string | number }) => string;
}

export const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('pt-BR');

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
