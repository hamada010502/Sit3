/**
 * VESTIPHOBIA — cart state and shared chrome.
 *
 * Loaded on every page. The cart lives in localStorage so it survives
 * navigation between the static pages, and every mounted view (drawer, cart
 * page, checkout summary) re-renders from one subscribe() callback.
 */

import { priceCart } from './pricing.js';

const CFG = window.VESTI || {};
const KEY = 'vestiphobia.cart.v1';
const CATALOGUE = new Map((CFG.products || []).map((p) => [p.slug, p]));

// Secondary index for load()'s rename recovery below. A product's id is stable
// across a slug change; its slug is not.
const BY_ID = new Map((CFG.products || []).filter((p) => p.id != null).map((p) => [p.id, p]));

/**
 * HTML-escape for the one place this module builds markup as a string
 * (lineHtml, injected with innerHTML). Same implementation as lib/html.js's
 * esc(), duplicated rather than imported because lib/ is a server/build-time
 * directory and is never served to the browser — an import would 404.
 *
 * Product names and image paths are admin-supplied, not customer-supplied, so
 * nothing reaching here is attacker-controlled today. That is exactly why it
 * is escaped: the cart must not be the thing that turns a compromised admin
 * account, or a future field fed from a less-trusted source, into script
 * running in every customer's browser.
 */
const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/* ----------------------------------------------------------------- state */

const clampQty = (n) => Math.min(99, Math.max(1, Math.floor(Number(n) || 1)));

// Declared before `load()` runs — `load` calls clampQty, so a `const` defined
// below this point would be in its temporal dead zone and throw on startup.
let lines = load();
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    // Drop anything that no longer exists in the catalogue, and re-read price
    // and imagery from the catalogue so a price change is never stale.
    //
    // A line whose slug is gone is looked up by its product id before being
    // given up on: renaming a product in the admin used to silently empty the
    // cart of every visitor who already had it, because the stored slug no
    // longer matched anything. The id survives a rename, so the line is
    // rewritten to the current slug instead of dropped. Lines saved before
    // ids were stored, and ids that really have gone, still fall away.
    const merged = [];
    for (const l of raw) {
      if (!l || typeof l.size !== 'string') continue;
      const p = CATALOGUE.get(l.slug) || (l.id != null ? BY_ID.get(l.id) : null);
      if (!p) continue;
      // Remapping can land two stored lines on the same product+size (an old
      // slug and the new one both in the cart); they become one line rather
      // than a duplicate pair.
      const existing = merged.find((m) => m.slug === p.slug && m.size === l.size);
      if (existing) existing.qty = clampQty(existing.qty + clampQty(l.qty));
      else merged.push({ slug: p.slug, id: p.id, size: l.size, qty: clampQty(l.qty) });
    }
    return merged;
  } catch (err) {
    // Corrupt or unreadable storage should not break the store — but it should
    // never fail silently either, or a real bug looks like an empty cart.
    console.warn('[vestiphobia] could not read the saved cart:', err);
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* private mode / quota — the cart still works for this page view */
  }
}

function emit() {
  persist();
  const s = snapshot();
  listeners.forEach((fn) => fn(s));
}

/** Hydrated view of the cart: catalogue data joined onto the stored lines. */
export function snapshot() {
  const items = lines
    .map((l) => {
      const p = CATALOGUE.get(l.slug);
      if (!p) return null;
      return {
        ...l,
        name: p.name,
        shortName: p.shortName,
        image: p.image,
        price: p.price,
        currency: p.currency,
        lineTotal: p.price * l.qty,
      };
    })
    .filter(Boolean);

  const pieces = items.reduce((n, i) => n + i.qty, 0);
  const subtotal = items.reduce((n, i) => n + i.lineTotal, 0);
  const min = CFG.freeShippingMinPieces || 2;

  return {
    items,
    pieces,
    subtotal,
    currency: items[0]?.currency || 'USD',
    freeShipping: pieces >= min,
    piecesToFreeShipping: Math.max(0, min - pieces),
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

export function add(slug, size, qty = 1) {
  if (!CATALOGUE.has(slug) || !size) return false;
  const existing = lines.find((l) => l.slug === slug && l.size === size);
  if (existing) existing.qty = clampQty(existing.qty + qty);
  // The id rides along so load() can still find this product after a rename.
  else lines.push({ slug, id: CATALOGUE.get(slug).id, size, qty: clampQty(qty) });
  emit();
  return true;
}

export function setQty(slug, size, qty) {
  const n = Math.floor(Number(qty) || 0);
  if (n <= 0) return remove(slug, size);
  const l = lines.find((x) => x.slug === slug && x.size === size);
  if (l) {
    l.qty = clampQty(n);
    emit();
  }
}

/**
 * Fire-and-forget analytics. Nothing in this module depends on the tracker
 * existing — if it is absent, or the visitor opted out, the event is unheard.
 */
const emitTrack = (name, props = {}) => {
  try {
    window.dispatchEvent(new CustomEvent('vesti:track', { detail: { name, props } }));
  } catch {
    /* telemetry never interrupts the cart */
  }
};

export function remove(slug, size) {
  const line = lines.find((l) => l.slug === slug && l.size === size);
  if (line) emitTrack('remove_from_cart', { slug, size, quantity: line.qty });
  lines = lines.filter((l) => !(l.slug === slug && l.size === size));
  emit();
}

/** Empty the cart — used after a cart has become an order. */
export function clear() {
  lines = [];
  emit();
}

export const money = (n, currency = 'USD') =>
  `${Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`} ${currency}`;

/**
 * Price a cart through the shared engine. One implementation for the summary,
 * the drawer and the order record, so the customer can never be shown a total
 * that differs from the one written into their order.
 */
export const pricingFor = (cart, isReturning = false) =>
  priceCart(cart, { config: CFG.discounts || {}, isReturning });

/** The checkout re-prices when the returning-customer status resolves. */
let returningFlag = false;
window.addEventListener('vesti:repricing', (e) => {
  returningFlag = !!e.detail?.isReturning;
  emit();
});

/* -------------------------------------------------------- focus trapping */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function trap(container) {
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const nodes = [...container.querySelectorAll(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null || n === document.activeElement
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

/* ------------------------------------------------------------- overlays */

const scrim = document.querySelector('[data-scrim]');
let openOverlay = null;

function openPanel(el, { trigger, lock = true, useScrim = true } = {}) {
  closePanel();
  el.hidden = false;
  if (scrim && useScrim) scrim.hidden = false;
  if (lock) document.body.classList.add('is-locked');
  trigger?.setAttribute('aria-expanded', 'true');
  const release = trap(el);
  const target = el.querySelector(FOCUSABLE);
  target?.focus();
  openOverlay = { el, trigger, release, lock };
}

function closePanel() {
  if (!openOverlay) return;
  const { el, trigger, release, lock } = openOverlay;
  el.hidden = true;
  release();
  if (scrim) scrim.hidden = true;
  if (lock) document.body.classList.remove('is-locked');
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.focus();
  openOverlay = null;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openOverlay) closePanel();
});
scrim?.addEventListener('click', closePanel);

/* Cart drawer */
const drawer = document.getElementById('cart-drawer');
document.querySelectorAll('[data-cart-open]').forEach((btn) => {
  btn.addEventListener('click', () => drawer && openPanel(drawer, { trigger: btn }));
});
document.querySelectorAll('[data-cart-close]').forEach((btn) => {
  btn.addEventListener('click', closePanel);
});

export const openCart = () => {
  const trigger = document.querySelector('[data-cart-open]');
  if (drawer) openPanel(drawer, { trigger });
};

/* Mobile menu */
const menu = document.getElementById('mobile-menu');
document.querySelector('[data-menu-open]')?.addEventListener('click', (e) => {
  // The menu is opaque and full-screen, so it needs no scrim behind it — and
  // a scrim would sit above it and swallow clicks on its own close button.
  if (menu) openPanel(menu, { trigger: e.currentTarget, useScrim: false });
});
document.querySelector('[data-menu-close]')?.addEventListener('click', closePanel);
menu?.querySelectorAll('a').forEach((a) => a.addEventListener('click', closePanel));

/* -------------------------------------------------------- cart rendering */

function lineHtml(item, readonly) {
  const key = esc(`${item.slug}::${item.size}`);
  const slug = esc(item.slug);
  const size = esc(item.size);
  const shortName = esc(item.shortName);
  const image = esc(item.image);
  return `<li data-line="${key}">
    <a href="/products/${slug}/"><img src="${image}" alt="${shortName}"></a>
    <div>
      <div class="line__top">
        <a class="line__name" href="/products/${slug}/">${shortName}</a>
        <span class="line__total">${esc(money(item.lineTotal, item.currency))}</span>
      </div>
      <p class="line__size">Size ${size}</p>
      <p class="line__unit">${esc(money(item.price, item.currency))} each</p>
      ${
        readonly
          ? `<p class="line__size">Qty ${item.qty}</p>`
          : `<div class="line__foot">
        <div class="line__qty">
          <button type="button" data-line-dec aria-label="Decrease quantity of ${shortName}, size ${size}">&minus;</button>
          <span aria-live="polite">${item.qty}</span>
          <button type="button" data-line-inc aria-label="Increase quantity of ${shortName}, size ${size}">+</button>
        </div>
        <button class="line__remove" type="button" data-line-remove>Remove <span class="sr-only">${shortName}, size ${size}</span></button>
      </div>`
      }
    </div>
  </li>`;
}

function shipMessage(s) {
  if (s.pieces === 0) return '';
  const priced = pricingFor(s, returningFlag);

  // Below the threshold: one message that names both rewards, so the customer
  // sees the whole reason to add a piece rather than half of it.
  if (!priced.freeShipping) {
    const n = priced.piecesToFreeShipping;
    const tier = priced.nextTier;
    const reward = tier ? `${tier.percent}% off and free shipping` : 'free shipping';
    return `Add ${n} more piece${n === 1 ? '' : 's'} for ${reward}.`;
  }

  // At or above the threshold: confirm what is already earned, and name the
  // next tier only when there is one left to reach.
  const earned = priced.discountPercent
    ? `${priced.discountPercent}% off and free shipping applied.`
    : 'Free shipping unlocked.';
  if (priced.nextTier) {
    const n = priced.piecesToNextTier;
    return `${earned} Add ${n} more for ${priced.nextTier.percent}% off.`;
  }
  return earned;
}

subscribe((s) => {
  // Counters
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = String(s.pieces);
  });
  document.querySelectorAll('[data-cart-count-label]').forEach((el) => {
    el.textContent = `${s.pieces} item${s.pieces === 1 ? '' : 's'} in cart`;
  });

  // Line lists (drawer, cart page, checkout summary)
  document.querySelectorAll('[data-cart-lines]').forEach((ul) => {
    const readonly = ul.hasAttribute('data-readonly');
    ul.innerHTML = s.items.map((i) => lineHtml(i, readonly)).join('');
  });

  document.querySelectorAll('[data-cart-empty]').forEach((el) => {
    el.hidden = s.pieces > 0;
  });
  document.querySelectorAll('[data-cart-foot]').forEach((el) => {
    el.hidden = s.pieces === 0;
  });

  document.querySelectorAll('[data-cart-subtotal]').forEach((el) => {
    el.textContent = money(s.subtotal, s.currency);
  });
  // Total is merchandise after discount. Shipping is never added here — it is
  // collected on delivery and its amount is not known to the website.
  document.querySelectorAll('[data-cart-total]').forEach((el) => {
    el.textContent = money(pricingFor(s, returningFlag).total, s.currency);
  });
  document.querySelectorAll('[data-ship-line]').forEach((el) => {
    // The courier sets the fee by region and collects it at the door, so the
    // site never shows a number here.
    el.textContent = s.freeShipping ? 'Free' : 'Paid on delivery';
  });

  // Discount line, driven by the shared pricing engine.
  const priced = pricingFor(s, returningFlag);
  document.querySelectorAll('[data-discount-row]').forEach((el) => {
    el.hidden = priced.discountPercent === 0;
  });
  document.querySelectorAll('[data-discount-label]').forEach((el) => {
    el.textContent = priced.appliedDiscount?.label || 'Discount';
  });
  document.querySelectorAll('[data-discount-amount]').forEach((el) => {
    el.textContent = `−${money(priced.discountAmount, s.currency)}`;
  });

  document.querySelectorAll('[data-ship-progress]').forEach((el) => {
    const msg = shipMessage(s);
    el.textContent = msg;
    el.hidden = !msg;
    el.classList.toggle('is-unlocked', s.freeShipping);
  });
});

/* Delegated line controls — one listener covers every mounted cart view. */
document.addEventListener('click', (e) => {
  const li = e.target.closest('[data-line]');
  if (!li) return;
  const [slug, size] = li.dataset.line.split('::');
  const current = snapshot().items.find((i) => i.slug === slug && i.size === size);
  if (!current) return;

  if (e.target.closest('[data-line-inc]')) setQty(slug, size, current.qty + 1);
  else if (e.target.closest('[data-line-dec]')) setQty(slug, size, current.qty - 1);
  else if (e.target.closest('[data-line-remove]')) remove(slug, size);
});

/* ------------------------------------------------------------ newsletter */

document.querySelectorAll('[data-newsletter]').forEach((form) => {
  const status = form.querySelector('[data-newsletter-status]');
  form.addEventListener('submit', (e) => {
    if (CFG.newsletterConfigured) return; // let the real provider handle the POST
    e.preventDefault();
    if (!status) return;
    // Deliberately does not claim success: nothing is stored.
    status.textContent =
      'Signup is not live yet — no email service is connected, so this address was not saved. Check back once the list opens.';
  });
});

/* Sync the cart across tabs. */
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  lines = load();
  const s = snapshot();
  listeners.forEach((fn) => fn(s));
});
