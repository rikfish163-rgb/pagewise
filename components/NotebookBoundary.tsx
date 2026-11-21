'use client';

import {lazy, Suspense} from 'react';

const Notebook=lazy(()=>import('./Notebook'));

export default function NotebookBoundary(props:Parameters<typeof import('./Notebook').default>[0]){
  return <Suspense fallback={<div role="status" className="note-loading">正在打开学习笔记…</div>}>
    <Notebook {...props}/>
  </Suspense>;
}
