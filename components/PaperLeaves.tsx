 'use client';

import { useEffect, useState } from 'react';

export default function PaperLeaves() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const update = () => setPaused(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className={`paper-leaves${paused ? ' is-paused' : ''}`} aria-hidden="true"><i/><i/><i/><i/><i/></div>;
}
