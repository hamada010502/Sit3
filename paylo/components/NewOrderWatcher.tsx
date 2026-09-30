'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/client';

interface NewOrder { id: string; code: string; product_title: string; total: number }
const SOUND_KEY = 'paylo_sale_sound';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** Two short rising tones, synthesised — no audio file to ship or cache. */
function chime() {
  // Counted before playing, so it is observable even where audio is unavailable (tests, muted kiosks).
  const w = window as unknown as { __paylo_chimes?: number };
  w.__paylo_chimes = (w.__paylo_chimes ?? 0) + 1;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      const t0 = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.32);
    });
  } catch { /* audio unavailable */ }
}

/**
 * While any seller page is open, polls for new orders and announces them: in-page toast
 * always, a desktop notification if the seller allowed it, and an optional sale chime.
 */
export function NewOrderWatcher({ intervalMs = 12000 }: { intervalMs?: number }) {
  const { t } = useI18n();
  const cursor = useRef<string | null>(null);
  const [toasts, setToasts] = useState<NewOrder[]>([]);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
  const [sound, setSound] = useState(false);

  useEffect(() => {
    setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    setSound(read(SOUND_KEY) === '1');
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const q = cursor.current ? `?since=${encodeURIComponent(cursor.current)}` : '';
        const r = await fetch(`/api/seller/new-orders${q}`, { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json() as { cursor: string; orders: NewOrder[] };
        const fresh = cursor.current ? data.orders : [];
        cursor.current = data.cursor;
        if (stop || fresh.length === 0) return;
        setToasts((x) => [...fresh, ...x].slice(0, 4));
        if (read(SOUND_KEY) === '1') chime();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const o of fresh) new Notification(t('new_order_title', { code: o.code }), { body: `${o.product_title} — ${o.total.toLocaleString()} SYP`, tag: o.id });
        }
      } catch { /* offline — try again next tick */ }
    };
    tick();
    const h = setInterval(tick, intervalMs);
    return () => { stop = true; clearInterval(h); };
  }, [intervalMs, t]);

  const enableDesktop = async () => {
    if (typeof Notification === 'undefined') return;
    setPerm(await Notification.requestPermission());
  };
  const toggleSound = () => {
    const next = !sound;
    setSound(next); write(SOUND_KEY, next ? '1' : '0');
    if (next) chime();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs mb-4" data-testid="alert-controls">
        <span className="text-ink-soft">{t('new_order_alerts')}:</span>
        {perm === 'granted' ? <span className="badge bg-success/10 text-success" data-testid="desktop-on">{t('desktop_alerts_on')}</span>
          : perm === 'unsupported' ? null
          : <button type="button" className="btn-secondary btn-sm" onClick={enableDesktop} data-testid="enable-desktop">{perm === 'denied' ? t('desktop_alerts_blocked') : t('desktop_alerts_enable')}</button>}
        <button type="button" className={`btn-sm ${sound ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleSound} aria-pressed={sound} data-testid="sound-toggle">
          {sound ? t('sale_sound_on') : t('sale_sound_off')}
        </button>
      </div>
      <div className={`fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 rtl:sm:right-auto rtl:sm:left-4 sm:w-80 z-50 space-y-2 ${toasts.length ? '' : 'hidden'}`} aria-live="polite" data-testid="order-toasts">
        {toasts.map((o) => (
          <div key={o.id} className="card-pad shadow-lift border-success/30 bg-white text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold">{t('new_order_title', { code: o.code })}</div>
                <div className="text-ink-soft">{o.product_title} — {o.total.toLocaleString()} SYP</div>
              </div>
              <button type="button" className="text-ink-soft" aria-label={t('close')} onClick={() => setToasts((x) => x.filter((y) => y.id !== o.id))}>×</button>
            </div>
            <Link href={`/seller/orders/${o.id}`} className="link text-xs">{t('view')} →</Link>
          </div>
        ))}
      </div>
    </>
  );
}
