/**
 * VESTIPHOBIA — responsive image pipeline.
 *
 *   node scripts/optimize-images.js          only rebuilds what changed
 *   node scripts/optimize-images.js --force  rebuilds everything
 *
 * Reads every photograph in assets/images/ and writes AVIF, WebP and JPEG
 * variants into assets/images/generated/, plus a manifest the templates read
 * to emit real <picture> markup with srcset.
 *
 * The originals are never modified or deleted — they stay the source of truth
 * and the largest JPEG variant is the <img> fallback.
 *
 * Widths are capped at the source width: these photographs are ~1150-1230px
 * wide, so upscaling to 1600 would add bytes and no detail. Only widths the
 * source can actually satisfy are produced.
 *
 * TIMING: a cold run encodes 66 variants and takes roughly 15-20 minutes on a
 * modest CPU — AVIF at effort 6 is the expensive part. Every later run is
 * incremental (mtime-checked) and finishes in under a second, so this cost is
 * paid once per checkout, not per build. If a faster cold build matters more
 * than the last few percent of file size, drop `avif.effort` to 4 below and
 * re-run with --force.
 */

import { readdir, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(ROOT, 'assets/images');
const OUT_DIR = join(SRC_DIR, 'generated');
const MANIFEST = join(SRC_DIR, 'manifest.json');

/**
 * The brand wordmark is a 1000px PNG with transparency and ships on every
 * page as the hero mark. At 272KB it was the single heaviest asset on the
 * homepage — heavier than all six optimized photographs put together — so it
 * goes through the same pipeline. AVIF and WebP both keep the alpha channel.
 */
const BRAND_DIR = join(ROOT, 'assets/brand');
const BRAND_WIDTHS = [380, 560, 760];

/** Target widths. A width larger than the source is skipped, never upscaled. */
const WIDTHS = [400, 800, 1200, 1600];

/**
 * Quality settings. The campaign photography is deliberately grainy — grain is
 * the first thing aggressive compression destroys, so these sit higher than a
 * typical web preset and AVIF keeps its default (slower) effort.
 */
const QUALITY = {
  avif: { quality: 62, effort: 6, chromaSubsampling: '4:4:4' },
  webp: { quality: 82, effort: 5, smartSubsample: true },
  jpeg: { quality: 84, mozjpeg: true, chromaSubsampling: '4:4:4' },
  png: { compressionLevel: 9, palette: true },
};

const FORMATS = ['avif', 'webp', 'jpeg'];
const EXT = { avif: 'avif', webp: 'webp', jpeg: 'jpg', png: 'png' };

const force = process.argv.includes('--force');

async function mtime(p) {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}

async function processOne(file, { srcDir = SRC_DIR, publicDir = '/assets/images', widthList = null } = {}) {
  const srcPath = join(srcDir, file);
  const stem = basename(file, extname(file));
  const image = sharp(srcPath);
  const meta = await image.metadata();
  const srcMtime = await mtime(srcPath);

  const widths = (widthList || WIDTHS).filter((w) => w <= meta.width);
  // Add the native width when the largest standard step falls meaningfully
  // short of it — otherwise a 1152px source would top out at 800px and look
  // soft on a retina desktop. Within 10% it is not worth another file.
  const largest = widths[widths.length - 1] || 0;
  if (meta.width > largest * 1.1) widths.push(meta.width);

  // A transparent source needs a PNG fallback — a JPEG would flatten the
  // alpha onto black and lose the cut-out.
  const transparent = meta.hasAlpha;
  const formats = transparent ? ['avif', 'webp', 'png'] : FORMATS;

  const variants = { avif: [], webp: [], jpeg: [], png: [] };
  let built = 0;

  for (const w of widths) {
    for (const fmt of formats) {
      const name = `${stem}-${w}.${EXT[fmt]}`;
      const outPath = join(OUT_DIR, name);
      const publicPath = `/assets/images/generated/${name}`;

      const fresh = !force && existsSync(outPath) && (await mtime(outPath)) >= srcMtime;
      if (!fresh) {
        await image
          .clone()
          .resize({ width: w, withoutEnlargement: true })
          .toFormat(fmt, QUALITY[fmt])
          .toFile(outPath);
        built++;
      }

      const bytes = (await stat(outPath)).size;
      variants[fmt].push({ w, path: publicPath, bytes });
    }
  }

  for (const k of Object.keys(variants)) if (!variants[k].length) delete variants[k];

  return {
    entry: [
      `${publicDir}/${file}`,
      {
        width: meta.width,
        height: meta.height,
        aspectRatio: +(meta.width / meta.height).toFixed(4),
        transparent,
        variants,
      },
    ],
    built,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR)).filter((f) => /\.(jpe?g|png)$/i.test(f));
  if (!files.length) {
    console.warn('[images] no source photographs found in assets/images/');
  }

  const manifest = {};
  let built = 0;
  let totalBytes = 0;

  for (const file of files.sort()) {
    const { entry, built: n } = await processOne(file);
    manifest[entry[0]] = entry[1];
    built += n;
    totalBytes += (await stat(join(SRC_DIR, file))).size;
  }

  // Brand marks: same treatment, narrower widths, alpha preserved.
  const brandFiles = (await readdir(BRAND_DIR).catch(() => [])).filter((f) => /\.(png|jpe?g)$/i.test(f));
  for (const file of brandFiles.sort()) {
    const { entry, built: n } = await processOne(file, {
      srcDir: BRAND_DIR,
      publicDir: '/assets/brand',
      widthList: BRAND_WIDTHS,
    });
    manifest[entry[0]] = entry[1];
    built += n;
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const generatedBytes = Object.values(manifest).reduce(
    (sum, m) => sum + (m.variants.webp || []).reduce((s, v) => s + v.bytes, 0),
    0
  );
  const smallest = Object.values(manifest)
    .map((m) => (m.variants.avif || [])[0])
    .filter(Boolean);

  console.log(
    `[images] ${files.length} sources, ${built} variants written` +
      (built === 0 ? ' (all up to date)' : '')
  );
  if (smallest.length) {
    const avg = Math.round(smallest.reduce((s, v) => s + v.bytes, 0) / smallest.length / 1024);
    console.log(
      `[images] originals ${Math.round(totalBytes / 1024)}KB total; ` +
        `mobile AVIF averages ${avg}KB each (webp set ${Math.round(generatedBytes / 1024)}KB)`
    );
  }
}

await main();
