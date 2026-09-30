'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { CollectionError, createCollection, deleteCollection } from '@/lib/collections';
import { requireApprovedSeller } from '@/lib/guards';

export async function createCollectionAction(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const { user, seller } = requireApprovedSeller();
  try {
    const c = createCollection(seller.id, String(formData.get('name') || ''));
    audit('seller', user.id, seller.store_name, 'collection', c.id, 'created', { name: c.name });
  } catch (e) {
    if (e instanceof CollectionError) return { error: e.message };
    throw e;
  }
  revalidatePath('/seller/collections');
  return {};
}

export async function deleteCollectionAction(id: string) {
  const { user, seller } = requireApprovedSeller();
  deleteCollection(seller.id, id);
  audit('seller', user.id, seller.store_name, 'collection', id, 'deleted');
  revalidatePath('/seller/collections');
}
