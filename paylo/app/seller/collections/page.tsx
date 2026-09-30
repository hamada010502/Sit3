import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { SubmitButton } from '@/components/SubmitButton';
import { sellerCollections } from '@/lib/collections';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { appUrl } from '@/lib/notify';
import { deleteCollectionAction } from './actions';
import { CollectionForm } from './CollectionForm';

export default function SellerCollectionsPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  const cols = sellerCollections(seller.id);
  const counts = Object.fromEntries((getDb().prepare(
    "SELECT collection_id, count(*) c FROM products WHERE seller_id = ? AND collection_id IS NOT NULL AND status != 'removed' GROUP BY collection_id",
  ).all(seller.id) as { collection_id: string; c: number }[]).map((r) => [r.collection_id, r.c]));
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="section-title">{t('collections_title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('collections_sub')}</p>
      </div>
      <CollectionForm />
      {cols.length === 0 ? <EmptyState icon="folder" title={t('collections_none')} body={t('empty_collections_body')} /> : (
        <div className="card divide-y divide-ink/8" data-testid="collection-list">
          {cols.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-ink-soft">{t('collection_count', { n: counts[c.id] ?? 0 })} · <Link href={`/s/${seller.slug}?c=${encodeURIComponent(c.slug)}`} className="link" dir="ltr">{appUrl(`/s/${seller.slug}?c=${c.slug}`)}</Link></div>
              </div>
              <form action={deleteCollectionAction.bind(null, c.id)}><SubmitButton className="btn-secondary btn-sm">{t('delete')}</SubmitButton></form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
