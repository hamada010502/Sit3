import { KycBadge } from '@/components/StatusBadge';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { KycForm } from './KycForm';

export default function VerificationPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="section-title">{t('kyc_title')}</h1>
        <KycBadge status={seller.kyc_status} t={t} />
      </div>
      <p className="mt-2 mb-6 text-sm text-ink-soft">{t('kyc_sub')}</p>
      {seller.kyc_status === 'rejected' && seller.kyc_note && <div className="alert-error mb-5"><strong>{t('review_note')}:</strong> {seller.kyc_note}</div>}
      {seller.kyc_status === 'approved'
        ? <div className="alert-success">{t('kyc_approved')}</div>
        : <KycForm seller={{ legal_name: seller.kyc_legal_name, national_id: seller.kyc_national_id, has_doc: !!seller.kyc_doc_path, status: seller.kyc_status }} />}
    </div>
  );
}
