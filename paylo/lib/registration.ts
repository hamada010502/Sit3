import { getDb, newId, nowIso } from './db';
import { hashPassword } from './auth';
import { audit } from './audit';
import { notify, appUrl } from './notify';
import type { StoreRegistrationRequest } from './types';

export class RegistrationError extends Error {}

export interface RegistrationInput {
  fullName: string; phone: string; email: string; nationalId: string;
  storeName: string; slug: string; instagram?: string; governorate: string; bio?: string; password: string;
}

/**
 * Checks phone and national ID against both live seller stores (sellers.phone /
 * sellers.kyc_national_id — reusing the existing KYC field rather than adding a
 * duplicate column, since registration-time identity capture supersedes it — see
 * approveRegistrationRequest) AND other non-rejected registration requests. A
 * REJECTED request holds no claim, so its applicant can resubmit.
 *
 * Never returns which field matched — callers must not leak that distinction either.
 */
function hasConflict(db: ReturnType<typeof getDb>, phone: string, nationalId: string): boolean {
  const sellerHit = db.prepare('SELECT 1 FROM sellers WHERE phone = ? OR kyc_national_id = ? LIMIT 1').get(phone, nationalId);
  if (sellerHit) return true;
  const reqHit = db.prepare(
    "SELECT 1 FROM store_registration_requests WHERE status != 'REJECTED' AND (phone = ? OR national_id = ?) LIMIT 1",
  ).get(phone, nationalId);
  return !!reqHit;
}

export async function submitRegistration(input: RegistrationInput): Promise<StoreRegistrationRequest> {
  const db = getDb();
  const phone = input.phone.trim();
  const nationalId = input.nationalId.trim();

  // Backend check before any insert — this is belt, the partial unique indexes in
  // lib/schema.sql are suspenders (they catch the race window between this check and
  // the insert below; caught as a RegistrationError just like a pre-detected conflict,
  // so the caller can't tell the two apart either).
  if (hasConflict(db, phone, nationalId)) {
    throw new RegistrationError('duplicate');
  }

  const id = newId();
  const passwordHash = await hashPassword(input.password);
  try {
    db.prepare(`INSERT INTO store_registration_requests
        (id, full_name, phone, email, national_id, store_name, slug, instagram, governorate, bio, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.fullName, phone, input.email, nationalId, input.storeName, input.slug, input.instagram || null,
        input.governorate, input.bio || null, passwordHash);
  } catch (e) {
    // SQLITE_CONSTRAINT from the partial unique indexes = another submission won the race.
    throw new RegistrationError('duplicate');
  }

  audit('system', null, input.email, 'store_registration_request', id, 'submitted', { storeName: input.storeName });
  await notify({
    event: 'registration.submitted',
    email: { to: input.email, subject: 'Paylo — registration received', body:
      `Hi ${input.fullName},\n\nWe received your registration for "${input.storeName}". It is under review; you'll hear back within 24 hours.\n\nYour store is not active yet.\n\n— Paylo` },
  });
  return db.prepare('SELECT * FROM store_registration_requests WHERE id = ?').get(id) as StoreRegistrationRequest;
}

export function getRegistration(id: string): StoreRegistrationRequest | undefined {
  return getDb().prepare('SELECT * FROM store_registration_requests WHERE id = ?').get(id) as StoreRegistrationRequest | undefined;
}

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Approval materializes the account: users + sellers rows are created here, not at
 * submission time, so a rejected or abandoned request never occupies a real account.
 * The store goes live as 'approved' immediately — the identity check that gates
 * approval here supersedes the separate post-approval KYC step, so kyc_status is set
 * to 'approved' too rather than asking the seller to submit the same national ID again.
 */
export async function approveRegistrationRequest(req: StoreRegistrationRequest, reviewerId: string): Promise<string> {
  if (req.status === 'APPROVED') throw new RegistrationError('already_approved');
  const db = getDb();

  // Slug could have been claimed by another approval since submission; fall back to a
  // suffixed variant rather than failing the approval outright.
  let slug = req.slug;
  if (db.prepare('SELECT 1 FROM sellers WHERE slug = ?').get(slug)) {
    slug = slugify(`${req.slug}-${req.id.slice(0, 5)}`);
  }

  const userId = newId();
  const sellerId = newId();
  db.transaction(() => {
    db.prepare("INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, 'seller', ?)")
      .run(userId, req.email, req.password_hash, req.full_name);
    db.prepare(`INSERT INTO sellers
        (id, user_id, store_name, slug, instagram, phone, governorate, bio, status,
         kyc_status, kyc_legal_name, kyc_national_id, kyc_reviewed_at, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'approved', ?, ?, ?, ?)`)
      .run(sellerId, userId, req.store_name, slug, req.instagram, req.phone, req.governorate, req.bio,
        req.full_name, req.national_id, nowIso(), nowIso());
    db.prepare("UPDATE store_registration_requests SET status = 'APPROVED', reviewed_at = ?, reviewed_by = ?, created_seller_id = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), reviewerId, sellerId, nowIso(), req.id);
  })();

  audit('owner', reviewerId, 'owner', 'store_registration_request', req.id, 'approved', { sellerId });
  await notify({
    event: 'registration.approved',
    email: { to: req.email, subject: 'Paylo — your store is approved', body:
      `Hi ${req.full_name},\n\n"${req.store_name}" is approved and live: ${appUrl('/s/' + slug)}\n\nLog in with the email and password you registered with: ${appUrl('/login')}\n\n— Paylo` },
  });
  return sellerId;
}

export async function rejectRegistrationRequest(req: StoreRegistrationRequest, reviewerId: string, note: string, notifyApplicant: boolean): Promise<void> {
  if (!note.trim()) throw new RegistrationError('note_required');
  const db = getDb();
  db.prepare("UPDATE store_registration_requests SET status = 'REJECTED', admin_notes = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?")
    .run(note, nowIso(), reviewerId, nowIso(), req.id);
  audit('owner', reviewerId, 'owner', 'store_registration_request', req.id, 'rejected', { note, notifyApplicant });
  if (notifyApplicant) {
    await notify({
      event: 'registration.rejected',
      email: { to: req.email, subject: 'Paylo — registration update', body:
        `Hi ${req.full_name},\n\nYour registration for "${req.store_name}" was not approved.\n\n— Paylo` },
    });
  }
}

export async function requestMoreInformation(req: StoreRegistrationRequest, reviewerId: string, note: string): Promise<void> {
  if (!note.trim()) throw new RegistrationError('note_required');
  const db = getDb();
  db.prepare("UPDATE store_registration_requests SET status = 'MORE_INFORMATION_REQUIRED', info_request_note = ?, updated_at = ? WHERE id = ?")
    .run(note, nowIso(), req.id);
  audit('owner', reviewerId, 'owner', 'store_registration_request', req.id, 'more_info_requested', { note });
  await notify({
    event: 'registration.more_info',
    email: { to: req.email, subject: 'Paylo — more information needed', body:
      `Hi ${req.full_name},\n\nWe need more information to continue reviewing your registration for "${req.store_name}":\n\n${note}\n\nReply to this email or contact Paylo support.\n\n— Paylo` },
  });
}
