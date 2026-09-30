import { SubmitButton } from '@/components/SubmitButton';
import { sellerCoupons } from '@/lib/coupons';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { toggleCouponAction } from './actions';
import { CouponForm } from './CouponForm';

export default function SellerCouponsPage() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const coupons = sellerCoupons(seller.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="section-title">{t('coupons_title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('coupons_sub')}</p>
      </div>
      <CouponForm />
      {coupons.length === 0 ? <div className="card-pad text-center text-ink-soft">{t('coupons_none')}</div> : (
        <div className="card overflow-x-auto"><table className="table" data-testid="coupon-list">
          <thead><tr><th>{t('coupon_code')}</th><th>{t('coupon_value')}</th><th>{t('coupon_min_subtotal')}</th><th>{t('coupon_uses')}</th><th>{t('coupon_expires')}</th><th>{t('coupon_active')}</th><th></th></tr></thead>
          <tbody>{coupons.map((c) => (
            <tr key={c.id}>
              <td className="font-mono font-semibold" dir="ltr">{c.code}</td>
              <td>{c.kind === 'percent' ? `${c.value}%` : formatSYP(c.value, lang)}</td>
              <td>{c.min_subtotal ? formatSYP(c.min_subtotal, lang) : '—'}</td>
              <td dir="ltr">{c.used_count}{c.max_uses !== null ? ` / ${c.max_uses}` : ''}</td>
              <td className="text-xs text-ink-soft" dir="ltr">{c.expires_at ? c.expires_at.slice(0, 10) : '—'}</td>
              <td>{c.active ? '✓' : '—'}</td>
              <td><form action={toggleCouponAction.bind(null, c.id, !c.active)}><SubmitButton className="btn-secondary btn-sm">{c.active ? t('coupon_deactivate') : t('coupon_activate')}</SubmitButton></form></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
