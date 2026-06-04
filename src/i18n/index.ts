import { createContext, useContext } from 'react';
import es from './es.json';
import en from './en.json';

export type Locale = 'es' | 'en';

const translations: Record<Locale, Record<string, string>> = { es, en };

export interface I18nContextType {
  locale: Locale;
  t: (key: string, fallback?: string) => string;
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextType>({
  locale: 'es',
  t: (key) => key,
  setLocale: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

export function getTranslation(locale: Locale, key: string, fallback?: string): string {
  return translations[locale]?.[key] || translations['es']?.[key] || fallback || key;
}

export { es, en };
