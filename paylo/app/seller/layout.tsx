import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { requireSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const { user, seller } = requireSeller();
  const { t } = getT();
  const approved = seller.status === 'approved';
  return (
    <Shell wide>
      {!user.totp_enabled && (
        <div className="alert-warn mb-5">{t('tfa_required_note')} <Link href="/seller/security" className="link">{t('nav_security')} →</Link></div>
      )}
      {approved && seller.kyc_status !== 'approved' && (
        <div className="alert-info mb-5">
          {seller.kyc_status === 'submitted' ? t('kyc_submitted_note') : t('kyc_blocked_note')}{' '}
          <Link href="/seller/verification" className="link">{t('nav_kyc')} →</Link>
        </div>
      )}
      {children}
    </Shell>
  );
}
