'use server';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/guards';
import { addAddress, deleteAddress, updateAddress, CustomerError } from '@/lib/customer';
import { GOVERNORATES } from '@/lib/types';

export interface AddressState { error?: string; ok?: boolean }

function readInput(formData: FormData) {
  const label = String(formData.get('label') || '').trim();
  const fullName = String(formData.get('full_name') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const governorate = String(formData.get('governorate') || '');
  const address = String(formData.get('address') || '').trim();
  const makeDefault = formData.get('make_default') === 'on';
  if (!fullName || !phone || !(GOVERNORATES as readonly string[]).includes(governorate) || address.length < 5) return null;
  return { label, fullName, phone, governorate, address, makeDefault };
}

export async function addAddressAction(_prev: AddressState | null, formData: FormData): Promise<AddressState> {
  const user = requireCustomer();
  const input = readInput(formData);
  if (!input) return { error: 'apply_error_generic' };
  addAddress(user.id, input);
  revalidatePath('/account/addresses');
  revalidatePath('/account');
  return { ok: true };
}

export async function updateAddressAction(addressId: string, _prev: AddressState | null, formData: FormData): Promise<AddressState> {
  const user = requireCustomer();
  const input = readInput(formData);
  if (!input) return { error: 'apply_error_generic' };
  try {
    updateAddress(user.id, addressId, input);
  } catch (e) {
    if (e instanceof CustomerError) return { error: 'apply_error_generic' };
    throw e;
  }
  revalidatePath('/account/addresses');
  revalidatePath('/account');
  return { ok: true };
}

export async function deleteAddressAction(addressId: string): Promise<void> {
  const user = requireCustomer();
  deleteAddress(user.id, addressId);
  revalidatePath('/account/addresses');
  revalidatePath('/account');
}
