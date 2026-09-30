'use server';
import { revalidatePath } from 'next/cache';
import { requireApprovedSeller } from '@/lib/guards';
import { deletePreset, savePreset, VariationError } from '@/lib/variations';

export async function savePresetAction(id: string | null, _prev: { error?: string; ok?: boolean } | null, formData: FormData) {
  const { seller } = requireApprovedSeller();
  try {
    savePreset(seller.id, String(formData.get('name') || ''), String(formData.get('values') || ''), id ?? undefined);
  } catch (e) {
    if (e instanceof VariationError) return { error: e.message };
    throw e;
  }
  revalidatePath('/seller/variations');
  return { ok: true };
}

export async function deletePresetAction(id: string) {
  const { seller } = requireApprovedSeller();
  deletePreset(seller.id, id);
  revalidatePath('/seller/variations');
}
