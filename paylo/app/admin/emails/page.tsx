import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
interface Row { id: number; to_email: string; subject: string; body: string; transport: string; status: string; created_at: string }
export default function AdminEmailsPage() {
  requireAdmin();
  const { t } = getT();
  const rows = getDb().prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 200').all() as Row[];
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('a_emails_title')}</h1>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{t('date')}</th><th>{t('to')}</th><th>{t('subject')}</th><th>{t('transport')}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td className="text-xs whitespace-nowrap">{r.created_at}</td><td dir="ltr">{r.to_email}</td>
            <td><details><summary className="cursor-pointer">{r.subject}</summary><pre className="mt-2 whitespace-pre-wrap text-xs bg-karry/50 rounded p-2" dir="ltr">{r.body}</pre></details></td>
            <td className="text-xs">{r.transport} · {r.status}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}
