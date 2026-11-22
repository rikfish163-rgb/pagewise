import type { Metadata } from 'next';
import './globals.css';
import './absolutely-fonts.css';
import ThemeProvider from '@/components/ThemeProvider';
import './workspace-theme.css';
export const metadata: Metadata = { title:'页边 · 学习阅读器',description:'在课件和论文中划词、框图、提问，回看同一门课的讨论。',icons:{icon:'/favicon.svg'} };
const initializeTheme = `
  (() => {
    let theme;
    try { theme = localStorage.getItem('pagewise:theme'); } catch {}
    document.documentElement.dataset.theme = theme === 'light' || theme === 'dark'
      ? theme
      : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  })();
`;

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){
  return <html lang="zh-CN" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{__html:initializeTheme}} /></head>
    <body><ThemeProvider>{children}</ThemeProvider></body>
  </html>;
}
