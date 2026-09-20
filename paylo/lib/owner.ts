/**
 * The owner account is a single, non-assignable identity — deliberately separate from
 * seller and admin/ops roles. There is no UI anywhere that sets a user's role to
 * 'owner'; it exists only via the seed script, and access is gated on this exact
 * email matching, in addition to (not instead of) the DB role flag. A DB role flag
 * alone is a single point of failure (an authz bug elsewhere, a mass-assignment bug,
 * a scoped SQL injection) could flip it — this constant cannot be changed by any
 * app code path, only by redeploying with a new env var or editing source.
 */
export const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'owner@paylo.sy').toLowerCase();

export function isOwnerAccount(email: string, role: string, totpEnabled: number | boolean): boolean {
  // 2FA has no exceptions for this account: without it, this never returns true,
  // regardless of what the role column says.
  return role === 'owner' && email.toLowerCase() === OWNER_EMAIL && !!totpEnabled;
}
