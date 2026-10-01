'use server';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/guards';
import { approveRegistrationRequest, getRegistration, REVIEW_CHECKS, RegistrationError, rejectRegistrationRequest, requestMoreInformation, saveReview, type ReviewAnswer } from '@/lib/registration';

export interface RegActionState { error?: string }

async function withRequest(id: string, fn: (req: NonNullable<ReturnType<typeof getRegistration>>) => Promise<void>): Promise<RegActionState> {
  const req = getRegistration(id);
  if (!req) return { error: 'Not found' };
  try {
    await fn(req);
  } catch (e) {
    if (e instanceof RegistrationError) return { error: e.message };
    throw e;
  }
  revalidatePath('/owner/registrations');
  revalidatePath(`/owner/registrations/${id}`);
  return {};
}

export async function approveAction(id: string, _prev: RegActionState | null): Promise<RegActionState> {
  const owner = requireOwner();
  return withRequest(id, async (req) => { await approveRegistrationRequest(req, owner.id); });
}

export async function rejectAction(id: string, _prev: RegActionState | null, formData: FormData): Promise<RegActionState> {
  const owner = requireOwner();
  const note = String(formData.get('note') || '').trim();
  const notifyApplicant = formData.get('notify') === 'on';
  return withRequest(id, async (req) => { await rejectRegistrationRequest(req, owner.id, note, notifyApplicant); });
}

export async function requestInfoAction(id: string, _prev: RegActionState | null, formData: FormData): Promise<RegActionState> {
  const owner = requireOwner();
  const note = String(formData.get('note') || '').trim();
  return withRequest(id, async (req) => { await requestMoreInformation(req, owner.id, note); });
}

export async function saveReviewAction(id: string, _prev: RegActionState | null, formData: FormData): Promise<RegActionState & { ok?: boolean }> {
  const owner = requireOwner();
  if (!getRegistration(id)) return { error: 'Not found' };
  const checks: Partial<Record<(typeof REVIEW_CHECKS)[number], ReviewAnswer>> = {};
  for (const k of REVIEW_CHECKS) { const v = String(formData.get(k) || ''); if (v === 'yes' || v === 'no' || v === 'na') checks[k] = v; }
  saveReview(id, owner.id, checks, String(formData.get('review_notes') || '').trim() || null);
  revalidatePath(`/owner/registrations/${id}`);
  return { ok: true };
}
