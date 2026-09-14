import { site as staticSite, isSet, activeSocial } from '../site.config.js';
import { page, newsletterForm } from '../lib/layout.js';
import { esc, paragraphs, when } from '../lib/html.js';
import { picture } from '../lib/images.js';
import { products as staticProducts, toStoreShape } from '../data/products.js';

const store = (products) => products.map(toStoreShape);

/** Placeholder for a legal/business value the owner has not supplied. */
const pending = (label) => `<span class="is-pending">[${esc(label)} — to be provided]</span>`;

const contactRef = (site, content = {}) => {
  const email = content['contact.email'] || site.contact.email;
  return isSet(email)
    ? `<a class="link-underline" href="mailto:${esc(email)}">${esc(email)}</a>`
    : pending('Contact email');
};

const operator = (site) => (isSet(site.legal.businessName) ? esc(site.legal.businessName) : pending('Legal business name'));

/* ------------------------------------------------------------------ Story */

const DEFAULT_STORY_BODY = [
  'Clothing is never just clothing.',
  'This didn\u2019t begin here. It began in 2020, somewhere further east, in a place that wasn\u2019t ready for it yet.',
  'It didn\u2019t make it past its own beginning. We don\u2019t explain why. Some things end quietly, and that\u2019s the whole story we\u2019re telling about it.',
  'What came back wasn\u2019t a relaunch. It was the same idea, rebuilt somewhere else, closer to what it meant to be the first time.',
  'We kept the name. We kept the fear. Everything else started over.',
];

export function story({ site = staticSite, content = {}, products = staticProducts } = {}) {
  const body = `
<section class="section page-head" aria-labelledby="story-h">
  <div class="wrap">
    <p class="eyebrow">${esc(site.brand)}</p>
    <h1 class="display" id="story-h">Our Story</h1>
  </div>
</section>

<section class="section section--top-tight" aria-label="Brand statement">
  <div class="wrap story-page__grid">
    <div class="prose prose--lg">
      ${paragraphs(content['story.body'] || DEFAULT_STORY_BODY)}
    </div>
    <figure class="story-page__fig">
      ${picture({
        src: '/assets/images/01_red_concrete_wide.jpeg',
        alt: 'A figure standing alone in front of a vast red-lit concrete wall, wearing the black VESTIPHOBIA Fear Tee.',
        sizes: '(min-width: 900px) 42vw, 100vw',
      })}
    </figure>
  </div>
</section>

<section class="section story-second" aria-labelledby="first-piece-h">
  <div class="wrap story-page__grid story-page__grid--flip">
    <figure class="story-page__fig">
      ${picture({
        src: '/assets/images/04_tshirt_detail.jpeg',
        alt: 'Close detail of the red VESTIPHOBIA wordmark printed across the front of the black tee.',
        sizes: '(min-width: 900px) 42vw, 100vw',
      })}
    </figure>
    <div class="prose prose--lg">
      <h2 class="display display--md display--lower" id="first-piece-h">the first piece.</h2>
      ${paragraphs([
        `The FEAR TEE is the first physical expression of ${site.brand}.`,
        'Black. Red. Direct.',
        'You either get it, or you don’t. Both are fine.',
      ])}
      ${when(
        products.length > 0,
        () => `<p><a class="btn btn--outline" href="/products/${esc(products[0].slug)}/">View the Fear Tee</a></p>`
      )}
    </div>
  </div>
</section>
`;

  return page({
    title: `Our Story — ${site.brand}`,
    description:
      'Clothing is never just clothing. VESTIPHOBIA is an archive-driven, underground project for people who treat garments as identity, not trend.',
    path: '/story/',
    ogImage: '/assets/images/01_red_concrete_wide.jpeg',
    bodyClass: 'page-story',
    body,
    products: store(products),
    site,
    content,
  });
}

/* ---------------------------------------------------------------- Contact */

export function contact({ site = staticSite, content = {}, products = staticProducts } = {}) {
  const email = content['contact.email'] || site.contact.email;
  const body = `
<section class="section page-head" aria-labelledby="contact-h">
  <div class="wrap">
    <h1 class="display" id="contact-h">Contact</h1>
  </div>
</section>

<section class="section section--top-tight" aria-label="Contact details">
  <div class="wrap contact__grid">
    <div class="prose prose--lg">
      <p>Questions about an order, sizing, shipping or the collection?</p>
      <p>Reach out and we'll get back to you.</p>
      <p>Orders are placed through the shop and confirmed with us on WhatsApp — see <a class="link-underline" href="/policies/shipping/">how ordering works</a>.</p>
    </div>

    <div class="contact__box">
      <h2 class="eyebrow">Email</h2>
      ${
        isSet(email)
          ? `<p class="contact__email"><a class="link-underline" href="mailto:${esc(email)}">${esc(email)}</a></p>`
          : `<p class="contact__email is-pending">Contact email — coming soon</p>
      <p class="muted">A support address is being set up. It will appear here, in the footer and on every policy page as soon as it is live.</p>`
      }

      ${
        activeSocial(site).length
          ? `<h2 class="eyebrow">Social</h2>
      <ul class="plain-list">
        ${activeSocial(site)
          .map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.label)}</a></li>`)
          .join('\n        ')}
      </ul>`
          : ''
      }

      <h2 class="eyebrow">Newsletter</h2>
      ${newsletterForm('contact', site)}
    </div>
  </div>
</section>
`;

  return page({
    title: `Contact — ${site.brand}`,
    description: 'Contact VESTIPHOBIA about an order, sizing, shipping or the collection.',
    path: '/contact/',
    bodyClass: 'page-contact',
    body,
    products: store(products),
    site,
    content,
  });
}

/* --------------------------------------------------------------- Policies */

function policyPage({
  slug,
  title,
  heading,
  sections,
  description,
  site = staticSite,
  products = staticProducts,
  content = {},
}) {
  const body = `
<section class="section page-head" aria-labelledby="policy-h">
  <div class="wrap">
    <p class="eyebrow">Policies</p>
    <h1 class="display display--md" id="policy-h">${esc(heading)}</h1>
  </div>
</section>

<section class="section section--top-tight" aria-label="${esc(heading)}">
  <div class="wrap policy">
    <nav class="policy__nav" aria-label="Policies">
      <a href="/policies/shipping/"${slug === 'shipping' ? ' aria-current="page"' : ''}>Shipping</a>
      <a href="/policies/returns/"${slug === 'returns' ? ' aria-current="page"' : ''}>Returns &amp; Exchanges</a>
      <a href="/policies/privacy/"${slug === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a>
      <a href="/policies/terms/"${slug === 'terms' ? ' aria-current="page"' : ''}>Terms</a>
    </nav>
    <div class="policy__body prose">
      ${sections
        .map(
          (s) =>
            (s.h ? `<h2>${esc(s.h)}</h2>` : '') +
            (s.html ? s.html : paragraphs(s.p || []))
        )
        .join('\n      ')}
    </div>
  </div>
</section>
`;

  return page({
    title: `${title} — ${site.brand}`,
    description,
    path: `/policies/${slug}/`,
    bodyClass: 'page-policy',
    body,
    products: store(products),
    site,
    content,
  });
}

export function shippingPolicy({ site = staticSite, content = {}, products = staticProducts } = {}) {
  const min = site.shipping.freeShippingMinPieces;
  const sh = site.shipping;
  const deliveryEstimate = content['shipping.delivery_estimate'] || sh.deliveryEstimate;
  const countryLabel = content['shipping.country_label'] || sh.countryLabel;
  const email = content['contact.email'] || site.contact.email;

  return policyPage({
    slug: 'shipping',
    title: 'Shipping Policy',
    heading: 'Shipping Policy',
    description:
      'VESTIPHOBIA ships within Syria. Delivery 5–7 business days. Free shipping on orders of two or more pieces.',
    site,
    content,
    products,
    sections: [
      {
        h: 'Where we ship',
        p: [
          `${site.brand} currently ships within ${countryLabel} only. We are not shipping internationally at this time.`,
        ],
      },
      {
        h: 'Delivery time',
        p: [`Delivery takes ${deliveryEstimate} from the moment your order is accepted.`],
      },
      {
        h: 'Shipping fee',
        p: [
          content['shipping.fee_note'] || 'The shipping fee is paid on delivery, directly to the courier.',
          'The amount is set by the shipping company and varies by region, so it is not shown as a fixed price on this website. We will confirm it with you over WhatsApp before your order is dispatched.',
          `Orders containing ${min} or more pieces ship free — we cover the fee for you.`,
        ],
      },
      {
        h: 'Your address',
        p: [
          'Please give a detailed delivery address including street, building and any landmark that helps the courier find you, along with a phone number they can reach.',
          'An incomplete address is the most common reason a delivery fails.',
        ],
      },
      {
        h: 'Questions',
        html: `<p>Message us on <a class="link-underline" href="${esc(site.contact.instagram)}" target="_blank" rel="noopener">Instagram</a>${
          isSet(email)
            ? ` or email <a class="link-underline" href="mailto:${esc(email)}">${esc(email)}</a>`
            : ''
        }, or reply on the WhatsApp thread for your order.</p>`,
      },
    ],
  });
}

export function returnsPolicy({ site = staticSite, content = {}, products = staticProducts } = {}) {
  const r = site.returns;
  const windowDays = content['returns.window_days'] || r.exchangeWindowDays;

  return policyPage({
    slug: 'returns',
    title: 'Returns & Exchanges',
    heading: 'Returns & Exchanges',
    description:
      'VESTIPHOBIA exchange policy. Exchanges within 7 days for size mismatch or product issues.',
    site,
    content,
    products,
    sections: [
      {
        h: 'Exchanges',
        p: [
          `You can request an exchange within ${windowDays} days of receiving your order.`,
          'Exchanges are accepted for a size mismatch or a problem with the product.',
        ],
      },
      {
        h: 'Condition',
        html: `<ul class="tick-list">
          <li>Unused</li>
          <li>Unwashed</li>
          <li>Undamaged</li>
          <li>In original condition</li>
        </ul>
        <p>Worn, washed or damaged items are not eligible. Final approval follows a review of the item's condition.</p>`,
      },
      {
        h: 'Refunds',
        p: [
          'We do not offer cash refunds at this time. Exchanges only.',
        ],
      },
      {
        h: 'Who pays exchange shipping',
        html: `<dl class="spec-list">
          <dt>We do</dt><dd>If we sent the wrong item, or there is a clear product defect.</dd>
          <dt>You do</dt><dd>If the wrong size was selected at checkout.</dd>
        </dl>`,
      },
      {
        h: 'How to request one',
        html: `<p>Message us on <a class="link-underline" href="${esc(site.contact.instagram)}" target="_blank" rel="noopener">Instagram</a> or on the WhatsApp thread for your order, and include your order number.</p>`,
      },
      {
        h: 'Undelivered or refused orders',
        p: [
          'An order that was refused at the door or could not be delivered is handled as a separate case, not as an exchange. Contact us and we will sort it out with you.',
        ],
      },
    ],
  });
}

export function privacyPolicy({ site = staticSite, content = {}, products = staticProducts } = {}) {
  // The analytics section is generated from the actual configuration, so the
  // policy cannot drift away from what the code does.
  const analytics = isSet(site.analytics.provider)
    ? [`We use ${site.analytics.provider} to understand how the site is used.`]
    : site.analytics.firstParty
      ? [
          'We measure how this site is used with our own software, running on our own server. No third-party analytics service, advertising network or social media pixel is installed, and nothing about your visit is shared with another company.',
        ]
      : [
          'No analytics of any kind is installed on this site at present. If that changes, this policy will be updated before it is enabled.',
        ];

  const marketing = isSet(site.newsletter.provider)
    ? [
        `If you subscribe to our newsletter, your email address is stored with our email provider (${site.newsletter.provider}) so we can send you updates. You can unsubscribe at any time.`,
      ]
    : [
        'The newsletter signup form on this site is not yet connected to an email service. Addresses submitted through it are not stored or transmitted. When a provider is configured, this policy will be updated to name it.',
      ];

  // There is no gateway. Payment happens off-site, by hand, over WhatsApp.
  const payments = [
    'This website does not process payments and never asks for card details. No payment information is collected here.',
    `Orders are confirmed over WhatsApp, and payment is arranged directly with us (${site.payment.method}). Anything you send us in that conversation is held in WhatsApp under WhatsApp's own terms and privacy policy.`,
    'A copy of your order is kept in your own browser so the confirmation page can show it back to you without asking for your phone number again. The order itself is held on our server, which is what lets us confirm, prepare and ship it.',
  ];

  return policyPage({
    slug: 'privacy',
    site,
    content,
    products,
    title: 'Privacy Policy',
    heading: 'Privacy Policy',
    description: 'How VESTIPHOBIA collects, uses and protects your information.',
    sections: [
      { p: [`This policy explains what information ${site.brand} collects and how it is used.`] },
      {
        h: 'Information we collect',
        p: [
          'Order information: the name, email address, shipping address, phone number (if provided) and order contents you submit when placing an order.',
          'Contact information: anything you send us when you get in touch about an order or a question.',
          'Technical information: standard web-server information such as browser type and pages requested.',
        ],
      },
      {
        h: 'Cookies and local storage',
        p: [
          'Your cart is stored in your own browser using local storage so it survives page navigation. It is not transmitted to us until you place an order.',
          'No advertising or tracking cookies are set by this site, and no cookie at all is set for visitors. The only cookie this site can issue is the session cookie for staff signing in to the admin area, which is not part of shopping here.',
        ],
      },
      { h: 'Analytics', p: analytics },
      ...(site.analytics.firstParty
        ? [
            {
              h: 'What our analytics records',
              html: `<p>So that this is checkable rather than a promise, here is the complete list.</p>
        <p><strong>Recorded:</strong> the pages you visit and when; which product and size you looked at;
        whether you added to the cart, began the checkout, or placed an order; how long a page was in the
        foreground; a coarse device class (mobile, tablet or desktop), operating system, browser name and
        screen-size band; the site that linked you here, and any campaign tag in the link you followed.</p>
        <p><strong>Not recorded, ever:</strong> your name, phone number, delivery address or email. Nothing
        you type into the checkout form is sent to our analytics — not even a partial value. Your IP address
        is not stored in our analytics data, not even in hashed form. We run no IP geolocation and hold no
        location database.</p>
        <p><strong>How you are counted:</strong> two random identifiers your own browser generates and stores
        for itself — one that lasts until you clear site data, so we can tell a first visit from a return, and
        one that lasts for the visit. Neither is derived from anything about your device, so neither can be
        used to recognise you on any other website. We set no analytics cookie and we do not fingerprint.</p>
        <p><strong>Retention:</strong> ${esc(String(site.analytics.retentionDays))} days for the raw records,
        after which they are deleted.</p>`,
            },
            {
              h: 'Turning analytics off',
              html: `<p>If your browser sends a Do Not Track or Global Privacy Control signal, this site
        already collects nothing about your visit — that is checked before anything is recorded.</p>
        <p>You can also switch it off here. This stores a single flag in your own browser and deletes the
        identifiers described above.</p>
        <p class="analytics-optout" data-analytics-optout>
          <button class="btn btn--outline" type="button" data-optout-toggle>Loading…</button>
          <span class="muted" data-optout-status role="status"></span>
        </p>
        <p class="fineprint">This setting lives in this browser only, so it has to be set again on another
        device or after clearing site data. Switching analytics off does not affect your cart, your checkout
        or your order — those are not analytics.</p>`,
            },
          ]
        : []),
      { h: 'Marketing and newsletter', p: marketing },
      { h: 'Payment processing', p: payments },
      {
        h: 'Data retention',
        p: [
          'Order information is retained for as long as needed to fulfil the order and to meet any legal or accounting obligations that apply to us.',
        ],
      },
      {
        h: 'Third-party services',
        p: [
          'Fonts on this site are served by Google Fonts, which receives the request for the font file.',
          'Any additional third-party service will be named in this policy before it is enabled.',
        ],
      },
      {
        h: 'Your rights',
        html: `<p>You may request access to, correction of, or deletion of the personal information we hold about you. Contact ${contactRef(site, content)}.</p>
        <p>The specific rights available to you depend on where you live. Governing jurisdiction: ${isSet(site.legal.jurisdiction) ? esc(site.legal.jurisdiction) : pending('Jurisdiction')}.</p>`,
      },
      {
        h: 'Operator and contact',
        html: `<p>This store is operated by ${operator(site)}${
          isSet(site.legal.address) ? `, ${esc(site.legal.address)}` : ''
        }.</p><p>Privacy questions: ${contactRef(site, content)}.</p>`,
      },
    ],
  });
}

export function termsPolicy({ site = staticSite, content = {}, products = staticProducts } = {}) {
  return policyPage({
    slug: 'terms',
    site,
    content,
    products,
    title: 'Terms of Service',
    heading: 'Terms of Service',
    description: 'The terms that apply when you use the VESTIPHOBIA website or place an order.',
    sections: [
      {
        html: `<p>These terms apply to your use of this website and to any order you place with ${operator(site)} ("${esc(site.brand)}", "we", "us").</p>`,
      },
      {
        h: 'Use of the website',
        p: [
          'You may browse and shop this site for personal, non-commercial use.',
          'You may not use the site in a way that damages it, interferes with other users, or breaks any law that applies to you.',
        ],
      },
      {
        h: 'Products and availability',
        p: [
          'Products are offered subject to availability. We may limit quantities or withdraw a product at any time.',
          'Product photography is a representation of the item. Colour reproduction varies between screens.',
        ],
      },
      {
        h: 'Pricing',
        p: [
          'Prices are listed in USD and may change without notice. The price that applies to an order is the price shown at the time the order is placed.',
          'If a product is listed at an incorrect price, we may cancel the order and refund any amount charged.',
        ],
      },
      {
        h: 'Orders',
        p: [
          'An order is an offer to buy. We may accept or decline it. A confirmation email acknowledges receipt of the order; acceptance occurs when the order is dispatched.',
        ],
      },
      {
        h: 'Payments',
        html: `<p>This website does not process payments. Placing an order here creates an order and hands it to WhatsApp; payment is then arranged directly with us (${esc(site.payment.method)}).</p>
        <p>An order is not paid until we have received and verified the transfer ourselves. Creating an order on this website does not transfer any money and is not a payment.</p>`,
      },
      {
        h: 'Shipping',
        html: `<p>Shipping is governed by our <a class="link-underline" href="/policies/shipping/">Shipping Policy</a>, which forms part of these terms.</p>`,
      },
      {
        h: 'Returns',
        html: `<p>Returns and exchanges are governed by our <a class="link-underline" href="/policies/returns/">Returns &amp; Exchanges</a> policy, which forms part of these terms.</p>`,
      },
      {
        h: 'Intellectual property',
        p: [
          `The ${site.brand} name, wordmark, campaign photography, product graphics, copy and site design are owned by us and may not be reproduced, resold or used commercially without written permission.`,
        ],
      },
      {
        h: 'User content',
        p: [
          'If you send us feedback, images or other material, you grant us permission to use it in connection with the brand. You confirm you have the right to share anything you send.',
        ],
      },
      {
        h: 'Limitation of liability',
        p: [
          'To the fullest extent permitted by the law that applies to you, our liability arising from an order is limited to the amount paid for that order.',
          'Nothing in these terms limits any liability that cannot lawfully be limited.',
        ],
      },
      {
        h: 'Governing law',
        html: `<p>These terms are governed by the laws of ${isSet(site.legal.jurisdiction) ? esc(site.legal.jurisdiction) : pending('Jurisdiction')}.</p>`,
      },
      { h: 'Contact', html: `<p>Questions about these terms: ${contactRef(site, content)}.</p>` },
    ],
  });
}

/* ------------------------------------------------------------------- 404 */

export function notFound({ site = staticSite, products = staticProducts } = {}) {
  const body = `
<section class="section error-page" aria-labelledby="e404-h">
  <div class="wrap error-page__inner">
    <p class="eyebrow">404</p>
    <h1 class="display" id="e404-h">This page doesn't exist.</h1>
    <p class="lede">The piece you were looking for may have been moved, or it was never here.</p>
    <div class="error-page__actions">
      <a class="btn btn--solid" href="/shop/">Go to shop</a>
      <a class="btn btn--outline" href="/">Home</a>
    </div>
  </div>
</section>
`;

  return page({
    title: `Page not found — ${site.brand}`,
    description: 'The page you were looking for could not be found.',
    path: '/404.html',
    bodyClass: 'page-404',
    body,
    products: store(products),
    site,
  });
}
