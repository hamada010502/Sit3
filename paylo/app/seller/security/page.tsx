import QRCode from 'qrcode';
import { requireSeller } from '@/lib/guards';
import { getDb } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { generateSecret, otpauthUri } from '@/lib/totp';
import { TwoFactorPanel } from './TwoFactorPanel';

/**
 * Two-factor is mandatory for seller accounts (v2 §6): an approved store can move money,
 * and Paylo has no card network behind it to reverse a payout-theft.
 */
export default async function SecurityPage() {
  const { user } = requireSeller();
  const { t } = getT();

  // A secret is minted on first visit and only becomes active once a live code verifies it.
  let secret = user.totp_secret;
  if (!user.totp_enabled) {
    if (!secret) {
      secret = generateSecret();
      getDb().prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);
    }
  }
  const qr = !user.totp_enabled && secret ? await QRCode.toDataURL(otpauthUri(secret, user.email), { margin: 1, width: 220, color: { dark: '#22305F', light: '#FFFFFF' } }) : null;

  return (
    <div className="max-w-2xl">
      <h1 className="section-title">{t('tfa_title')}</h1>
      <p className="mt-2 mb-6 text-sm text-ink-soft">{t('tfa_sub')}</p>
      <TwoFactorPanel enabled={!!user.totp_enabled} secret={user.totp_enabled ? null : secret} qr={qr} />
    </div>
  );
}
