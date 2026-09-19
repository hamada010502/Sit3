'use server';
import { createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getCurrentSeller } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { generateRecoveryCodes, verifyTotp } from '@/lib/totp';

export interface TfaState { error?: string; recovery?: string[]; ok?: string }

export async function enableTfaAction(_prev: TfaState | null, formData: FormData): Promise<TfaState> {
  const s = getCurrentSeller();
  if (!s) return { error: 'login_error' };
  const secret = s.user.totp_secret;
  if (!secret) return { error: 'tfa_invalid' };
  if (!verifyTotp(secret, String(formData.get('code') || ''))) return { error: 'tfa_invalid' };

  const codes = generateRecoveryCodes();
  getDb().prepare('UPDATE users SET totp_enabled = 1, totp_recovery = ? WHERE id = ?')
    .run(JSON.stringify(codes.map((c) => createHash('sha256').update(c).digest('hex'))), s.user.id);
  audit('seller', s.user.id, s.user.email, 'user', s.user.id, '2fa.enabled');
  revalidatePath('/seller/security');
  return { recovery: codes, ok: 'tfa_enabled_ok' };
}

export async function disableTfaAction(_prev: TfaState | null, formData: FormData): Promise<TfaState> {
  const s = getCurrentSeller();
  if (!s) return { error: 'login_error' };
  if (!s.user.totp_secret || !verifyTotp(s.user.totp_secret, String(formData.get('code') || ''))) return { error: 'tfa_invalid' };
  getDb().prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery = NULL WHERE id = ?').run(s.user.id);
  audit('seller', s.user.id, s.user.email, 'user', s.user.id, '2fa.disabled');
  revalidatePath('/seller/security');
  return { ok: 'tfa_disabled_ok' };
}
