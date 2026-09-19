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
  if (!storeName || !phone || !(GOVERNORATES as readonly string[]).includes(governorate)) return { error: 'apply_error_generic' };

  const logo = formData.get('logo');
  const banner = formData.get('banner');
  const logoPath = logo instanceof File ? await saveUpload(logo) : null;
  const bannerPath = banner instanceof File ? await saveUpload(banner) : null;

  getDb().prepare(`UPDATE sellers SET store_name = ?, instagram = ?, phone = ?, governorate = ?, bio = ?, about = ?,
      payout_details = ?, visible = ?, logo_path = COALESCE(?, logo_path), banner_path = COALESCE(?, banner_path) WHERE id = ?`)
    .run(storeName, instagram, phone, governorate, bio, about, payoutDetails, visible, logoPath, bannerPath, seller.id);
  audit('seller', seller.id, storeName, 'seller', seller.id, 'settings.updated', { visible });
  revalidatePath('/seller/settings');
  revalidatePath(`/s/${seller.slug}`);
  return { ok: true };
}
