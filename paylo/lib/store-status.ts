import { getDb } from './db';
import type { Seller } from './types';

/** Whether the seller's own login has two-factor turned on. */
export function sellerHasTwoFactor(sellerId: string): boolean {
  const r = getDb().prepare('SELECT u.totp_enabled t FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sellerId) as { t: number } | undefined;
  return !!r?.t;
}

/**
 * The one definition of "buyers can see and buy from this store". Two-factor is part of
 * it: a store approved through registration review is created before its seller could
 * ever enable 2FA, so it stays on hold until they do (v2 §6: 2FA is mandatory).
 */
export function isStoreLive(seller: Pick<Seller, 'id' | 'status' | 'visible'>): boolean {
  return seller.status === 'approved' && !!seller.visible && sellerHasTwoFactor(seller.id);
}
