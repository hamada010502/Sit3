'use server';
import { redirect } from 'next/navigation';
import { RegistrationError, submitRegistration } from '@/lib/registration';
import { GOVERNORATES } from '@/lib/types';

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Submission never creates a users/sellers row and never logs the applicant in — it
 * only creates a store_registration_request. The account is materialized on approval
 * (see lib/registration.ts), so an unreviewed or rejected registration never occupies
 * a real login. On success this redirects to a static confirmation screen rather than
 * a dashboard, since there is no session to show one in.
 */
export async function applyAction(_prev: { error?: string } | null, formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const nationalId = String(formData.get('national_id') || '').trim();
  const password = String(formData.get('password') || '');
  const storeName = String(formData.get('store_name') || '').trim();
  const slug = slugify(String(formData.get('slug') || storeName));
  const instagram = String(formData.get('instagram') || '').trim().replace(/^@/, '');
  const governorate = String(formData.get('governorate') || '');
  const bio = String(formData.get('bio') || '').trim();

  if (!name || !email.includes('@') || !/^\+?[0-9\s-]{8,15}$/.test(phone) || nationalId.length < 4
      || password.length < 8 || !storeName || !slug || !(GOVERNORATES as readonly string[]).includes(governorate)) {
    return { error: 'apply_error_generic' };
  }

  try {
    await submitRegistration({ fullName: name, phone, email, nationalId, storeName, slug, instagram, governorate, bio, password });
  } catch (e) {
    // Same generic message whether the conflict was phone, national ID, or both — never
    // reveal which field matched or anything about the existing account (spec §3).
    if (e instanceof RegistrationError) return { error: 'apply_error_duplicate' };
    throw e;
  }
  redirect('/apply/confirmation');
}
