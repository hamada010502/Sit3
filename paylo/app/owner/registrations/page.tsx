import Link from 'next/link';
import { RegistrationStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { requireOwner } from '@/lib/guards';
import type { RegistrationStatus, StoreRegistrationRequest } from '@/lib/types';

const STATUSES: RegistrationStatus[] = ['PENDING_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED'];
const LABEL: Record<RegistrationStatus, string> = {
  PENDING_REVIEW: 'Pending review', MORE_INFORMATION_REQUIRED: 'More info requested', APPROVED: 'Approved', REJECTED: 'Rejected',
};

/** Same masking rule as the detail page's rule for the list: only the detail screen (a
 * separate, explicit click) ever shows the full national ID. */
const maskId = (v: string) => (v.length <= 4 ? '*'.repeat(v.length) : '*'.repeat(v.length - 4) + v.slice(-4));

export default function OwnerRegistrationsPage({ searchParams }: { searchParams: { status?: string } }) {
  requireOwner();
  const db = getDb();
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, (db.prepare('SELECT count(*) c FROM store_registration_requests WHERE status = ?').get(s) as { c: number }).c]),
  ) as Record<RegistrationStatus, number>;

  const filter = STATUSES.includes(searchParams.status as RegistrationStatus) ? (searchParams.status as RegistrationStatus) : null;
  const rows = (filter
    ? db.prepare('SELECT * FROM store_registration_requests WHERE status = ? ORDER BY submitted_at DESC').all(filter)
    : db.prepare('SELECT * FROM store_registration_requests ORDER BY submitted_at DESC').all()) as StoreRegistrationRequest[];

  return (
    <div>
      <h1 className="section-title mb-4">Store registrations</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {STATUSES.map((s) => (
          <Link key={s} href={filter === s ? '/owner/registrations' : `/owner/registrations?status=${s}`}
            className={`stat block hover:border-ink/30 ${filter === s ? 'border-ink' : ''}`}>
            <div className="stat-label">{LABEL[s]}</div>
            <div className="stat-value">{counts[s]}</div>
          </Link>
        ))}
      </div>
      {filter && <Link href="/owner/registrations" className="link text-sm mb-4 inline-block">Clear filter</Link>}

      {rows.length === 0 ? <div className="alert-info">No registration requests{filter ? ` with status ${LABEL[filter]}` : ''}.</div> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Applicant</th><th>Phone</th><th>Email</th><th>National ID</th><th>Store</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.full_name}</td>
                <td dir="ltr" className="text-sm">{r.phone}</td>
                <td dir="ltr" className="text-sm">{r.email}</td>
                <td dir="ltr" className="text-sm font-mono">{maskId(r.national_id)}</td>
                <td>{r.store_name}</td>
                <td className="text-xs text-ink-soft whitespace-nowrap">{r.submitted_at}</td>
                <td><RegistrationStatusBadge status={r.status} /></td>
                <td><Link href={`/owner/registrations/${r.id}`} className="link text-sm">View</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
