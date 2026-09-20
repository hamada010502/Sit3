import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RegistrationStatusBadge } from '@/components/StatusBadge';
import { auditFor } from '@/lib/audit';
import { requireOwner } from '@/lib/guards';
import { getRegistration } from '@/lib/registration';
import { RegistrationActions } from './RegistrationActions';

export default function OwnerRegistrationDetailPage({ params }: { params: { id: string } }) {
  requireOwner();
  const req = getRegistration(params.id);
  if (!req) notFound();
  const history = auditFor('store_registration_request', req.id);
  const Info = ({ k, v }: { k: string; v: React.ReactNode }) => <div><span className="text-ink-soft">{k}: </span>{v || '—'}</div>;

  return (
    <div>
      <Link href="/owner/registrations" className="text-sm text-ink-soft hover:text-cherry">← Store registrations</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6">
        <h1 className="section-title">{req.store_name}</h1>
        <RegistrationStatusBadge status={req.status} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1.5">
          <h2 className="font-semibold mb-2">Applicant</h2>
          <Info k="Full name" v={req.full_name} />
          <Info k="Phone" v={<span dir="ltr">{req.phone}</span>} />
          <Info k="Email" v={<span dir="ltr">{req.email}</span>} />
          <Info k="National ID" v={<span dir="ltr" className="font-mono">{req.national_id}</span>} />
          <p className="text-xs text-ink-soft pt-1">Full, unmasked value — visible only on this screen.</p>
        </div>
        <div className="card-pad text-sm space-y-1.5">
          <h2 className="font-semibold mb-2">Store</h2>
          <Info k="Store name" v={req.store_name} />
          <Info k="Store link" v={<span dir="ltr">/s/{req.slug}</span>} />
          <Info k="Instagram" v={req.instagram ? <span dir="ltr">@{req.instagram}</span> : null} />
          <Info k="Governorate" v={req.governorate} />
          <Info k="Bio" v={req.bio} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1.5">
          <h2 className="font-semibold mb-2">Duplicate check</h2>
          <Info k="Result" v={<span className="text-success font-medium">Clear — no conflict on phone or national ID at submission</span>} />
          <Info k="Submitted" v={req.submitted_at} />
        </div>
        <div className="card-pad text-sm space-y-1.5">
          <h2 className="font-semibold mb-2">Review</h2>
          <Info k="Reviewed at" v={req.reviewed_at} />
          <Info k="Reviewed by" v={req.reviewed_by} />
          <Info k="Admin notes" v={req.admin_notes} />
          <Info k="Info requested" v={req.info_request_note} />
        </div>
      </div>

      <div className="mb-6">
        <h2 className="font-semibold mb-3">Decision</h2>
        <RegistrationActions id={req.id} status={req.status} />
      </div>

      {history.length > 0 && (
        <div className="card-pad">
          <h2 className="font-semibold mb-3">History</h2>
          <ul className="text-sm divide-y divide-ink/5">
            {history.map((h) => (
              <li key={h.id} className="py-2 flex flex-wrap gap-2">
                <span className="text-xs text-ink-soft whitespace-nowrap">{h.created_at}</span>
                <code className="text-xs font-semibold" dir="ltr">{h.action}</code>
                {h.detail && <span className="text-xs text-ink-soft">{h.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
