'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { setSetting } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';

export async function saveAdminSettingsAction(_prev: { ok?: boolean } | null, formData: FormData) {
  requireAdmin();
  const num = (k: string, min: number, max: number, int = true) => {
    const v = Number(String(formData.get(k) ?? ''));
    if (!Number.isFinite(v)) return;
    setSetting(k, String(Math.min(max, Math.max(min, int ? Math.round(v) : v))));
  };
  const text = (k: string) => setSetting(k, String(formData.get(k) || '').trim());
  const flag = (k: string) => setSetting(k, formData.get(k) ? '1' : '0');

  num('commission_rate', 0, 100, false);
  num('commission_fixed_fee', 0, 10_000_000);
  num('commission_vat_rate', 0, 100, false);
  num('delivery_fee_damascus', 0, 10_000_000);
  num('delivery_fee_other', 0, 10_000_000);
  num('payout_cutoff_day', 0, 6);
  num('payout_cutoff_hour', 0, 23);
  num('payout_transfer_day', 0, 6);
  num('address_change_window_hours', 0, 720);
  setSetting('payout_eligibility', String(formData.get('payout_eligibility')) === 'on_delivery' ? 'on_delivery' : 'on_close');
  text('logistics_partner_name'); text('bank_name'); text('bank_account_name'); text('bank_iban'); text('bank_note');
  flag('yalla_go_enabled'); flag('cod_enabled'); flag('bank_transfer_enabled'); flag('card_enabled');
  flag('notify_email'); flag('notify_sms');

  audit('admin', null, 'admin', 'settings', 'platform', 'updated');
  revalidatePath('/admin/settings');
  return { ok: true };
}
