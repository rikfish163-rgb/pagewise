import type { Metadata } from 'next';
import './globals.css';
import './absolutely-fonts.css';
export const metadata: Metadata = { title:'页边 · 学习阅读器',description:'在课件和论文中划词、框图、提问，回看同一门课的讨论。',icons:{icon:'/favicon.svg'} };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>;}
