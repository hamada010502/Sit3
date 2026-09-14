import { site as staticSite, isSet, activeSocial, whatsappConfigured } from '../site.config.js';
import { esc, when } from './html.js';
import { iconClose, iconBag } from './icons.js';

/**
 * Every function below takes an optional `site` parameter (defaulting to the
 * static site.config.js import, which keeps build.js's static-export path
 * working unchanged). A parameter named `site` shadows the module import
 * inside the function body, so `site.brand`, `site.shipping...` etc. read
 * from whichever was actually passed in — no internal reference had to
 * change. The server passes a live, per-request object (static config with
 * the admin-editable content/settings values merged in) so a change made in
 * /admin appears on the next page load, not the next deploy.
 */

const NAV_INFO = [
  ['/story/', 'Story'],
  ['/contact/', 'Contact'],
  ['/policies/shipping/', 'Shipping'],
  ['/policies/returns/', 'Returns'],
  ['/policies/privacy/', 'Privacy'],
  ['/policies/terms/', 'Terms'],
];

const canonical = (site, path) => (isSet(site.domain) ? site.domain.replace(/\/$/, '') + path : null);

/**
 * Serialise a value for embedding inside a <script> element.
 *
 * JSON.stringify alone is not enough: a string containing "</script>" ends the
 * element early as far as the HTML parser is concerned, and whatever follows is
 * parsed as markup. Escaping every "<" to its unicode form is still valid
 * JSON and parses back to the identical string, but can no longer close
 * the tag.
 *
 * Every <script> in this file goes through here — the runtime config block and
 * the JSON-LD block both carry admin-supplied text (product names, taglines,
 * descriptions), so neither may be the one that skips it.
 */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function head({ title, description, path, ogImage, jsonLd, bodyClass, noindex, extraHead, site = staticSite }) {
  const url = canonical(site, path);
  const ogImg = ogImage && url ? site.domain.replace(/\/$/, '') + ogImage : ogImage;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
${url ? `<link rel="canonical" href="${esc(url)}">` : '<!-- canonical omitted: final domain not configured -->'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.brand)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">` : ''}
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/site.css">
<link rel="icon" href="/assets/brand/vestiphobia-wordmark.png">
${extraHead || ''}
${jsonLd ? `<script type="application/ld+json">${scriptJson(jsonLd)}</script>` : ''}
</head>
<body class="${esc(bodyClass || '')}">
<a class="skip-link" href="#main">Skip to content</a>`;
}

/**
 * Sitewide announcement ticker, above the header on every page. Pure CSS
 * loop (no JS): the track holds the announcement twice back-to-back and
 * animates to -50%, which is seamless because the second copy is pixel-
 * identical to the first. The visible, animated copy is aria-hidden — a
 * single sr-only paragraph carries the text to assistive tech once, not
 * once per repeat.
 */
function marquee(site = staticSite, content = {}) {
  const text = content['announcement'] || site.announcement;
  if (!isSet(text)) return '';
  const item = `<span class="marquee__item">${esc(text)}</span>`;
  return `<div class="marquee" data-marquee>
  <p class="sr-only">${esc(text)}</p>
  <div class="marquee__track" aria-hidden="true">
    <span class="marquee__group">${item.repeat(6)}</span>
    <span class="marquee__group">${item.repeat(6)}</span>
  </div>
</div>`;
}

function header(site = staticSite) {
  return `<header class="header" data-header>
  <nav class="header__bar" aria-label="Primary">
    <div class="header__side header__side--left">
      <button class="icon-btn header__menu" type="button" data-menu-open aria-expanded="false" aria-controls="mobile-menu">
        <span class="icon-btn__glyph" aria-hidden="true"><span></span><span></span></span>
        <span class="sr-only">Open menu</span>
      </button>
      <a class="nav-link header__shop" href="/shop/">Shop</a>
    </div>

    <a class="header__brand" href="/" aria-label="${esc(site.brand)} — home">
      ${
        site.logo.useMarkInHeader
          ? `<img class="header__mark" src="${esc(site.logo.markSrc)}" alt="${esc(site.brand)}">`
          : `<span class="wordmark">${esc(site.brand)}</span>`
      }
    </a>

    <div class="header__side header__side--right">
      <a class="nav-link header__desk" href="/story/">Story</a>
      <a class="nav-link header__desk" href="/contact/">Contact</a>
      <button class="nav-link cart-link" type="button" data-cart-open aria-expanded="false" aria-controls="cart-drawer">
        ${iconBag()}
        <span class="sr-only" data-cart-count-label>0 items in cart</span>
        <span class="cart-count" data-cart-count aria-hidden="true">0</span>
      </button>
    </div>
  </nav>
</header>

<div class="mobile-menu" id="mobile-menu" hidden>
  <div class="mobile-menu__head">
    <span class="wordmark wordmark--sm">${esc(site.brand)}</span>
    <button class="icon-btn" type="button" data-menu-close>${iconClose()}<span class="sr-only">Close menu</span></button>
  </div>
  <nav class="mobile-menu__nav" aria-label="Mobile">
    <a href="/shop/">Shop</a>
    <a href="/story/">Story</a>
    <a href="/contact/">Contact</a>
    <details class="mobile-menu__group">
      <summary>Policies</summary>
      <a href="/policies/shipping/">Shipping</a>
      <a href="/policies/returns/">Returns &amp; Exchanges</a>
      <a href="/policies/privacy/">Privacy</a>
      <a href="/policies/terms/">Terms</a>
    </details>
  </nav>
</div>`;
}

export function newsletterForm(variant = 'section', site = staticSite) {
  const configured = isSet(site.newsletter.provider) && isSet(site.newsletter.endpoint);
  return `<form class="signup signup--${esc(variant)}" data-newsletter${configured ? ` action="${esc(site.newsletter.endpoint)}" method="post"` : ''}>
  <div class="signup__row">
    <label class="sr-only" for="newsletter-${esc(variant)}">Email</label>
    <input class="signup__input" id="newsletter-${esc(variant)}" type="email" name="email" placeholder="Email" autocomplete="email" required>
    <button class="btn btn--solid" type="submit">Join</button>
  </div>
  <p class="signup__note" data-newsletter-note>${
    configured
      ? 'You can unsubscribe at any time.'
      : 'Signup is not connected to an email service yet, so addresses entered here are not stored or sent anywhere. The form goes live once a newsletter provider is configured.'
  }</p>
  <p class="signup__status" data-newsletter-status role="status"></p>
</form>`;
}

/**
 * Social links. An account with no URL is omitted entirely rather than shown
 * as a dead "coming soon" row — no invented handles, and no clutter.
 */
function socialLinks(site = staticSite) {
  const links = activeSocial(site);
  if (!links.length) return '';
  return `<ul class="plain-list">
  ${links
    .map(
      (s) =>
        `<li><a href="${esc(s.url)}" rel="me noopener" target="_blank">${esc(s.label)}</a></li>`
    )
    .join('\n  ')}
</ul>`;
}

export function socialSection(site = staticSite) {
  const links = socialLinks(site);
  if (!links) return '';
  return `<section class="section section--tight follow" aria-labelledby="follow-h">
  <div class="wrap">
    <h2 class="eyebrow" id="follow-h">Follow ${esc(site.brand)}</h2>
    ${links}
  </div>
</section>`;
}

function footer(site = staticSite) {
  const social = socialLinks(site);
  return `<footer class="footer">
  <div class="wrap footer__grid">
    <div class="footer__col footer__col--brand">
      <span class="wordmark wordmark--sm">${esc(site.brand)}</span>
      <p class="footer__line">${esc(site.tagline)}.</p>
    </div>

    <div class="footer__col">
      <h2 class="eyebrow">Shop</h2>
      <ul class="plain-list"><li><a href="/shop/">Shop</a></li></ul>
    </div>

    <div class="footer__col">
      <h2 class="eyebrow">Info</h2>
      <ul class="plain-list">
        ${NAV_INFO.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('\n        ')}
      </ul>
    </div>

    ${
      social
        ? `<div class="footer__col">
      <h2 class="eyebrow">Follow</h2>
      ${social}
    </div>`
        : ''
    }

    <div class="footer__col footer__col--signup">
      <h2 class="footer__signup-h">Enter the ${esc(site.brand)}</h2>
      ${newsletterForm('footer', site)}
    </div>
  </div>

  <div class="wrap footer__base">
    <p>&copy; ${site.copyrightYear} ${esc(site.brand)}</p>
    ${when(isSet(site.legal.businessName), () => `<p>${esc(site.legal.businessName)}</p>`)}
  </div>
</footer>`;
}

function cartDrawer(site = staticSite) {
  return `<div class="drawer-scrim" data-scrim hidden></div>
<aside class="drawer" id="cart-drawer" aria-label="Cart" hidden>
  <div class="drawer__head">
    <h2 class="drawer__title">Cart <span class="drawer__count" data-cart-count>0</span></h2>
    <button class="icon-btn" type="button" data-cart-close>${iconClose()}<span class="sr-only">Close cart</span></button>
  </div>

  <div class="drawer__body" data-cart-body>
    <p class="drawer__empty" data-cart-empty>Your cart is empty.</p>
    <ul class="cart-lines" data-cart-lines></ul>
  </div>

  <div class="drawer__foot" data-cart-foot hidden>
    <p class="ship-progress" data-ship-progress role="status"></p>
    <div class="drawer__subtotal">
      <span>Subtotal</span>
      <span data-cart-subtotal>$0 USD</span>
    </div>
    <p class="drawer__fineprint">Free shipping applies to orders containing ${site.shipping.freeShippingMinPieces} or more pieces. Below that, shipping is arranged with you directly.</p>
    <div class="drawer__actions">
      <button class="btn btn--ghost" type="button" data-cart-close>Continue shopping</button>
      <a class="btn btn--solid" href="/checkout/">Checkout</a>
    </div>
  </div>
</aside>`;
}

/**
 * Config the browser needs at runtime, serialised once per page.
 * No secrets belong here — everything in this object is public by definition.
 */
function runtimeConfig(products, site = staticSite) {
  const cfg = {
    brand: site.brand,
    freeShippingMinPieces: site.shipping.freeShippingMinPieces,
    // The wa.me destination.
    //
    // In API mode it is NOT sent to the browser at all: the server builds the
    // handoff link and returns it with the confirmed order, so the number
    // never reaches the page bundle. Only a standalone static build, which has
    // no server to build that link, still needs it here — and even then it
    // lives in the href alone and is never rendered as visible copy. A QA
    // check fails the build if it appears in page text.
    whatsappNumber:
      site.api.enabled || !whatsappConfigured(site)
        ? ''
        : String(site.whatsapp.number).replace(/\D/g, ''),
    instagramUrl: site.contact.instagram,
    paymentMethod: site.payment.method,
    discounts: {
      bundleTiers: site.discounts.bundleTiers,
      returningCustomerPercent: site.discounts.returningCustomerPercent,
      freeShippingMinPieces: site.shipping.freeShippingMinPieces,
    },
    returningCustomerPercent: site.discounts.returningCustomerPercent,
    deliveryEstimate: site.shipping.deliveryEstimate,
    orderIdPrefix: site.orders.idPrefix,
    orderSeqPadding: site.orders.sequencePadding,
    // The backend in server/. When set, orderService talks to it and the
    // server owns order numbers, prices and stock. When null, the site is
    // standalone and orders live only in the customer's own browser.
    ordersEndpoint: site.api.enabled ? site.api.ordersEndpoint : null,
    newsletterConfigured: isSet(site.newsletter.provider) && isSet(site.newsletter.endpoint),
    contactEmail: site.contact.email,
    products,
  };
  return `<script>window.VESTI = ${scriptJson(cfg)};</script>`;
}

/**
 * @param chrome  false renders the page without the storefront header, footer
 *                and cart drawer — used by the admin area, which is not part
 *                of the shop.
 */
export function page({
  title,
  description,
  path,
  body,
  bodyClass = '',
  ogImage = null,
  jsonLd = null,
  products = [],
  scripts = [],
  noindex = false,
  chrome = true,
  extraHead = '',
  site = staticSite,
  content = {},
}) {
  return `${head({ title, description, path, ogImage, jsonLd, bodyClass, noindex, extraHead, site })}
${chrome ? marquee(site, content) : ''}
${chrome ? header(site) : ''}
<main id="main">
${body}
</main>
${chrome ? footer(site) : ''}
${chrome ? cartDrawer(site) : ''}
${runtimeConfig(products, site)}
${chrome ? '<script src="/assets/js/store.js" type="module"></script>' : ''}
${site.analytics.firstParty ? '<script src="/assets/js/analytics.js" type="module"></script>' : ''}
${scripts.map((s) => `<script src="${esc(s)}" type="module"></script>`).join('\n')}
</body>
</html>`;
}
