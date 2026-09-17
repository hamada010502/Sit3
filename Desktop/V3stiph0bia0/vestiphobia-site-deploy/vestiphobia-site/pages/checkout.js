import { site as staticSite, isSet, whatsappConfigured } from '../site.config.js';
import { page } from '../lib/layout.js';
import { esc } from '../lib/html.js';
import { products as staticProducts, toStoreShape } from '../data/products.js';

const store = (products) => products.map(toStoreShape);

/* ------------------------------------------------------------- Cart page */

/**
 * A full cart page as well as the drawer — the drawer is the primary
 * interaction, this is the shareable/bookmarkable fallback.
 */
export function cartPage({ site = staticSite, products = staticProducts, content = {} } = {}) {
  const min = site.shipping.freeShippingMinPieces;

  const body = `
<section class="section page-head" aria-labelledby="cart-h">
  <div class="wrap"><h1 class="display" id="cart-h">Cart</h1></div>
</section>

<section class="section section--top-tight" aria-label="Cart contents">
  <div class="wrap cart-page" data-cart-page>
    <div class="cart-page__lines">
      <p class="drawer__empty" data-cart-empty>Your cart is empty. <a class="link-underline" href="/shop/">Shop the first drop</a>.</p>
      <ul class="cart-lines cart-lines--page" data-cart-lines></ul>
    </div>

    <aside class="cart-page__summary panel" data-cart-foot hidden aria-label="Order summary">
      <h2 class="eyebrow">Summary</h2>
      <p class="ship-progress" data-ship-progress role="status"></p>
      <div class="sum-row sum-row--total">
        <span>Subtotal</span>
        <span data-cart-subtotal>$0 USD</span>
      </div>
      <p class="muted">Free shipping applies to orders containing ${min} or more pieces. Below that, shipping is arranged with you directly.</p>
      <a class="btn btn--solid btn--block" href="/checkout/">Checkout</a>
      <a class="btn btn--ghost btn--block" href="/shop/">Continue shopping</a>
    </aside>
  </div>
</section>
`;

  return page({
    title: `Cart — ${site.brand}`,
    description: 'Your VESTIPHOBIA cart.',
    path: '/cart/',
    bodyClass: 'page-cart',
    body,
    products: store(products),
    site,
    content,
  });
}

/* --------------------------------------------------------- Checkout page */

export function checkoutPage({ site = staticSite, products = staticProducts, content = {} } = {}) {
  const min = site.shipping.freeShippingMinPieces;
  const waReady = whatsappConfigured(site);
  const deliveryEstimate = content['shipping.delivery_estimate'] || site.shipping.deliveryEstimate;

  const field = ({ id, label, type = 'text', autocomplete, required = true, hint, area = false }) => `
  <div class="field">
    <label class="field__label" for="${esc(id)}">${esc(label)}${required ? '' : ' <span class="muted">(optional)</span>'}</label>
    ${
      area
        ? `<textarea class="field__input field__input--area" id="${esc(id)}" name="${esc(id)}" rows="3"></textarea>`
        : `<input class="field__input" id="${esc(id)}" name="${esc(id)}" type="${esc(type)}"${
            autocomplete ? ` autocomplete="${esc(autocomplete)}"` : ''
          }${required ? ' required' : ''}>`
    }
    ${hint ? `<p class="field__hint">${esc(hint)}</p>` : ''}
    <p class="field__error" data-error-for="${esc(id)}" role="alert"></p>
  </div>`;

  const body = `
<section class="section page-head" aria-labelledby="checkout-h">
  <div class="wrap">
    <h1 class="display display--md" id="checkout-h">Checkout</h1>
    <p class="page-head__note">Order by WhatsApp — payment by Sham Cash</p>
  </div>
</section>

<section class="section section--top-tight" aria-label="Checkout">
  <div class="wrap checkout" data-checkout>

    <form class="checkout__form" data-checkout-form novalidate>
      <fieldset class="fieldset">
        <legend class="eyebrow">Your details</legend>

        ${field({ id: 'fullName', label: 'Full name', autocomplete: 'name' })}
        ${field({
          id: 'phone',
          label: 'Phone number',
          type: 'tel',
          autocomplete: 'tel',
          hint: 'We continue your order with you on this number.',
        })}
        ${field({ id: 'city', label: 'City', autocomplete: 'address-level2' })}
        ${field({
          id: 'address',
          label: 'Detailed delivery address',
          autocomplete: 'street-address',
          area: true,
          hint: 'Street, building, floor and any landmark that helps the courier find you.',
        })}
        ${field({
          id: 'email',
          label: 'Email',
          type: 'email',
          autocomplete: 'email',
          required: false,
          hint: 'Recommended — receive an email when your order ships.',
        })}
        ${field({ id: 'notes', label: 'Order notes', required: false, area: true })}
      </fieldset>

      <div class="returning" data-returning hidden role="status">
        <p class="returning__title">Come back. Pay less.</p>
        <p class="returning__body" data-returning-body></p>
      </div>

      <fieldset class="fieldset">
        <legend class="eyebrow">How it works</legend>
        <ol class="steps">
          <li><span class="steps__n">1</span><span>You place the order here and get an order number.</span></li>
          <li><span class="steps__n">2</span><span>WhatsApp opens with your order already written out.</span></li>
          <li><span class="steps__n">3</span><span>We reply with the Sham Cash transfer details.</span></li>
          <li><span class="steps__n">4</span><span>You transfer, we verify by hand, and your order is accepted.</span></li>
        </ol>
        <p class="muted">${esc(site.payment.note)}</p>
        ${
          waReady
            ? ''
            : `<div class="notice notice--pending" role="status">
          <h2 class="notice__title">WhatsApp not configured</h2>
          <p>No brand WhatsApp number is set, so the order cannot be sent yet. It is still created and given an order number.</p>
        </div>`
        }
      </fieldset>

      <button class="btn btn--wa btn--block btn--lg" type="submit" data-checkout-submit>
        Confirm by WhatsApp
      </button>
      <p class="checkout__status" data-checkout-status role="status"></p>
      <p class="muted checkout__reassure">No card details are collected anywhere on this website.</p>
    </form>

    <aside class="checkout__summary panel" aria-labelledby="sum-h">
      <h2 class="eyebrow" id="sum-h">Order summary</h2>
      <p class="drawer__empty" data-cart-empty>Your cart is empty. <a class="link-underline" href="/shop/">Shop the first drop</a>.</p>
      <ul class="cart-lines cart-lines--summary" data-cart-lines data-readonly></ul>

      <div data-cart-foot hidden>
        <div class="sum-row"><span>Subtotal</span><span data-cart-subtotal>$0 USD</span></div>
        <div class="sum-row sum-row--discount" data-discount-row hidden>
          <span data-discount-label>Discount</span><span data-discount-amount></span>
        </div>
        <div class="sum-row"><span>Shipping</span><span data-ship-line>—</span></div>
        <div class="sum-row sum-row--total"><span>Total</span><span data-cart-total>$0 USD</span></div>
        <p class="ship-progress" data-ship-progress role="status"></p>
        <p class="muted">Delivery: ${esc(deliveryEstimate)} — ${esc(site.shipping.countryLabel)} only.<br>
        ${esc(content['shipping.fee_note'] || 'Shipping fee is paid upon delivery and varies by region.')}</p>
      </div>
    </aside>

  </div>
</section>
`;

  return page({
    title: `Checkout — ${site.brand}`,
    description: 'Complete your VESTIPHOBIA order over WhatsApp.',
    path: '/checkout/',
    bodyClass: 'page-checkout',
    body,
    products: store(products),
    scripts: ['/assets/js/checkout.js'],
    noindex: true,
    site,
    content,
  });
}

/* ----------------------------------------------- Order confirmation page */

/**
 * /order/ reads the order id from the query string and renders it from the
 * order store. It is a single static page, not one page per order — there is
 * no server to generate per-order routes, and orders live only in the
 * customer's own browser.
 */
export function orderPage({ site = staticSite, products = staticProducts, content = {} } = {}) {
  const waReady = whatsappConfigured(site);
  const deliveryEstimate = content['shipping.delivery_estimate'] || site.shipping.deliveryEstimate;

  const body = `
<section class="section order-page" data-order-page aria-labelledby="order-h">
  <div class="wrap">

    <!-- One h1 for the page; its text and eyebrow are set from the order state
         so the found and not-found views never both contribute a heading. -->
    <p class="eyebrow" data-order-eyebrow>Order</p>
    <h1 class="display display--md" id="order-h" data-order-id>Loading…</h1>

    <div data-order-missing hidden>
      ${
        site.api.enabled
          ? `<p class="lede">This order was not placed on this device. Enter the phone number used on the order to look it up.</p>

      <form class="order-lookup" data-order-lookup novalidate>
        <div class="field">
          <label class="field__label" for="lookup-phone">Phone number on the order</label>
          <input class="field__input" id="lookup-phone" name="phone" type="tel" autocomplete="tel"
                 inputmode="tel" placeholder="09XX XXX XXX" required>
        </div>
        <p class="field__error" data-lookup-error role="alert" hidden></p>
        <button class="btn btn--solid" type="submit">Find my order</button>
      </form>
      <p class="fineprint">We ask for the phone number because order numbers alone are guessable —
        without it, anyone could read someone else's delivery address.</p>`
          : `<p class="lede">We could not find that order in this browser. Orders are stored on the device they were created on.</p>`
      }
      <p><a class="btn btn--outline" href="/shop/">Back to shop</a></p>
    </div>

    <div data-order-view hidden>

      <p class="lede">Your order has been prepared. Continue on WhatsApp to confirm it and receive the Sham Cash payment details.</p>

      ${
        waReady
          ? `<a class="btn btn--wa btn--lg btn--block-mobile" data-wa-link href="#" target="_blank" rel="noopener">
        Confirm by WhatsApp
      </a>`
          : `<div class="notice notice--pending" role="status">
        <h2 class="notice__title">WhatsApp number not configured</h2>
        <p>Your order was created and saved, but no brand WhatsApp number is set in <code>site.config.js</code> yet, so it cannot be sent. The full message is below — it can be copied and sent manually.</p>
      </div>`
      }

      <div class="order-status">
        <div class="order-status__row">
          <span class="eyebrow">Order status</span>
          <span class="tag tag--pending" data-order-status>PENDING</span>
          <span class="muted" data-order-status-meaning></span>
        </div>
        <div class="order-status__row">
          <span class="eyebrow">Payment</span>
          <span data-order-method>${esc(site.payment.method)}</span>
        </div>
        <div class="order-status__row">
          <span class="eyebrow">Delivery</span>
          <span>${esc(deliveryEstimate)} — fee paid on delivery</span>
        </div>
      </div>

      <div class="order-grid">
        <section class="panel" aria-labelledby="order-items-h">
          <h2 class="eyebrow" id="order-items-h">Items</h2>
          <ul class="order-items" data-order-items></ul>
          <div class="sum-row"><span>Subtotal</span><span data-order-subtotal></span></div>
          <div class="sum-row sum-row--discount" data-order-discount-row hidden>
            <span data-order-discount-label></span><span data-order-discount-amount></span>
          </div>
          <div class="sum-row"><span>Shipping</span><span data-order-shipping></span></div>
          <div class="sum-row sum-row--total"><span>Total</span><span data-order-total></span></div>
        </section>

        <section class="panel" aria-labelledby="order-cust-h">
          <h2 class="eyebrow" id="order-cust-h">Delivery to</h2>
          <address class="order-address" data-order-address></address>
        </section>
      </div>

      <details class="acc acc--standalone">
        <summary class="acc__summary"><span>The message we will send</span><span class="acc__sign" aria-hidden="true"></span></summary>
        <div class="acc__body">
          <pre class="wa-preview" data-wa-preview></pre>
          <button class="btn btn--outline" type="button" data-wa-copy>Copy message</button>
          <span class="copy-status" data-copy-status role="status"></span>
        </div>
      </details>

      <p class="order-fallback">
        Having trouble?
        <a class="link-underline" href="${esc(site.contact.instagram)}" target="_blank" rel="noopener">Contact us on Instagram</a>
        — quote your order number.
      </p>

      <p class="muted order-page__note">Keep this order number. Orders are stored in this browser only — this page will not open on another device.</p>
    </div>

  </div>
</section>
`;

  return page({
    title: `Your order — ${site.brand}`,
    description: 'Your VESTIPHOBIA order details.',
    path: '/order/',
    bodyClass: 'page-order',
    body,
    products: store(products),
    scripts: ['/assets/js/order.js'],
    noindex: true,
    site,
    content,
  });
}
