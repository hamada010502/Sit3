import { redirect } from 'next/navigation';
import { getCurrentSeller, getCurrentUser } from './auth';

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
