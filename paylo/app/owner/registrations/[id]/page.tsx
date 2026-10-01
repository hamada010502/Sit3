import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RegistrationStatusBadge } from '@/components/StatusBadge';
import { auditFor } from '@/lib/audit';
import { requireOwner } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { duplicateSignals, getRegistration, getReview, reviewComplete } from '@/lib/registration';
import { RegistrationActions } from './RegistrationActions';
import { ReviewChecklist } from './ReviewChecklist';

export default function OwnerRegistrationDetailPage({ params }: { params: { id: string } }) {
  requireOwner();
  const { t } = getT();
  const req = getRegistration(params.id);
  if (!req) notFound();
  const history = auditFor('store_registration_request', req.id);
  const review = getReview(req.id);
  const dup = duplicateSignals(req);
  const closed = req.status === 'APPROVED' || req.status === 'REJECTED';
  const Info = ({ k, v }: { k: string; v: React.ReactNode }) => <div><span className="text-ink-soft">{k}: </span>{v || '—'}</div>;
  const Flag = ({ n, label, testid }: { n: number; label: string; testid: string }) => (
    <div data-testid={testid} data-count={n}>
      <span className="text-ink-soft">{label}: </span>
      {n === 0 ? <span className="text-success font-medium">{t('rv_dup_none')}</span> : <span className="text-cherry font-semibold">{t('rv_dup_found', { n })}</span>}
    </div>
  );

  return (
    <div>
      <Link href="/owner/registrations" className="text-sm text-ink-soft hover:text-cherry">← {t('rg_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6">
        <h1 className="section-title">{req.store_name}</h1>
        <RegistrationStatusBadge status={req.status} t={t} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1.5">
          <h2 className="font-semibold mb-2">{t('rg_applicant')}</h2>
          <Info k={t('full_name')} v={req.full_name} />
          <Info k={t('phone')} v={<span dir="ltr">{req.phone}</span>} />
          <Info k={t('email')} v={<span dir="ltr">{req.email}</span>} />
          <Info k={t('national_id')} v={<span dir="ltr" className="font-mono">{req.national_id}</span>} />
          <p className="text-xs text-ink-soft pt-1">{t('rg_unmasked_note')}</p>
        </div>
        <div className="card-pad text-sm space-y-1.5">
          <h2 className="font-semibold mb-2">{t('rg_store')}</h2>
          <Info k={t('store_name')} v={req.store_name} />
          <Info k={t('store_slug')} v={<span dir="ltr">/s/{req.slug}</span>} />
          <Info k={t('instagram')} v={req.instagram ? <span dir="ltr">@{req.instagram}</span> : null} />
          <Info k={t('governorate')} v={req.governorate} />
          <Info k={t('bio')} v={req.bio} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1.5" data-testid="dup-check">
          <h2 className="font-semibold mb-2">{t('rv_dup_title')}</h2>
          <Flag n={dup.phone} label={t('phone')} testid="dup-phone" />
          <Flag n={dup.email} label={t('email')} testid="dup-email" />
          <Flag n={dup.nationalId} label={t('national_id')} testid="dup-national-id" />
          {dup.rejectedBefore > 0 && <div className="text-warn font-medium">{t('rv_dup_rejected_before', { n: dup.rejectedBefore })}</div>}
          <div>{dup.formatOk ? <span className="text-success">{t('rv_id_format_ok')}</span> : <span className="text-cherry font-semibold">{t('rv_id_format_bad')}</span>}</div>
          <p className="text-xs text-ink-soft pt-1">{t('rv_no_gov_api')}</p>
          <Info k={t('rg_submitted')} v={req.submitted_at} />
        </div>
        <ReviewChecklist id={req.id} review={review} closed={closed} />
      </div>

      <div className="card-pad text-sm space-y-1.5 mb-6">
        <h2 className="font-semibold mb-2">{t('rg_review')}</h2>
        <Info k={t('rg_reviewed_at')} v={req.reviewed_at} />
        <Info k={t('rg_reviewed_by')} v={req.reviewed_by} />
        <Info k={t('rg_admin_notes')} v={req.admin_notes} />
        <Info k={t('rg_info_requested')} v={req.info_request_note} />
      </div>

      <div className="mb-6">
        <h2 className="font-semibold mb-3">{t('rg_decision')}</h2>
        <RegistrationActions id={req.id} status={req.status} reviewReady={reviewComplete(review)} />
      </div>

      {history.length > 0 && (
        <div className="card-pad">
          <h2 className="font-semibold mb-3">{t('rg_history')}</h2>
          <ul className="text-sm divide-y divide-ink/5">
            {history.map((h) => (
              <li key={h.id} className="py-2 flex flex-wrap gap-2">
                <span className="text-xs text-ink-soft whitespace-nowrap">{h.created_at}</span>
                <code className="text-xs font-semibold" dir="ltr">{h.action}</code>
                {h.detail && <span className="text-xs text-ink-soft break-all">{h.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
