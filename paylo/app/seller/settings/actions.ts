'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { requireSeller } from '@/lib/guards';
import { GOVERNORATES } from '@/lib/types';
import { saveUpload } from '../products/actions';

export async function saveSettingsAction(_prev: { error?: string; ok?: boolean } | null, formData: FormData) {
  const { seller } = requireSeller();
  const storeName = String(formData.get('store_name') || '').trim();
  const instagram = String(formData.get('instagram') || '').trim().replace(/^@/, '') || null;
  const phone = String(formData.get('phone') || '').trim();
  const governorate = String(formData.get('governorate') || '');
  const bio = String(formData.get('bio') || '').trim() || null;
  const about = String(formData.get('about') || '').trim() || null;
  const payoutDetails = String(formData.get('payout_details') || '').trim() || null;
  const visible = formData.get('visible') ? 1 : 0;
  const announcement = String(formData.get('announcement') || '').trim().slice(0, 160) || null;
  const thankYou = String(formData.get('thank_you_message') || '').replace(/\r\n?/g, '\n').trim().slice(0, 500) || null;
  if (!storeName || !phone || !(GOVERNORATES as readonly string[]).includes(governorate)) return { error: 'apply_error_generic' };

  const logo = formData.get('logo');
  const banner = formData.get('banner');
  const logoPath = logo instanceof File ? await saveUpload(logo) : null;
  const bannerPath = banner instanceof File ? await saveUpload(banner) : null;

  // New upload wins; otherwise "remove" clears it; otherwise keep what is there.
  const logoVal = logoPath ?? (formData.get('remove_logo') ? null : seller.logo_path);
  const bannerVal = bannerPath ?? (formData.get('remove_banner') ? null : seller.banner_path);
  getDb().prepare(`UPDATE sellers SET store_name = ?, instagram = ?, phone = ?, governorate = ?, bio = ?, about = ?,
      payout_details = ?, visible = ?, announcement = ?, thank_you_message = ?, logo_path = ?, banner_path = ? WHERE id = ?`)
    .run(storeName, instagram, phone, governorate, bio, about, payoutDetails, visible, announcement, thankYou, logoVal, bannerVal, seller.id);
  audit('seller', seller.id, storeName, 'seller', seller.id, 'settings.updated', { visible, announcement: !!announcement });
  revalidatePath('/seller/settings');
  revalidatePath(`/s/${seller.slug}`);
  return { ok: true };
}
