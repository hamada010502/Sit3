import { getDb, newId, nowIso } from './db';
// Applicants have no account or language preference yet: Arabic, like buyers.
import { buyerLang, registrationApproved, registrationMoreInfo, registrationReceived, registrationRejected } from './notify-templates';
import { hashPassword } from './auth';
import { audit } from './audit';
import { notify, appUrl } from './notify';
import type { StoreRegistrationRequest } from './types';
import { isPlaceholderName, isValidNationalIdFormat, normalizeNationalId, normalizePhone } from './id-validate';

export class RegistrationError extends Error {}

export interface RegistrationInput {
  fullName: string; phone: string; email: string; nationalId: string;
  storeName: string; slug: string; instagram?: string; governorate: string; bio?: string; password: string;
}

/** Per-day ceilings on applications, per normalised phone and per hashed IP. */
export const REG_LIMIT_PER_PHONE = 5;
export const REG_LIMIT_PER_IP = 20;

/**
 * Identity checks before an application is stored. Email and phone must not belong to an
 * account (users) or another non-rejected application; the phone also not to a live store.
 * Those collisions get their own message (email_taken / phone_taken). A national-ID clash
 * with an approved seller or active application stays a generic 'duplicate' — the ID is the
 * most sensitive field, so the form never confirms whether a given ID is on file.
 * A REJECTED application holds no claim on any of the three, so the applicant can resubmit.
 * The database enforces the same rules (partial unique indexes + triggers in lib/db.ts).
 */
function identityConflict(db: ReturnType<typeof getDb>, email: string, phone: string, nationalId: string): 'email_taken' | 'phone_taken' | 'duplicate' | null {
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(email)
    || db.prepare("SELECT 1 FROM store_registration_requests WHERE status != 'REJECTED' AND lower(email) = lower(?)").get(email)) return 'email_taken';
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone) || db.prepare('SELECT 1 FROM sellers WHERE phone = ?').get(phone)
    || db.prepare("SELECT 1 FROM store_registration_requests WHERE status != 'REJECTED' AND phone = ?").get(phone)) return 'phone_taken';
  if (db.prepare('SELECT 1 FROM sellers WHERE kyc_national_id = ?').get(nationalId)
    || db.prepare("SELECT 1 FROM store_registration_requests WHERE status != 'REJECTED' AND national_id = ?").get(nationalId)) return 'duplicate';
  return null;
}

/** Maps a constraint failure (race with another submission) to the same codes. */
function constraintCode(e: unknown): 'email_taken' | 'phone_taken' | 'duplicate' {
  const m = String((e as Error)?.message || '');
  if (/email_taken|lower\(email\)|\.email/.test(m)) return 'email_taken';
  if (/phone_taken|\.phone/.test(m)) return 'phone_taken';
  return 'duplicate';
}

export async function submitRegistration(input: RegistrationInput, ipHash: string | null = null): Promise<StoreRegistrationRequest> {
  const db = getDb();
  const phone = normalizePhone(input.phone);
  const nationalId = normalizeNationalId(input.nationalId);
  const email = input.email.trim().toLowerCase();

  // Every attempt counts toward the daily limit, successful or not.
  const since = "datetime('now','-1 day')";
  const byPhone = phone ? (db.prepare(`SELECT count(*) c FROM registration_attempts WHERE phone = ? AND at >= ${since}`).get(phone) as { c: number }).c : 0;
  const byIp = ipHash ? (db.prepare(`SELECT count(*) c FROM registration_attempts WHERE ip_hash = ? AND at >= ${since}`).get(ipHash) as { c: number }).c : 0;
  db.prepare('INSERT INTO registration_attempts (phone, ip_hash) VALUES (?, ?)').run(phone, ipHash);
  if (byPhone >= REG_LIMIT_PER_PHONE || byIp >= REG_LIMIT_PER_IP) throw new RegistrationError('rate_limited');

  if (!phone) throw new RegistrationError('phone_invalid');
  if (!isValidNationalIdFormat(nationalId)) throw new RegistrationError('national_id_invalid');
  if (isPlaceholderName(input.fullName)) throw new RegistrationError('name_invalid');

  // Belt: checked before any insert. Suspenders: the unique indexes and triggers catch the
  // race window between this check and the insert, mapped to the same codes.
  const clash = identityConflict(db, email, phone, nationalId);
  if (clash) throw new RegistrationError(clash);

  const id = newId();
  const passwordHash = await hashPassword(input.password);
  try {
    db.prepare(`INSERT INTO store_registration_requests
        (id, full_name, phone, email, national_id, store_name, slug, instagram, governorate, bio, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.fullName.trim(), phone, email, nationalId, input.storeName, input.slug, input.instagram || null,
        input.governorate, input.bio || null, passwordHash);
  } catch (e) {
    throw new RegistrationError(constraintCode(e));
  }

  audit('system', null, email, 'store_registration_request', id, 'submitted', { storeName: input.storeName });
  await notify({ event: 'registration.submitted', email: { to: email, ...registrationReceived(buyerLang(), { name: input.fullName.trim(), store: input.storeName }) } });
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
  // Approval stays manual and deliberate: the reviewer checklist must be complete with no
  // failed item before a store can be created.
  if (!reviewComplete(getReview(req.id))) throw new RegistrationError('review_incomplete');
  const db = getDb();

  // Slug could have been claimed by another approval since submission; fall back to a
  // suffixed variant rather than failing the approval outright.
  let slug = req.slug;
  if (db.prepare('SELECT 1 FROM sellers WHERE slug = ?').get(slug)) {
    slug = slugify(`${req.slug}-${req.id.slice(0, 5)}`);
  }

  const userId = newId();
  const sellerId = newId();
  // Order matters: the application is marked APPROVED first, so the account created from it
  // does not collide with its own (still pending) email/phone in trg_users_identity_ins.
  db.transaction(() => {
    db.prepare("UPDATE store_registration_requests SET status = 'APPROVED', reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), reviewerId, nowIso(), req.id);
    db.prepare("INSERT INTO users (id, email, password_hash, role, name, phone) VALUES (?, ?, ?, 'seller', ?, ?)")
      .run(userId, req.email, req.password_hash, req.full_name, normalizePhone(req.phone) ?? req.phone);
    db.prepare(`INSERT INTO sellers
        (id, user_id, store_name, slug, instagram, phone, governorate, bio, status,
         kyc_status, kyc_legal_name, kyc_national_id, kyc_reviewed_at, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'approved', ?, ?, ?, ?)`)
      .run(sellerId, userId, req.store_name, slug, req.instagram, req.phone, req.governorate, req.bio,
        req.full_name, req.national_id, nowIso(), nowIso());
    db.prepare('UPDATE store_registration_requests SET created_seller_id = ? WHERE id = ?').run(sellerId, req.id);
  })();

  audit('owner', reviewerId, 'owner', 'store_registration_request', req.id, 'approved', { sellerId, submittedAt: req.submitted_at });
  await notify({ event: 'registration.approved', email: { to: req.email,
    ...registrationApproved(buyerLang(), { name: req.full_name, store: req.store_name, storeUrl: appUrl('/s/' + slug), loginUrl: appUrl('/login') }) } });
  return sellerId;
}

export async function rejectRegistrationRequest(req: StoreRegistrationRequest, reviewerId: string, note: string, notifyApplicant: boolean): Promise<void> {
  if (!note.trim()) throw new RegistrationError('note_required');
  const db = getDb();
  db.prepare("UPDATE store_registration_requests SET status = 'REJECTED', admin_notes = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?")
    .run(note, nowIso(), reviewerId, nowIso(), req.id);
  audit('owner', reviewerId, 'owner', 'store_registration_request', req.id, 'rejected', { note, notifyApplicant, submittedAt: req.submitted_at });
  if (notifyApplicant) {
    await notify({ event: 'registration.rejected', email: { to: req.email, ...registrationRejected(buyerLang(), { name: req.full_name, store: req.store_name }) } });
  }
}

export async function requestMoreInformation(req: StoreRegistrationRequest, reviewerId: string, note: string): Promise<void> {
  if (!note.trim()) throw new RegistrationError('note_required');
  const db = getDb();
  db.prepare("UPDATE store_registration_requests SET status = 'MORE_INFORMATION_REQUIRED', info_request_note = ?, updated_at = ? WHERE id = ?")
    .run(note, nowIso(), req.id);
  audit('owner', reviewerId, 'owner', 'store_registration_request', req.id, 'more_info_requested', { note, submittedAt: req.submitted_at });
  await notify({ event: 'registration.more_info', email: { to: req.email, ...registrationMoreInfo(buyerLang(), { name: req.full_name, store: req.store_name, note }) } });
}

/* ------------------------- reviewer checklist ------------------------ */

/** What a human reviewer confirms. There is no government ID API: these are manual checks. */
export const REVIEW_CHECKS = ['photo_readable', 'name_matches', 'id_matches', 'face_visible', 'not_duplicate'] as const;
export type ReviewCheck = typeof REVIEW_CHECKS[number];
export type ReviewAnswer = 'yes' | 'no' | 'na';
export interface RegistrationReview { checks: Partial<Record<ReviewCheck, ReviewAnswer>>; notes: string | null; reviewer_id: string | null; updated_at: string | null }

export function getReview(requestId: string): RegistrationReview {
  const r = getDb().prepare('SELECT * FROM registration_reviews WHERE request_id = ?').get(requestId) as { checks: string; notes: string | null; reviewer_id: string | null; updated_at: string } | undefined;
  let checks: RegistrationReview['checks'] = {};
  try { checks = r ? JSON.parse(r.checks) : {}; } catch { /* treat unreadable as empty */ }
  return { checks, notes: r?.notes ?? null, reviewer_id: r?.reviewer_id ?? null, updated_at: r?.updated_at ?? null };
}

/** Complete = every item answered, none "no". "Not a duplicate" can never be N/A. */
export function reviewComplete(r: RegistrationReview): boolean {
  return REVIEW_CHECKS.every((k) => r.checks[k] === 'yes' || (r.checks[k] === 'na' && k !== 'not_duplicate'));
}

export function saveReview(requestId: string, reviewerId: string, checks: Partial<Record<ReviewCheck, ReviewAnswer>>, notes: string | null) {
  const clean: Partial<Record<ReviewCheck, ReviewAnswer>> = {};
  for (const k of REVIEW_CHECKS) if (checks[k] && ['yes', 'no', 'na'].includes(checks[k]!)) clean[k] = checks[k];
  getDb().prepare(`INSERT INTO registration_reviews (request_id, checks, notes, reviewer_id, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(request_id) DO UPDATE SET checks = excluded.checks, notes = excluded.notes, reviewer_id = excluded.reviewer_id, updated_at = excluded.updated_at`)
    .run(requestId, JSON.stringify(clean), notes?.slice(0, 2000) || null, reviewerId);
  audit('owner', reviewerId, 'owner', 'store_registration_request', requestId, 'review_checklist_saved', { checks: clean });
}

/**
 * Live duplicate check for the reviewer (not just "clear at submission"): other accounts,
 * stores or non-rejected applications sharing this phone, email or national number, plus
 * previously REJECTED applications with the same national number (worth a look).
 */
export function duplicateSignals(req: StoreRegistrationRequest) {
  const db = getDb();
  const c = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;
  return {
    phone: c('SELECT count(*) c FROM users WHERE phone = ?', req.phone) + c('SELECT count(*) c FROM sellers WHERE phone = ?', req.phone)
      + c("SELECT count(*) c FROM store_registration_requests WHERE phone = ? AND id != ? AND status != 'REJECTED'", req.phone, req.id),
    email: c('SELECT count(*) c FROM users WHERE lower(email) = lower(?)', req.email)
      + c("SELECT count(*) c FROM store_registration_requests WHERE lower(email) = lower(?) AND id != ? AND status != 'REJECTED'", req.email, req.id),
    nationalId: c('SELECT count(*) c FROM sellers WHERE kyc_national_id = ?', req.national_id)
      + c("SELECT count(*) c FROM store_registration_requests WHERE national_id = ? AND id != ? AND status != 'REJECTED'", req.national_id, req.id),
    rejectedBefore: c("SELECT count(*) c FROM store_registration_requests WHERE national_id = ? AND id != ? AND status = 'REJECTED'", req.national_id, req.id),
    formatOk: isValidNationalIdFormat(req.national_id),
  };
}
