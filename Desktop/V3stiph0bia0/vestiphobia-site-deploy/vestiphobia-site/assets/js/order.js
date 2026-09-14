/**
 * Customer-facing order confirmation page: /order/?id=VST-2026-0001
 *
 * Two ways in:
 *   - The device that placed the order holds a receipt, so the page renders
 *     immediately and then refreshes the status from the server.
 *   - Any other device must supply the phone number on the order. Order
 *     numbers are sequential and guessable; the phone check is what stops one
 *     customer reading another's delivery address.
 */

import { getOrder, buildWhatsAppMessage, whatsappLink, STATUS_MEANING } from './orderService.js';

const root = document.querySelector('[data-order-page]');

const money = (n, currency = 'USD') =>
  n === null || n === undefined
    ? null
    : `${Number.isInteger(n) ? `$${n}` : `$${Number(n).toFixed(2)}`} ${currency}`;

if (root) {
  const view = root.querySelector('[data-order-view]');
  const missing = root.querySelector('[data-order-missing]');
  const lookup = root.querySelector('[data-order-lookup]');
  const lookupError = root.querySelector('[data-lookup-error]');
  const heading = root.querySelector('[data-order-id]');
  const eyebrow = root.querySelector('[data-order-eyebrow]');
  const id = new URLSearchParams(window.location.search).get('id');

  const show = (el) => {
    if (el) el.hidden = false;
  };
  const hide = (el) => {
    if (el) el.hidden = true;
  };

  /** Text nodes only — never innerHTML with order data. */
  const setList = (el, lines) => {
    if (!el) return;
    el.replaceChildren(
      ...lines.filter(Boolean).map((line) => {
        const span = document.createElement('span');
        span.textContent = line;
        return span;
      })
    );
  };

  function renderItems(el, order) {
    if (!el) return;
    el.replaceChildren(
      ...order.items.map((i) => {
        const li = document.createElement('li');
        for (const [cls, text] of [
          ['order-items__name', i.name],
          ['order-items__meta', `Size ${i.size} × ${i.quantity}`],
          ['order-items__total', money(i.lineTotal, order.currency)],
        ]) {
          const span = document.createElement('span');
          span.className = cls;
          span.textContent = text;
          li.append(span);
        }
        return li;
      })
    );
  }

  function render(order) {
    hide(missing);

    heading.textContent = order.orderId;
    if (eyebrow) eyebrow.textContent = 'Order created';
    root.querySelector('[data-order-status]').textContent = order.orderStatus;
    const meaning = root.querySelector('[data-order-status-meaning]');
    if (meaning) meaning.textContent = STATUS_MEANING[order.orderStatus] || '';

    renderItems(root.querySelector('[data-order-items]'), order);

    root.querySelector('[data-order-subtotal]').textContent = money(order.subtotal, order.currency);
    const discRow = root.querySelector('[data-order-discount-row]');
    if (discRow) {
      discRow.hidden = !order.discountPercent;
      if (order.discountPercent) {
        root.querySelector('[data-order-discount-label]').textContent = order.discountLabel;
        root.querySelector('[data-order-discount-amount]').textContent =
          `−${money(order.discountAmount, order.currency)}`;
      }
    }
    root.querySelector('[data-order-shipping]').textContent = order.shippingLabel;
    root.querySelector('[data-order-total]').textContent = money(order.total, order.currency);

    // Flat shape: the confirmed checkout collects one free-text address plus a
    // city, not a structured western address.
    setList(root.querySelector('[data-order-address]'), [
      order.customerName,
      order.customerPhoneRaw || order.customerPhone,
      order.customerEmail,
      order.address,
      order.city,
    ]);

    // The exact message, shown so the customer can see what they are sending
    // — and copy it by hand if no WhatsApp number is configured yet.
    const message = buildWhatsAppMessage(order);
    const preview = root.querySelector('[data-wa-preview]');
    if (preview) preview.textContent = message;

    const link = whatsappLink(order);
    const waBtn = root.querySelector('[data-wa-link]');
    if (waBtn) {
      if (link) waBtn.href = link;
      else waBtn.remove(); // never render a dead or invented wa.me link
    }

    const copyBtn = root.querySelector('[data-wa-copy]');
    const copyStatus = root.querySelector('[data-copy-status]');
    copyBtn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message);
        if (copyStatus) copyStatus.textContent = 'Copied.';
      } catch {
        if (copyStatus) copyStatus.textContent = 'Select the text above and copy it manually.';
      }
    });

    show(view);
  }

  function renderNotFound() {
    heading.textContent = 'Order not found';
    if (eyebrow) eyebrow.textContent = 'Order';
    hide(view);
    show(missing);
  }

  lookup?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const phone = new FormData(lookup).get('phone');
    const button = lookup.querySelector('button[type=submit]');

    hide(lookupError);
    if (!String(phone || '').replace(/\D/g, '')) {
      if (lookupError) {
        lookupError.textContent = 'Enter the phone number used on the order.';
        show(lookupError);
      }
      return;
    }

    button.disabled = true;
    try {
      const order = await getOrder(id, phone);
      if (order) return render(order);
      if (lookupError) {
        // Deliberately one message for "no such order" and "wrong phone".
        lookupError.textContent = 'No order matches that number and phone.';
        show(lookupError);
      }
    } catch (err) {
      if (lookupError) {
        lookupError.textContent = 'We could not reach the store. Please try again in a moment.';
        show(lookupError);
      }
      console.error('[vestiphobia] order lookup failed:', err);
    } finally {
      button.disabled = false;
    }
  });

  (async () => {
    let order = null;
    try {
      order = id ? await getOrder(id) : null;
    } catch (err) {
      console.error('[vestiphobia] could not load the order:', err);
    }
    if (order) render(order);
    else renderNotFound();
  })();
}
