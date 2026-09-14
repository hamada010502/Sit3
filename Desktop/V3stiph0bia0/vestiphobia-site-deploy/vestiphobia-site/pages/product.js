import { site as staticSite, isSet } from '../site.config.js';
import { page } from '../lib/layout.js';
import { iconClose, iconArrow } from '../lib/icons.js';
import { esc, money, paragraphs, when } from '../lib/html.js';
import { picture, preloadHero, imageEntry } from '../lib/images.js';
import { products as staticProducts, toStoreShape, toProductViewModel } from '../data/products.js';

function accordion(id, heading, inner, open = false) {
  return `<details class="acc"${open ? ' open' : ''}>
  <summary class="acc__summary" id="${esc(id)}">
    <span>${esc(heading)}</span>
    <span class="acc__sign" aria-hidden="true"></span>
  </summary>
  <div class="acc__body prose">${inner}</div>
</details>`;
}

function sizeGuideBody(p) {
  if (!isSet(p.sizeGuide?.measurements)) {
    return `<p>${esc(p.sizeGuide?.note || 'A measurement chart will be published here once confirmed.')}</p>`;
  }
  const rows = p.sizeGuide.measurements;
  const cols = Object.keys(rows[0]).filter((k) => k !== 'size');
  return `<div class="table-scroll"><table class="size-table">
  <thead><tr><th scope="col">Size</th>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>${rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.size)}</th>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`
    )
    .join('')}</tbody>
</table></div>`;
}

/**
 * Product details. Each spec row renders only once the owner has confirmed it;
 * an unset one is omitted rather than shown as an empty row or a guess.
 *
 * The pending note is driven by what is actually still missing, not by a count
 * of rows — so it disappears on its own the moment the last gap is filled.
 */
function confirmedSpecs(p) {
  return [
    ['Fabric', p.fabric],
    ['Weight', isSet(p.gsm) ? `${p.gsmApproximate ? 'Approx. ' : ''}${p.gsm} GSM` : null],
    ['Fit', p.fit],
  ].filter(([, v]) => isSet(v));
}

function detailsBody(p) {
  const specs = confirmedSpecs(p);

  const stillPending = !p.careInstructions?.length || !isSet(p.sizeGuide?.measurements);

  return `<ul class="tick-list">${p.details.confirmed.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
${
  specs.length
    ? `<dl class="spec-list">${specs
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join('')}</dl>`
    : ''
}
${stillPending && p.details.pending ? `<p class="is-pending">${esc(p.details.pending)}</p>` : ''}`;
}

function shippingBody(site, content) {
  const min = site.shipping.freeShippingMinPieces;
  const deliveryEstimate = content['shipping.delivery_estimate'] || site.shipping.deliveryEstimate;
  const lines = [
    `Free shipping on ${min}+ pieces.`,
    isSet(site.shipping.flatRateUnderThreshold)
      ? `Orders below ${min} pieces are charged ${money(site.shipping.flatRateUnderThreshold, site.shipping.currency)} for shipping.`
      : `Shipping for orders below ${min} pieces is arranged with you directly when we confirm the order.`,
  ];
  if (isSet(site.shipping.processingTime)) lines.push(`Processing time: ${site.shipping.processingTime}.`);
  if (isSet(deliveryEstimate)) lines.push(`Estimated delivery: ${deliveryEstimate}.`);
  if (!isSet(site.shipping.processingTime) && !isSet(deliveryEstimate)) {
    lines.push('Processing and delivery estimates will be published once shipping is finalized.');
  }
  return paragraphs(lines) + `<p><a class="link-underline" href="/policies/shipping/">Shipping policy</a></p>`;
}

function supportBody(site, content) {
  const email = content['contact.email'] || site.contact.email;
  return isSet(email)
    ? `<p>Questions about an order, sizing or the collection? Email <a class="link-underline" href="mailto:${esc(email)}">${esc(email)}</a>.</p>`
    : `<p class="is-pending">Contact email — coming soon.</p><p>A support address will be published on the <a class="link-underline" href="/contact/">contact page</a> as soon as it is set up. Orders are confirmed over WhatsApp at checkout.</p>`;
}

function gallery(p) {
  const thumbs = p.images
    .map(
      (im, i) => `<button class="gal__thumb${i === 0 ? ' is-active' : ''}" type="button"
      data-gal-thumb="${i}" aria-label="Show image ${i + 1} of ${p.images.length}"${i === 0 ? ' aria-current="true"' : ''}>
      <img src="${esc(im.src)}" alt="" aria-hidden="true" loading="lazy" decoding="async">
    </button>`
    )
    .join('\n    ');

  const slides = p.images
    .map(
      (im, i) => `<li class="gal__slide" data-gal-slide="${i}">
      <button class="gal__zoom" type="button" data-gal-open="${i}" aria-label="Open image ${i + 1} full size">
        ${picture({
          src: im.src,
          alt: im.alt,
          className: 'gal__img',
          eager: i === 0,
          sizes: '(min-width: 900px) 55vw, 100vw',
          entry: imageEntry(im),
        })}
      </button>
    </li>`
    )
    .join('\n    ');

  const dots = p.images
    .map(
      (im, i) => `<button class="gal__dot${i === 0 ? ' is-active' : ''}" type="button"
      data-gal-dot="${i}" aria-label="Go to image ${i + 1} of ${p.images.length}"${i === 0 ? ' aria-current="true"' : ''}></button>`
    )
    .join('\n      ');

  return `<div class="gal" data-gallery data-gal-total="${p.images.length}">
  <div class="gal__stage">
    <ul class="gal__track" data-gal-track>
      ${slides}
    </ul>
    <p class="gal__counter" data-gal-counter aria-live="polite">1 / ${p.images.length}</p>
  </div>
  <div class="gal__dots" role="group" aria-label="Go to image" data-gal-dots>
    ${dots}
  </div>
  <div class="gal__thumbs" role="group" aria-label="Product images">
    ${thumbs}
  </div>
</div>

<div class="lightbox" data-lightbox hidden>
  <button class="lightbox__close" type="button" data-lb-close aria-label="Close">${iconClose()}</button>
  <button class="lightbox__nav lightbox__nav--prev" type="button" data-lb-prev aria-label="Previous image">${iconArrow()}</button>
  <img class="lightbox__img" data-lb-img alt="">
  <button class="lightbox__nav lightbox__nav--next" type="button" data-lb-next aria-label="Next image">${iconArrow()}</button>
  <p class="lightbox__counter" data-lb-counter></p>
</div>`;
}

/**
 * Size button. "Low stock" appears only when a real quantity is configured —
 * an unknown quantity never becomes manufactured scarcity. `s` here is
 * already the resolved {label, available, low} shape toProductViewModel()
 * produces, so this never has to know whether the product came from the
 * static catalogue or the database.
 */
function sizeButton(s) {
  const state = !s.available ? 'sold_out' : s.low ? 'low' : 'available';
  const disabled = !s.available;
  return `<button class="size-btn" type="button" role="radio" aria-checked="false"
            data-size="${esc(s.label)}" data-state="${state}"${
              disabled ? ' disabled aria-disabled="true"' : ''
            }${s.low ? ` aria-label="${esc(s.label)} — low stock"` : ''}>${esc(s.label)}${
              s.low ? '<span class="size-btn__low" aria-hidden="true">LOW</span>' : ''
            }</button>`;
}

export default function product(rawProduct, { site = staticSite, content = {}, allProducts = staticProducts } = {}) {
  const p = toProductViewModel(rawProduct);
  const min = site.shipping.freeShippingMinPieces;
  const soldOut = p.soldOut;
  const heroImage = p.images[0].src;

  const body = `
<nav class="crumbs wrap" aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Home</a></li>
    <li><a href="/shop/">Shop</a></li>
    <li aria-current="page">${esc(p.shortName)}</li>
  </ol>
</nav>

<section class="pdp wrap" data-product="${esc(p.slug)}" data-slug="${esc(p.slug)}" data-price="${esc(String(p.price))}">
  <div class="pdp__media">
    ${gallery(p)}
  </div>

  <div class="pdp__panel">
    <div class="pdp__head">
      ${p.badge ? `<p class="eyebrow eyebrow--lower">${esc(p.badge)}</p>` : ''}
      <h1 class="pdp__title">${esc(p.name)}</h1>
      <p class="price price--lg">${
        p.compareAtPrice
          ? `<span class="card__was">${money(p.compareAtPrice, p.currency)}</span> ${money(p.price, p.currency)}`
          : money(p.price, p.currency)
      }</p>
      ${when(
        confirmedSpecs(p).length > 0,
        () => `<ul class="pdp__specs">${confirmedSpecs(p)
          .map(([, v]) => `<li>${esc(v)}</li>`)
          .join('')}</ul>`
      )}
    </div>

    <form class="pdp__form" data-add-form novalidate>
      <fieldset class="sizes">
        <legend class="eyebrow eyebrow--lower">size</legend>
        <div class="sizes__row" role="radiogroup" aria-label="Size" data-size-group>
          ${p.sizes.map((s) => sizeButton(s)).join('\n          ')}
        </div>
        <p class="sizes__hint" data-size-hint role="status">Select a size to continue.</p>
      </fieldset>

      <div class="qty">
        <span class="eyebrow eyebrow--lower" id="qty-label">quantity</span>
        <div class="qty__control" role="group" aria-labelledby="qty-label">
          <button class="qty__btn" type="button" data-qty-dec aria-label="Decrease quantity">&minus;</button>
          <input class="qty__input" type="number" inputmode="numeric" min="1" max="99" value="1" data-qty-input aria-label="Quantity">
          <button class="qty__btn" type="button" data-qty-inc aria-label="Increase quantity">+</button>
        </div>
      </div>

      <button class="btn btn--solid btn--block btn--lg" type="submit" data-add-btn disabled>
        ${soldOut ? 'Sold out' : 'Add to cart'}
      </button>
      <p class="pdp__added" data-add-status role="status"></p>
    </form>

    <p class="pdp__ship">
      <span class="muted">FREE SHIPPING ON ${min}+ PIECES</span>
    </p>

    <div class="accordions">
      ${accordion(
        'acc-desc',
        'Description',
        (p.tagline ? `<p class="pdp__tagline">${esc(p.tagline)}</p>` : '') +
          paragraphs(p.description) +
          (p.highlights?.length
            ? `<ul class="highlights">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
            : ''),
        true
      )}
      ${accordion('acc-details', 'Product details', detailsBody(p))}
      ${when(
        p.careInstructions?.length > 0,
        () =>
          accordion(
            'acc-care',
            'Care',
            `<ul class="tick-list">${p.careInstructions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
          )
      )}
      ${accordion('acc-size', 'Size guide', sizeGuideBody(p))}
      ${accordion('acc-ship', 'Shipping', shippingBody(site, content))}
      ${accordion(
        'acc-order',
        'How ordering works',
        `<ol class="steps">
          <li><span class="steps__n">1</span><span>Add your size to the cart and fill in your details at checkout.</span></li>
          <li><span class="steps__n">2</span><span>You send us the order on WhatsApp.</span></li>
          <li><span class="steps__n">3</span><span>We reply with the ${esc(site.payment.method.split('—')[0].trim())} transfer details.</span></li>
          <li><span class="steps__n">4</span><span>We verify the transfer by hand and confirm your order.</span></li>
        </ol>
        <p class="muted">${esc(site.payment.note)}</p>`
      )}
      ${accordion(
        'acc-returns',
        'Returns & exchanges',
        `<p>Return and exchange conditions are currently being finalized. Contact ${esc(site.brand)} before sending any item back.</p><p><a class="link-underline" href="/policies/returns/">Returns policy</a></p>`
      )}
      ${accordion('acc-support', 'Support', supportBody(site, content))}
    </div>
  </div>
</section>

<div class="sticky-buy" data-sticky-buy hidden>
  <div class="sticky-buy__meta">
    <span class="sticky-buy__name">${esc(p.shortName)}</span>
    <span class="sticky-buy__price">${money(p.price, p.currency)}</span>
  </div>
  <button class="btn btn--solid" type="button" data-sticky-add>Add to cart</button>
</div>
`;

  // Structured data carries only confirmed facts. Fabric and weight appear
  // here only once they exist in the product data.
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.shortDescription,
    image: p.images.map((i) => (site.domain ? site.domain.replace(/\/$/, '') + i.src : i.src)),
    brand: { '@type': 'Brand', name: site.brand },
    ...(isSet(p.fabric) ? { material: p.fabric } : {}),
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: p.currency,
      availability:
        p.availability === 'sold_out'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      ...(site.domain ? { url: `${site.domain.replace(/\/$/, '')}/products/${p.slug}/` } : {}),
    },
  };

  return page({
    title: `${p.name} — ${site.brand}`,
    description: p.shortDescription,
    path: `/products/${p.slug}/`,
    ogImage: heroImage,
    bodyClass: 'page-product',
    body,
    products: allProducts.map(toStoreShape),
    jsonLd: productJsonLd,
    extraHead: preloadHero(heroImage, '(min-width: 900px) 55vw, 100vw'),
    scripts: ['/assets/js/product.js'],
    site,
    content,
  });
}
