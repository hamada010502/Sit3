import { redirect } from 'next/navigation';
import { requireSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';

export default function SellerPendingPage() {
  const { seller } = requireSeller();
  if (seller.status === 'approved') redirect('/seller');
  const { t } = getT();
  const key = seller.status === 'pending' ? 'pending' : seller.status === 'rejected' ? 'rejected' : 'suspended';
  return (
    <div className="card-pad max-w-xl mx-auto text-center py-10">
      <h1 className="section-title">{t(`status_${key}_title` as const)}</h1>
      <p className="mt-3 text-ink-soft">{t(`status_${key}_body` as const)}</p>
      {seller.review_note && <div className="alert-info mt-5 text-start"><strong>{t('review_note')}:</strong> {seller.review_note}</div>}
    </div>
  );
}
