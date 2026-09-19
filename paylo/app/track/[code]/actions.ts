'use server';
import { revalidatePath } from 'next/cache';
import { buyerConfirmReceived, getOrderByCode, openDispute, OrderError, requestAddressChange, submitTransferProof } from '@/lib/orders';
import { saveUpload } from '@/app/seller/products/actions';
import { GOVERNORATES } from '@/lib/types';

type State = { error?: string; ok?: boolean };

async function onOrder(code: string, fn: (o: import('@/lib/types').Order) => Promise<void> | void): Promise<State> {
  const order = getOrderByCode(code);
  if (!order) return { error: 'tracking_not_found' };
  try { await fn(order); } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/track/${code}`);
  return { ok: true };
}

export async function openDisputeAction(code: string, _prev: State | null, formData: FormData): Promise<State> {
  return onOrder(code, (o) => { openDispute(o, String(formData.get('reason') || 'other'), String(formData.get('description') || '').trim() || null); });
}
export async function confirmReceivedAction(code: string): Promise<void> {
  await onOrder(code, (o) => buyerConfirmReceived(o));
}
export async function submitTransferAction(code: string, _prev: State | null, formData: FormData): Promise<State> {
  const file = formData.get('proof');
  const proof = file instanceof File ? await saveUpload(file) : null;
  return onOrder(code, (o) => { submitTransferProof(o, String(formData.get('reference') || '').trim(), proof); });
}
export async function requestAddressAction(code: string, _prev: State | null, formData: FormData): Promise<State> {
  const gov = String(formData.get('governorate') || '');
  const addr = String(formData.get('address') || '').trim();
  if (!(GOVERNORATES as readonly string[]).includes(gov) || addr.length < 5) return { error: 'checkout_error' };
  return onOrder(code, (o) => requestAddressChange(o, addr, gov));
}
