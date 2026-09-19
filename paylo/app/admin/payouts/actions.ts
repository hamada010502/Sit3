'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/guards';
import { generatePayouts, markPayoutFailed, markPayoutPaid, reopenPayout } from '@/lib/orders';

export async function generatePayoutsAction(): Promise<void> {
  requireAdmin();
  const n = generatePayouts();
  revalidatePath('/admin/payouts');
  redirect(`/admin/payouts?generated=${n}`);
}
export async function markPaidAction(payoutId: string, formData: FormData): Promise<void> {
  requireAdmin();
  await markPayoutPaid(payoutId, String(formData.get('reference') || '').trim() || null);
  revalidatePath('/admin/payouts');
}
export async function markFailedAction(payoutId: string, formData: FormData): Promise<void> {
  requireAdmin();
  await markPayoutFailed(payoutId, String(formData.get('reference') || '').trim() || 'Transfer failed');
  revalidatePath('/admin/payouts');
}
export async function reopenPayoutAction(payoutId: string): Promise<void> {
  requireAdmin();
  reopenPayout(payoutId);
  revalidatePath('/admin/payouts');
}
