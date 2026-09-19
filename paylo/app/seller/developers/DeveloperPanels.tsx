'use client';
import { useFormState } from 'react-dom';
import { addEndpointAction, createTokenAction, deleteEndpointAction, revokeTokenAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { CopyButton } from '@/components/CopyButton';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { ApiToken, WebhookDelivery, WebhookEndpoint } from '@/lib/types';

export function DeveloperPanels({ endpoints, deliveries, tokens, events }:
  { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[]; tokens: ApiToken[]; events: string[] }) {
  const { t } = useI18n();
  const [epState, addEndpoint] = useFormState(addEndpointAction, null);
  const [tkState, createToken] = useFormState(createTokenAction, null);
  const live = tokens.filter((x) => !x.revoked_at);

  return (
    <>
      <form action={addEndpoint} className="card-pad space-y-4">
        {epState?.error && <div className="alert-error">{t('apply_error_generic')}</div>}
        <Field label={t('wh_url')}><input name="url" className="input" dir="ltr" placeholder="https://example.com/paylo" required /></Field>
        <div>
          <label className="label">{t('wh_events')}</label>
          <div className="flex flex-wrap gap-3 text-sm">
            {events.map((e) => (
              <label key={e} className="flex items-center gap-1.5"><input type="checkbox" name="events" value={e} className="accent-rose h-4 w-4" /><code dir="ltr">{e}</code></label>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-soft">{t('wh_all_events')}</p>
        </div>
        <SubmitButton className="btn-primary">{t('wh_add')}</SubmitButton>
      </form>

      {endpoints.length === 0 ? <div className="card-pad text-center text-ink-soft text-sm">{t('wh_none')}</div> : (
        <div className="space-y-3">
          {endpoints.map((e) => (
            <div key={e.id} className="card-pad text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code dir="ltr" className="font-semibold break-all">{e.url}</code>
                <form action={deleteEndpointAction.bind(null, e.id)}><button className="btn-ghost btn-sm text-danger">{t('wh_delete')}</button></form>
              </div>
              <p className="mt-1 text-xs text-ink-soft" dir="ltr">{e.events === '*' ? t('wh_all_events') : e.events}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-ink-soft">{t('wh_secret')}:</span>
                <code className="bg-mist rounded px-2 py-1 text-xs break-all" dir="ltr">{e.secret}</code>
                <CopyButton text={e.secret} />
              </div>
            </div>
          ))}
        </div>
      )}

      {deliveries.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="font-bold px-5 pt-5 pb-2">{t('wh_deliveries')}</h2>
          <table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('notif_event')}</th><th>{t('status')}</th></tr></thead>
            <tbody>{deliveries.map((d) => (
              <tr key={d.id}>
                <td className="text-xs whitespace-nowrap">{d.created_at}</td>
                <td><code dir="ltr" className="text-xs">{d.event}</code></td>
                <td><span className={`badge ${d.status === 'delivered' ? 'bg-success/12 text-success' : 'bg-danger/10 text-danger'}`}>{d.status}{d.response_code ? ` ${d.response_code}` : ''}</span>
                  {d.error && <div className="text-xs text-ink-soft">{d.error}</div>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      <form action={createToken} className="card-pad space-y-4">
        <h2 className="font-bold">{t('api_title')}</h2>
        {tkState?.token && (
          <div className="alert-success">
            <p className="mb-2">{t('api_token_once')}</p>
            <div className="flex items-center gap-2"><code className="bg-white rounded px-2 py-1 text-xs break-all" dir="ltr">{tkState.token}</code><CopyButton text={tkState.token} /></div>
          </div>
        )}
        <Field label={t('api_name')}><input name="name" className="input" placeholder="Mobile app" /></Field>
        <SubmitButton className="btn-primary">{t('api_new')}</SubmitButton>
        {live.length === 0 ? <p className="text-sm text-ink-soft">{t('api_none')}</p> : (
          <ul className="divide-y divide-ink/5 text-sm">
            {live.map((k) => (
              <li key={k.id} className="py-2 flex items-center justify-between gap-3">
                <span><strong>{k.name}</strong> <code className="text-xs text-ink-soft" dir="ltr">{k.prefix}…</code></span>
                <button formAction={revokeTokenAction.bind(null, k.id)} className="btn-ghost btn-sm text-danger">{t('api_revoke')}</button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </>
  );
}
