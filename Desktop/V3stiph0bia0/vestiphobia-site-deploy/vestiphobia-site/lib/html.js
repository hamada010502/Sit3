/** Small helpers shared by every template. */

export const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** $17 USD — the format the owner uses in the brand copy. */
export const money = (amount, currency = 'USD') => {
  const n = Number(amount);
  const body = Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  return `${body} ${currency}`;
};

/**
 * A price, with the pre-sale price beside it when the product is on sale.
 *
 * The shop card and the product page each built this string themselves, with
 * the same classes and the same ternary — and both read out as "$120 USD $88
 * USD", two bare numbers with nothing saying which one is being charged. The
 * labels are screen-reader only; the visible price is unchanged.
 */
export const priceHtml = (price, compareAt, currency = 'USD') =>
  compareAt
    ? `<span class="card__was"><span class="sr-only">Was </span>${money(compareAt, currency)}</span> ` +
      `<span class="sr-only">Now </span>${money(price, currency)}`
    : money(price, currency);

export const paragraphs = (list = []) => list.map((p) => `<p>${esc(p)}</p>`).join('\n');

/** Renders only when `cond` is truthy — keeps templates free of ternary noise. */
export const when = (cond, fn) => (cond ? fn() : '');

/**
 * Responsive <img>. Every campaign photo is portrait (~4:5), so an explicit
 * aspect-ratio box is set to prevent layout shift and to stop the browser
 * from cropping the garment.
 */
export const img = ({ src, alt, className = '', eager = false, sizes = '100vw', ratio = '4 / 5' }) =>
  `<img src="${esc(src)}" alt="${esc(alt)}"${className ? ` class="${esc(className)}"` : ''}` +
  ` style="aspect-ratio:${ratio}"` +
  ` sizes="${esc(sizes)}"` +
  ` loading="${eager ? 'eager' : 'lazy'}" decoding="${eager ? 'sync' : 'async'}"` +
  `${eager ? ' fetchpriority="high"' : ''}>`;
