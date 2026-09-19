import { CopyButton } from '@/components/CopyButton';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { appUrl } from '@/lib/notify';
import { WEBHOOK_EVENTS } from '@/lib/webhooks';
import type { ApiToken, WebhookDelivery, WebhookEndpoint } from '@/lib/types';
import { DeveloperPanels } from './DeveloperPanels';

export default function DevelopersPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  const db = getDb();
  const endpoints = db.prepare('SELECT * FROM webhook_endpoints WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as WebhookEndpoint[];
  const deliveries = db.prepare(
    'SELECT d.* FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE e.seller_id = ? ORDER BY d.id DESC LIMIT 30',
  ).all(seller.id) as WebhookDelivery[];
  const tokens = db.prepare('SELECT * FROM api_tokens WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as ApiToken[];

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="section-title">{t('wh_title')}</h1>
        <p className="mt-2 text-sm text-ink-soft">{t('wh_sub')}</p>
      </div>
      <DeveloperPanels endpoints={endpoints} deliveries={deliveries} tokens={tokens} events={[...WEBHOOK_EVENTS]} />
      <div className="card-pad text-sm">
        <h2 className="font-bold mb-2">{t('api_title')}</h2>
        <p className="text-ink-soft mb-3">{t('api_sub')}</p>
        <pre className="bg-mist rounded-lg p-3 overflow-x-auto text-xs" dir="ltr">{`curl -H "Authorization: Bearer plo_..." \\
  ${appUrl('/api/v1/orders')}`}</pre>
        <div className="mt-3 flex items-center gap-2">
          <code className="bg-mist rounded px-2 py-1 text-xs" dir="ltr">{appUrl('/api/v1')}</code>
          <CopyButton text={appUrl('/api/v1')} />
        </div>
      </div>
    </div>
  );
}
