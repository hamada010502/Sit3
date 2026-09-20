'use server';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/guards';
import { computeMarketAnalytics, computeOwnerOverview, MARKET_KEY, OVERVIEW_KEY, writeCache } from '@/lib/analytics';

/** The only place a page load triggers a recompute — an explicit, owner-initiated click. */
export async function refreshAnalyticsAction() {
  requireOwner();
  writeCache(OVERVIEW_KEY, computeOwnerOverview());
  writeCache(MARKET_KEY, computeMarketAnalytics());
  revalidatePath('/owner');
  revalidatePath('/owner/analytics');
}
