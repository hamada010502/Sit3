import { Shell } from '@/components/Shell';
import { requireSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const { seller } = requireSeller();
  const { t } = getT();
  if (seller.status !== 'approved') {
    const key = seller.status === 'pending' ? 'pending' : seller.status === 'rejected' ? 'rejected' : 'suspended';
    return (
      <Shell>
        <div className="card-pad max-w-xl mx-auto text-center py-10">
          <h1 className="text-2xl font-bold">{t(`status_${key}_title` as const)}</h1>
          <p className="mt-3 text-bluewood/70">{t(`status_${key}_body` as const)}</p>
          {seller.review_note && <div className="alert-info mt-5 text-start"><strong>{t('review_note')}:</strong> {seller.review_note}</div>}
        </div>
      </Shell>
    );
  }
  return <Shell wide>{children}</Shell>;
}
