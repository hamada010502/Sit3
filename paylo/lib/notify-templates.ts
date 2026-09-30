import { getDb } from './db';
import { makeT, type Lang } from './i18n';
import { formatSYP } from './money';

/**
 * Every email / SMS / WhatsApp text Paylo sends, in Arabic or English. Strings live in
 * lib/i18n (keys nt_*), so the two languages stay in sync through the Dict type.
 *
 * Language: buyers get Arabic (no account, no stored preference). Sellers get their
 * preferred_lang setting (default Arabic).
 */
export const buyerLang = (): Lang => 'ar';

/**
 * The seller's explicit choice (Settings → Notifications → "Language of my messages"),
 * default Arabic. The dashboard's AR/EN browsing switch is independent of this.
 */
export function sellerLang(sellerId: string): Lang {
  const r = getDb().prepare('SELECT preferred_lang FROM sellers WHERE id = ?').get(sellerId) as { preferred_lang: string } | undefined;
  return r?.preferred_lang === 'en' ? 'en' : 'ar';
}

export interface Mail { subject: string; body: string }
type Msg = { email: Mail; sms: string };

const kit = (lang: Lang) => {
  const t = makeT(lang);
  const money = (n: number) => formatSYP(n, lang);
  /** Joins non-empty paragraphs and signs off. */
  const body = (...parts: (string | false | null | undefined)[]) => [...parts.filter(Boolean), t('nt_sign')].join('\n\n');
  return { t, money, body };
};

/* ------------------------------- buyers ------------------------------- */

export function buyerOrderPlaced(lang: Lang, p: { name: string; code: string; store: string; awaitingPayment: boolean; sellerNote: string | null; track: string }): Msg {
  const { t, body } = kit(lang);
  return {
    email: { subject: t('nt_placed_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }),
      t('nt_placed_body', { code: p.code, store: p.store }),
      p.awaitingPayment ? t('nt_placed_transfer') : t('nt_placed_cod'),
      p.sellerNote && `${t('nt_placed_seller_note', { store: p.store })}\n${p.sellerNote}`,
      t('nt_track_it', { url: p.track })) },
    sms: t('nt_placed_sms', { code: p.code, url: p.track }),
  };
}

export function buyerPaymentConfirmed(lang: Lang, p: { name: string; code: string; track: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_paid_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), t('nt_paid_body', { code: p.code }), p.track) },
    sms: t('nt_paid_sms', { code: p.code }) };
}

export function buyerTransferRejected(lang: Lang, p: { name: string; code: string; note: string | null; track: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_transfer_rej_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), t('nt_transfer_rej_body', { code: p.code }), p.note, t('nt_transfer_rej_upload', { url: p.track })) },
    sms: t('nt_transfer_rej_sms', { code: p.code, url: p.track }) };
}

export function buyerDigitalReady(lang: Lang, p: { name: string; code: string; digitalNote: string | null; track: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_digital_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), t('nt_digital_body', { code: p.code }), p.digitalNote || t('nt_digital_fallback'), p.track) },
    sms: t('nt_delivered_sms', { code: p.code }) + ' ' + p.track };
}

export function buyerShipped(lang: Lang, p: { name: string; code: string; viaPickupPartner: boolean; tracking: string | null; track: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_shipped_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }),
      t('nt_shipped_body', { code: p.code }) + ' ' + (p.viaPickupPartner ? t('nt_shipped_partner') : t('nt_shipped_courier')),
      p.tracking && t('nt_tracking_no', { n: p.tracking }), p.track) },
    sms: t('nt_shipped_sms', { code: p.code }) + (p.tracking ? ' ' + t('nt_tracking_no', { n: p.tracking }) : '') + ' ' + p.track };
}

export function buyerReadyForPickup(lang: Lang, p: { name: string; code: string; location: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_pickup_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), `${t('nt_pickup_body', { code: p.code })}\n${p.location}`, t('nt_pickup_bring')) },
    sms: t('nt_pickup_sms', { code: p.code, place: p.location }) };
}

export function buyerDelivered(lang: Lang, p: { name: string; code: string; track: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_delivered_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), t('nt_delivered_body', { code: p.code, url: p.track })) },
    sms: t('nt_delivered_sms', { code: p.code }) };
}

export function buyerCancelled(lang: Lang, p: { code: string; reason: string | null }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_cancelled_subject', { code: p.code }), body: body(t('nt_cancelled_body', { code: p.code }), p.reason) },
    sms: t('nt_cancelled_sms', { code: p.code }) };
}

export function buyerAddressReviewed(lang: Lang, p: { code: string; approved: boolean; note: string | null; track: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_address_subject', { code: p.code }), body: body(t(p.approved ? 'nt_address_applied' : 'nt_address_declined', { code: p.code }), p.note, p.track) },
    sms: t(p.approved ? 'nt_address_applied_sms' : 'nt_address_declined_sms', { code: p.code }) };
}

export type ReturnOutcome = 'refund' | 'partial_refund' | 'found' | 'dismissed';
export function buyerReturnResolved(lang: Lang, p: { name: string; code: string; outcome: ReturnOutcome; amount: number; note: string | null }): Msg {
  const { t, money, body } = kit(lang);
  const outcome = p.outcome === 'refund' ? t('nt_outcome_refund') : p.outcome === 'partial_refund' ? t('nt_outcome_partial', { amount: money(p.amount) })
    : p.outcome === 'found' ? t('nt_outcome_found') : t('nt_outcome_dismissed');
  return { email: { subject: t('nt_return_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), t('nt_return_body', { code: p.code, outcome }), p.note && t('nt_note', { note: p.note })) },
    sms: t('nt_return_sms', { code: p.code, outcome }) };
}

const refundHow = (lang: Lang, cardLast4: string | null | undefined) =>
  cardLast4 !== undefined ? makeT(lang)('nt_refund_to_card', { last4: cardLast4 ?? '••••' }) : makeT(lang)('nt_refund_same_method');

/** cardLast4: undefined when not paid by card; null when card digits are unknown. */
export function buyerRefundFull(lang: Lang, p: { name: string; code: string; amount: number; cardLast4?: string | null }): Msg {
  const { t, money, body } = kit(lang);
  return { email: { subject: t('nt_refund_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), t('nt_refund_body', { amount: money(p.amount), how: refundHow(lang, p.cardLast4) })) },
    sms: t('nt_refund_sms', { code: p.code }) };
}

export function buyerRefundPartial(lang: Lang, p: { name: string; code: string; amount: number; cardLast4?: string | null }): Msg {
  const { t, money, body } = kit(lang);
  return { email: { subject: t('nt_partial_subject', { code: p.code }), body: body(t('nt_hi', { name: p.name }), t('nt_partial_body', { amount: money(p.amount), code: p.code, how: refundHow(lang, p.cardLast4) })) },
    sms: t('nt_partial_sms', { amount: money(p.amount), code: p.code }) };
}

export function buyerClaimCode(lang: Lang, p: { code: string; otp: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_claim_subject', { code: p.code }), body: body(t('nt_claim_body', { code: p.code, otp: p.otp })) },
    sms: t('nt_claim_sms', { code: p.code, otp: p.otp }) };
}

/* ------------------------------- sellers ------------------------------ */

export function sellerNewOrder(lang: Lang, p: { code: string; line: string; buyer: string; governorate: string; awaitingPayment: boolean; url: string }): Msg {
  const { t, body } = kit(lang);
  return { email: { subject: t('nt_seller_new_subject', { code: p.code }), body: body(
      t('nt_seller_new_body', { code: p.code, line: p.line, buyer: p.buyer, gov: p.governorate }) + '\n' + (p.awaitingPayment ? t('nt_seller_new_unpaid') : t('nt_seller_new_cod')), p.url) },
    sms: t('nt_seller_new_sms', { code: p.code, line: p.line, url: p.url }) };
}

export function sellerOrderCollected(lang: Lang, p: { code: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t('nt_collected_subject', { code: p.code }), body: body(t('nt_collected_body', { code: p.code })) };
}

export function sellerOrderDelivered(lang: Lang, p: { code: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t('nt_delivered_subject', { code: p.code }), body: body(t('nt_seller_delivered_body', { code: p.code })) };
}

export function sellerReturnOpened(lang: Lang, p: { code: string; reason: string }): Mail {
  const { t, body } = kit(lang);
  const reason = t(`dr_${p.reason}` as 'dr_other');
  return { subject: t('nt_return_opened_subject', { code: p.code }), body: body(t('nt_return_opened_body', { code: p.code, reason })) };
}

export function sellerRefundPartial(lang: Lang, p: { code: string; amount: number; sellerLiable: boolean; reduction: number }): Mail {
  const { t, money, body } = kit(lang);
  return { subject: t('nt_seller_partial_subject', { code: p.code }), body: body(t('nt_seller_partial_body', { amount: money(p.amount), code: p.code }) + ' ' +
    (p.sellerLiable ? t('nt_seller_partial_reduced', { amount: money(p.reduction) }) : t('nt_seller_partial_unchanged'))) };
}

export function sellerPayoutSent(lang: Lang, p: { store: string; amount: number; reference: string | null; period: string }): Mail {
  const { t, money, body } = kit(lang);
  return { subject: t('nt_payout_subject', { period: p.period }), body: body(t('nt_hi', { name: p.store }),
    t('nt_payout_body', { amount: money(p.amount) }) + (p.reference ? ' ' + t('nt_payout_ref', { ref: p.reference }) : '')) };
}

import type { SellerStatus } from './types';
export function sellerAccountStatus(lang: Lang, p: { store: string; status: SellerStatus; note: string | null; storeUrl: string; productsUrl: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t(`nt_account_${p.status}_subject`), body: body(t(`nt_account_${p.status}_body`, { store: p.store }),
    p.status === 'approved' && t('nt_account_approved_links', { store: p.storeUrl, products: p.productsUrl }), p.note && t('nt_note_from_paylo', { note: p.note })) };
}

export function sellerKycReviewed(lang: Lang, p: { store: string; approved: boolean; note: string | null; url: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t(p.approved ? 'nt_kyc_ok_subject' : 'nt_kyc_no_subject'), body: body(t('nt_hi', { name: p.store }), t(p.approved ? 'nt_kyc_ok_body' : 'nt_kyc_no_body'), p.note, p.url) };
}

/* ----------------------------- registration --------------------------- */

export function registrationReceived(lang: Lang, p: { name: string; store: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t('nt_reg_received_subject'), body: body(t('nt_hi', { name: p.name }), t('nt_reg_received_body', { store: p.store }), t('nt_reg_not_active')) };
}

export function registrationApproved(lang: Lang, p: { name: string; store: string; storeUrl: string; loginUrl: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t('nt_reg_approved_subject'), body: body(t('nt_hi', { name: p.name }), t('nt_reg_approved_body', { store: p.store }),
    t('nt_reg_approved_login', { url: p.loginUrl }), t('nt_reg_approved_2fa', { url: p.storeUrl })) };
}

export function registrationRejected(lang: Lang, p: { name: string; store: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t('nt_reg_rejected_subject'), body: body(t('nt_hi', { name: p.name }), t('nt_reg_rejected_body', { store: p.store })) };
}

export function registrationMoreInfo(lang: Lang, p: { name: string; store: string; note: string }): Mail {
  const { t, body } = kit(lang);
  return { subject: t('nt_reg_more_subject'), body: body(t('nt_hi', { name: p.name }), t('nt_reg_more_body', { store: p.store }), p.note, t('nt_reg_more_reply')) };
}
