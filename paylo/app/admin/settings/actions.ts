'use server';
import { revalidatePath } from 'next/cache';
import { setSetting } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';

export async function saveAdminSettingsAction(_prev: { ok?: boolean } | null, formData: FormData) {
  requireAdmin();
  const num = (k: string, min: number, max: number, int = true) => {
    const v = Number(String(formData.get(k) || ''));
    if (!Number.isFinite(v)) return;
    setSetting(k, String(Math.min(max, Math.max(min, int ? Math.round(v) : v))));
  };
  num('commission_rate', 0, 100, false);
  num('delivery_fee_damascus', 0, 10_000_000);
  num('delivery_fee_other', 0, 10_000_000);
  num('payout_hold_days', 0, 60);
  setSetting('logistics_partner_name', String(formData.get('logistics_partner_name') || '').trim());
  setSetting('yalla_go_enabled', formData.get('yalla_go_enabled') ? '1' : '0');
  revalidatePath('/admin/settings');
  return { ok: true };
}
