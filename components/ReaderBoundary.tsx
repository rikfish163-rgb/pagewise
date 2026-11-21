'use client';

import {lazy, Suspense} from 'react';
import type {Props} from './Reader';

const Reader=lazy(()=>import('./Reader'));

export default function ReaderBoundary(props:Props){
  return <Suspense fallback={<div role="status" className="reader-loading">正在准备阅读器…</div>}>
    <Reader {...props}/>
  </Suspense>;
}
