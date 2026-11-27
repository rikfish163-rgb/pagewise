'use client';

import { useLocale } from './LocaleProvider';
import {lazy, Suspense} from 'react';
import type {Props} from './Reader';

const Reader=lazy(()=>import('./Reader'));

export default function ReaderBoundary(props:Props){
  const { t } = useLocale();
  return <Suspense fallback={<div role="status" className="reader-loading">{t("正在准备阅读器…")}</div>}>
    <Reader {...props}/>
  </Suspense>;
}
