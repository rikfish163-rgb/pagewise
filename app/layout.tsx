import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import './absolutely-fonts.css';
import ThemeProvider from '@/components/ThemeProvider';
import LocaleProvider from '@/components/LocaleProvider';
import { localeCookieName, resolveLocale, translate } from '@/lib/i18n';
import './workspace-theme.css';
export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveLocale((await cookies()).get(localeCookieName)?.value);
  return {
    title: translate(locale, '页边 · 学习阅读器'),
    description: translate(locale, '在课件和论文中划词、框图、提问，回看同一门课的讨论。'),
    icons: { icon: '/favicon.svg' },
  };
}
const initializeTheme = `
  (() => {
    let theme;
    try { theme = localStorage.getItem('pagewise:theme'); } catch {}
    document.documentElement.dataset.theme = theme === 'light' || theme === 'dark'
      ? theme
      : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  })();
`;

export default async function RootLayout({children}:Readonly<{children:React.ReactNode}>){
  const locale = resolveLocale((await cookies()).get(localeCookieName)?.value);
  return <html lang={locale} suppressHydrationWarning>
    <head><link rel="preload" href="/fonts/inter/InterVariable.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/><script dangerouslySetInnerHTML={{__html:initializeTheme}} /></head>
    <body><LocaleProvider initialLocale={locale}><ThemeProvider>{children}</ThemeProvider></LocaleProvider></body>
  </html>;
}
