import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductImage } from '@/components/ProductImage';
import { ProductStatusBadge, SellerStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Product, Seller, User } from '@/lib/types';
import { removeListingAction, setSellerStatusAction } from '../actions';

export default function AdminSellerPage({ params }: { params: { id: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const seller = db.prepare('SELECT * FROM sellers WHERE id = ?').get(params.id) as Seller | undefined;
  if (!seller) notFound();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(seller.user_id) as User;
  const products = db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as Product[];
  const Info = ({ k, v }: { k: string; v: React.ReactNode }) => <div><span className="text-bluewood/60">{k}: </span>{v || '—'}</div>;
  const actions: { label: string; status: Seller['status']; cls: string }[] =
    seller.status === 'pending' ? [{ label: t('approve'), status: 'approved', cls: 'btn-primary' }, { label: t('reject'), status: 'rejected', cls: 'btn-danger' }]
    : seller.status === 'approved' ? [{ label: t('suspend'), status: 'suspended', cls: 'btn-danger' }]
    : [{ label: t('reinstate'), status: 'approved', cls: 'btn-primary' }];
  return (
    <div>
      <Link href="/admin/sellers" className="text-sm text-bluewood/60 hover:text-crusta">← {t('a_sellers_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6"><h1 className="text-2xl font-bold">{seller.store_name}</h1><SellerStatusBadge status={seller.status} t={t} /></div>
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1">
          <Info k={t('full_name')} v={user.name} /><Info k={t('email')} v={<span dir="ltr">{user.email}</span>} /><Info k={t('phone')} v={<span dir="ltr">{seller.phone}</span>} />
          <Info k={t('governorate')} v={seller.governorate} /><Info k={t('instagram')} v={seller.instagram ? <a className="text-crusta" href={`https://instagram.com/${seller.instagram}`} target="_blank" rel="noreferrer" dir="ltr">@{seller.instagram}</a> : null} />
          <Info k={t('store_slug')} v={<Link className="text-crusta" href={`/s/${seller.slug}`} target="_blank" dir="ltr">/s/{seller.slug}</Link>} />
          <Info k={t('bio')} v={seller.bio} /><Info k={t('payout_details')} v={<span className="whitespace-pre-line">{seller.payout_details}</span>} />
          <Info k={t('date')} v={seller.created_at} />
        </div>
        <div className="card-pad">
          {seller.review_note && <div className="alert-info mb-3 text-sm"><strong>{t('review_note')}:</strong> {seller.review_note}</div>}
          <label className="label">{t('admin_note')}</label>
          <div className="space-y-2">
            {actions.map((a) => (
              <form key={a.status} action={setSellerStatusAction.bind(null, seller.id, a.status)} className="flex gap-2">
                <input name="note" className="input" placeholder={t('a_note_ph')} />
                <SubmitButton className={`${a.cls} shrink-0`}>{a.label}</SubmitButton>
              </form>
            ))}
          </div>
        </div>
      </div>
      <h2 className="font-semibold mb-3">{t('products_of')} ({products.length})</h2>
      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.id} className="card p-3 flex items-center gap-3">
            <ProductImage images={p.images} alt={p.title} className="h-14 w-14 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.title}</span><ProductStatusBadge status={p.status} t={t} /></div><div className="text-xs text-bluewood/60">{formatSYP(p.price, lang)} · {t('stock')}: {p.stock} · <Link href={`/p/${p.id}`} target="_blank" className="text-crusta" dir="ltr">/p/{p.id}</Link></div></div>
            {p.status !== 'removed' && <form action={removeListingAction.bind(null, p.id)}><button className="btn-danger btn-sm">{t('remove_listing')}</button></form>}
          </div>
        ))}
      </div>
    </div>
  );
}
