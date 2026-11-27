'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  localeCookieName,
  localePreferenceKey,
  resolveLocale,
  translate,
  type Locale,
  type MessageValues,
} from '../lib/i18n';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (message: string, values?: MessageValues) => string;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh-CN',
  setLocale: () => {},
  t: (message, values) => translate('zh-CN', message, values),
});

export function useLocale() {
  return useContext(LocaleContext);
}

export default function LocaleProvider({
  children,
  initialLocale = 'zh-CN',
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const pathname = usePathname();
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    document.cookie = `${localeCookieName}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try {
      localStorage.setItem(localePreferenceKey, next);
    } catch {
      // The cookie and current session also retain the choice.
    }
  }, []);

  useEffect(() => {
    function syncPreference(event: StorageEvent) {
      if (event.key === localePreferenceKey) setLocale(resolveLocale(event.newValue));
    }
    window.addEventListener('storage', syncPreference);
    return () => window.removeEventListener('storage', syncPreference);
  }, [setLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    const title = pathname === '/login' ? '登录 · 页边'
      : pathname === '/admin/credits' ? '积分管理 · 页边' : '页边 · 学习阅读器';
    document.title = translate(locale, title);
  }, [locale, pathname]);

  const value = useMemo(() => ({
    locale,
    setLocale,
    t: (message: string, values?: MessageValues) => translate(locale, message, values),
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
