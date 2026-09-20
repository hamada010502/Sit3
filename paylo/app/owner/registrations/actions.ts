'use server';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/guards';
import { approveRegistrationRequest, getRegistration, RegistrationError, rejectRegistrationRequest, requestMoreInformation } from '@/lib/registration';

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
