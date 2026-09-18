'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/guards';
import { generateWeeklyPayouts, markPayoutPaid } from '@/lib/orders';

export async function generatePayoutsAction() {
  requireAdmin();
  const n = generateWeeklyPayouts();
  revalidatePath('/admin/payouts');
  redirect(`/admin/payouts?generated=${n}`);
}
export async function markPaidAction(payoutId: string, formData: FormData) {
  requireAdmin();
  await markPayoutPaid(payoutId, String(formData.get('reference') || '').trim() || null);
  revalidatePath('/admin/payouts');
}
