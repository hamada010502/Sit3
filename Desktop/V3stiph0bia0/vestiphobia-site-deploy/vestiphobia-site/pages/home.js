import { site as staticSite } from '../site.config.js';
import { page, newsletterForm, socialSection } from '../lib/layout.js';
import { esc, money, paragraphs } from '../lib/html.js';
import { picture, preloadHero, primaryImage, imageEntry } from '../lib/images.js';
import { featuredProduct, toStoreShape, groupByCategory, products as staticProducts } from '../data/products.js';
import { categoryRow } from './shop.js';

const HERO = '/assets/images/01_red_concrete_wide.jpeg';

/**
 * Editorial sequence for the homepage. Every supplied photograph is portrait
 * (~4:5) — the layout is built around that rather than forcing a landscape
 * crop that would cut the garment.
 */
const EDITORIAL = [
  {
    src: '/assets/images/06_right_facing_profile.jpeg',
    alt: 'Right-facing profile of the model in the Fear Tee, kitchen light falling across the shoulder.',
    span: 'wide',
  },
  {
    src: '/assets/images/07_back_facing.jpeg',
    alt: 'Back view of the model wearing the Fear Tee.',
    span: 'narrow',
  },
  {
    src: '/assets/images/04_red_concrete_wall_three_quarter_back.jpeg',
    alt: 'Three-quarter rear view of the model against the red-lit concrete wall.',
    span: 'offset',
  },
];

export default function home({ site = staticSite, products = staticProducts, product = null, content = {} } = {}) {
  // The intro block follows the admin's "Featured on homepage" flag on the
  // live catalogue. It used to read featuredProduct() from the static
  // data/products.js file regardless of what was passed in, so a rename,
  // re-photograph or a different featured product in the admin never reached
  // the homepage. The static entry remains only as a last resort for an
  // empty catalogue, so the page still renders.
  const p = product || products.find((x) => x.featured) || products[0] || featuredProduct();
  const main = primaryImage(p.images);
  const detail = p.images.find((i) => i.role === 'detail') || p.images.find((i) => i !== main) || main;
  const heroImage = content['home.hero_image'] || HERO;
  const heroLine = content['home.hero_line'] || 'Clothing for the uncomfortable.';

  const body = `
<section class="hero" aria-labelledby="hero-h">
  ${picture({
    src: heroImage,
    alt: 'Campaign image: a figure standing alone in front of a vast red-lit concrete wall, wearing the black VESTIPHOBIA Fear Tee.',
    className: 'hero__img',
    pictureClass: 'hero__media',
    eager: true,
    sizes: '100vw',
    ratio: 'auto',
  })}
  <div class="hero__veil" aria-hidden="true"></div>
  <div class="hero__copy">
    <h1 id="hero-h">
      <span class="sr-only">${esc(site.brand)} — ${esc(site.tagline)}</span>
      ${picture({
        src: site.logo.markSrc,
        alt: '',
        decorative: true,
        className: 'hero__mark',
        pictureClass: 'hero__mark-wrap',
        eager: true,
        sizes: '(min-width: 900px) 380px, 76vw',
        ratio: 'auto',
      })}
    </h1>
    <p class="hero__line">${esc(heroLine)}</p>
    <a class="btn btn--solid btn--lg" href="/products/${esc(p.slug)}/">Shop the first drop</a>
  </div>
</section>

<section class="section intro" aria-labelledby="intro-h">
  <div class="wrap intro__grid">
    <div class="intro__media">
      ${picture({
        src: main.src,
        alt: main.alt,
        className: 'intro__img',
        sizes: '(min-width: 900px) 23vw, 46vw',
        entry: imageEntry(main),
      })}
      ${picture({
        src: detail.src,
        alt: detail.alt,
        className: 'intro__img',
        sizes: '(min-width: 900px) 23vw, 46vw',
        entry: imageEntry(detail),
      })}
    </div>

    <div class="intro__text">
      <p class="eyebrow">001 / First Drop</p>
      <h2 class="display" id="intro-h">${esc(p.shortName)}</h2>
      <p class="price">${money(p.price, p.currency)}</p>
      <p class="lede">${esc(p.shortDescription)}</p>
      <a class="btn btn--outline" href="/products/${esc(p.slug)}/">View product</a>
    </div>
  </div>
</section>

<section class="section" aria-label="Browse the collection">
  ${groupByCategory(products).map(categoryRow).join('\n  ')}
</section>

<section class="editorial" aria-label="Campaign imagery">
  ${EDITORIAL.map(
    (e) => `<figure class="editorial__item editorial__item--${e.span}">
    ${picture({ src: e.src, alt: e.alt, sizes: '(min-width: 900px) 50vw, 100vw' })}
    ${e.caption ? `<figcaption class="eyebrow">${esc(e.caption)}</figcaption>` : ''}
  </figure>`
  ).join('\n  ')}
</section>

<section class="section story-block" aria-labelledby="why-h">
  <div class="wrap story-block__grid">
    <h2 class="display display--md display--lower" id="why-h">${esc(content['home.story.heading'] || 'why vestiphobia.')}</h2>
    <div class="prose">
      ${paragraphs(
        content['home.story.body'] || [
          'Clothing is never just clothing.',
          'We started from a simple contradiction: the fear of what we put on our bodies, and the need to express through it. Vestiphobia is an archive-driven, underground project built for people who treat garments as identity, not trend.',
          'Every piece is made with intention — weight, texture, fit, and a quiet refusal to look like everything else.',
          'This is not fashion. This is personal armor.',
        ]
      )}
      <p><a class="link-underline link-cta" href="/story/">Read our story</a></p>
    </div>
  </div>
</section>

<section class="section collective" aria-labelledby="collective-h">
  <div class="wrap collective__inner">
    <h2 class="display display--md display--lower" id="collective-h">enter the fear.</h2>
    <p class="lede">First access to new pieces, drops and whatever comes next.</p>
    ${newsletterForm('section', site)}
  </div>
</section>

${socialSection(site)}
`;

  return page({
    title: `${site.brand} — ${site.tagline}`,
    description:
      'VESTIPHOBIA is an underground fashion label built around clothing as identity and tension. The first drop: the FEAR TEE, a black graphic tee in sizes S–XXL.',
    path: '/',
    ogImage: heroImage,
    bodyClass: 'page-home',
    body,
    products: products.map(toStoreShape),
    extraHead: preloadHero(heroImage, '100vw'),
    site,
    content,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.brand,
      description: 'Underground fashion label. Clothing as identity, tension and self-expression.',
      ...(site.domain ? { url: site.domain } : {}),
    },
  });
}
