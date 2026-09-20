import { notFound, redirect } from 'next/navigation';
import { getCurrentSeller, getCurrentUser } from './auth';
import { isOwnerAccount } from './owner';

export function requireSeller() {
  const s = getCurrentSeller();
  if (!s) redirect('/login');
  return s;
}

/**
 * Gate for everything a live store can do. Unapproved sellers land on /seller/pending,
 * which stays reachable alongside Security so they can satisfy the two-factor
 * requirement that approval depends on.
 */
export function requireApprovedSeller() {
  const s = requireSeller();
  if (s.seller.status !== 'approved') redirect('/seller/pending');
  return s;
}

export function requireAdmin() {
  const u = getCurrentUser();
  if (!u || u.role !== 'admin') redirect('/login');
  return u;
}

/**
 * Layout-level second check for /owner, on top of middleware.ts's edge-level gate.
 * Two independent layers because the middleware token is stateless: if the account
 * were ever suspended or demoted after a token was issued, only this DB-backed check
 * would catch it before the next token expiry. A non-owner gets notFound(), never a
 * redirect or an "access denied" message — the route must not be distinguishable
 * from one that doesn't exist.
 */
export function requireOwner() {
  const u = getCurrentUser();
  if (!u || !isOwnerAccount(u.email, u.role, u.totp_enabled)) notFound();
  return u;
}
