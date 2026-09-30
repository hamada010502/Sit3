'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';

/** The seller copied their store link from the checklist: that step counts as done. */
export async function markLinkCopiedAction() {
  const { seller } = requireApprovedSeller();
  getDb().prepare('UPDATE sellers SET onboarding_link_copied = 1 WHERE id = ?').run(seller.id);
  revalidatePath('/seller');
}

export async function dismissOnboardingAction() {
  const { seller } = requireApprovedSeller();
  getDb().prepare('UPDATE sellers SET onboarding_dismissed = 1 WHERE id = ?').run(seller.id);
  revalidatePath('/seller');
}
