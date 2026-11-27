'use client';

import { useLocale } from './LocaleProvider';
import {lazy, Suspense} from 'react';

const Notebook=lazy(()=>import('./Notebook'));

export default function NotebookBoundary(props:Parameters<typeof import('./Notebook').default>[0]){
  const { t } = useLocale();
  return <Suspense fallback={props.visible?<div role="status" className="note-loading">{t("正在打开笔记本…")}</div>:null}>
    <Notebook {...props}/>
  </Suspense>;
}
