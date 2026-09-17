/**
 * Responsive image markup, driven by the manifest that
 * scripts/optimize-images.js writes.
 *
 * The previous implementation emitted a `sizes` attribute with no `srcset`,
 * which is inert — every device downloaded the full-size original. This module
 * emits a real <picture> with AVIF, WebP and JPEG source sets so a phone
 * fetches a ~400px file instead of a 1200px one.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './html.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = join(ROOT, 'assets/images/manifest.json');

let manifest = {};
let manifestLoaded = false;

export function loadManifest() {
  if (existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    manifestLoaded = true;
  } else {
    manifest = {};
    manifestLoaded = false;
  }
  return manifestLoaded;
}

loadManifest();

export const hasManifest = () => manifestLoaded;
export const manifestEntry = (src) => manifest[src] || null;

const srcsetFor = (list) => list.map((v) => `${v.path} ${v.w}w`).join(', ');

/**
 * The card/gallery-first image for a product. DB-sourced products carry an
 * explicit `isPrimary` flag (set by the admin's "Make primary" control);
 * the static catalogue has no such flag, so `role === 'main'` is the
 * equivalent there. Either way, falls back to the first image so a product
 * with images but no primary/main marker still renders something.
 */
export function primaryImage(images) {
  return images.find((i) => i.isPrimary) || images.find((i) => i.role === 'main') || images[0] || null;
}

/** Build the `entry` override picture() needs for a DB-sourced image, or null for a static one. */
export const imageEntry = (im) =>
  im.width && im.variants ? { width: im.width, height: im.height, variants: im.variants } : null;

/**
 * The smallest rendered variant of an image, for the places that draw it at
 * thumbnail size. The gallery's 72px-wide thumbnails used the raw `src`,
 * which is the LARGEST file in the set — three of them cost ~460KB on a phone
 * that had already downloaded the 23KB slide it was showing.
 */
export function thumbSrc(im) {
  const entry = imageEntry(im) || manifestEntry(im.src);
  const set = entry?.variants?.jpeg || entry?.variants?.png || entry?.variants?.webp;
  if (!set?.length) return im.src;
  return set.reduce((a, b) => (b.w < a.w ? b : a)).path;
}

/**
 * Build a <picture> element.
 *
 * @param {string}  src      original path, e.g. /assets/images/02_medium_shot.jpeg
 * @param {string}  alt      required; '' only for decorative images
 * @param {string}  sizes    CSS sizes expression describing the rendered width
 * @param {boolean} eager    true for the LCP image — skips lazy loading
 * @param {string}  ratio    CSS aspect-ratio to reserve, preventing layout shift
 * @param {string}  className applied to the <img>
 * @param {string}  pictureClass applied to the <picture>
 */
export function picture({
  src,
  alt = '',
  sizes = '100vw',
  eager = false,
  ratio = '4 / 5',
  className = '',
  pictureClass = '',
  decorative = false,
  // An admin-uploaded image carries its own width/height/variants (set at
  // upload time by server/lib/uploads.js) rather than living in the
  // build-time manifest.json — pass that shape here to render it responsively
  // exactly the same way a static, manifest-backed image renders.
  entry: entryOverride = null,
}) {
  const entry = entryOverride || manifestEntry(src);
  const loading = eager ? 'eager' : 'lazy';
  const decoding = eager ? 'sync' : 'async';
  const priority = eager ? ' fetchpriority="high"' : '';
  const aria = decorative ? ' aria-hidden="true"' : '';
  const cls = className ? ` class="${esc(className)}"` : '';

  // No manifest (pipeline not run yet): fall back to the original file so the
  // build still produces a working page rather than a broken one.
  if (!entry) {
    return (
      `<img src="${esc(src)}"${cls} alt="${esc(alt)}"${aria}` +
      ` style="aspect-ratio:${ratio}" loading="${loading}" decoding="${decoding}"${priority}>`
    );
  }

  // A transparent source falls back to PNG; a photograph falls back to JPEG.
  const fallbackSet = entry.variants.jpeg || entry.variants.png;
  const fallback = fallbackSet[fallbackSet.length - 1];

  const source = (fmt, type) =>
    entry.variants[fmt]?.length
      ? `<source type="${type}" srcset="${srcsetFor(entry.variants[fmt])}" sizes="${esc(sizes)}">`
      : '';

  return (
    `<picture${pictureClass ? ` class="${esc(pictureClass)}"` : ''}>` +
    source('avif', 'image/avif') +
    source('webp', 'image/webp') +
    `<img src="${esc(fallback.path)}"` +
    ` srcset="${srcsetFor(fallbackSet)}" sizes="${esc(sizes)}"` +
    `${cls} alt="${esc(alt)}"${aria}` +
    ` width="${entry.width}" height="${entry.height}"` +
    ` style="aspect-ratio:${ratio}"` +
    ` loading="${loading}" decoding="${decoding}"${priority}>` +
    `</picture>`
  );
}

/**
 * Preload hint for the hero image so the LCP candidate starts downloading
 * before the CSS that positions it has parsed.
 */
export function preloadHero(src, sizes = '100vw', entryOverride = null) {
  const entry = entryOverride || manifestEntry(src);
  if (!entry) return `<link rel="preload" as="image" href="${esc(src)}">`;
  // Preload the format picture() will actually choose. Admin uploads carry
  // webp + jpeg and no avif, so preferring jpeg whenever avif was missing
  // preloaded a file the browser then ignored in favour of the webp — two
  // downloads of the same photo for the one image that has to be fast.
  const [type, set] = entry.variants.avif?.length
    ? ['image/avif', entry.variants.avif]
    : entry.variants.webp?.length
      ? ['image/webp', entry.variants.webp]
      : ['image/jpeg', entry.variants.jpeg || entry.variants.png];
  return (
    `<link rel="preload" as="image" type="${type}"` +
    ` imagesrcset="${srcsetFor(set)}" imagesizes="${esc(sizes)}" fetchpriority="high">`
  );
}
