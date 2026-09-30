'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { adminInvestigate, adminResolveDispute, OrderError } from '@/lib/orders';
import type { Dispute, Liability } from '@/lib/types';

export async function investigateAction(disputeId: string, formData: FormData) {
  requireAdmin();
  const d = getDb().prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as Dispute | undefined;
  if (d) adminInvestigate(d, String(formData.get('note') || '').trim() || null);
  revalidatePath('/admin/disputes');
}
export async function resolveAction(disputeId: string, formData: FormData) {
  requireAdmin();
  const d = getDb().prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as Dispute | undefined;
  if (!d) return;
  const resolution = String(formData.get('resolution')) as 'refund' | 'partial_refund' | 'found' | 'dismiss';
  const liability = (String(formData.get('liability') || 'none') as Liability);
  const note = String(formData.get('note') || '').trim() || null;
  const amount = parseInt(String(formData.get('amount') || '0').replace(/[^0-9]/g, ''), 10) || 0;
  let error: string | null = null;
  try { await adminResolveDispute(d, resolution, liability, note, amount); } catch (e) { if (!(e instanceof OrderError)) throw e; error = e.message; }
  revalidatePath('/admin/disputes');
  if (error) redirect(`/admin/disputes?err=${encodeURIComponent(error)}#${d.id}`);
  revalidatePath(`/admin/orders/${d.order_id}`);
}
