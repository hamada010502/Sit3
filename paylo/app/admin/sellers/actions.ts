'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getDb, nowIso } from '@/lib/db';
import { notify, appUrl } from '@/lib/notify';
import { requireAdmin } from '@/lib/guards';
import type { SellerStatus, User } from '@/lib/types';

export interface SellerActionState { error?: string; ok?: boolean }

export async function setSellerStatusAction(sellerId: string, status: SellerStatus, _prev: SellerActionState | null, formData: FormData): Promise<SellerActionState> {
  requireAdmin();
  const db = getDb();
  const row = db.prepare('SELECT s.*, u.email, u.totp_enabled FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
    .get(sellerId) as { email: string; totp_enabled: number; store_name: string; slug: string } | undefined;
  if (!row) return { error: 'apply_error_generic' };
  // v2 §6 makes two-factor mandatory, so a store cannot go live without it.
  if (status === 'approved' && !row.totp_enabled) return { error: 'tfa_required_note' };

  const note = String(formData.get('note') || '').trim() || null;
  db.prepare('UPDATE sellers SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?').run(status, note, nowIso(), sellerId);
  audit('admin', null, 'admin', 'seller', sellerId, 'status:' + status, note);

  const msg = status === 'approved' ? `Your store "${row.store_name}" is approved. Your storefront: ${appUrl('/s/' + row.slug)}\nAdd products and share the links from ${appUrl('/seller/products')}.`
    : status === 'rejected' ? `Your seller application for "${row.store_name}" was not approved.`
    : status === 'suspended' ? `Your seller account "${row.store_name}" has been suspended and your links are disabled.`
    : `Your seller account "${row.store_name}" is under review.`;
  await notify({ event: 'seller.' + status, email: { to: row.email, subject: `Paylo — seller account ${status}`, body: `${msg}${note ? '\n\nNote from Paylo: ' + note : ''}\n\n— Paylo` } });
  revalidatePath('/admin/sellers');
  revalidatePath(`/admin/sellers/${sellerId}`);
  return { ok: true };
}

export async function reviewKycAction(sellerId: string, approve: boolean, formData: FormData): Promise<void> {
  requireAdmin();
  const db = getDb();
  const note = String(formData.get('note') || '').trim() || null;
  db.prepare('UPDATE sellers SET kyc_status = ?, kyc_note = ?, kyc_reviewed_at = ? WHERE id = ?')
    .run(approve ? 'approved' : 'rejected', note, nowIso(), sellerId);
  audit('admin', null, 'admin', 'seller', sellerId, approve ? 'kyc.approved' : 'kyc.rejected', note);
  const u = db.prepare('SELECT u.email, s.store_name FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sellerId) as { email: string; store_name: string } | undefined;
  if (u) await notify({ event: 'kyc.reviewed', email: { to: u.email, subject: `Paylo — identity verification ${approve ? 'approved' : 'rejected'}`,
    body: `Hi ${u.store_name},\n\nYour identity verification was ${approve ? 'approved. Payouts are now unlocked.' : 'not accepted.'}${note ? '\n\n' + note : ''}\n\n${appUrl('/seller/verification')}\n\n— Paylo` } });
  revalidatePath(`/admin/sellers/${sellerId}`);
  revalidatePath('/admin/ops');
}

export async function removeListingAction(productId: string): Promise<void> {
  requireAdmin();
  getDb().prepare("UPDATE products SET status = 'removed', updated_at = ? WHERE id = ?").run(nowIso(), productId);
  audit('admin', null, 'admin', 'product', productId, 'removed_by_admin');
  revalidatePath('/admin/sellers');
}

export async function resetTotpAction(sellerId: string): Promise<void> {
  requireAdmin();
  const db = getDb();
  const u = db.prepare('SELECT user_id FROM sellers WHERE id = ?').get(sellerId) as { user_id: string } | undefined;
  if (!u) return;
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery = NULL WHERE id = ?').run(u.user_id);
  audit('admin', null, 'admin', 'user', u.user_id, '2fa.reset_by_admin');
  revalidatePath(`/admin/sellers/${sellerId}`);
}
