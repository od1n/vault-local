import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { I18nContext, type Locale, getTranslation } from './index';

function detectLocale(): Locale {
  // Check localStorage first
  try {
    const saved = localStorage.getItem('vault-local-locale');
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // localStorage not available
  }
  // Detect from browser
  const lang = navigator.language?.toLowerCase() || '';
  if (lang.startsWith('es')) return 'es';
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem('vault-local-locale', newLocale);
    } catch {
      // localStorage not available
    }
  }, []);

  const t = useCallback(
    (key: string, fallback?: string) => {
      return getTranslation(locale, key, fallback);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
