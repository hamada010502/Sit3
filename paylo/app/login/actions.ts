'use server';
import { redirect } from 'next/navigation';
import { createSession, findUserByEmail, verifyPassword } from '@/lib/auth';

export async function loginAction(_prev: { error?: string } | null, formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const user = findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) return { error: 'login_error' };
  createSession(user);
  redirect(user.role === 'admin' ? '/admin' : '/seller');
}
