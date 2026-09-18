# Paylo — Link It. Get Paid.

Link-based payment and delivery platform for Syrian social-media sellers, modeled on Shopier (Turkey).
Sellers list products, share a checkout link or storefront on Instagram, buyers pay by card as guests,
Paylo holds the funds (escrow-style), handles delivery, and pays sellers weekly minus a commission.

Built from `paylo-project-overview.md`, `shopier-syria-fable-prompt.md` and `paylo-brand-identity-prompt.md`.

## Stack

- Next.js 14 (App Router, server actions), TypeScript, Tailwind CSS
- SQLite via `better-sqlite3` (single file, zero infrastructure; schema in `lib/schema.sql`)
- Signed-cookie sessions, bcrypt passwords
- Bilingual UI: English (LTR) and Arabic (RTL), switchable, RTL-safe layout via logical CSS properties
- Brand palette: Karry `#FFEBD2`, Atomic Tangerine `#FFA364`, Crusta `#FC7643`, Apple Blossom `#AF4F41`, Pickled Bluewood `#273248`

## Quick start

```bash
cd paylo
npm install
cp .env.example .env        # optional; defaults work for local dev
npm run seed                # creates DB + admin + demo sellers
npm run dev                 # http://localhost:3000
```

Seeded accounts:

| Role | Email | Password |
|---|---|---|
| Admin | admin@paylo.sy | admin1234 |
| Seller (approved) | demo@paylo.sy | seller1234 — storefront `/s/lina-handmade` |
| Seller (pending) | pending@paylo.sy | seller1234 |

Test cards (mock provider): any Luhn-valid number succeeds, e.g. `5555 5555 5555 4444`.
A number ending in `0002` is declined (insufficient funds); ending in `0069` is declined (expired).

Production: `npm run build && npm start`. Set `SESSION_SECRET`, `APP_URL`, and `DATABASE_PATH` / `UPLOAD_DIR` to persistent locations.

## Entry points (no public catalog, no search)

| URL | Who | What |
|---|---|---|
| `/` | public | Landing + order-tracking box |
| `/s/[slug]` | buyer | Seller storefront (active products only) |
| `/p/[id]` | buyer | Single-product checkout link (guest, card only, SYP) |
| `/track/[code]` | buyer | Live order status, confirm receipt, open a dispute (no login) |
| `/apply`, `/login` | seller | Application (pending until admin approval), login |
| `/seller/**` | seller | Dashboard, products, orders (hand-off step), payouts, settings |
| `/admin/**` | admin | Sellers (approve/reject/suspend, remove listings), orders (delivery ops), disputes, payouts, settings, email log |

## Order state machine (`lib/orders.ts`)

```
pending_payment ─► payment_failed
       │
       ▼
     paid ─────────► handed_off ─► in_transit ──────┐
   (funds held)     (seller must    (Damascus rider │
                     confirm)        or Yalla Go)   ▼
                        │                        delivered ─► [weekly payout]
                        └─► ready_for_pickup ────┘  (admin or buyer confirms)
                            (logistics partner,
                             other governorates)

   any paid state ─► disputed ─► back to previous state | refunded
```

- **Funds hold:** an order is payout-eligible only when `delivered`, has no open dispute, is not yet in a payout, and `payout_hold_days` (admin setting, default 0) have passed. Everything else is reported as "held".
- **Hand-off is manual:** the seller must click "Mark as handed off" (with rider name / shipment reference). Nothing moves automatically.
- **Fulfillment path per order:** `platform_rider` (Damascus default), `yalla_go` (admin can outsource on rider shortage, toggle in settings), `logistics_pickup` (all other governorates; admin enters the pickup location, buyer is emailed and sees it on the tracking page).
- **Disputes:** opened by the buyer from the tracking page. Admin marks investigating, then resolves as refund / shipment found / dismissed and records **who bears the loss** (`seller` if never handed off, `logistics`, `platform`, `none`). Refunds go through the payment provider; stock is restored only if the parcel never left the seller. An order already paid out cannot be refunded in-app.
- **Payouts:** admin clicks "Generate this week's payouts" → one pending payout per seller for all eligible orders; then "Mark as paid" with a bank reference. Sellers see eligible / held / paid totals.
- **Commission** (default 7.5%, admin-adjustable) is computed on the product subtotal at order time and frozen on the order. Delivery fee (per zone, admin-adjustable) is charged to the buyer on top.

## Abstractions for unresolved business items

- **Payment provider** — `lib/payments/provider.ts` defines `charge()` / `refund()`. `mock.ts` is the dev adapter; `qnb.ts` is an empty stub for the QNB Syria Mastercard rail. Select with `PAYMENT_PROVIDER=mock|qnb`. Checkout, refunds and admin never import a concrete adapter.
- **Email** — `lib/email.ts`. `EMAIL_TRANSPORT=log` (default) stores every notification in the DB (Admin → Emails) so flows are verifiable without SMTP. `EMAIL_TRANSPORT=smtp` + `SMTP_*` sends for real (`npm i nodemailer`).
- **Real-time status** — pages poll the server every 5–15 s (`components/AutoRefresh.tsx`); no websocket infra needed.
- **Landing hero** — `components/HeroCardWaterfall.tsx` renders the tilted, infinitely scrolling product-card grid (desktop/tablet) and the horizontal strip (mobile). Animation is CSS-only on `transform` (`.wf-*` rules in `app/globals.css`), honours `prefers-reduced-motion`, and mirrors in RTL. Replace the `products[]` array (currently on-palette placeholder SVGs in `public/hero/`) with real photos; layout does not change.
- **Uploads** — stored in `UPLOAD_DIR` (default `data/uploads`) and served by `/uploads/[name]`, so they work in production without a rebuild.

## Tests

`e2e/smoke.js` drives the whole lifecycle through a real browser (seller application → approval → product with image → declined then successful card → hand-off → pickup/delivery → dispute → refund with liability → second order via Yalla Go → weekly payout → Arabic RTL). Run against a seeded, running instance:

```bash
npm i -g playwright && npx playwright install chromium
node e2e/smoke.js
```

## Deliberately out of scope (per spec)

Buyer accounts, catalog/search, product variants, multi-currency, SMS/WhatsApp, native apps, automatic refund timers, seller subscriptions.

## Open items carried forward (not resolved by this build)

1. QNB Syria / PSP merchant contract — no owner yet; `qnb.ts` stays a stub until the gateway spec exists.
2. Delivery-ops costing (riders, Yalla Go fees, logistics partner) — outside the software budget.
3. Domain / trademark / Instagram handle for "Paylo" — unverified.
4. Logistics partner for outside-Damascus pickup — unnamed (`logistics_partner_name` setting is a placeholder).
5. Spec §4 item 6(b) ("payment-confirmed with no dispute" as payout-eligible) contradicts the sentence after it ("orders pending delivery confirmation are held"). This build holds funds until **delivered**, with an optional post-delivery hold in days. Change `payoutEligibleOrders()` in `lib/orders.ts` if the business wants the looser rule.
