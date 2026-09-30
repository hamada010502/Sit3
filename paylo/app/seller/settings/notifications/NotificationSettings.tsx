'use client';
import { useEffect, useState, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { saveNotifyPrefsAction, testPushAction } from './actions';
import { subscribeThisDevice, unsubscribeThisDevice, type PushResult } from '@/lib/push-client';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';
import type { Seller } from '@/lib/types';

type Prefs = Pick<Seller, 'notify_push' | 'notify_sound' | 'notify_email_orders' | 'notify_text' | 'preferred_lang'>;

export function NotificationSettings({ prefs, devices }: { prefs: Prefs; devices: number }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveNotifyPrefsAction, null);
  const [device, setDevice] = useState<PushResult | 'on' | 'off' | 'checking'>('checking');
  const [busy, start] = useTransition();
  const [test, setTest] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setDevice('unsupported');
      const reg = await navigator.serviceWorker.getRegistration();
      setDevice((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => setDevice('off'));
  }, []);

  const Toggle = ({ name, label, hint, on }: { name: string; label: string; hint: string; on: number }) => (
    <label className="flex items-start gap-3 py-3 min-h-[44px] cursor-pointer">
      <input type="checkbox" name={name} defaultChecked={!!on} className="accent-cherry h-5 w-5 mt-0.5 shrink-0" />
      <span><strong className="block text-sm">{label}</strong><span className="text-xs text-ink-soft">{hint}</span></span>
    </label>
  );

  return (
    <section className="card-pad space-y-4" id="notifications" data-testid="notification-settings">
      <div>
        <h2 className="font-bold">{t('notif_settings_title')}</h2>
        <p className="text-sm text-ink-soft mt-1">{t('notif_settings_sub')}</p>
      </div>

      <div className="rounded-lg bg-cream p-3 flex flex-wrap items-center justify-between gap-3" data-testid="device-push">
        <div className="text-sm">
          <strong>{t('notif_this_device')}:</strong>{' '}
          <span data-testid="device-state">{t(device === 'on' || device === 'subscribed' ? 'notif_device_on' : device === 'denied' ? 'desktop_alerts_blocked'
            : device === 'unsupported' ? 'notif_device_unsupported' : device === 'failed' ? 'notif_device_failed' : 'notif_device_off')}</span>
          <div className="text-xs text-ink-soft">{t('notif_devices_count', { n: devices })}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {device === 'on' || device === 'subscribed' ? (
            <>
              <button type="button" className="btn-secondary btn-sm min-h-[40px]" disabled={busy}
                onClick={() => start(async () => { const r = await testPushAction(); setTest(t('notif_test_sent', { n: r.sent })); })}>{t('notif_send_test')}</button>
              <button type="button" className="btn-ghost btn-sm min-h-[40px]" disabled={busy}
                onClick={() => start(async () => { await unsubscribeThisDevice(); setDevice('off'); })}>{t('notif_device_disable')}</button>
            </>
          ) : device !== 'unsupported' && (
            <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy} data-testid="enable-push"
              onClick={() => start(async () => setDevice(await subscribeThisDevice()))}>{t('notif_device_enable')}</button>
          )}
        </div>
        {test && <p className="text-xs text-success w-full">{test}</p>}
      </div>

      <form action={action} className="divide-y divide-ink/8">
        {state?.ok && <div className="alert-success mb-2">{t('settings_saved')}</div>}
        <Toggle name="notify_push" label={t('notif_push')} hint={t('notif_push_hint')} on={prefs.notify_push} />
        <Toggle name="notify_sound" label={t('notif_sound')} hint={t('notif_sound_hint')} on={prefs.notify_sound} />
        <Toggle name="notify_email_orders" label={t('notif_email')} hint={t('notif_email_hint')} on={prefs.notify_email_orders} />
        <label className="block py-3">
          <strong className="block text-sm">{t('notif_text')}</strong>
          <span className="text-xs text-ink-soft block mb-2">{t('notif_text_hint')}</span>
          <select name="notify_text" className="input" defaultValue={prefs.notify_text}>
            <option value="none">{t('notif_text_none')}</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label className="block py-3">
          <strong className="block text-sm">{t('notif_lang')}</strong>
          <span className="text-xs text-ink-soft block mb-2">{t('notif_lang_hint')}</span>
          <select name="preferred_lang" className="input" defaultValue={prefs.preferred_lang} data-testid="preferred-lang">
            <option value="ar">العربية</option><option value="en">English</option>
          </select>
        </label>
        <div className="pt-3"><SubmitButton className="btn-primary">{t('save')}</SubmitButton></div>
      </form>
    </section>
  );
}
