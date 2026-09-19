import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';

interface Row { id: number; channel: 'email' | 'sms' | 'whatsapp'; recipient: string; event: string; subject: string | null; body: string; transport: string; status: string; created_at: string }
const CHANNELS = ['all', 'email', 'sms', 'whatsapp'] as const;

export default function AdminNotificationsPage({ searchParams }: { searchParams: { channel?: string } }) {
  requireAdmin();
  const { t } = getT();
  const ch = (CHANNELS as readonly string[]).includes(searchParams.channel || '') ? searchParams.channel! : 'all';
  const rows = (ch === 'all'
    ? getDb().prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 200').all()
    : getDb().prepare('SELECT * FROM notifications WHERE channel = ? ORDER BY id DESC LIMIT 200').all(ch)) as Row[];
  return (
    <div>
      <h1 className="section-title">{t('notif_title')}</h1>
      <p className="mt-1 mb-4 text-sm text-ink-soft">{t('notif_sub')}</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {CHANNELS.map((f) => (
          <Link key={f} href={f === 'all' ? '/admin/notifications' : `/admin/notifications?channel=${f}`}
            className={`badge border px-3 py-1 ${ch === f ? 'bg-tide text-white border-tide' : 'bg-white border-ink/15 text-ink-soft'}`}>
            {f === 'all' ? t('all') : t(`ch_${f}` as const)}
          </Link>
        ))}
      </div>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{t('date')}</th><th>{t('notif_channel')}</th><th>{t('to')}</th><th>{t('notif_event')}</th><th>{t('subject')}</th><th>{t('transport')}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td className="text-xs whitespace-nowrap">{r.created_at}</td>
            <td><span className="badge bg-ink/8 text-ink-soft">{t(`ch_${r.channel}` as const)}</span></td>
            <td dir="ltr" className="text-xs">{r.recipient}</td>
            <td className="text-xs" dir="ltr">{r.event}</td>
            <td><details><summary className="cursor-pointer text-sm">{r.subject || r.body.slice(0, 48)}</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs bg-mist rounded p-2" dir="ltr">{r.body}</pre></details></td>
            <td className="text-xs">{r.transport} · {r.status}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}
