'use server';
import { revalidatePath } from 'next/cache';
import { buyerConfirmReceived, getOrderByCode, openDispute, OrderError } from '@/lib/orders';

export async function openDisputeAction(code: string, formData: FormData) {
  const order = getOrderByCode(code);
  if (!order) return;
  const reason = String(formData.get('reason') || 'other');
  const desc = String(formData.get('description') || '').trim() || null;
  try { openDispute(order, reason, desc); } catch (e) { if (!(e instanceof OrderError)) throw e; }
  revalidatePath(`/track/${code}`);
}
export async function confirmReceivedAction(code: string) {
  const order = getOrderByCode(code);
  if (!order) return;
  try { await buyerConfirmReceived(order); } catch (e) { if (!(e instanceof OrderError)) throw e; }
  revalidatePath(`/track/${code}`);
}
