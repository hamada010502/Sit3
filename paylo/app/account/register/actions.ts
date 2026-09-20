'use server';
import { redirect } from 'next/navigation';
import { createSession, recordLogin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { createCustomerAccount, CustomerError } from '@/lib/customer';

export interface RegisterState { error?: string }

/** Optional, explicit — nothing else in the app calls this. Creating an account is
 * always something a visitor chooses, never a side effect of checking out (spec §8). */
export async function registerAction(_prev: RegisterState | null, formData: FormData): Promise<RegisterState> {
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const password = String(formData.get('password') || '');

  if (!name || !email.includes('@') || password.length < 8) return { error: 'apply_error_generic' };

  let user;
  try {
    user = await createCustomerAccount({ name, email, phone, password });
  } catch (e) {
    if (e instanceof CustomerError && e.message === 'email_taken') return { error: 'register_error_taken' };
    throw e;
  }
  await createSession(user);
  recordLogin(user.id);
  audit('buyer', user.id, user.email, 'user', user.id, 'login.success');
  redirect('/account');
}
