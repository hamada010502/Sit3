import { createHash, randomInt } from 'crypto';
import { getDb, newId, nowIso } from './db';
import { hashPassword } from './auth';
import { audit } from './audit';
import { notify, appUrl } from './notify';
import type { CustomerAddress, Order, OrderClaim, User } from './types';

export class CustomerError extends Error {}

/* ------------------------------ account ------------------------------ */

export interface NewCustomerInput { name: string; email: string; phone: string; password: string }

/** Registration is always optional — nothing in the checkout path calls this. A customer
 * account only ever comes from someone explicitly choosing "Create account". */
export async function createCustomerAccount(input: NewCustomerInput): Promise<User> {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(input.email);
  if (existing) throw new CustomerError('email_taken');

  const id = newId();
  const passwordHash = await hashPassword(input.password);
  db.prepare("INSERT INTO users (id, email, password_hash, role, name, phone) VALUES (?, ?, ?, 'customer', ?, ?)")
    .run(id, input.email.trim(), passwordHash, input.name.trim(), input.phone.trim() || null);
  audit('buyer', id, input.email, 'user', id, 'customer.registered');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;
}

export function updateCustomerProfile(userId: string, input: { name: string; phone: string }): void {
  getDb().prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(input.name.trim(), input.phone.trim() || null, userId);
}

/* ---------------------------- addresses ------------------------------- */

export interface AddressInput { label?: string; fullName: string; phone: string; governorate: string; address: string; makeDefault?: boolean }

export function listAddresses(userId: string): CustomerAddress[] {
  return getDb().prepare('SELECT * FROM customer_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(userId) as CustomerAddress[];
}
export function getAddress(userId: string, addressId: string): CustomerAddress | undefined {
  return getDb().prepare('SELECT * FROM customer_addresses WHERE id = ? AND user_id = ?').get(addressId, userId) as CustomerAddress | undefined;
}
export function defaultAddress(userId: string): CustomerAddress | undefined {
  return getDb().prepare('SELECT * FROM customer_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC LIMIT 1').get(userId) as CustomerAddress | undefined;
}

export function addAddress(userId: string, input: AddressInput): CustomerAddress {
  const db = getDb();
  const id = newId();
  const isFirst = !db.prepare('SELECT 1 FROM customer_addresses WHERE user_id = ?').get(userId);
  const makeDefault = isFirst || !!input.makeDefault;
  db.transaction(() => {
    if (makeDefault) db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO customer_addresses (id, user_id, label, full_name, phone, governorate, address, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, input.label || null, input.fullName.trim(), input.phone.trim(), input.governorate, input.address.trim(), makeDefault ? 1 : 0);
  })();
  return getAddress(userId, id)!;
}

export function updateAddress(userId: string, addressId: string, input: AddressInput): void {
  const db = getDb();
  if (!getAddress(userId, addressId)) throw new CustomerError('not_found');
  db.transaction(() => {
    if (input.makeDefault) db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE user_id = ?').run(userId);
    db.prepare('UPDATE customer_addresses SET label = ?, full_name = ?, phone = ?, governorate = ?, address = ?, is_default = COALESCE(?, is_default) WHERE id = ? AND user_id = ?')
      .run(input.label || null, input.fullName.trim(), input.phone.trim(), input.governorate, input.address.trim(), input.makeDefault ? 1 : null, addressId, userId);
  })();
}

export function deleteAddress(userId: string, addressId: string): void {
  const db = getDb();
  const addr = getAddress(userId, addressId);
  if (!addr) throw new CustomerError('not_found');
  db.prepare('DELETE FROM customer_addresses WHERE id = ? AND user_id = ?').run(addressId, userId);
  if (addr.is_default) {
    const next = db.prepare('SELECT id FROM customer_addresses WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId) as { id: string } | undefined;
    if (next) db.prepare('UPDATE customer_addresses SET is_default = 1 WHERE id = ?').run(next.id);
  }
}

/* --------------------------- order history ----------------------------- */

/** A customer's own history — orders placed while signed in, plus any guest order
 * verified onto the account via claimOrder below. Never a lookup by email/phone alone. */
export function ordersForCustomer(userId: string): Order[] {
  return getDb().prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Order[];
}

/* ------------------------- guest order claiming -------------------------- */
/**
 * Attaching a past guest order to an account never trusts the email alone — the order
 * code plus a one-time code delivered to the email/phone already on that order is the
 * only accepted proof. Matching by email alone would let anyone who merely *knows*
 * someone's email claim their order.
 */

const CLAIM_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
const genCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export async function requestOrderClaim(userId: string, orderCode: string, contact: string): Promise<void> {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(orderCode.trim()) as Order | undefined;
  // Same generic outcome whether the order doesn't exist, is already linked to an
  // account, or the contact doesn't match — never confirm which case it was.
  if (!order || order.user_id) throw new CustomerError('cannot_claim');

  const email = order.buyer_email;
  const phone = order.buyer_phone;
  const normalized = contact.trim().toLowerCase();
  let channel: 'email' | 'sms';
  if (email && email.toLowerCase() === normalized) channel = 'email';
  else if (phone.replace(/\s|-/g, '') === contact.trim().replace(/\s|-/g, '')) channel = 'sms';
  else throw new CustomerError('cannot_claim');

  const code = genCode();
  const id = newId();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_SECONDS * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO order_claims (id, order_id, user_id, channel, contact, code_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, order.id, userId, channel, contact.trim(), hashCode(code), expiresAt);

  await notify({
    event: 'order.claim_code',
    email: channel === 'email' ? { to: email!, subject: `Paylo — verification code for order ${order.code}`,
      body: `Your verification code to link order ${order.code} to your account is ${code}. It expires in 10 minutes.\n\n— Paylo` } : undefined,
    sms: channel === 'sms' ? { to: phone, body: `Paylo: code ${code} to link order ${order.code} to your account. Expires in 10 minutes.` } : undefined,
  });
}

export function confirmOrderClaim(userId: string, orderCode: string, code: string): void {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(orderCode.trim()) as Order | undefined;
  if (!order || order.user_id) throw new CustomerError('cannot_claim');

  const claim = db.prepare(
    'SELECT * FROM order_claims WHERE order_id = ? AND user_id = ? AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1',
  ).get(order.id, userId) as OrderClaim | undefined;
  if (!claim) throw new CustomerError('cannot_claim');
  if (claim.attempts >= MAX_ATTEMPTS) throw new CustomerError('too_many_attempts');
  if (new Date(claim.expires_at + 'Z').getTime() < Date.now()) throw new CustomerError('code_expired');

  if (hashCode(code.trim()) !== claim.code_hash) {
    db.prepare('UPDATE order_claims SET attempts = attempts + 1 WHERE id = ?').run(claim.id);
    throw new CustomerError('code_invalid');
  }

  db.transaction(() => {
    db.prepare('UPDATE order_claims SET verified_at = ? WHERE id = ?').run(nowIso(), claim.id);
    db.prepare('UPDATE orders SET user_id = ? WHERE id = ?').run(userId, order.id);
  })();
  audit('buyer', userId, order.buyer_name, 'order', order.id, 'claimed_by_account', { via: claim.channel });
}

export function appUrlForAccount() {
  return appUrl('/account');
}
