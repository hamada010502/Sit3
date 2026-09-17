import { site as staticSite } from '../site.config.js';
import { page } from '../lib/layout.js';
import { esc, priceHtml } from '../lib/html.js';
import { picture, primaryImage, imageEntry } from '../lib/images.js';
import { products as staticProducts, toStoreShape, groupByCategory } from '../data/products.js';

/**
 * Product card. Reused as-is by the homepage's carousel row, so there is
 * exactly one place that knows how to render a product tile.
 */
export function card(p, index) {
  const main = primaryImage(p.images);
  const hover = p.images.find((i) => i.role === 'detail') || p.images.find((i) => i !== main) || null;
  const soldOut = p.availability === 'sold_out' || p.status === 'SOLD_OUT' || p.soldOut === true;

  return `<li class="card" data-product-card data-slug="${esc(p.slug)}" data-position="${index + 1}">
  <a class="card__link" href="/products/${esc(p.slug)}/">
    <div class="card__media">
      ${picture({
        src: main.src,
        alt: main.alt,
        className: 'card__img',
        eager: index === 0,
        sizes: '(min-width: 1100px) 30vw, (min-width: 640px) 45vw, 100vw',
        entry: imageEntry(main),
      })}
      ${
        hover
          ? picture({
              src: hover.src,
              alt: '',
              decorative: true,
              pictureClass: 'card__hover',
              sizes: '(min-width: 1100px) 30vw, (min-width: 640px) 45vw, 100vw',
              entry: imageEntry(hover),
            })
          : ''
      }
      ${p.badge ? `<span class="card__badge">${esc(p.badge)}</span>` : ''}
      ${soldOut ? '<span class="card__badge card__badge--muted">Sold out</span>' : ''}
    </div>
    <div class="card__meta">
      <h3 class="card__name">${esc(p.name)}</h3>
      <p class="card__price">${priceHtml(p.price, p.compareAtPrice, p.currency)}</p>
      <span class="card__cta">View product</span>
    </div>
  </a>
</li>`;
}

/**
 * One horizontally-scrolling row of product cards for a single category.
 * Reused unchanged by the homepage — the only difference between the two
 * call sites is which products array they group and render.
 */
export function categoryRow({ key, label, products }) {
  const count = products.length;
  return `<section class="category-row" aria-labelledby="cat-${esc(key)}-h">
  <div class="wrap">
    <div class="category-row__head">
      <h2 class="eyebrow" id="cat-${esc(key)}-h">${esc(label)}</h2>
      <span class="eyebrow category-row__count">${count} ${count === 1 ? 'piece' : 'pieces'}</span>
      <a class="eyebrow category-row__see-all" href="/shop/#cat-${esc(key)}-h">see all &rarr;</a>
    </div>
    <p class="category-row__hint">swipe / scroll &rarr;</p>
    <ul class="category-row__track" data-product-grid aria-label="${esc(label)} products">
      ${products.map(card).join('\n      ')}
    </ul>
  </div>
</section>`;
}

export default function shop({ site = staticSite, products = staticProducts, content = {} } = {}) {
  const count = products.length;
  const rows = groupByCategory(products);

  const body = `
<section class="section page-head" aria-labelledby="shop-h">
  <div class="wrap">
    <h1 class="display" id="shop-h">Shop</h1>
    <p class="page-head__note">${count} ${count === 1 ? 'piece' : 'pieces'} available.</p>
  </div>
</section>

<section class="section section--top-tight" aria-label="Products">
  ${rows.map(categoryRow).join('\n  ')}
</section>

<section class="section section--tight" aria-labelledby="more-h">
  <div class="wrap next-drop">
    <h2 class="eyebrow eyebrow--lower" id="more-h">next</h2>
    <p class="lede">More pieces are in development. Join the list to see them first.</p>
    <a class="link-underline link-cta" href="/#collective-h">enter the fear.</a>
  </div>
</section>
`;

  return page({
    title: `Shop — ${site.brand}`,
    description:
      'Shop VESTIPHOBIA. The first drop: VESTIPHOBIA 001 — FEAR TEE, $17 USD, sizes S–XXL.',
    path: '/shop/',
    ogImage: (products[0]?.images[0] || {}).src || null,
    bodyClass: 'page-shop',
    body,
    products: products.map(toStoreShape),
    site,
    content,
  });
}
