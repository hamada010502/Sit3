/**
 * VESTIPHOBIA — single source of truth for business configuration.
 *
 * A `null` here is OWNER INPUT REQUIRED. The site is designed to render
 * completely and honestly while these are null: components fall back to
 * neutral states instead of inventing facts. `npm run build` prints
 * everything still outstanding on every run.
 *
 * From Stage 3 onward most of this becomes Admin-editable content in the
 * database; this file stays the fallback/seed and the deploy-time defaults.
 */

export const site = {
  brand: 'VESTIPHOBIA',
  tagline: 'Clothing for the Uncomfortable',

  // Final domain is not registered yet, and connecting it is deliberately the
  // LAST task in the project. Used for canonical URLs, OG tags and sitemap.xml.
  domain: null, // e.g. 'https://vestiphobia.com'

  legal: {
    businessName: null,
    address: null,
    jurisdiction: null,
    registrationNumber: null,
  },

  contact: {
    email: null,
    // Public contact channel. Unlike WhatsApp, Instagram IS shown to customers
    // — it is the documented fallback when the WhatsApp handoff fails.
    instagram: 'https://www.instagram.com/vestiiphobia',
    instagramHandle: '@vestiiphobia',
  },

  /**
   * ORDERING — WhatsApp handoff, Sham Cash paid manually.
   *
   * There is no payment gateway and no Sham Cash API. The website creates the
   * order and hands it to WhatsApp; the brand then sends payment instructions,
   * receives the transfer, verifies it by hand and accepts the order.
   */
  whatsapp: {
    enabled: true,
    // Full international form, digits only.
    //
    // NEVER render this number in customer-facing markup. It is the wa.me
    // destination only. A QA check fails the build if it appears as visible
    // text anywhere on the site.
    number: '963965438721',
  },

  payment: {
    method: 'SHAM CASH — MANUAL',
    note: 'Payment is arranged directly with VESTIPHOBIA over WhatsApp after the order is placed. This website does not process payments.',
    // Sham Cash account details are deliberately NOT stored in the frontend —
    // they are sent per-customer over WhatsApp. From Stage 3 the Admin holds
    // the template and fills the number in when replying.
    accountDetailsInFrontend: false,
  },

  social: {
    // Set a full URL to activate a link; null/empty hides it entirely.
    instagram: 'https://www.instagram.com/vestiiphobia',
    tiktok: null,
    facebook: null,
    x: null,
  },

  /**
   * RADIO — the Live365 station player.
   *
   * OWNER INPUT REQUIRED. streamUrl and embedUrl are both null until real
   * values are supplied, and the player renders nowhere on the site while
   * that's true — same "hidden until confirmed" rule as everything else in
   * this file. https://live365.com/station/Vestiphobia-a11798 is the public
   * station page, not a playable source; get the actual value from the
   * Live365 dashboard (Streaming / Listen -> Embed or "Get Player Code").
   *
   *   - streamUrl set  -> a custom-built player streams it directly in an
   *     <audio> element (full control over styling to match the site).
   *   - streamUrl empty, embedUrl set -> falls back to Live365's own iframe
   *     widget at that URL (its internal skin can't be restyled — only the
   *     container around it is styled to fit the layout).
   *   - both empty -> no player renders anywhere.
   */
  radio: {
    label: 'VESTIPHOBIA RADIO',
    stationUrl: 'https://live365.com/station/Vestiphobia-a11798',
    streamUrl: null,
    embedUrl: null,
  },

  newsletter: {
    provider: null,
    endpoint: null,
  },

  /**
   * SHIPPING — confirmed.
   *
   * Syria only. The courier sets the fee by region and the customer pays it on
   * delivery, so the site must never display a fixed shipping price.
   */
  shipping: {
    countries: ['SY'],
    countryLabel: 'Syria',
    syriaOnly: true,
    deliveryEstimate: '5–7 business days',
    // Confirmed: the fee is collected by the courier at the door.
    paidOnDelivery: true,
    feeVariesByRegion: true,
    // Deliberately null and must stay null — inventing a number here would be
    // a promise the courier has not made.
    flatRateUnderThreshold: null,
    freeShippingMinPieces: 2,
    currency: 'USD',
    processingTime: null,
    carrier: null,
  },

  /**
   * RETURNS / EXCHANGES — confirmed policy.
   * Exchange only; no cash refunds at present.
   */
  returns: {
    exchangeWindowDays: 7,
    exchangeOnly: true,
    cashRefunds: false,
    // Who pays exchange shipping, by cause.
    brandCoversWhen: 'wrong item sent or a clear product defect',
    customerCoversWhen: 'the customer selected the wrong size',
    requestChannels: ['Instagram', 'WhatsApp'],
  },

  /**
   * DISCOUNTS — confirmed rules.
   *
   * Bundle and returning-customer discounts do NOT stack. The engine in
   * assets/js/pricing.js picks the single best applicable percentage.
   */
  discounts: {
    // Quantity tiers: at or above `minQty`, take `percent` off the merchandise.
    bundleTiers: [
      { minQty: 3, percent: 10, label: '3+ pieces — 10% off' },
      { minQty: 2, percent: 5, label: '2 pieces — 5% off' },
    ],
    // Applied only once a previous order for the same phone has reached
    // DELIVERED. Admin-editable from Stage 3.
    returningCustomerPercent: 5,
    // Promotions above this need an explicit extra confirmation in Admin.
    maxPercentWithoutConfirmation: 20,
    // Admin-created promotions and promo codes land here from Stage 3.
    promotions: [],
  },

  analytics: {
    /**
     * No third-party provider. No Google Analytics, no Meta pixel, no ad
     * network — nothing that would send a visitor's browsing to another
     * company.
     */
    provider: null,

    /**
     * First-party analytics: events go to this site's own /api/events and
     * nowhere else. What is collected, and what is deliberately not, is
     * documented in assets/js/analytics.js and in the privacy policy.
     * Set to false to ship the site with no tracking at all.
     */
    firstParty: true,

    /** Days of raw event data to keep. Purge is an explicit admin action. */
    retentionDays: 365,
  },

  orders: {
    idPrefix: 'VST',
    sequencePadding: 4,
  },

  /**
   * The storefront's connection to the backend.
   *
   * With `enabled: true` the checkout posts to the API in server/, which owns
   * order numbers, prices, stock and status. Set it to false to build a
   * standalone static site again: orders then live only in the customer's own
   * browser and reach the brand solely through the WhatsApp message. The
   * checkout says as much either way — it never claims an order was received
   * by a server that was not there.
   */
  api: {
    enabled: true,
    ordersEndpoint: '/api/orders',
  },

  /**
   * The admin is server-rendered at /admin by server/index.js, behind a real
   * login. This flag belongs to the retired static prototype and stays false:
   * a passwordless admin page must never be part of a build again.
   */
  admin: {
    enabled: false,
  },

  logo: {
    markSrc: '/assets/brand/vestiphobia-wordmark.png',
    useMarkInHeader: false,
  },

  /**
   * LAUNCH — the countdown that runs before the shop opens.
   *
   * Set `opensAt` to an ISO-8601 UTC instant and the server shows a countdown
   * page to visitors until that moment, then opens the full site by itself.
   * No deploy, no switch to flip, nothing to remember at midnight.
   *
   *   opensAt: '2026-09-08T18:00:00.000Z'   // two days from the launch day
   *
   * While it is null the site is simply open. The admin, the API and the
   * health check stay reachable throughout, so stock and content can be
   * prepared behind the countdown.
   */
  launch: {
    opensAt: null,
    heading: 'ARRIVING',
    body: 'The first VESTIPHOBIA drop opens in',
    // Shown once the countdown reaches zero and the page has not been
    // reloaded yet.
    openedText: 'The drop is open.',
  },

  announcement: 'FREE SHIPPING ON 2+ PIECES',

  copyrightYear: 2026,
};

/** True when a value has been supplied by the owner. */
export const isSet = (v) =>
  v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

// `s` defaults to the static config, but every caller that has live
// (DB-sourced, per-request) site data passes it explicitly — these two
// functions must never read the process-wide singleton on a request path.
export const activeSocial = (s = site) =>
  Object.entries(s.social)
    .filter(([, url]) => isSet(url))
    .map(([name, url]) => ({
      name,
      url,
      label: name === 'x' ? 'X' : name[0].toUpperCase() + name.slice(1),
    }));

export const whatsappConfigured = (s = site) => s.whatsapp.enabled && isSet(s.whatsapp.number);

export default site;
