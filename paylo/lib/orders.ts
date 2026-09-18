import { getDb, getSetting, newId, newOrderCode, nowIso } from './db';
import { getPaymentProvider, type CardInput } from './payments';
import { sendEmail, appUrl } from './email';
import { calcCommission } from './money';
import { DAMASCUS, type Dispute, type FulfillmentMethod, type Liability, type Order, type OrderEvent, type OrderStatus, type Payment, type Product, type Seller } from './types';

export type Actor = 'buyer' | 'seller' | 'admin' | 'system';

/** Allowed transitions. Disputes are handled separately (any post-payment status → disputed → back). */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: [],
  paid: ['handed_off', 'disputed', 'refunded', 'cancelled'],
  handed_off: ['in_transit', 'ready_for_pickup', 'delivered', 'disputed', 'refunded'],
  in_transit: ['ready_for_pickup', 'delivered', 'disputed', 'refunded'],
  ready_for_pickup: ['delivered', 'disputed', 'refunded'],
  delivered: ['disputed', 'refunded'],
  disputed: ['paid', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered', 'refunded'],
  refunded: [],
  cancelled: [],
};

export class OrderError extends Error {}

export function getOrder(id: string): Order | undefined {
  return getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order | undefined;
}
export function getOrderByCode(code: string): Order | undefined {
  return getDb().prepare('SELECT * FROM orders WHERE upper(code) = upper(?)').get(code.trim()) as Order | undefined;
}
export function getOrderEvents(orderId: string): OrderEvent[] {
  return getDb().prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC').all(orderId) as OrderEvent[];
}
export function getOrderPayments(orderId: string): Payment[] {
  return getDb().prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC').all(orderId) as Payment[];
}
export function getOrderDisputes(orderId: string): Dispute[] {
  return getDb().prepare('SELECT * FROM disputes WHERE order_id = ? ORDER BY created_at DESC').all(orderId) as Dispute[];
}
export function getOpenDispute(orderId: string): Dispute | undefined {
  return getDb().prepare("SELECT * FROM disputes WHERE order_id = ? AND status IN ('open','investigating') ORDER BY created_at DESC LIMIT 1").get(orderId) as Dispute | undefined;
}

function transition(order: Order, to: OrderStatus, actor: Actor, note?: string | null, extra: Partial<Order> = {}) {
  if (!TRANSITIONS[order.status].includes(to)) {
    throw new OrderError(`Cannot move order ${order.code} from ${order.status} to ${to}`);
  }
  const db = getDb();
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const vals: unknown[] = [to, nowIso()];
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(v); }
  vals.push(order.id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  db.prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note) VALUES (?, ?, ?, ?, ?)').run(order.id, order.status, to, actor, note ?? null);
}

export function defaultFulfillment(governorate: string): FulfillmentMethod {
  return governorate === DAMASCUS ? 'platform_rider' : 'logistics_pickup';
}

export interface CheckoutInput {
  productId: string;
  quantity: number;
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string;
  governorate: string;
  address: string;
  note?: string;
  card: CardInput;
}

export type CheckoutResult = { ok: true; order: Order } | { ok: false; error: string; order?: Order };

/** Create the order, charge the card through the provider abstraction, and confirm or fail it. */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(input.productId) as Product | undefined;
  if (!product || product.status !== 'active') return { ok: false, error: 'product_unavailable' };
  const seller = db.prepare('SELECT * FROM sellers WHERE id = ?').get(product.seller_id) as Seller | undefined;
  if (!seller || seller.status !== 'approved') return { ok: false, error: 'product_unavailable' };
  const qty = Math.max(1, Math.floor(input.quantity));
  if (qty > product.stock) return { ok: false, error: 'qty_exceeds' };

  const rate = parseFloat(getSetting('commission_rate')) || 0;
  const deliveryFee = parseInt(getSetting(input.governorate === DAMASCUS ? 'delivery_fee_damascus' : 'delivery_fee_other'), 10) || 0;
  const subtotal = product.price * qty;
  const commission = calcCommission(subtotal, rate);
  const total = subtotal + deliveryFee;
  const id = newId();
  const code = newOrderCode();

  db.prepare(`INSERT INTO orders (id, code, seller_id, product_id, product_title, unit_price, quantity, subtotal, delivery_fee, total,
    commission_rate, commission_amount, seller_net, buyer_name, buyer_phone, buyer_email, governorate, address, note, fulfillment_method, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`).run(
    id, code, seller.id, product.id, product.title, product.price, qty, subtotal, deliveryFee, total,
    rate, commission, subtotal - commission, input.buyerName, input.buyerPhone, input.buyerEmail || null,
    input.governorate, input.address, input.note || null, defaultFulfillment(input.governorate),
  );
  db.prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note) VALUES (?, NULL, ?, ?, NULL)').run(id, 'pending_payment', 'buyer');

  const provider = getPaymentProvider();
  const result = await provider.charge({ orderId: id, orderCode: code, amount: total, currency: 'SYP', card: input.card, description: `Paylo order ${code}` });
  const order = getOrder(id)!;

  db.prepare(`INSERT INTO payments (id, order_id, provider, provider_ref, amount, status, card_last4, card_brand, failure_reason, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    newId(), id, provider.name, result.providerRef ?? null, total, result.ok ? 'captured' : 'failed',
    result.cardLast4 ?? null, result.cardBrand ?? null, result.failureReason ?? null, result.raw ? JSON.stringify(result.raw) : null,
  );

  if (!result.ok) {
    transition(order, 'payment_failed', 'system', result.failureReason);
    return { ok: false, error: result.failureReason || 'generic', order: getOrder(id) };
  }

  // Payment confirmed: hold funds, decrement stock (auto-deactivate at zero), notify.
  const tx = db.transaction(() => {
    const fresh = db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id) as { stock: number };
    const newStock = Math.max(0, fresh.stock - qty);
    db.prepare("UPDATE products SET stock = ?, status = CASE WHEN ? = 0 THEN 'out_of_stock' ELSE status END, updated_at = ? WHERE id = ?").run(newStock, newStock, nowIso(), product.id);
    transition(order, 'paid', 'system', `Card ${result.cardBrand ?? ''} •••• ${result.cardLast4 ?? ''}`, { paid_at: nowIso() });
  });
  tx();

  const confirmed = getOrder(id)!;
  await sendEmail(confirmed.buyer_email, `Paylo — payment confirmed for order ${code}`,
    `Hi ${confirmed.buyer_name},\n\nYour payment of ${total} SYP for "${product.title}" (x${qty}) from ${seller.store_name} is confirmed.\n` +
    `Paylo holds the funds until your order is delivered.\n\nTrack your order: ${appUrl('/track/' + code)}\n\n— Paylo`);
  const sellerUser = db.prepare('SELECT email FROM users WHERE id = ?').get(seller.user_id) as { email: string };
  await sendEmail(sellerUser.email, `Paylo — new order ${code} to fulfill`,
    `New paid order ${code}: "${product.title}" x${qty} — ${confirmed.buyer_name}, ${confirmed.governorate}.\n` +
    `Prepare the parcel and mark it as handed off in your dashboard: ${appUrl('/seller/orders/' + id)}\n\n— Paylo`);
  return { ok: true, order: confirmed };
}

/** Seller confirms the parcel physically left their hands. Required step — never automatic. */
export async function sellerHandOff(order: Order, sellerId: string, ref: string) {
  if (order.seller_id !== sellerId) throw new OrderError('Not your order');
  transition(order, 'handed_off', 'seller', ref || null, { handed_off_at: nowIso(), fulfillment_ref: ref || null });
  const fresh = getOrder(order.id)!;
  const how = fresh.fulfillment_method === 'logistics_pickup'
    ? `It was handed to our logistics partner. We will email you when it is ready for pickup.`
    : `It is on its way with a courier in Damascus.`;
  await sendEmail(fresh.buyer_email, `Paylo — order ${fresh.code} has been shipped`,
    `Hi ${fresh.buyer_name},\n\nYour order ${fresh.code} has left the seller. ${how}\n\nTrack: ${appUrl('/track/' + fresh.code)}\n\n— Paylo`);
}

/** Admin-side delivery operations. */
export function adminSetFulfillment(order: Order, method: FulfillmentMethod, ref: string | null) {
  if (['delivered', 'refunded', 'cancelled', 'payment_failed'].includes(order.status)) throw new OrderError('Order is closed');
  if (method !== 'logistics_pickup' && order.governorate !== DAMASCUS) throw new OrderError('Riders serve Damascus only');
  getDb().prepare('UPDATE orders SET fulfillment_method = ?, fulfillment_ref = COALESCE(?, fulfillment_ref), updated_at = ? WHERE id = ?').run(method, ref, nowIso(), order.id);
  getDb().prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note) VALUES (?, ?, ?, ?, ?)').run(order.id, order.status, order.status, 'admin', `Fulfillment set to ${method}${ref ? ' (' + ref + ')' : ''}`);
}
export async function adminSetInTransit(order: Order, ref: string | null) {
  transition(order, 'in_transit', 'admin', ref, ref ? { fulfillment_ref: ref } : {});
}
export async function adminSetReadyForPickup(order: Order, pickupLocation: string) {
  if (!pickupLocation.trim()) throw new OrderError('Pickup location is required');
  transition(order, 'ready_for_pickup', 'admin', pickupLocation, { pickup_location: pickupLocation });
  const fresh = getOrder(order.id)!;
  await sendEmail(fresh.buyer_email, `Paylo — order ${fresh.code} is ready for pickup`,
    `Hi ${fresh.buyer_name},\n\nYour order ${fresh.code} is ready. Collect it from:\n${pickupLocation}\n\nBring your order code and phone number.\n\n— Paylo`);
}
export async function adminSetDelivered(order: Order, note: string | null) {
  await markDelivered(order, 'admin', note);
}
export async function buyerConfirmReceived(order: Order) {
  if (!['handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status)) throw new OrderError('Cannot confirm now');
  await markDelivered(order, 'buyer', 'Buyer confirmed receipt');
}
async function markDelivered(order: Order, actor: Actor, note: string | null) {
  transition(order, 'delivered', actor, note, { delivered_at: nowIso() });
  const fresh = getOrder(order.id)!;
  await sendEmail(fresh.buyer_email, `Paylo — order ${fresh.code} delivered`,
    `Hi ${fresh.buyer_name},\n\nYour order ${fresh.code} is marked as delivered. If something is wrong, report it within the tracking page: ${appUrl('/track/' + fresh.code)}\n\n— Paylo`);
  const s = getDb().prepare('SELECT u.email FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(fresh.seller_id) as { email: string };
  await sendEmail(s.email, `Paylo — order ${fresh.code} delivered`, `Order ${fresh.code} was delivered. It becomes payout-eligible in the next weekly cycle unless a dispute is opened.\n\n— Paylo`);
}

/** Buyer opens a dispute from the tracking page. Freezes payout eligibility. */
export function openDispute(order: Order, reason: string, description: string | null): Dispute {
  if (!['paid', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered'].includes(order.status)) throw new OrderError('Cannot dispute this order');
  if (order.payout_id) throw new OrderError('Order already paid out');
  if (getOpenDispute(order.id)) throw new OrderError('Dispute already open');
  const db = getDb();
  const id = newId();
  db.transaction(() => {
    db.prepare('INSERT INTO disputes (id, order_id, reason, description) VALUES (?, ?, ?, ?)').run(id, order.id, reason, description);
    transition(order, 'disputed', 'buyer', reason, { pre_dispute_status: order.status });
  })();
  return db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Dispute;
}
export function adminInvestigate(dispute: Dispute, note: string | null) {
  getDb().prepare("UPDATE disputes SET status = 'investigating', admin_note = COALESCE(?, admin_note) WHERE id = ?").run(note, dispute.id);
}

/**
 * Admin resolution. Liability logic per spec:
 *  - never handed off  → platform refunds buyer directly; liability = seller (funds were still held).
 *  - lost after hand-off → platform refunds buyer; liability = logistics (recovered outside the app) or platform (own rider).
 *  - found → delivery continues from where it was.
 *  - dismissed → order returns to its pre-dispute status; no refund.
 */
export async function adminResolveDispute(dispute: Dispute, resolution: 'refund' | 'found' | 'dismiss', liability: Liability, note: string | null) {
  const db = getDb();
  const order = getOrder(dispute.order_id)!;
  if (order.status !== 'disputed') throw new OrderError('Order is not in dispute');
  const back = (order.pre_dispute_status ?? 'paid') as OrderStatus;
  if (resolution === 'refund') {
    await refundOrder(order, 'admin', `Dispute resolved: refund (liability: ${liability})`);
    db.prepare("UPDATE disputes SET status = 'resolved_refund', liability = ?, admin_note = ?, resolved_at = ? WHERE id = ?").run(liability, note, nowIso(), dispute.id);
  } else if (resolution === 'found') {
    transition(order, back, 'admin', 'Dispute resolved: shipment located, delivery continues', { pre_dispute_status: null });
    db.prepare("UPDATE disputes SET status = 'resolved_found', liability = 'none', admin_note = ?, resolved_at = ? WHERE id = ?").run(note, nowIso(), dispute.id);
  } else {
    transition(order, back, 'admin', 'Dispute dismissed', { pre_dispute_status: null });
    db.prepare("UPDATE disputes SET status = 'resolved_dismissed', liability = 'none', admin_note = ?, resolved_at = ? WHERE id = ?").run(note, nowIso(), dispute.id);
  }
  const fresh = getOrder(order.id)!;
  await sendEmail(fresh.buyer_email, `Paylo — update on your report for order ${fresh.code}`,
    `Hi ${fresh.buyer_name},\n\nYour report on order ${fresh.code} has been resolved: ${resolution === 'refund' ? 'a full refund has been issued to your card.' : resolution === 'found' ? 'the shipment was located and delivery continues.' : 'no refund will be issued.'}${note ? '\n\nNote from Paylo: ' + note : ''}\n\n— Paylo`);
}

export async function refundOrder(order: Order, actor: Actor, note: string) {
  if (order.payout_id) throw new OrderError('Order already paid out to seller; refund must be handled manually');
  const db = getDb();
  const captured = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'captured' ORDER BY created_at DESC LIMIT 1").get(order.id) as Payment | undefined;
  if (!captured) throw new OrderError('No captured payment to refund');
  const provider = getPaymentProvider();
  const r = await provider.refund({ providerRef: captured.provider_ref || '', amount: captured.amount, reason: note });
  if (!r.ok) throw new OrderError('Refund failed at provider: ' + (r.failureReason || 'unknown'));
  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(captured.id);
    db.prepare("INSERT INTO payments (id, order_id, provider, provider_ref, amount, status, card_last4, card_brand, raw) VALUES (?, ?, ?, ?, ?, 'refunded', ?, ?, ?)")
      .run(newId(), order.id, provider.name, r.providerRef ?? null, -captured.amount, captured.card_last4, captured.card_brand, r.raw ? JSON.stringify(r.raw) : null);
    // restore stock if the parcel never left the seller
    if (order.status === 'paid' || order.pre_dispute_status === 'paid') {
      db.prepare("UPDATE products SET stock = stock + ?, status = CASE WHEN status = 'out_of_stock' THEN 'active' ELSE status END WHERE id = ?").run(order.quantity, order.product_id);
    }
    transition(order, 'refunded', actor, note, { refunded_at: nowIso(), pre_dispute_status: null });
  })();
  const fresh = getOrder(order.id)!;
  await sendEmail(fresh.buyer_email, `Paylo — refund issued for order ${fresh.code}`,
    `Hi ${fresh.buyer_name},\n\n${captured.amount} SYP has been refunded to your card ending ${captured.card_last4 ?? '••••'}. It may take a few days to appear.\n\n— Paylo`);
}

/* ------------------------------ Payouts ------------------------------ */

/** Orders that may be included in the next weekly payout cycle. */
export function payoutEligibleOrders(sellerId?: string): Order[] {
  const hold = parseInt(getSetting('payout_hold_days'), 10) || 0;
  const rows = getDb().prepare(`
    SELECT o.* FROM orders o
    WHERE o.status = 'delivered' AND o.payout_id IS NULL
      AND datetime(o.delivered_at, '+' || ? || ' days') <= datetime('now')
      AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id AND d.status IN ('open','investigating'))
      ${sellerId ? 'AND o.seller_id = ?' : ''}
    ORDER BY o.delivered_at ASC`).all(...(sellerId ? [hold, sellerId] : [hold])) as Order[];
  return rows;
}
/** Paid orders whose funds are still held (not delivered, or disputed). */
export function heldOrders(sellerId?: string): Order[] {
  return getDb().prepare(`
    SELECT o.* FROM orders o
    WHERE o.payout_id IS NULL AND o.status IN ('paid','handed_off','in_transit','ready_for_pickup','disputed','delivered')
      AND o.id NOT IN (${payoutEligibleOrders(sellerId).map(() => '?').join(',') || "''"})
      ${sellerId ? 'AND o.seller_id = ?' : ''}
    ORDER BY o.created_at DESC`).all(...payoutEligibleOrders(sellerId).map((o) => o.id), ...(sellerId ? [sellerId] : [])) as Order[];
}

/** Generates one pending payout per seller for all currently eligible orders. Idempotent per order. */
export function generateWeeklyPayouts(): number {
  const db = getDb();
  const eligible = payoutEligibleOrders();
  const bySeller = new Map<string, Order[]>();
  for (const o of eligible) bySeller.set(o.seller_id, [...(bySeller.get(o.seller_id) ?? []), o]);
  const now = new Date();
  const label = `Week of ${now.toISOString().slice(0, 10)}`;
  let count = 0;
  db.transaction(() => {
    for (const [sellerId, orders] of bySeller) {
      const id = newId();
      const gross = orders.reduce((s, o) => s + o.subtotal, 0);
      const commission = orders.reduce((s, o) => s + o.commission_amount, 0);
      db.prepare('INSERT INTO payouts (id, seller_id, period_label, order_count, gross, commission, amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, sellerId, label, orders.length, gross, commission, gross - commission);
      const upd = db.prepare('UPDATE orders SET payout_id = ?, updated_at = ? WHERE id = ? AND payout_id IS NULL');
      for (const o of orders) upd.run(id, nowIso(), o.id);
      count++;
    }
  })();
  return count;
}
export async function markPayoutPaid(payoutId: string, reference: string | null) {
  const db = getDb();
  db.prepare("UPDATE payouts SET status = 'paid', reference = ?, paid_at = ? WHERE id = ? AND status = 'pending'").run(reference, nowIso(), payoutId);
  const p = db.prepare('SELECT p.*, u.email, s.store_name FROM payouts p JOIN sellers s ON s.id = p.seller_id JOIN users u ON u.id = s.user_id WHERE p.id = ?').get(payoutId) as { email: string; amount: number; period_label: string; store_name: string } | undefined;
  if (p) await sendEmail(p.email, `Paylo — payout sent (${p.period_label})`, `Hi ${p.store_name},\n\nA payout of ${p.amount} SYP has been sent${reference ? ' (ref: ' + reference + ')' : ''}.\n\n— Paylo`);
}
