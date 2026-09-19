'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getDb, newId, nowIso } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { createApiToken } from '@/lib/apitokens';
import { newWebhookSecret, WEBHOOK_EVENTS } from '@/lib/webhooks';

export async function addEndpointAction(_prev: { error?: string } | null, formData: FormData) {
  const { seller } = requireApprovedSeller();
  const url = String(formData.get('url') || '').trim();
  if (!/^https?:\/\/.+/.test(url)) return { error: 'apply_error_generic' };
  const picked = formData.getAll('events').map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  const id = newId();
  getDb().prepare('INSERT INTO webhook_endpoints (id, seller_id, url, secret, events) VALUES (?, ?, ?, ?, ?)')
    .run(id, seller.id, url, newWebhookSecret(), picked.length ? picked.join(',') : '*');
  audit('seller', seller.id, seller.store_name, 'webhook', id, 'created', { url });
  revalidatePath('/seller/developers');
  return {};
}

export async function deleteEndpointAction(endpointId: string): Promise<void> {
  const { seller } = requireApprovedSeller();
  getDb().prepare('DELETE FROM webhook_endpoints WHERE id = ? AND seller_id = ?').run(endpointId, seller.id);
  audit('seller', seller.id, seller.store_name, 'webhook', endpointId, 'deleted');
  revalidatePath('/seller/developers');
}

export async function createTokenAction(_prev: { token?: string; error?: string } | null, formData: FormData) {
  const { seller } = requireApprovedSeller();
  const name = String(formData.get('name') || '').trim() || 'API token';
  const { token, row } = createApiToken(seller.id, name);
  audit('seller', seller.id, seller.store_name, 'api_token', row.id, 'created', { name });
  revalidatePath('/seller/developers');
  return { token };
}

export async function revokeTokenAction(tokenId: string): Promise<void> {
  const { seller } = requireApprovedSeller();
  getDb().prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND seller_id = ?').run(nowIso(), tokenId, seller.id);
  audit('seller', seller.id, seller.store_name, 'api_token', tokenId, 'revoked');
  revalidatePath('/seller/developers');
}
