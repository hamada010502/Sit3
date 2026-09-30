'use server';
import { makeT } from '@/lib/i18n';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { pushToSeller } from '@/lib/push';

export async function saveNotifyPrefsAction(_prev: { ok?: boolean } | null, formData: FormData) {
  const { user, seller } = requireApprovedSeller();
  const text = ['sms', 'whatsapp'].includes(String(formData.get('notify_text'))) ? String(formData.get('notify_text')) : 'none';
  const on = (k: string) => (formData.get(k) ? 1 : 0);
  getDb().prepare('UPDATE sellers SET notify_push = ?, notify_sound = ?, notify_email_orders = ?, notify_text = ? WHERE id = ?')
    .run(on('notify_push'), on('notify_sound'), on('notify_email_orders'), text, seller.id);
  audit('seller', user.id, seller.store_name, 'seller', seller.id, 'notifications.updated', { push: on('notify_push'), sound: on('notify_sound'), email: on('notify_email_orders'), text });
  revalidatePath('/seller', 'layout');
  return { ok: true };
}

/** Dashboard shortcut: flips the sale sound without opening settings. */
export async function setSoundAction(on: boolean) {
  const { seller } = requireApprovedSeller();
  getDb().prepare('UPDATE sellers SET notify_sound = ? WHERE id = ?').run(on ? 1 : 0, seller.id);
  revalidatePath('/seller', 'layout');
}

export async function testPushAction(): Promise<{ sent: number }> {
  const { seller } = requireApprovedSeller();
  return { sent: await pushToSeller(seller.id, (lang) => ({ title: makeT(lang)('push_test_title'), body: makeT(lang)('push_test_body'), url: '/seller/settings', tag: 'paylo-test' })) };
}
