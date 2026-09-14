/**
 * VESTIPHOBIA static build.
 *
 *   node build.js          -> writes dist/
 *   node build.js --serve  -> writes dist/ and serves it on :4173
 *
 * Routes come from data/products.js and the page modules — adding a product
 * adds its route, its sitemap entry and its shop card with no other edits.
 *
 * The build FAILS (non-zero exit) on a configuration error that would ship
 * something broken or dishonest. It only warns about values the owner has not
 * supplied yet, because the site is designed to render honestly without them.
 */

import { mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { site, isSet, whatsappConfigured } from './site.config.js';
import { products } from './data/products.js';
import { hasManifest, manifestEntry } from './lib/images.js';
import home from './pages/home.js';
import shop from './pages/shop.js';
import productPage from './pages/product.js';
import { cartPage, checkoutPage, orderPage } from './pages/checkout.js';
import {
  story,
  contact,
  shippingPolicy,
  returnsPolicy,
  privacyPolicy,
  termsPolicy,
  notFound,
} from './pages/content.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'dist');

/* ------------------------------------------------------------ validation */

/**
 * Errors are things that would ship a broken or misleading site. Each one
 * stops the build. Missing owner input is NOT an error — that is handled by
 * the warning list, because every such value has an honest fallback.
 */
function validate() {
  const errors = [];

  if (!products.length) errors.push('data/products.js contains no products.');

  const slugs = new Set();
  for (const p of products) {
    const where = p.slug || p.id || '(unnamed product)';
    if (!p.slug) errors.push(`product ${p.id}: missing slug.`);
    if (slugs.has(p.slug)) errors.push(`duplicate product slug: ${p.slug}`);
    slugs.add(p.slug);

    if (typeof p.price !== 'number' || !(p.price > 0))
      errors.push(`product ${where}: price must be a positive number.`);
    if (!p.sizes?.length) errors.push(`product ${where}: no sizes defined.`);
    if (!p.images?.length) errors.push(`product ${where}: no images defined.`);

    for (const im of p.images || []) {
      if (!im.alt) errors.push(`product ${where}: image ${im.src} has no alt text.`);
      if (hasManifest() && !manifestEntry(im.src))
        errors.push(
          `product ${where}: ${im.src} has no optimized variants. Run \`npm run images\`.`
        );
    }

    for (const key of Object.keys(p.stockBySize || {})) {
      if (!p.sizes.some((s) => s.label === key))
        errors.push(`product ${where}: stockBySize has size "${key}" that is not in sizes.`);
    }
  }

  if (isSet(site.domain) && !/^https?:\/\//.test(site.domain))
    errors.push('site.domain must include a protocol, e.g. https://vestiphobia.com');

  if (site.whatsapp.enabled && isSet(site.whatsapp.number) && !/^\d{6,15}$/.test(String(site.whatsapp.number)))
    errors.push(
      'whatsapp.number must be digits only, in full international form without "+" (e.g. 963900000000).'
    );

  if (typeof site.shipping.freeShippingMinPieces !== 'number' || site.shipping.freeShippingMinPieces < 1)
    errors.push('shipping.freeShippingMinPieces must be a number of 1 or more.');

  return errors;
}

/** Values the owner still owes us. The site renders honestly without them. */
function missingOwnerInput() {
  return Object.entries({
    'WhatsApp number (orders cannot be sent without it)': whatsappConfigured() ? 'set' : null,
    'contact email (Instagram is live; a support address is not)': site.contact.email,
    'domain — deliberately the final task, not a blocker yet': site.domain,
    'legal business name': site.legal.businessName,
    'legal jurisdiction': site.legal.jurisdiction,
    'order processing time (delivery estimate IS set)': site.shipping.processingTime,
    'newsletter provider': site.newsletter.provider,
    'stock quantities by size': Object.values(products[0]?.stockBySize || {}).some((v) => v !== null)
      ? 'set'
      : null,
  })
    .filter(([, v]) => !isSet(v))
    .map(([k]) => k);

  // Deliberately NOT listed as missing:
  //   shipping.flatRateUnderThreshold — the courier sets the fee by region and
  //     collects it on delivery, so there is no website price to configure.
  //   fabric / gsm / fit / care / measurements — all supplied and published.
}

/* ---------------------------------------------------------------- routes */

/** Every route in the site: [outputPath, html, sitemapPath|null]. */
function routes() {
  const list = [
    ['index.html', home(), '/'],
    ['shop/index.html', shop(), '/shop/'],
    ['story/index.html', story(), '/story/'],
    ['contact/index.html', contact(), '/contact/'],
    ['cart/index.html', cartPage(), null],
    ['checkout/index.html', checkoutPage(), null],
    ['order/index.html', orderPage(), null],
    ['policies/shipping/index.html', shippingPolicy(), '/policies/shipping/'],
    ['policies/returns/index.html', returnsPolicy(), '/policies/returns/'],
    ['policies/privacy/index.html', privacyPolicy(), '/policies/privacy/'],
    ['policies/terms/index.html', termsPolicy(), '/policies/terms/'],
    ['404.html', notFound(), null],
  ];

  for (const p of products) {
    list.push([`products/${p.slug}/index.html`, productPage(p), `/products/${p.slug}/`]);
  }

  // The admin is NOT part of this build. It is server-rendered at /admin by
  // server/index.js, behind a login with hashed passwords and database-held
  // sessions. The static prototype that used to live here had no
  // authentication — a static site cannot provide any — and it is gone.
  // robots.txt still disallows /admin/ so the real one is never indexed.

  return list;
}

function sitemap(paths) {
  if (!isSet(site.domain)) return null;
  const base = site.domain.replace(/\/$/, '');
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${base}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
}

function robots() {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /checkout/',
    'Disallow: /cart/',
    'Disallow: /order/',
    'Disallow: /admin/',
  ];
  if (isSet(site.domain)) {
    lines.push('', `Sitemap: ${site.domain.replace(/\/$/, '')}/sitemap.xml`);
  } else {
    lines.push('', '# Sitemap URL is emitted once site.domain is configured in site.config.js');
  }
  return lines.join('\n') + '\n';
}

async function write(rel, contents) {
  const target = join(OUT, rel);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function build() {
  const errors = validate();
  if (errors.length) {
    console.error('\nBUILD FAILED — configuration errors:\n');
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('');
    process.exit(1);
  }

  if (!hasManifest()) {
    console.warn(
      '[build] no image manifest found — pages will fall back to the full-size originals.\n' +
        '        Run `npm run images` to generate responsive AVIF/WebP variants.'
    );
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const all = routes();
  for (const [path, html] of all) await write(path, html);

  await cp(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true });

  const sm = sitemap(all.map((r) => r[2]).filter(Boolean));
  if (sm) await write('sitemap.xml', sm);
  await write('robots.txt', robots());
  await write('_redirects', '/*  /404.html  404\n');

  console.log(`built ${all.length} pages -> dist/`);

  if (site.admin.enabled) {
    throw new Error(
      'site.admin.enabled is true, but the static admin prototype no longer exists.\n' +
        'The admin is served by server/index.js at /admin, behind a login. Set it back to false.'
    );
  }

  if (site.api.enabled) {
    console.log(
      `[build] API mode: the checkout posts to ${site.api.ordersEndpoint}, which exists only ` +
        'while server/index.js is running (npm run server).'
    );
  } else {
    console.warn(
      "\n[build] API mode is OFF. Orders will live only in each customer's own browser\n" +
        '        and reach you solely through the WhatsApp message they send.'
    );
  }

  if (!whatsappConfigured()) {
    console.warn(
      '\n[build] whatsapp.number is empty — customers can create an order but cannot send it.\n' +
        '        Set it in site.config.js to switch the ordering flow on.'
    );
  }

  const missing = missingOwnerInput();
  if (missing.length) {
    console.log(`\nOWNER INPUT REQUIRED (site renders honestly without these):\n  - ${missing.join('\n  - ')}`);
  }
}

/* --------------------------------------------------- optional dev server */

async function serve(port = Number(process.env.PORT) || 4173) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8',
  };

  createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(OUT, '.' + p);
    if (!file.startsWith(OUT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const buf = await readFile(file);
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' }).end(buf);
    } catch {
      try {
        const buf = await readFile(join(OUT, '404.html'));
        res.writeHead(404, { 'content-type': TYPES['.html'] }).end(buf);
      } catch {
        res.writeHead(404).end('not found');
      }
    }
  }).listen(port, () => console.log(`serving dist/ on http://localhost:${port}`));
}

await build();
if (process.argv.includes('--serve')) await serve();
