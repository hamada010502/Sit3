export type Role = 'admin' | 'seller' | 'owner' | 'customer';
export type SellerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type KycStatus = 'not_started' | 'submitted' | 'approved' | 'rejected';
export type ProductType = 'physical' | 'digital';
export type ProductStatus = 'active' | 'inactive' | 'out_of_stock' | 'removed';
export type FulfillmentMethod = 'platform_rider' | 'yalla_go' | 'logistics_pickup' | 'digital';
export type PaymentMethod = 'cod' | 'bank_transfer' | 'card';
export type PaymentStatus = 'pending' | 'confirmed' | 'collected_cod' | 'failed' | 'refunded';

/** Commercial state (Full Spec v2 §4.2). Drives payout eligibility and seller filters. */
export type OrderState = 'open' | 'closed' | 'cancelled' | 'returned';
/** Operational fulfilment detail inside a commercial state. */
export type OrderStatus =
  | 'awaiting_payment' | 'payment_failed' | 'confirmed' | 'handed_off' | 'in_transit'
  | 'ready_for_pickup' | 'delivered' | 'disputed' | 'refunded' | 'cancelled';

export type DisputeKind = 'return' | 'not_received' | 'other';
export type DisputeStatus = 'open' | 'investigating' | 'resolved_refund' | 'resolved_found' | 'resolved_dismissed';
export type Liability = 'seller' | 'logistics' | 'platform' | 'none';
export type BankTransferStatus = 'awaiting_proof' | 'submitted' | 'confirmed' | 'rejected';
export type NotificationChannel = 'email' | 'sms' | 'whatsapp';
export type ActorType = 'buyer' | 'seller' | 'admin' | 'owner' | 'system' | 'api';
export type RegistrationStatus = 'PENDING_REVIEW' | 'MORE_INFORMATION_REQUIRED' | 'APPROVED' | 'REJECTED';

export interface User {
  id: string; email: string; password_hash: string; role: Role; name: string; phone: string | null;
  totp_secret: string | null; totp_enabled: number; totp_recovery: string | null;
  last_login_at: string | null; created_at: string;
}
export interface Seller {
  id: string; user_id: string; store_name: string; slug: string; instagram: string | null; phone: string;
  governorate: string; bio: string | null; about: string | null; logo_path: string | null; banner_path: string | null;
  visible: number; payout_details: string | null; status: SellerStatus; review_note: string | null;
  kyc_status: KycStatus; kyc_legal_name: string | null; kyc_national_id: string | null; kyc_doc_path: string | null;
  kyc_note: string | null; kyc_reviewed_at: string | null; created_at: string; reviewed_at: string | null;
}
export interface Product {
  id: string; seller_id: string; type: ProductType; title: string; description: string | null; price: number;
  stock: number; images: string; digital_note: string | null; option1_name: string | null; option2_name: string | null;
  status: ProductStatus; created_at: string; updated_at: string;
}
export interface ProductVariant {
  id: string; product_id: string; option1_value: string | null; option2_value: string | null;
  label: string; price: number; stock: number; position: number;
}
export interface Order {
  id: string; code: string; seller_id: string; product_id: string; user_id: string | null; product_title: string; product_type: ProductType;
  variant_id: string | null; variant_label: string | null; unit_price: number; quantity: number; subtotal: number;
  delivery_fee: number; total: number; commission_rate: number; commission_fixed: number; commission_vat: number;
  commission_amount: number; seller_net: number; buyer_name: string; buyer_phone: string; buyer_email: string | null;
  governorate: string; address: string; note: string | null;
  payment_method: PaymentMethod; payment_status: PaymentStatus;
  fulfillment_method: FulfillmentMethod; fulfillment_ref: string | null; tracking_number: string | null;
  pickup_location: string | null; order_state: OrderState; status: OrderStatus;
  pre_dispute_status: OrderStatus | null; pre_dispute_state: OrderState | null; payout_id: string | null;
  created_at: string; paid_at: string | null; closed_at: string | null; handed_off_at: string | null;
  delivered_at: string | null; cancelled_at: string | null; returned_at: string | null; refunded_at: string | null;
  updated_at: string;
}
export interface OrderEvent {
  id: number; order_id: string; from_status: string | null; to_status: string;
  from_state: string | null; to_state: string | null; actor: string; note: string | null; created_at: string;
}
export interface Payment {
  id: string; order_id: string; method: string; provider: string; provider_ref: string | null; amount: number;
  currency: string; status: 'pending' | 'captured' | 'failed' | 'refunded'; card_last4: string | null;
  card_brand: string | null; failure_reason: string | null; raw: string | null; created_at: string;
}
export interface BankTransfer {
  id: string; order_id: string; reference: string | null; proof_path: string | null; amount: number;
  status: BankTransferStatus; admin_note: string | null; submitted_at: string | null; reviewed_at: string | null; created_at: string;
}
export interface AddressChangeRequest {
  id: string; order_id: string; new_address: string; new_governorate: string;
  status: 'pending' | 'approved' | 'rejected'; admin_note: string | null; created_at: string; resolved_at: string | null;
}
export interface Dispute {
  id: string; order_id: string; kind: DisputeKind; reason: string; description: string | null; status: DisputeStatus;
  liability: Liability | null; admin_note: string | null; created_at: string; resolved_at: string | null;
}
export interface Payout {
  id: string; seller_id: string; period_label: string; cutoff_at: string | null; order_count: number;
  gross: number; commission: number; amount: number; status: 'pending' | 'paid' | 'failed';
  reference: string | null; failure_reason: string | null; created_at: string; paid_at: string | null;
}
export interface StoreRegistrationRequest {
  id: string; full_name: string; phone: string; email: string; national_id: string;
  store_name: string; slug: string; instagram: string | null; governorate: string; bio: string | null;
  password_hash: string; status: RegistrationStatus; admin_notes: string | null; info_request_note: string | null;
  duplicate_check: string; created_seller_id: string | null;
  submitted_at: string; reviewed_at: string | null; reviewed_by: string | null; updated_at: string;
}
export interface CustomerAddress {
  id: string; user_id: string; label: string | null; full_name: string; phone: string;
  governorate: string; address: string; is_default: number; created_at: string;
}
export interface OrderClaim {
  id: string; order_id: string; user_id: string; channel: 'email' | 'sms'; contact: string;
  code_hash: string; attempts: number; expires_at: string; verified_at: string | null; created_at: string;
}
export interface AuditEntry {
  id: number; actor_type: ActorType; actor_id: string | null; actor_label: string | null;
  entity_type: string; entity_id: string; action: string; detail: string | null; created_at: string;
}
export interface WebhookEndpoint {
  id: string; seller_id: string | null; url: string; secret: string; events: string; active: number; created_at: string;
}
export interface WebhookDelivery {
  id: number; endpoint_id: string; event: string; payload: string; status: string;
  response_code: number | null; error: string | null; attempts: number; created_at: string;
}
export interface ApiToken {
  id: string; seller_id: string; name: string; prefix: string; token_hash: string;
  last_used_at: string | null; revoked_at: string | null; created_at: string;
}

export const GOVERNORATES = [
  'Damascus', 'Rif Dimashq', 'Aleppo', 'Homs', 'Hama', 'Latakia', 'Tartus', 'Idlib',
  'Daraa', 'As-Suwayda', 'Quneitra', 'Deir ez-Zor', 'Raqqa', 'Al-Hasakah',
] as const;
export const DAMASCUS = 'Damascus';

/** Which commercial state each fulfilment status belongs to. */
export const STATE_OF_STATUS: Record<OrderStatus, OrderState> = {
  awaiting_payment: 'open', confirmed: 'open',
  handed_off: 'closed', in_transit: 'closed', ready_for_pickup: 'closed', delivered: 'closed',
  disputed: 'open', payment_failed: 'cancelled', cancelled: 'cancelled', refunded: 'returned',
};
