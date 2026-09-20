'use server';
import { redirect } from 'next/navigation';
import { clearTwoFactor, createSession, findUserByEmail, getPendingTwoFactorUser, recordLogin, startTwoFactor, verifyPassword } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { verifyTotp } from '@/lib/totp';
import { createHash } from 'crypto';
import type { ActorType, Role } from '@/lib/types';

function redirectForRole(role: string): never {
  redirect(role === 'admin' ? '/admin' : role === 'owner' ? '/owner' : role === 'customer' ? '/account' : '/seller');
}
/** audit_log's actor_type has no 'customer' value — a signed-in customer's own actions
 * are simply a 'buyer' with an actor_id, same as any authenticated buyer action elsewhere. */
function actorTypeFor(role: Role): ActorType {
  return role === 'customer' ? 'buyer' : role;
}

export async function loginAction(_prev: { error?: string } | null, formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const user = findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    audit('system', null, email, 'user', email, 'login.failed');
    return { error: 'login_error' };
  }
  if (user.totp_enabled) {
    startTwoFactor(user.id);
    redirect('/login/2fa');
  }
  await createSession(user);
  recordLogin(user.id);
  audit(actorTypeFor(user.role), user.id, user.email, 'user', user.id, 'login.success');
  redirectForRole(user.role);
}

/** Second factor. Accepts a live TOTP code or one single-use recovery code. */
export async function twoFactorAction(_prev: { error?: string } | null, formData: FormData) {
  const user = getPendingTwoFactorUser();
  if (!user) redirect('/login');
  const code = String(formData.get('code') || '').trim().toUpperCase();
  let ok = user.totp_secret ? verifyTotp(user.totp_secret, code) : false;

  if (!ok && user.totp_recovery) {
    const remaining: string[] = JSON.parse(user.totp_recovery);
    const idx = remaining.indexOf(createHash('sha256').update(code).digest('hex'));
    if (idx >= 0) {
      remaining.splice(idx, 1);
      getDb().prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(remaining), user.id);
      audit(actorTypeFor(user.role), user.id, user.email, 'user', user.id, '2fa.recovery_used', { remaining: remaining.length });
      ok = true;
    }
  }
  if (!ok) {
    audit('system', user.id, user.email, 'user', user.id, '2fa.failed');
    return { error: 'tfa_invalid' };
  }
  clearTwoFactor();
  await createSession(user);
  recordLogin(user.id);
  audit(actorTypeFor(user.role), user.id, user.email, 'user', user.id, 'login.success.2fa');
  redirectForRole(user.role);
}
