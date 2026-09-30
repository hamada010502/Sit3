import webpush from 'web-push';
import { getDb, getSetting, newId, nowIso, setSetting } from './db';

/**
 * Web Push (VAPID). Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; if unset they are
 * generated once and kept in settings, so push works locally with no setup. In production
 * set them in the environment — rotating keys invalidates every existing subscription.
 */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  let pub = getSetting('vapid_public'), priv = getSetting('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    setSetting('vapid_public', k.publicKey); setSetting('vapid_private', k.privateKey);
    pub = k.publicKey; priv = k.privateKey;
  }
  return { publicKey: pub, privateKey: priv };
}

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

export function saveSubscription(sellerId: string, sub: PushSub, userAgent: string | null) {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('invalid subscription');
  // Upsert on endpoint: a device re-subscribing (or moving to another seller login) owns it.
  getDb().prepare(`INSERT INTO push_subscriptions (id, seller_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET seller_id = excluded.seller_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`)
    .run(newId(), sellerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 200) ?? null);
}

export function removeSubscription(sellerId: string, endpoint: string) {
  getDb().prepare('DELETE FROM push_subscriptions WHERE seller_id = ? AND endpoint = ?').run(sellerId, endpoint);
}

export const subscriptionCount = (sellerId: string) =>
  (getDb().prepare('SELECT count(*) c FROM push_subscriptions WHERE seller_id = ?').get(sellerId) as { c: number }).c;

/** Sends to every device of a seller. Never throws — a push failure must not affect the order. */
export async function pushToSeller(sellerId: string, payload: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  const subs = getDb().prepare('SELECT * FROM push_subscriptions WHERE seller_id = ?').all(sellerId) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  if (!subs.length) return 0;
  const { publicKey, privateKey } = vapidKeys();
  const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] || 'no-reply@paylo.sy'}`;
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload),
        { vapidDetails: { subject, publicKey, privateKey }, TTL: 3600, timeout: 5000 });
      getDb().prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').run(nowIso(), s.id);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) getDb().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
    }
  }));
  return sent;
}
