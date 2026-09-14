/**
 * Checkout — collects the customer's details, creates the order, then hands
 * off to WhatsApp.
 *
 * There is no payment step by design. No card fields, no gateway. The order is
 * created with status PENDING ("submitted, awaiting store approval") and only
 * the store can advance it.
 *
 * Order of operations matters: the order is CREATED AND SAVED BEFORE the
 * WhatsApp handoff is attempted. If WhatsApp fails to open, the order still
 * exists and the customer is shown the Instagram fallback — an order is never
 * silently lost.
 */

import { snapshot, clear as clearCart, pricingFor } from './store.js';
import {
  createOrder,
  isReturningCustomer,
  isLocalOnly,
  normalisePhone,
  whatsappLink,
} from './orderService.js';

const CFG = window.VESTI || {};

/**
 * Fire-and-forget analytics. Note what is NOT passed: nothing from the form.
 * The tracker never reads name, phone, email or address, and the server would
 * reject them if it did.
 */
const emitTrack = (name, props = {}, once = false) => {
  try {
    window.dispatchEvent(new CustomEvent('vesti:track', { detail: { name, props, once } }));
  } catch {
    /* telemetry never interrupts a checkout */
  }
};
const form = document.querySelector('[data-checkout-form]');

if (form) {
  const status = form.querySelector('[data-checkout-status]');
  const submit = form.querySelector('[data-checkout-submit]');
  const returningBox = form.querySelector('[data-returning]');
  const returningBody = form.querySelector('[data-returning-body]');

  const REQUIRED = [
    ['fullName', 'Enter your full name.'],
    ['phone', 'Enter the phone number we should reach you on.'],
    ['city', 'Enter your city.'],
    ['address', 'Enter your delivery address so the courier can find you.'],
  ];

  const setError = (id, message) => {
    const field = form.querySelector(`#${id}`);
    const slot = form.querySelector(`[data-error-for="${id}"]`);
    if (slot) slot.textContent = message || '';
    if (field) {
      if (message) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
  };

  const validate = () => {
    let firstBad = null;
    for (const [id, message] of REQUIRED) {
      const field = form.querySelector(`#${id}`);
      const value = (field?.value || '').trim();
      let error = '';
      if (!value) error = message;
      else if (id === 'phone' && normalisePhone(value).length < 8)
        error = 'Enter a full phone number we can reach you on.';
      else if (id === 'address' && value.length < 10)
        error = 'Add more detail so the courier can find you.';
      setError(id, error);
      if (error && !firstBad) firstBad = field;
    }

    // Email is optional, but must be valid when given.
    const email = form.querySelector('#email');
    const emailValue = (email?.value || '').trim();
    if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailValue)) {
      setError('email', 'Enter a valid email address, or leave it empty.');
      if (!firstBad) firstBad = email;
    } else {
      setError('email', '');
    }

    return firstBad;
  };

  form.querySelectorAll('input, textarea').forEach((input) => {
    input.addEventListener('blur', () => {
      if (input.getAttribute('aria-invalid') === 'true') validate();
    });
  });

  // Once per page load: begin_checkout is the funnel step, and a re-render or
  // a validation retry must not inflate it.
  {
    const cart = snapshot();
    emitTrack(
      'begin_checkout',
      { pieces: cart.pieces, subtotal: cart.subtotal, currency: cart.currency },
      true
    );
  }

  // Which field the customer got as far as, without ever sending its value.
  form.querySelectorAll('input, textarea').forEach((input) => {
    input.addEventListener(
      'blur',
      () => emitTrack('checkout_progress', { step: input.id, valid: input.value.trim() ? 1 : 0 }, true),
      { once: false }
    );
  });

  /* ------------------------------------------- returning-customer notice */

  const phoneInput = form.querySelector('#phone');
  let isReturning = false;

  const refreshReturning = async () => {
    const phone = normalisePhone(phoneInput?.value);
    isReturning = phone.length >= 8 ? await isReturningCustomer(phone) : false;

    if (!returningBox) return;
    if (isReturning) {
      const pct = CFG.returningCustomerPercent ?? 5;
      returningBody.textContent = `We recognise this number. Your ${pct}% returning customer discount is applied below.`;
    } else if (isLocalOnly()) {
      returningBody.textContent =
        "Use your real phone number. We'll recognise you when you order again and apply your returning customer discount automatically.";
    } else {
      // With the backend in place the browser is NOT told whether a phone
      // number has ordered before — an endpoint that answered that would let
      // anyone test a number against the customer list. The store applies the
      // discount when it prices the order, so the confirmed total can come out
      // lower than this summary, never higher.
      const pct = CFG.returningCustomerPercent ?? 5;
      returningBody.textContent =
        `Use your real phone number. If you have received an order from us before, your ${pct}% ` +
        'returning customer discount is applied automatically when we confirm this one.';
    }
    returningBox.hidden = false;
    // Re-price the summary: the discount may have changed.
    window.dispatchEvent(new CustomEvent('vesti:repricing', { detail: { isReturning } }));
  };

  phoneInput?.addEventListener('blur', refreshReturning);
  refreshReturning();

  /* -------------------------------------------------------------- submit */

  let submitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Duplicate-tap guard #1: ignore re-entry while a submit is in flight.
    // orderService adds guard #2 (a cart+customer fingerprint) so a reload
    // mid-flight cannot produce a second order either.
    if (submitting) return;

    if (status) {
      status.textContent = '';
      status.classList.remove('is-error');
    }

    const cart = snapshot();
    if (cart.pieces === 0) {
      if (status) {
        status.textContent = 'Your cart is empty.';
        status.classList.add('is-error');
      }
      return;
    }

    const firstBad = validate();
    if (firstBad) {
      firstBad.focus();
      if (status) {
        status.textContent = 'Check the highlighted fields.';
        status.classList.add('is-error');
      }
      return;
    }

    submitting = true;
    submit.disabled = true;
    if (status) status.textContent = 'Creating your order…';

    try {
      const customer = Object.fromEntries(new FormData(form).entries());
      // Re-check against the phone actually submitted, not a stale blur.
      const returning = await isReturningCustomer(customer.phone);
      const pricing = pricingFor(cart, returning);

      const order = await createOrder({ cart, customer, pricing });

      // The confirmed figures from the server, not the ones on screen.
      emitTrack('order_created', {
        order_number: order.orderId,
        pieces: order.pieces,
        total: order.total,
        currency: order.currency,
        discount_percent: order.discountPercent || 0,
      });

      // The order is saved. Only now is the cart cleared and WhatsApp opened —
      // in that order, so a failure at the handoff cannot lose the order.
      clearCart();

      const link = whatsappLink(order);
      const target = `/order/?id=${encodeURIComponent(order.orderId)}`;

      if (link) {
        // Open WhatsApp in a new tab and send this tab to the order page, so
        // the customer keeps their order number either way. If the popup is
        // blocked, the order page shows the button and the Instagram fallback.
        window.open(link, '_blank', 'noopener');
      }
      window.location.assign(target);
    } catch (err) {
      submitting = false;
      submit.disabled = false;
      if (status) {
        // A 4xx carries a message the customer can act on — a size that just
        // sold out, a field that failed validation. Anything else gets the
        // generic wording, because a server error says nothing useful and
        // must not be dressed up as the customer's mistake.
        const actionable = err?.status >= 400 && err?.status < 500 && err?.message;
        status.textContent = '';
        status.append(
          actionable
            ? err.message
            : 'We could not create your order. Nothing has been sent — please try again'
        );
        if (!actionable && CFG.instagramUrl) {
          status.append(', or ');
          const a = document.createElement('a');
          a.className = 'link-underline';
          a.href = CFG.instagramUrl;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = 'message us on Instagram';
          status.append(a, '.');
        } else if (!actionable) {
          status.append('.');
        }
        status.classList.add('is-error');
      }
      // The reason, never the input that caused it.
      emitTrack('checkout_error', { reason: err?.status ? `http_${err.status}` : 'network' });
      console.error('[vestiphobia] order creation failed:', err);
    }
  });
}
