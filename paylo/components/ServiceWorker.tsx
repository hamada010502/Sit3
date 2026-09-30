'use client';
import { useEffect } from 'react';

/** Registers /sw.js (offline page + Web Push). Harmless where unsupported. */
export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* e.g. private mode */ });
  }, []);
  return null;
}
