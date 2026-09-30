import { getCurrentSeller } from './auth';

/** For API routes: the session's own live seller, or null. Seller id never comes from input. */
export function liveSellerFromSession() {
  const s = getCurrentSeller();
  if (!s || s.seller.status !== 'approved' || !s.user.totp_enabled) return null;
  return s;
}
