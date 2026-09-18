import { redirect } from 'next/navigation';
import { getCurrentSeller, getCurrentUser } from './auth';

export function requireSeller() {
  const s = getCurrentSeller();
  if (!s) redirect('/login');
  return s;
}
/** Seller must be approved to reach product/order features. */
export function requireApprovedSeller() {
  const s = requireSeller();
  if (s.seller.status !== 'approved') redirect('/seller');
  return s;
}
export function requireAdmin() {
  const u = getCurrentUser();
  if (!u || u.role !== 'admin') redirect('/login');
  return u;
}
