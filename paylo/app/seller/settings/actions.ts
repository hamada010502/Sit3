'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { requireSeller } from '@/lib/guards';
import { GOVERNORATES } from '@/lib/types';

export async function saveSettingsAction(_prev: { error?: string; ok?: boolean } | null, formData: FormData) {
  const { seller } = requireSeller();
  const storeName = String(formData.get('store_name') || '').trim();
  const instagram = String(formData.get('instagram') || '').trim().replace(/^@/, '') || null;
  const phone = String(formData.get('phone') || '').trim();
  const governorate = String(formData.get('governorate') || '');
  const bio = String(formData.get('bio') || '').trim() || null;
  const payoutDetails = String(formData.get('payout_details') || '').trim() || null;
  if (!storeName || !phone || !(GOVERNORATES as readonly string[]).includes(governorate)) return { error: 'apply_error_generic' };
  getDb().prepare('UPDATE sellers SET store_name = ?, instagram = ?, phone = ?, governorate = ?, bio = ?, payout_details = ? WHERE id = ?')
    .run(storeName, instagram, phone, governorate, bio, payoutDetails, seller.id);
  revalidatePath('/seller/settings');
  return { ok: true };
}
