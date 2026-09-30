import { getPaymentProvider } from '@/lib/payments';
import { ALL_METHODS, paymentMethodStatus } from '@/lib/payment-methods';
import type { TFn } from '@/lib/i18n';

/**
 * What buyers can use right now, and why a method is off. Never shows secrets — only the
 * provider's name and whether it reports itself configured.
 */
export function PaymentMethodsStatus({ t }: { t: TFn }) {
  const label = { cod: t('pm_cod'), bank_transfer: t('pm_bank_transfer'), card: t('pm_card') } as const;
  const provider = getPaymentProvider();
  return (
    <section className="card overflow-x-auto mb-5" data-testid="payment-status">
      <h2 className="font-bold px-5 pt-5 pb-2">{t('pay_status_title')}</h2>
      <table className="table"><tbody>{ALL_METHODS.map((m) => {
        const st = paymentMethodStatus(m);
        return (
          <tr key={m} data-method={m} data-live={st.block ? '0' : '1'}>
            <td className="font-medium">{label[m]}</td>
            <td><span className={`badge ${st.block ? 'bg-ink/8 text-ink-soft' : 'bg-success/12 text-success'}`}>{st.block ? t('pay_state_off') : t('pay_state_on')}</span></td>
            <td className="text-xs text-ink-soft">{st.block ? t(`pay_block_${st.block}`) : m === 'card' ? t('pay_provider', { name: provider.name }) : ''}</td>
          </tr>);
      })}</tbody></table>
    </section>
  );
}
