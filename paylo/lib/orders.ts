import { getDb, getSetting, newId, newOrderCode, nowIso } from './db';
import { audit } from './audit';
import { notify, appUrl } from './notify';
import { emitWebhook } from './webhooks';
import { computeFees } from './fees';
import { currentCutoff, isoDay, isoStamp, nextTransferDate } from './payouts-schedule';
import { getPaymentProvider, type CardInput } from './payments';
import {
  DAMASCUS, STATE_OF_STATUS,
  type AddressChangeRequest, type BankTransfer, type Dispute, type FulfillmentMethod, type Liability,
  type Order, type OrderEvent, type OrderState, type OrderStatus, type Payment, type PaymentMethod,
  type Payout, type Product, type ProductVariant, type Seller,
} from './types';

export type Actor = 'buyer' | 'seller' | 'admin' | 'system' | 'api';
export class OrderError extends Error {}

/**
 * Order state machine (Full Spec v2 §4.2).
 *
 *   awaiting_payment ─► confirmed ─► handed_off ─► in_transit ──────┐
 *   (bank transfer)    (payable /   (seller       (rider / Yalla Go)│
 *                       COD taken)   hand-off)                      ▼
 *                                         └─► ready_for_pickup ─► delivered
 *   any post-payment status ─► disputed ─► back to previous | refunded
 *
 * `order_state` (open/closed/cancelled/returned) is derived from the status, except
 * while disputed, when the pre-dispute state is preserved.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ['confirmed', 'payment_failed', 'cancelled'],
  payment_failed: [],
  confirmed: ['handed_off', 'delivered', 'disputed', 'refunded', 'cancelled'],
  handed_off: ['in_transit', 'ready_for_pickup', 'delivered', 'disputed', 'refunded'],
  in_transit: ['ready_for_pickup', 'delivered', 'disputed', 'refunded'],
  ready_for_pickup: ['delivered', 'disputed', 'refunded'],
  delivered: ['disputed', 'refunded'],
  disputed: ['confirmed', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered', 'refunded'],
  refunded: [],
  cancelled: [],
};

/* ------------------------------- reads ------------------------------- */

export const getOrder = (id: string) => getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order | undefined;
export const getOrderByCode = (code: string) => getDb().prepare('SELECT * FROM orders WHERE upper(code) = upper(?)').get(code.trim()) as Order | undefined;
export const getOrderEvents = (orderId: string) => getDb().prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC').all(orderId) as OrderEvent[];
export const getOrderPayments = (orderId: string) => getDb().prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC').all(orderId) as Payment[];
export const getOrderDisputes = (orderId: string) => getDb().prepare('SELECT * FROM disputes WHERE order_id = ? ORDER BY created_at DESC').all(orderId) as Dispute[];
export const getBankTransfer = (orderId: string) => getDb().prepare('SELECT * FROM bank_transfers WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(orderId) as BankTransfer | undefined;
export const getAddressRequest = (orderId: string) => getDb().prepare("SELECT * FROM address_change_requests WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").get(orderId) as AddressChangeRequest | undefined;
export const getOpenDispute = (orderId: string) => getDb().prepare("SELECT * FROM disputes WHERE order_id = ? AND status IN ('open','investigating') ORDER BY created_at DESC LIMIT 1").get(orderId) as Dispute | undefined;
export const getSellerOf = (order: Order) => getDb().prepare('SELECT * FROM sellers WHERE id = ?').get(order.seller_id) as Seller;
const sellerEmail = (sellerId: string) => (getDb().prepare('SELECT u.email, u.name FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sellerId) as { email: string; name: string } | undefined);

/* ---------------------------- transitions ---------------------------- */

function stateFor(status: OrderStatus, order: Order): OrderState {
  if (status === 'disputed') return (order.pre_dispute_state ?? order.order_state) as OrderState;
  if (status === 'refunded') {
    // Refund before fulfilment voids the order; after fulfilment it is a return (v2 §4.2).
    const wasClosed = (order.pre_dispute_state ?? order.order_state) === 'closed';
    return wasClosed ? 'returned' : 'cancelled';
  }
  return STATE_OF_STATUS[status];
}

function transition(order: Order, to: OrderStatus, actor: Actor, note?: string | null, extra: Partial<Order> = {}) {
  if (!TRANSITIONS[order.status].includes(to)) {
    throw new OrderError(`Cannot move order ${order.code} from ${order.status} to ${to}`);
  }
  const toState = stateFor(to, order);
  const db = getDb();
  const sets = ['status = ?', 'order_state = ?', 'updated_at = ?'];
  const vals: unknown[] = [to, toState, nowIso()];
  if (toState === 'closed' && order.order_state !== 'closed') { sets.push('closed_at = ?'); vals.push(nowIso()); }
  if (toState === 'cancelled') { sets.push('cancelled_at = ?'); vals.push(nowIso()); }
  if (toState === 'returned') { sets.push('returned_at = ?'); vals.push(nowIso()); }
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(v); }
  vals.push(order.id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  db.prepare('INSERT INTO order_events (order_id, from_status, to_status, from_state, to_state, actor, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(order.id, order.status, to, order.order_state, toState, actor, note ?? null);
  audit(actor, null, actor, 'order', order.id, `status:${order.status}->${to}`, { state: toState, note: note ?? undefined });
}

export function defaultFulfillment(governorate: string, isDigital: boolean): FulfillmentMethod {
  if (isDigital) return 'digital';
  return governorate === DAMASCUS ? 'platform_rider' : 'logistics_pickup';
}

/* ------------------------------ checkout ----------------------------- */

export interface CheckoutInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string;
  governorate: string;
  address: string;
  note?: string;
  paymentMethod: PaymentMethod;
  card?: CardInput;
  /** Set only when the buyer is signed in to a customer account at checkout — never
   * required. The order always keeps its own buyer_name/phone/email/address copy
   * regardless, so this is purely "which account, if any, gets this in its history." */
  userId?: string | null;
}
export type CheckoutResult = { ok: true; order: Order } | { ok: false; error: string; order?: Order };

/**
 * Creates the order and applies the payment method.
 *   cod           — no money moves now; the order is immediately fulfillable.
 *   bank_transfer — order waits at `awaiting_payment` until an admin confirms the proof.
 *   card          — charged through the provider abstraction; only reachable when the
 *                   Phase-2 rail is switched on (v2 §3).
 * Stock is reserved at placement for every method, so the last unit cannot be oversold.
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(input.productId) as Product | undefined;
  if (!product || product.status !== 'active') return { ok: false, error: 'product_unavailable' };
  const seller = db.prepare('SELECT * FROM sellers WHERE id = ?').get(product.seller_id) as Seller | undefined;
  if (!seller || seller.status !== 'approved' || !seller.visible) return { ok: false, error: 'product_unavailable' };
  if (!paymentMethodEnabled(input.paymentMethod)) return { ok: false, error: 'payment_method_unavailable' };

  let variant: ProductVariant | undefined;
  if (input.variantId) {
    variant = db.prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?').get(input.variantId, product.id) as ProductVariant | undefined;
    if (!variant) return { ok: false, error: 'product_unavailable' };
  } else if (db.prepare('SELECT count(*) c FROM product_variants WHERE product_id = ?').get(product.id) as { c: number }) {
    const c = (db.prepare('SELECT count(*) c FROM product_variants WHERE product_id = ?').get(product.id) as { c: number }).c;
    if (c > 0) return { ok: false, error: 'variant_required' };
  }

  const isDigital = product.type === 'digital';
  const qty = Math.max(1, Math.floor(input.quantity));
  const available = variant ? variant.stock : product.stock;
  if (!isDigital && qty > available) return { ok: false, error: 'qty_exceeds' };

  const unitPrice = variant ? variant.price : product.price;
  const subtotal = unitPrice * qty;
  const deliveryFee = isDigital ? 0 : parseInt(getSetting(input.governorate === DAMASCUS ? 'delivery_fee_damascus' : 'delivery_fee_other'), 10) || 0;
  const fees = computeFees(subtotal);
  const total = subtotal + deliveryFee;
  const id = newId();
  const code = newOrderCode();
  const initialStatus: OrderStatus = input.paymentMethod === 'bank_transfer' ? 'awaiting_payment' : input.paymentMethod === 'card' ? 'awaiting_payment' : 'confirmed';

  db.transaction(() => {
    db.prepare(`INSERT INTO orders (
        id, code, seller_id, product_id, user_id, product_title, product_type, variant_id, variant_label, unit_price, quantity,
        subtotal, delivery_fee, total, commission_rate, commission_fixed, commission_vat, commission_amount, seller_net,
        buyer_name, buyer_phone, buyer_email, governorate, address, note, payment_method, payment_status,
        fulfillment_method, order_state, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'open', ?)`).run(
      id, code, seller.id, product.id, input.userId || null, product.title, product.type, variant?.id ?? null, variant?.label ?? null, unitPrice, qty,
      subtotal, deliveryFee, total, fees.rate, fees.fixed, fees.vat, fees.commission, fees.sellerNet,
      input.buyerName, input.buyerPhone, input.buyerEmail || null, input.governorate, input.address, input.note || null,
      input.paymentMethod, defaultFulfillment(input.governorate, isDigital), initialStatus,
    );
    db.prepare('INSERT INTO order_events (order_id, from_status, to_status, from_state, to_state, actor, note) VALUES (?, NULL, ?, NULL, ?, ?, ?)')
      .run(id, initialStatus, 'open', 'buyer', `Placed via ${input.paymentMethod}`);
    if (!isDigital) reserveStock(product.id, variant?.id ?? null, qty);
  })();

  audit('buyer', input.userId || null, input.buyerName, 'order', id, 'created', { code, method: input.paymentMethod, total });
  const order0 = getOrder(id)!;

  if (input.paymentMethod === 'card') {
    const provider = getPaymentProvider();
    const result = await provider.charge({ orderId: id, orderCode: code, amount: total, currency: 'SYP', card: input.card!, description: `Paylo order ${code}` });
    db.prepare(`INSERT INTO payments (id, order_id, method, provider, provider_ref, amount, status, card_last4, card_brand, failure_reason, raw)
      VALUES (?, ?, 'card', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      newId(), id, provider.name, result.providerRef ?? null, total, result.ok ? 'captured' : 'failed',
      result.cardLast4 ?? null, result.cardBrand ?? null, result.failureReason ?? null, result.raw ? JSON.stringify(result.raw) : null);
    if (!result.ok) {
      db.transaction(() => {
        transition(order0, 'payment_failed', 'system', result.failureReason);
        if (!isDigital) releaseStock(product.id, variant?.id ?? null, qty);
      })();
      return { ok: false, error: result.failureReason || 'generic', order: getOrder(id) };
    }
    await markPaymentConfirmed(getOrder(id)!, 'system', `Card ${result.cardBrand ?? ''} •••• ${result.cardLast4 ?? ''}`);
  } else if (input.paymentMethod === 'bank_transfer') {
    db.prepare('INSERT INTO bank_transfers (id, order_id, amount) VALUES (?, ?, ?)').run(newId(), id, total);
    db.prepare("INSERT INTO payments (id, order_id, method, provider, amount, status) VALUES (?, ?, 'bank_transfer', 'manual', ?, 'pending')").run(newId(), id, total);
    await notifyOrderPlaced(getOrder(id)!, seller, true);
  } else {
    db.prepare("INSERT INTO payments (id, order_id, method, provider, amount, status) VALUES (?, ?, 'cod', 'courier', ?, 'pending')").run(newId(), id, total);
    if (isDigital) throw new OrderError('Digital products cannot be sold cash on delivery');
    await notifyOrderPlaced(getOrder(id)!, seller, false);
  }

  const final = getOrder(id)!;
  await emitWebhook('order.created', publicOrder(final), final.seller_id);
  if (isDigital && final.status === 'confirmed') await autoDeliverDigital(final);
  return { ok: true, order: getOrder(id)! };
}

function reserveStock(productId: string, variantId: string | null, qty: number) {
  const db = getDb();
  if (variantId) db.prepare('UPDATE product_variants SET stock = max(0, stock - ?) WHERE id = ?').run(qty, variantId);
  db.prepare("UPDATE products SET stock = max(0, stock - ?), updated_at = ? WHERE id = ?").run(qty, nowIso(), productId);
  syncProductStockStatus(productId);
}
function releaseStock(productId: string, variantId: string | null, qty: number) {
  const db = getDb();
  if (variantId) db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?').run(qty, variantId);
  db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?').run(qty, nowIso(), productId);
  syncProductStockStatus(productId);
}
/** Auto-deactivate at zero stock, reactivate when stock returns (physical products only). */
export function syncProductStockStatus(productId: string) {
  const db = getDb();
  const p = db.prepare('SELECT type, stock, status FROM products WHERE id = ?').get(productId) as { type: string; stock: number; status: string } | undefined;
  if (!p || p.type === 'digital' || p.status === 'removed' || p.status === 'inactive') return;
  const next = p.stock <= 0 ? 'out_of_stock' : 'active';
  if (next !== p.status) db.prepare('UPDATE products SET status = ? WHERE id = ?').run(next, productId);
}

async function notifyOrderPlaced(order: Order, seller: Seller, awaitingPayment: boolean) {
  const su = sellerEmail(seller.id);
  const track = appUrl('/track/' + order.code);
  await notify({
    event: 'order.placed',
    email: order.buyer_email ? { to: order.buyer_email, subject: `Paylo — order ${order.code} received`,
      body: `Hi ${order.buyer_name},\n\nYour order ${order.code} from ${seller.store_name} has been received.\n` +
        (awaitingPayment ? `We are waiting for your bank transfer. Upload the receipt on your tracking page to speed it up.\n` : `You will pay the courier on delivery.\n`) +
        `\nTrack it: ${track}\n\n— Paylo` } : undefined,
    sms: { to: order.buyer_phone, body: `Paylo: order ${order.code} received. Track it at ${track}` },
  });
  if (su) await notify({ event: 'order.placed.seller', email: { to: su.email, subject: `Paylo — new order ${order.code}`,
    body: `New order ${order.code}: "${order.product_title}"${order.variant_label ? ' (' + order.variant_label + ')' : ''} ×${order.quantity} for ${order.buyer_name}, ${order.governorate}.\n` +
      (awaitingPayment ? 'Payment is not confirmed yet — do not ship until it is.\n' : 'Cash on delivery. Prepare the parcel and mark it handed off.\n') +
      `\n${appUrl('/seller/orders/' + order.id)}\n\n— Paylo` } });
}

/* --------------------------- payment events -------------------------- */

export async function markPaymentConfirmed(order: Order, actor: Actor, note: string) {
  const db = getDb();
  db.prepare("UPDATE orders SET payment_status = 'confirmed', paid_at = ? WHERE id = ?").run(nowIso(), order.id);
  if (order.status === 'awaiting_payment') transition(getOrder(order.id)!, 'confirmed', actor, note);
  audit(actor, null, actor, 'order', order.id, 'payment.confirmed', note);
  const fresh = getOrder(order.id)!;
  await notify({
    event: 'payment.confirmed',
    email: fresh.buyer_email ? { to: fresh.buyer_email, subject: `Paylo — payment confirmed for ${fresh.code}`,
      body: `Hi ${fresh.buyer_name},\n\nWe have confirmed payment for order ${fresh.code}. The seller is preparing it now.\n\n${appUrl('/track/' + fresh.code)}\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: payment confirmed for order ${fresh.code}.` },
  });
  await emitWebhook('order.updated', publicOrder(fresh), fresh.seller_id);
  if (fresh.product_type === 'digital') await autoDeliverDigital(fresh);
}

/** Buyer uploads their transfer receipt from the tracking page. */
export function submitTransferProof(order: Order, reference: string, proofPath: string | null) {
  const bt = getBankTransfer(order.id);
  if (!bt) throw new OrderError('No bank transfer on this order');
  if (bt.status === 'confirmed') throw new OrderError('Already confirmed');
  getDb().prepare("UPDATE bank_transfers SET reference = ?, proof_path = COALESCE(?, proof_path), status = 'submitted', submitted_at = ? WHERE id = ?")
    .run(reference || null, proofPath, nowIso(), bt.id);
  audit('buyer', null, order.buyer_name, 'order', order.id, 'transfer.proof_submitted', { reference });
}

export async function reviewTransfer(order: Order, approve: boolean, note: string | null) {
  const bt = getBankTransfer(order.id);
  if (!bt) throw new OrderError('No bank transfer on this order');
  const db = getDb();
  db.prepare('UPDATE bank_transfers SET status = ?, admin_note = ?, reviewed_at = ? WHERE id = ?')
    .run(approve ? 'confirmed' : 'rejected', note, nowIso(), bt.id);
  if (approve) {
    db.prepare("UPDATE payments SET status = 'captured', provider_ref = ? WHERE order_id = ? AND method = 'bank_transfer'").run(bt.reference, order.id);
    await markPaymentConfirmed(order, 'admin', `Bank transfer confirmed${bt.reference ? ' (' + bt.reference + ')' : ''}`);
  } else {
    audit('admin', null, 'admin', 'order', order.id, 'transfer.rejected', note);
    await notify({ event: 'transfer.rejected', email: order.buyer_email ? { to: order.buyer_email,
      subject: `Paylo — we could not match your transfer for ${order.code}`,
      body: `Hi ${order.buyer_name},\n\nWe could not match the transfer for order ${order.code}.${note ? '\n\n' + note : ''}\nUpload a clearer receipt here: ${appUrl('/track/' + order.code)}\n\n— Paylo` } : undefined,
      sms: { to: order.buyer_phone, body: `Paylo: we could not match your transfer for ${order.code}. See ${appUrl('/track/' + order.code)}` } });
  }
}

/** Rider or logistics partner has handed the collected cash to Paylo. Unlocks COD payout. */
export function markCodCollected(order: Order, note: string | null) {
  if (order.payment_method !== 'cod') throw new OrderError('Not a cash-on-delivery order');
  const db = getDb();
  db.prepare("UPDATE orders SET payment_status = 'collected_cod', paid_at = COALESCE(paid_at, ?) WHERE id = ?").run(nowIso(), order.id);
  db.prepare("UPDATE payments SET status = 'captured' WHERE order_id = ? AND method = 'cod'").run(order.id);
  audit('admin', null, 'admin', 'order', order.id, 'cod.collected', note);
}

/* --------------------------- fulfilment ------------------------------ */

/** Digital goods have no courier step: confirmed payment closes the order immediately. */
async function autoDeliverDigital(order: Order) {
  if (order.product_type !== 'digital' || order.status !== 'confirmed') return;
  const product = getDb().prepare('SELECT digital_note FROM products WHERE id = ?').get(order.product_id) as { digital_note: string | null } | undefined;
  transition(order, 'delivered', 'system', 'Digital delivery', { delivered_at: nowIso(), handed_off_at: nowIso(), closed_at: nowIso() });
  const fresh = getOrder(order.id)!;
  await notify({ event: 'order.delivered', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — your download for ${fresh.code}`,
    body: `Hi ${fresh.buyer_name},\n\nYour order ${fresh.code} is ready.\n\n${product?.digital_note || 'The seller will contact you with the files.'}\n\n${appUrl('/track/' + fresh.code)}\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: order ${fresh.code} delivered. ${appUrl('/track/' + fresh.code)}` } });
  await emitWebhook('order.closed', publicOrder(fresh), fresh.seller_id);
}

/** Seller confirms the parcel physically left their hands. This is what closes the order. */
export async function sellerHandOff(order: Order, sellerId: string, ref: string, tracking: string) {
  if (order.seller_id !== sellerId) throw new OrderError('Not your order');
  if (order.payment_method === 'bank_transfer' && order.payment_status !== 'confirmed') throw new OrderError('Payment is not confirmed yet');
  transition(order, 'handed_off', 'seller', ref || null, { handed_off_at: nowIso(), fulfillment_ref: ref || null, tracking_number: tracking || null });
  const fresh = getOrder(order.id)!;
  const how = fresh.fulfillment_method === 'logistics_pickup'
    ? 'It is with our logistics partner. We will tell you when it is ready to collect.'
    : 'It is on its way with a courier in Damascus.';
  await notify({ event: 'order.shipped', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — order ${fresh.code} is on its way`,
    body: `Hi ${fresh.buyer_name},\n\nOrder ${fresh.code} has left the seller. ${how}${tracking ? `\nTracking: ${tracking}` : ''}\n\n${appUrl('/track/' + fresh.code)}\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: order ${fresh.code} shipped.${tracking ? ' Tracking ' + tracking : ''} ${appUrl('/track/' + fresh.code)}` } });
  await emitWebhook('order.closed', publicOrder(fresh), fresh.seller_id);
}

export function adminSetFulfillment(order: Order, method: FulfillmentMethod, ref: string | null) {
  if (['delivered', 'refunded', 'cancelled', 'payment_failed'].includes(order.status)) throw new OrderError('Order is closed');
  if (method !== 'logistics_pickup' && method !== 'digital' && order.governorate !== DAMASCUS) throw new OrderError('Riders serve Damascus only');
  getDb().prepare('UPDATE orders SET fulfillment_method = ?, fulfillment_ref = COALESCE(?, fulfillment_ref), updated_at = ? WHERE id = ?').run(method, ref, nowIso(), order.id);
  getDb().prepare('INSERT INTO order_events (order_id, from_status, to_status, from_state, to_state, actor, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(order.id, order.status, order.status, order.order_state, order.order_state, 'admin', `Fulfillment set to ${method}${ref ? ' (' + ref + ')' : ''}`);
  audit('admin', null, 'admin', 'order', order.id, 'fulfillment.changed', { method, ref });
}

export async function adminSetInTransit(order: Order, ref: string | null) {
  transition(order, 'in_transit', 'admin', ref, ref ? { fulfillment_ref: ref } : {});
  await emitWebhook('order.updated', publicOrder(getOrder(order.id)!), order.seller_id);
}

export async function adminSetReadyForPickup(order: Order, pickupLocation: string) {
  if (!pickupLocation.trim()) throw new OrderError('Pickup location is required');
  transition(order, 'ready_for_pickup', 'admin', pickupLocation, { pickup_location: pickupLocation });
  const fresh = getOrder(order.id)!;
  await notify({ event: 'order.ready_for_pickup', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — order ${fresh.code} is ready for pickup`,
    body: `Hi ${fresh.buyer_name},\n\nOrder ${fresh.code} is ready. Collect it from:\n${pickupLocation}\n\nBring your order code and phone number.\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: order ${fresh.code} ready for pickup at ${pickupLocation}` } });
  await emitWebhook('order.updated', publicOrder(fresh), fresh.seller_id);
}

export async function adminSetDelivered(order: Order, note: string | null) { await markDelivered(order, 'admin', note); }
export async function buyerConfirmReceived(order: Order) {
  if (!['handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status)) throw new OrderError('Cannot confirm now');
  await markDelivered(order, 'buyer', 'Buyer confirmed receipt');
}

async function markDelivered(order: Order, actor: Actor, note: string | null) {
  transition(order, 'delivered', actor, note, { delivered_at: nowIso() });
  // Cash-on-delivery: delivery is also the moment the money is collected from the buyer.
  if (order.payment_method === 'cod' && order.payment_status === 'pending') markCodCollected(getOrder(order.id)!, 'Collected on delivery');
  const fresh = getOrder(order.id)!;
  await notify({ event: 'order.delivered', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — order ${fresh.code} delivered`,
    body: `Hi ${fresh.buyer_name},\n\nOrder ${fresh.code} is marked delivered. If something is wrong, open a return from ${appUrl('/track/' + fresh.code)}\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: order ${fresh.code} delivered.` } });
  const su = sellerEmail(fresh.seller_id);
  if (su) await notify({ event: 'order.delivered.seller', email: { to: su.email, subject: `Paylo — order ${fresh.code} delivered`,
    body: `Order ${fresh.code} was delivered and joins the next payout run unless a return is opened.\n\n— Paylo` } });
  await emitWebhook('order.closed', publicOrder(fresh), fresh.seller_id);
}

export async function cancelOrder(order: Order, actor: Actor, reason: string) {
  if (!TRANSITIONS[order.status].includes('cancelled')) throw new OrderError('This order can no longer be cancelled');
  const db = getDb();
  db.transaction(() => {
    transition(order, 'cancelled', actor, reason);
    if (order.product_type !== 'digital') releaseStock(order.product_id, order.variant_id, order.quantity);
  })();
  const fresh = getOrder(order.id)!;
  await notify({ event: 'order.cancelled', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — order ${fresh.code} cancelled`, body: `Order ${fresh.code} has been cancelled.${reason ? '\n\n' + reason : ''}\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: order ${fresh.code} cancelled.` } });
  await emitWebhook('order.updated', publicOrder(fresh), fresh.seller_id);
}

/* ------------------------ address change (buyer) --------------------- */

export function requestAddressChange(order: Order, newAddress: string, newGovernorate: string) {
  const windowH = parseInt(getSetting('address_change_window_hours'), 10) || 24;
  const placed = new Date(order.created_at.replace(' ', 'T') + 'Z').getTime();
  if (Date.now() - placed > windowH * 3600_000) throw new OrderError('The address-change window has closed');
  if (!['awaiting_payment', 'confirmed'].includes(order.status)) throw new OrderError('The parcel has already left the seller');
  if (getAddressRequest(order.id)?.status === 'pending') throw new OrderError('A request is already pending');
  const id = newId();
  getDb().prepare('INSERT INTO address_change_requests (id, order_id, new_address, new_governorate) VALUES (?, ?, ?, ?)')
    .run(id, order.id, newAddress, newGovernorate);
  audit('buyer', null, order.buyer_name, 'order', order.id, 'address_change.requested', { newGovernorate });
}

export async function reviewAddressChange(order: Order, approve: boolean, note: string | null) {
  const req = getAddressRequest(order.id);
  if (!req || req.status !== 'pending') throw new OrderError('No pending request');
  const db = getDb();
  db.prepare('UPDATE address_change_requests SET status = ?, admin_note = ?, resolved_at = ? WHERE id = ?')
    .run(approve ? 'approved' : 'rejected', note, nowIso(), req.id);
  if (approve) {
    // A governorate change moves the order between delivery models, so the fee and route follow it.
    const fee = parseInt(getSetting(req.new_governorate === DAMASCUS ? 'delivery_fee_damascus' : 'delivery_fee_other'), 10) || 0;
    const method = defaultFulfillment(req.new_governorate, order.product_type === 'digital');
    db.prepare('UPDATE orders SET address = ?, governorate = ?, delivery_fee = ?, total = subtotal + ?, fulfillment_method = ?, updated_at = ? WHERE id = ?')
      .run(req.new_address, req.new_governorate, fee, fee, method, nowIso(), order.id);
    db.prepare('INSERT INTO order_events (order_id, from_status, to_status, from_state, to_state, actor, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(order.id, order.status, order.status, order.order_state, order.order_state, 'admin', `Address changed to ${req.new_governorate}`);
  }
  audit('admin', null, 'admin', 'order', order.id, approve ? 'address_change.approved' : 'address_change.rejected', note);
  const fresh = getOrder(order.id)!;
  await notify({ event: 'address_change.reviewed', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — address change for ${fresh.code}`,
    body: `Your address change for order ${fresh.code} was ${approve ? 'applied' : 'not applied'}.${note ? '\n\n' + note : ''}\n\n${appUrl('/track/' + fresh.code)}\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: address change for ${fresh.code} ${approve ? 'applied' : 'declined'}.` } });
}

/* --------------------------- returns & refunds ----------------------- */

/** Buyer opens a return/refund request from the tracking page. Freezes payout eligibility. */
export async function openDispute(order: Order, reason: string, description: string | null): Promise<Dispute> {
  if (!['confirmed', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered'].includes(order.status)) throw new OrderError('Cannot open a return on this order');
  if (order.payout_id) throw new OrderError('Order already paid out');
  if (getOpenDispute(order.id)) throw new OrderError('A request is already open');
  const db = getDb();
  const id = newId();
  const kind = order.status === 'delivered' ? 'return' : reason === 'not_received' ? 'not_received' : 'other';
  db.transaction(() => {
    db.prepare('INSERT INTO disputes (id, order_id, kind, reason, description) VALUES (?, ?, ?, ?, ?)').run(id, order.id, kind, reason, description);
    transition(order, 'disputed', 'buyer', reason, { pre_dispute_status: order.status, pre_dispute_state: order.order_state });
  })();
  audit('buyer', null, order.buyer_name, 'dispute', id, 'opened', { order: order.code, reason });
  const su = sellerEmail(order.seller_id);
  if (su) await notify({ event: 'refund.created', email: { to: su.email, subject: `Paylo — return opened on ${order.code}`,
    body: `The buyer opened a return request on order ${order.code} (${reason}). Paylo is reviewing it.\n\n— Paylo` } });
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Dispute;
  await emitWebhook('refund.created', { order: publicOrder(getOrder(order.id)!), dispute: d }, order.seller_id);
  return d;
}

export function adminInvestigate(dispute: Dispute, note: string | null) {
  getDb().prepare("UPDATE disputes SET status = 'investigating', admin_note = COALESCE(?, admin_note) WHERE id = ?").run(note, dispute.id);
  audit('admin', null, 'admin', 'dispute', dispute.id, 'investigating', note);
}

/**
 * Admin resolution, liability recorded for accounting:
 *   never handed off   → platform refunds the buyer; liability sits with the seller.
 *   lost after hand-off → platform refunds the buyer; liability sits with the logistics
 *                         partner (recovered outside the app) or with Paylo's own rider.
 *   found              → delivery resumes from where it stopped.
 *   dismissed          → order returns to its pre-dispute status, no refund.
 */
export async function adminResolveDispute(dispute: Dispute, resolution: 'refund' | 'found' | 'dismiss', liability: Liability, note: string | null) {
  const db = getDb();
  const order = getOrder(dispute.order_id)!;
  if (order.status !== 'disputed') throw new OrderError('Order is not in dispute');
  const back = (order.pre_dispute_status ?? 'confirmed') as OrderStatus;
  if (resolution === 'refund') {
    await refundOrder(order, 'admin', `Return resolved: refund (liability: ${liability})`);
    db.prepare("UPDATE disputes SET status = 'resolved_refund', liability = ?, admin_note = ?, resolved_at = ? WHERE id = ?").run(liability, note, nowIso(), dispute.id);
  } else {
    const status = resolution === 'found' ? 'resolved_found' : 'resolved_dismissed';
    transition(order, back, 'admin', resolution === 'found' ? 'Shipment located, delivery continues' : 'Return request dismissed',
      { pre_dispute_status: null, pre_dispute_state: null });
    db.prepare("UPDATE disputes SET status = ?, liability = 'none', admin_note = ?, resolved_at = ? WHERE id = ?").run(status, note, nowIso(), dispute.id);
  }
  audit('admin', null, 'admin', 'dispute', dispute.id, 'resolved:' + resolution, { liability, note });
  const fresh = getOrder(order.id)!;
  const outcome = resolution === 'refund' ? 'a full refund has been issued' : resolution === 'found' ? 'the shipment was located and delivery continues' : 'no refund will be issued';
  await notify({ event: 'refund.updated', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — your return request for ${fresh.code}`,
    body: `Hi ${fresh.buyer_name},\n\nYour return request on order ${fresh.code} is resolved: ${outcome}.${note ? '\n\nNote: ' + note : ''}\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: return on ${fresh.code} resolved — ${outcome}.` } });
  await emitWebhook('refund.updated', { order: publicOrder(fresh), dispute: db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id) }, fresh.seller_id);
}

export async function refundOrder(order: Order, actor: Actor, note: string) {
  if (order.payout_id) throw new OrderError('Order already paid out to the seller; settle this refund manually');
  const db = getDb();
  const captured = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'captured' ORDER BY created_at DESC LIMIT 1").get(order.id) as Payment | undefined;

  if (captured && captured.method === 'card') {
    const provider = getPaymentProvider();
    const r = await provider.refund({ providerRef: captured.provider_ref || '', amount: captured.amount, reason: note });
    if (!r.ok) throw new OrderError('Refund failed at provider: ' + (r.failureReason || 'unknown'));
    db.prepare("INSERT INTO payments (id, order_id, method, provider, provider_ref, amount, status, card_last4, card_brand, raw) VALUES (?, ?, 'card', ?, ?, ?, 'refunded', ?, ?, ?)")
      .run(newId(), order.id, provider.name, r.providerRef ?? null, -captured.amount, captured.card_last4, captured.card_brand, r.raw ? JSON.stringify(r.raw) : null);
  } else if (captured) {
    // Cash and bank transfers are reversed by Paylo operations, outside the app.
    db.prepare("INSERT INTO payments (id, order_id, method, provider, amount, status) VALUES (?, ?, ?, 'manual', ?, 'refunded')")
      .run(newId(), order.id, captured.method, -captured.amount);
  }

  db.transaction(() => {
    if (captured) db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(captured.id);
    db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ?").run(order.id);
    const neverShipped = (order.pre_dispute_status ?? order.status) === 'confirmed' || (order.pre_dispute_status ?? order.status) === 'awaiting_payment';
    if (neverShipped && order.product_type !== 'digital') releaseStock(order.product_id, order.variant_id, order.quantity);
    transition(order, 'refunded', actor, note, { refunded_at: nowIso(), pre_dispute_status: null, pre_dispute_state: null });
  })();
  audit(actor, null, actor, 'order', order.id, 'refunded', note);
  const fresh = getOrder(order.id)!;
  const how = captured?.method === 'card' ? `to your card ending ${captured.card_last4 ?? '••••'}` : 'by the method you paid with';
  await notify({ event: 'refund.issued', email: fresh.buyer_email ? { to: fresh.buyer_email,
    subject: `Paylo — refund for order ${fresh.code}`,
    body: `Hi ${fresh.buyer_name},\n\n${fresh.total} SYP will be refunded ${how}.\n\n— Paylo` } : undefined,
    sms: { to: fresh.buyer_phone, body: `Paylo: refund issued for order ${fresh.code}.` } });
}

/* ------------------------------ payouts ------------------------------ */

/**
 * Payout eligibility. v2 §4.2 puts Closed orders in the pool, but money that has not
 * actually reached Paylo cannot be paid out, so the rule is split by payment method:
 *
 *   cash on delivery → delivered AND the courier has handed the cash in
 *   prepaid          → payment confirmed, then Closed (or delivered, per the
 *                      `payout_eligibility` setting)
 *
 * On top of that: seller KYC approved (v2 §6), no open return, not already paid out,
 * and closed before the cutoff.
 */
export function payoutEligibleOrders(sellerId?: string, cutoff: Date = new Date()): Order[] {
  const onDeliveryOnly = getSetting('payout_eligibility') === 'on_delivery';
  return getDb().prepare(`
    SELECT o.* FROM orders o
      JOIN sellers s ON s.id = o.seller_id
    WHERE o.order_state = 'closed'
      AND o.payout_id IS NULL
      AND s.kyc_status = 'approved'
      AND (
        (o.payment_method = 'cod' AND o.payment_status = 'collected_cod' AND o.status = 'delivered')
        OR (o.payment_method != 'cod' AND o.payment_status = 'confirmed' AND (? = 0 OR o.status = 'delivered'))
      )
      AND coalesce(o.closed_at, o.updated_at) <= ?
      AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id AND d.status IN ('open','investigating'))
      ${sellerId ? 'AND o.seller_id = ?' : ''}
    ORDER BY o.closed_at ASC`)
    .all(...[onDeliveryOnly ? 1 : 0, isoStamp(cutoff), ...(sellerId ? [sellerId] : [])]) as Order[];
}

/** Money earned but not yet releasable: still open, or closed but not yet eligible. */
export function pendingOrders(sellerId: string): Order[] {
  const eligible = new Set(payoutEligibleOrders(sellerId).map((o) => o.id));
  const rows = getDb().prepare(
    "SELECT * FROM orders WHERE seller_id = ? AND payout_id IS NULL AND order_state IN ('open','closed') AND status NOT IN ('cancelled','payment_failed','refunded') ORDER BY created_at DESC",
  ).all(sellerId) as Order[];
  return rows.filter((o) => !eligible.has(o.id));
}

export interface Balances { available: number; pending: number; lifetime: number; nextPayout: string }
export function sellerBalances(sellerId: string): Balances {
  const available = payoutEligibleOrders(sellerId).reduce((s, o) => s + o.seller_net, 0);
  const pending = pendingOrders(sellerId).reduce((s, o) => s + o.seller_net, 0);
  const lifetime = (getDb().prepare("SELECT coalesce(sum(amount),0) s FROM payouts WHERE seller_id = ? AND status = 'paid'").get(sellerId) as { s: number }).s;
  return { available, pending, lifetime, nextPayout: isoDay(nextTransferDate()) };
}

/** One pending payout per seller for everything eligible at the cutoff. Idempotent per order. */
export function generatePayouts(cutoff: Date = new Date()): number {
  const db = getDb();
  const eligible = payoutEligibleOrders(undefined, cutoff);
  const bySeller = new Map<string, Order[]>();
  for (const o of eligible) bySeller.set(o.seller_id, [...(bySeller.get(o.seller_id) ?? []), o]);
  const label = `Cutoff ${isoDay(cutoff)}`;
  let count = 0;
  db.transaction(() => {
    for (const [sellerId, orders] of bySeller) {
      const id = newId();
      const gross = orders.reduce((s, o) => s + o.subtotal, 0);
      const commission = orders.reduce((s, o) => s + o.commission_amount + o.commission_vat, 0);
      db.prepare('INSERT INTO payouts (id, seller_id, period_label, cutoff_at, order_count, gross, commission, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, sellerId, label, isoStamp(cutoff), orders.length, gross, commission, gross - commission);
      const upd = db.prepare('UPDATE orders SET payout_id = ?, updated_at = ? WHERE id = ? AND payout_id IS NULL');
      for (const o of orders) upd.run(id, nowIso(), o.id);
      audit('admin', null, 'admin', 'payout', id, 'generated', { seller: sellerId, orders: orders.length, amount: gross - commission });
      count++;
    }
  })();
  return count;
}

export async function markPayoutPaid(payoutId: string, reference: string | null) {
  const db = getDb();
  db.prepare("UPDATE payouts SET status = 'paid', reference = ?, paid_at = ? WHERE id = ? AND status IN ('pending','failed')").run(reference, nowIso(), payoutId);
  const p = db.prepare('SELECT p.*, u.email, s.store_name FROM payouts p JOIN sellers s ON s.id = p.seller_id JOIN users u ON u.id = s.user_id WHERE p.id = ?')
    .get(payoutId) as (Payout & { email: string; store_name: string }) | undefined;
  if (!p) return;
  audit('admin', null, 'admin', 'payout', payoutId, 'paid', { reference, amount: p.amount });
  await notify({ event: 'payout.sent', email: { to: p.email, subject: `Paylo — payout sent (${p.period_label})`,
    body: `Hi ${p.store_name},\n\nA payout of ${p.amount} SYP has been sent${reference ? ' (ref: ' + reference + ')' : ''}.\n\n— Paylo` } });
  await emitWebhook('payout.sent', { id: p.id, seller_id: p.seller_id, amount: p.amount, reference, period: p.period_label }, p.seller_id);
}

export async function markPayoutFailed(payoutId: string, reason: string) {
  getDb().prepare("UPDATE payouts SET status = 'failed', failure_reason = ? WHERE id = ?").run(reason, payoutId);
  audit('admin', null, 'admin', 'payout', payoutId, 'failed', reason);
}

/** Releases a failed payout's orders back into the pool so the next run picks them up. */
export function reopenPayout(payoutId: string) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE orders SET payout_id = NULL WHERE payout_id = ?').run(payoutId);
    db.prepare('DELETE FROM payouts WHERE id = ? AND status != ?').run(payoutId, 'paid');
  })();
  audit('admin', null, 'admin', 'payout', payoutId, 'reopened');
}

/* ------------------------------ helpers ------------------------------ */

export function paymentMethodEnabled(m: PaymentMethod): boolean {
  if (m === 'card') return getSetting('card_enabled') === '1' && (process.env.PAYMENT_CARD_ENABLED || '0') === '1';
  if (m === 'cod') return getSetting('cod_enabled') !== '0';
  return getSetting('bank_transfer_enabled') !== '0';
}
export function enabledPaymentMethods(isDigital: boolean): PaymentMethod[] {
  const all: PaymentMethod[] = ['cod', 'bank_transfer', 'card'];
  return all.filter((m) => paymentMethodEnabled(m) && !(isDigital && m === 'cod'));
}

/** Shape sent to webhooks and the public API — never includes card or internal fields. */
export function publicOrder(o: Order) {
  return {
    id: o.id, code: o.code, state: o.order_state, status: o.status, payment_method: o.payment_method,
    payment_status: o.payment_status, product: { id: o.product_id, title: o.product_title, variant: o.variant_label, type: o.product_type },
    quantity: o.quantity, subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total, currency: 'SYP',
    commission: o.commission_amount + o.commission_vat, seller_net: o.seller_net,
    buyer: { name: o.buyer_name, phone: o.buyer_phone, email: o.buyer_email, governorate: o.governorate, address: o.address },
    fulfillment: { method: o.fulfillment_method, reference: o.fulfillment_ref, tracking_number: o.tracking_number, pickup_location: o.pickup_location },
    created_at: o.created_at, closed_at: o.closed_at, delivered_at: o.delivered_at,
  };
}

export { currentCutoff, nextTransferDate };
