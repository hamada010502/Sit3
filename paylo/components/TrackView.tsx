'use client';
import { useEffect } from 'react';
import { sendEvent } from '@/lib/analytics-client';

/** Sends one view event when the page mounts (product page, store page). */
export function TrackView({ name, productId, storeSlug, props }: { name: 'product_view' | 'search_or_store_view'; productId?: string; storeSlug?: string; props?: Record<string, unknown> }) {
  useEffect(() => { sendEvent(name, { product_id: productId, store_slug: storeSlug, props }); }, [name, productId, storeSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
