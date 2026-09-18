'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
/** Re-fetches the server component tree on an interval so status changes show up without a reload. */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
