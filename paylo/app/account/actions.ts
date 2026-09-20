'use server';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/guards';
import { updateCustomerProfile } from '@/lib/customer';

export interface ProfileState { error?: string; ok?: boolean }

export async function updateProfileAction(_prev: ProfileState | null, formData: FormData): Promise<ProfileState> {
  const user = requireCustomer();
  const name = String(formData.get('name') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  if (!name) return { error: 'apply_error_generic' };
  updateCustomerProfile(user.id, { name, phone });
  revalidatePath('/account');
  return { ok: true };
}
