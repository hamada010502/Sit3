export type Role = 'admin' | 'seller';
export type SellerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type ProductStatus = 'active' | 'inactive' | 'out_of_stock' | 'removed';
export type FulfillmentMethod = 'platform_rider' | 'yalla_go' | 'logistics_pickup';
export type OrderStatus =
  | 'pending_payment' | 'payment_failed' | 'paid' | 'handed_off' | 'in_transit'
  | 'ready_for_pickup' | 'delivered' | 'disputed' | 'refunded' | 'cancelled';
export type DisputeStatus = 'open' | 'investigating' | 'resolved_refund' | 'resolved_found' | 'resolved_dismissed';
export type Liability = 'seller' | 'logistics' | 'platform' | 'none';

export interface User { id: string; email: string; password_hash: string; role: Role; name: string; created_at: string }
export interface Seller {
  id: string; user_id: string; store_name: string; slug: string; instagram: string | null; phone: string;
  governorate: string; bio: string | null; payout_details: string | null; status: SellerStatus;
  review_note: string | null; created_at: string; reviewed_at: string | null;
}
export interface Product {
  id: string; seller_id: string; title: string; description: string | null; price: number; stock: number;
  images: string; status: ProductStatus; created_at: string; updated_at: string;
}
export interface Order {
  id: string; code: string; seller_id: string; product_id: string; product_title: string; unit_price: number;
  quantity: number; subtotal: number; delivery_fee: number; total: number; commission_rate: number;
  commission_amount: number; seller_net: number; buyer_name: string; buyer_phone: string; buyer_email: string | null;
  governorate: string; address: string; note: string | null; fulfillment_method: FulfillmentMethod;
  fulfillment_ref: string | null; pickup_location: string | null; status: OrderStatus; pre_dispute_status: OrderStatus | null;
  payout_id: string | null; created_at: string; paid_at: string | null; handed_off_at: string | null;
  delivered_at: string | null; refunded_at: string | null; updated_at: string;
}
export interface OrderEvent { id: number; order_id: string; from_status: string | null; to_status: string; actor: string; note: string | null; created_at: string }
export interface Payment { id: string; order_id: string; provider: string; provider_ref: string | null; amount: number; currency: string; status: string; card_last4: string | null; card_brand: string | null; failure_reason: string | null; raw: string | null; created_at: string }
export interface Dispute { id: string; order_id: string; reason: string; description: string | null; status: DisputeStatus; liability: Liability | null; admin_note: string | null; created_at: string; resolved_at: string | null }
export interface Payout { id: string; seller_id: string; period_label: string; order_count: number; gross: number; commission: number; amount: number; status: 'pending' | 'paid'; reference: string | null; created_at: string; paid_at: string | null }

export const GOVERNORATES = [
  'Damascus', 'Rif Dimashq', 'Aleppo', 'Homs', 'Hama', 'Latakia', 'Tartus', 'Idlib',
  'Daraa', 'As-Suwayda', 'Quneitra', 'Deir ez-Zor', 'Raqqa', 'Al-Hasakah',
] as const;
export const DAMASCUS = 'Damascus';
