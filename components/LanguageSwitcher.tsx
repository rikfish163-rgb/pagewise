'use client';

import { useLocale } from './LocaleProvider';
import './language-switcher.css';

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();

  return <div className="language-switcher" data-compact={compact} role="group" aria-label={t('界面语言')}>
    <button type="button" lang="zh-CN" aria-label={t('切换到中文')} aria-pressed={locale === 'zh-CN'} onClick={() => setLocale('zh-CN')}>
      中文
    </button>
    <button type="button" lang="en" aria-label={t('切换到英文')} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>
      {compact ? 'EN' : 'English'}
    </button>
  </div>;
}
