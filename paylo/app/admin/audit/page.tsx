import Link from 'next/link';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { recentAudit } from '@/lib/audit';

const TYPES = ['all', 'order', 'seller', 'payout', 'dispute', 'user', 'product', 'webhook', 'api_token'];

export default function AdminAuditPage({ searchParams }: { searchParams: { type?: string } }) {
  requireAdmin();
  const { t } = getT();
  const type = searchParams.type && TYPES.includes(searchParams.type) ? searchParams.type : 'all';
  const rows = recentAudit(300, type === 'all' ? undefined : type);
  return (
    <div>
      <h1 className="section-title">{t('audit_title')}</h1>
      <p className="mt-1 mb-4 text-sm text-ink-soft">{t('audit_sub')}</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {TYPES.map((f) => (
          <Link key={f} href={f === 'all' ? '/admin/audit' : `/admin/audit?type=${f}`}
            className={`badge border px-3 py-1 ${type === f ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`}>
            {f === 'all' ? t('all') : f}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? <div className="card-pad text-center text-ink-soft">{t('audit_none')}</div> : (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('audit_actor')}</th><th>{t('audit_entity')}</th><th>{t('audit_action')}</th><th>{t('audit_detail')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="text-xs whitespace-nowrap">{r.created_at}</td>
              <td className="text-xs"><span className="badge bg-ink/8 text-ink-soft">{r.actor_type}</span>{r.actor_label && <div className="mt-1 text-ink-soft">{r.actor_label}</div>}</td>
              <td className="text-xs"><code dir="ltr">{r.entity_type}</code><div className="text-ink-soft" dir="ltr">{r.entity_id.slice(0, 12)}</div></td>
              <td className="text-xs font-semibold" dir="ltr">{r.action}</td>
              <td className="text-xs text-ink-soft max-w-sm break-words" dir="ltr">{r.detail}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
