'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getCurrentSeller } from '@/lib/auth';
import { getDb, nowIso } from '@/lib/db';
import { saveUpload } from '../products/actions';

export async function submitKycAction(_prev: { error?: string; ok?: boolean } | null, formData: FormData) {
  const s = getCurrentSeller();
  if (!s) return { error: 'login_error' };
  const legalName = String(formData.get('legal_name') || '').trim();
  const nationalId = String(formData.get('national_id') || '').trim();
  const file = formData.get('doc');
  const docPath = file instanceof File ? await saveUpload(file) : null;
  if (legalName.length < 3 || nationalId.length < 4 || (!docPath && !s.seller.kyc_doc_path)) return { error: 'apply_error_generic' };
  getDb().prepare("UPDATE sellers SET kyc_legal_name = ?, kyc_national_id = ?, kyc_doc_path = COALESCE(?, kyc_doc_path), kyc_status = 'submitted', kyc_note = NULL, kyc_reviewed_at = ? WHERE id = ?")
    .run(legalName, nationalId, docPath, nowIso(), s.seller.id);
  audit('seller', s.seller.id, s.seller.store_name, 'seller', s.seller.id, 'kyc.submitted');
  revalidatePath('/seller/verification');
  return { ok: true };
}
