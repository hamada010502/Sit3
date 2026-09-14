/**
 * VESTIPHOBIA — live storefront context.
 *
 * Everything the page templates in pages/*.js accept as `{site, content,
 * products}` is built here, fresh, on every request — straight from the
 * database. Nothing here is cached or computed once at build time: an admin
 * edit to a product, a content string or a setting is live on the next page
 * load, with no `npm run build` and no redeploy.
 *
 * The static `site` object in site.config.js stays the fallback and the seed
 * (and is still what `npm run build` — the offline/no-server export — uses
 * unchanged). liveSite() below only overrides the specific leaf fields that
 * are actually admin-editable via the settings/content tables; everything
 * else (brand name, legal info, logo, launch countdown, …) still comes from
 * the static config, because there is no admin screen for it yet.
 */

import { site as staticSite } from '../site.config.js';
import { getSettings, getContent } from './routes/settings.js';
import { publicCatalogue, publicProductBySlug } from './routes/products.js';
import { parseJson } from './db/index.js';

/** Merge live settings/content onto the static config. Never mutates staticSite. */
function liveSite(settings, content) {
  const s = staticSite;
  return {
    ...s,
    announcement: content['announcement'] ?? s.announcement,
    tagline: content['brand.tagline'] ?? s.tagline,
    contact: {
      ...s.contact,
      instagram: content['contact.instagram'] ?? s.contact.instagram,
      email: content['contact.email'] || s.contact.email,
    },
    whatsapp: {
      ...s.whatsapp,
      enabled: settings['whatsapp.enabled'] === undefined ? s.whatsapp.enabled : settings['whatsapp.enabled'] === '1',
      number: settings['whatsapp.number'] || s.whatsapp.number,
    },
    shipping: {
      ...s.shipping,
      deliveryEstimate: content['shipping.delivery_estimate'] ?? s.shipping.deliveryEstimate,
      countryLabel: content['shipping.country_label'] ?? s.shipping.countryLabel,
      freeShippingMinPieces: settings['shipping.free_min_pieces']
        ? Number(settings['shipping.free_min_pieces'])
        : s.shipping.freeShippingMinPieces,
    },
    returns: {
      ...s.returns,
      exchangeWindowDays: content['returns.window_days']
        ? Number(content['returns.window_days'])
        : s.returns.exchangeWindowDays,
    },
    discounts: {
      ...s.discounts,
      returningCustomerPercent: settings['discount.returning_percent']
        ? Number(settings['discount.returning_percent'])
        : s.discounts.returningCustomerPercent,
      maxPercentWithoutConfirmation: settings['discount.max_percent']
        ? Number(settings['discount.max_percent'])
        : s.discounts.maxPercentWithoutConfirmation,
      bundleTiers: settings['discount.bundle_tiers']
        ? parseJson(settings['discount.bundle_tiers'], s.discounts.bundleTiers)
        : s.discounts.bundleTiers,
    },
  };
}

/**
 * Full live context for a storefront request: the merged site config, the
 * raw content key/value map (page templates read specific keys straight out
 * of it, e.g. content['shipping.fee_note']) and the public product catalogue.
 */
export async function liveContext() {
  const [settings, content, products] = await Promise.all([
    getSettings(),
    getContent(),
    publicCatalogue(),
  ]);
  return { site: liveSite(settings, content), content, products };
}

/** Same as liveContext(), plus one product resolved by slug (or null). */
export async function liveProductContext(slug) {
  const [{ site, content, products }, product] = await Promise.all([
    liveContext(),
    publicProductBySlug(slug),
  ]);
  return { site, content, products, product };
}
