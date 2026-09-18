'use server';
import { revalidatePath } from 'next/cache';
import { getDb, nowIso } from '@/lib/db';
import { sendEmail, appUrl } from '@/lib/email';
import { requireAdmin } from '@/lib/guards';
import type { SellerStatus } from '@/lib/types';

export async function setSellerStatusAction(sellerId: string, status: SellerStatus, formData: FormData) {
  requireAdmin();
  const note = String(formData.get('note') || '').trim() || null;
  const db = getDb();
  db.prepare('UPDATE sellers SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?').run(status, note, nowIso(), sellerId);
  const row = db.prepare('SELECT u.email, s.store_name, s.slug FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sellerId) as { email: string; store_name: string; slug: string } | undefined;
  if (row) {
    const msg = status === 'approved' ? `Your store "${row.store_name}" is approved. Your storefront: ${appUrl('/s/' + row.slug)}\nAdd products and share checkout links from ${appUrl('/seller/products')}.`
      : status === 'rejected' ? `Your seller application for "${row.store_name}" was not approved.`
      : status === 'suspended' ? `Your seller account "${row.store_name}" has been suspended. Your links are disabled.`
      : `Your seller account "${row.store_name}" is under review.`;
    await sendEmail(row.email, `Paylo — seller account ${status}`, `${msg}${note ? '\n\nNote from Paylo: ' + note : ''}\n\n— Paylo`);
  }
  revalidatePath('/admin/sellers');
  revalidatePath(`/admin/sellers/${sellerId}`);
}

export async function removeListingAction(productId: string) {
  requireAdmin();
  getDb().prepare("UPDATE products SET status = 'removed', updated_at = ? WHERE id = ?").run(nowIso(), productId);
  revalidatePath('/admin/sellers');
}
