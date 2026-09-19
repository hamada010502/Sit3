/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductImage } from '@/components/ProductImage';
import { KycBadge, ProductStatusBadge, SellerStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { auditFor } from '@/lib/audit';
import type { Product, Seller, User } from '@/lib/types';
import { removeListingAction, resetTotpAction, reviewKycAction } from '../actions';
import { SellerDecision } from './SellerDecision';

export default function AdminSellerPage({ params }: { params: { id: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const seller = db.prepare('SELECT * FROM sellers WHERE id = ?').get(params.id) as Seller | undefined;
  if (!seller) notFound();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(seller.user_id) as User;
  const products = db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as Product[];
  const history = auditFor('seller', seller.id).slice(0, 12);
  const Info = ({ k, v }: { k: string; v: React.ReactNode }) => <div><span className="text-ink-soft">{k}: </span>{v || '—'}</div>;

  return (
    <div>
      <Link href="/admin/sellers" className="text-sm text-ink-soft hover:text-rose-600">← {t('a_sellers_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6">
        <h1 className="section-title">{seller.store_name}</h1>
        <SellerStatusBadge status={seller.status} t={t} />
        <KycBadge status={seller.kyc_status} t={t} />
        <span className={`badge ${user.totp_enabled ? 'bg-success/12 text-success' : 'bg-danger/10 text-danger'}`}>2FA {user.totp_enabled ? t('yes') : t('no')}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1">
          <Info k={t('full_name')} v={user.name} /><Info k={t('email')} v={<span dir="ltr">{user.email}</span>} /><Info k={t('phone')} v={<span dir="ltr">{seller.phone}</span>} />
          <Info k={t('governorate')} v={seller.governorate} />
          <Info k={t('instagram')} v={seller.instagram ? <a className="link" href={`https://instagram.com/${seller.instagram}`} target="_blank" rel="noreferrer" dir="ltr">@{seller.instagram}</a> : null} />
          <Info k={t('store_slug')} v={<Link className="link" href={`/s/${seller.slug}`} target="_blank" dir="ltr">/s/{seller.slug}</Link>} />
          <Info k={t('store_visible')} v={seller.visible ? t('yes') : t('no')} />
          <Info k={t('bio')} v={seller.bio} />
          <Info k={t('payout_details')} v={<span className="whitespace-pre-line">{seller.payout_details}</span>} />
          <Info k={t('date')} v={seller.created_at} />
          <form action={resetTotpAction.bind(null, seller.id)} className="pt-2"><button className="btn-ghost btn-sm text-danger">{t('tfa_disable')} (2FA)</button></form>
        </div>
        <div className="space-y-4">
          <SellerDecision sellerId={seller.id} status={seller.status} reviewNote={seller.review_note} />
          <div className="card-pad text-sm">
            <h2 className="font-bold mb-2">{t('kyc_title')}</h2>
            <Info k={t('kyc_legal_name')} v={seller.kyc_legal_name} />
            <Info k={t('kyc_national_id')} v={<span dir="ltr">{seller.kyc_national_id}</span>} />
            {seller.kyc_doc_path && <a href={seller.kyc_doc_path} target="_blank" rel="noreferrer" className="link block mt-2">{t('kyc_doc')} →</a>}
            {seller.kyc_note && <div className="alert-info mt-2">{seller.kyc_note}</div>}
            {seller.kyc_status === 'submitted' && (
              <div className="mt-3 space-y-2">
                <form action={reviewKycAction.bind(null, seller.id, true)} className="flex gap-2">
                  <input name="note" className="input" placeholder={t('a_note_ph')} /><SubmitButton className="btn-primary shrink-0">{t('kyc_approve')}</SubmitButton>
                </form>
                <form action={reviewKycAction.bind(null, seller.id, false)} className="flex gap-2">
                  <input name="note" className="input" placeholder={t('a_note_ph')} /><SubmitButton className="btn-danger shrink-0">{t('kyc_reject')}</SubmitButton>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      <h2 className="font-bold mb-3">{t('products_of')} ({products.length})</h2>
      <div className="space-y-2 mb-6">
        {products.map((p) => (
          <div key={p.id} className="card p-3 flex items-center gap-3">
            <ProductImage images={p.images} alt={p.title} className="h-14 w-14 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.title}</span><ProductStatusBadge status={p.status} t={t} /></div>
              <div className="text-xs text-ink-soft">{formatSYP(p.price, lang)} · {t('stock')}: {p.stock} · <Link href={`/p/${p.id}`} target="_blank" className="link" dir="ltr">/p/{p.id}</Link></div>
            </div>
            {p.status !== 'removed' && <form action={removeListingAction.bind(null, p.id)}><button className="btn-danger btn-sm">{t('remove_listing')}</button></form>}
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className="card-pad">
          <h2 className="font-bold mb-3">{t('audit_title')}</h2>
          <ul className="text-sm divide-y divide-ink/5">
            {history.map((h) => (
              <li key={h.id} className="py-2 flex flex-wrap gap-2">
                <span className="text-xs text-ink-soft whitespace-nowrap">{h.created_at}</span>
                <code className="text-xs font-semibold" dir="ltr">{h.action}</code>
                {h.detail && <span className="text-xs text-ink-soft">{h.detail}</span>}
              </li>))}
          </ul>
        </div>
      )}
    </div>
  );
}
