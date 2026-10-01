'use server';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/guards';
import { CustomerError, updateCustomerProfile } from '@/lib/customer';

export interface ProfileState { error?: string; ok?: boolean }

export async function updateProfileAction(_prev: ProfileState | null, formData: FormData): Promise<ProfileState> {
  const user = requireCustomer();
  const name = String(formData.get('name') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  if (!name) return { error: 'apply_error_generic' };
  try { updateCustomerProfile(user.id, { name, phone }); } catch (e) {
    if (e instanceof CustomerError) return { error: e.message === 'phone_taken' ? 'phone_taken' : 'phone_invalid' };
    throw e;
  }
  revalidatePath('/account');
  return { ok: true };
}
