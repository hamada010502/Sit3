/**
 * VESTIPHOBIA — uploaded file storage.
 *
 * Three backends behind one interface, in priority order:
 *
 *   1. Supabase Storage (production default). Activates automatically the
 *      moment SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 *      SUPABASE_STORAGE_BUCKET are all set — no code change. Talks to
 *      Supabase's Storage REST API directly with the service role key as a
 *      bearer token (Node's built-in fetch is enough; no SDK dependency).
 *      The service role key is used ONLY here, on the server — it is never
 *      sent to the browser, never logged, and never included in an error
 *      message returned to a client.
 *
 *   2. Generic S3-compatible object storage (Cloudflare R2, AWS S3, or
 *      Supabase Storage's own S3-compatible endpoint, …). Activates when
 *      S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are
 *      set and the Supabase variables above are not. Signed with AWS SigV4
 *      by hand (Node's built-in crypto).
 *
 *   3. Local disk (development fallback). Zero setup, works out of the box,
 *      but the directory it writes to must sit on a PERSISTENT volume in
 *      production — most PaaS filesystems (Render, Railway, Fly without a
 *      volume attached) are wiped on every redeploy. Used automatically
 *      whenever neither remote backend above is configured.
 *
 * All three return the same shape from putObject(): a URL string, which is
 * what gets stored in product_images.src and served to the browser — an
 * absolute https:// URL for Supabase/S3, a same-origin /uploads/... path for
 * local disk. The storefront and admin gallery render either kind through
 * the same <picture> markup (lib/images.js) without caring which backend
 * produced it, and existing local-disk images keep working unchanged after
 * a switch to Supabase — only new uploads go to the new backend.
 */

import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

// resolve(), not join(): UPLOADS_DIR is commonly an absolute path (a mounted
// volume), and join() would incorrectly nest an absolute override under
// process.cwd() instead of using it as-is.
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? resolve(process.cwd(), process.env.UPLOADS_DIR)
  : join(ROOT, 'data', 'uploads');

function s3Config() {
  const { S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION, S3_PUBLIC_URL } =
    process.env;
  if (!S3_BUCKET || !S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    bucket: S3_BUCKET,
    endpoint: S3_ENDPOINT.replace(/\/$/, ''),
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    region: S3_REGION || 'auto',
    // Some providers (R2, Supabase) serve objects from a different public
    // hostname than the API endpoint used to write them.
    publicUrl: (S3_PUBLIC_URL || S3_ENDPOINT).replace(/\/$/, ''),
  };
}

function supabaseConfig() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_STORAGE_BUCKET) return null;
  return {
    url: SUPABASE_URL.replace(/\/$/, ''),
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    bucket: SUPABASE_STORAGE_BUCKET,
  };
}

export const usingSupabase = () => supabaseConfig() !== null;
export const usingS3 = () => s3Config() !== null;
export const storageBackend = () => (usingSupabase() ? 'supabase' : usingS3() ? 's3' : 'local');

/**
 * The origin(s) product photos are actually served from, for the CSP's
 * `img-src` directive.
 *
 * THE BUG THIS FIXES: uploaded images were written to Supabase/S3 as absolute
 * https:// URLs (see putObject() above) and stored verbatim in
 * product_images.src, but the CSP shipped with `img-src 'self' data:` only —
 * no remote origin at all. Every browser silently blocked those <img>/
 * <source> loads as a CSP violation (visible in devtools as "Refused to load
 * the image ... because it violates the following Content Security Policy
 * directive"), so an uploaded photo existed in storage and in the database
 * but never painted on the storefront, the admin gallery, or anywhere else —
 * this is the actual root cause of "images don't display". Local-disk
 * uploads (`/uploads/...`, same-origin) were never affected, which is why the
 * bug only showed up once a real Supabase/S3 backend was configured.
 */
export function imageStorageOrigins() {
  const origins = new Set();
  const supa = supabaseConfig();
  if (supa) {
    try {
      origins.add(new URL(supa.url).origin);
    } catch {
      /* malformed SUPABASE_URL — nothing to add */
    }
  }
  const s3 = s3Config();
  if (s3) {
    for (const raw of [s3.publicUrl, s3.endpoint]) {
      try {
        origins.add(new URL(raw).origin);
      } catch {
        /* malformed S3 URL — nothing to add */
      }
    }
  }
  return [...origins];
}

/* ------------------------------------------------------------ AWS SigV4 ---
 * The minimum needed to PUT and DELETE one object. No listing, no multipart
 * upload, no query-string signing — a single-shot signed request is all an
 * admin image upload needs.
 */

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();

function signingKey({ secretAccessKey, dateStamp, region, service }) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

async function s3Request({ method, key, body, contentType }) {
  const cfg = s3Config();
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const payloadHash = sha256Hex(body || Buffer.alloc(0));

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(contentType ? { 'content-type': contentType } : {}),
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    url.search.replace(/^\?/, ''),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${cfg.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const key_ = signingKey({ secretAccessKey: cfg.secretAccessKey, dateStamp, region: cfg.region, service });
  const signature = createHmac('sha256', key_).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { ...headers, Authorization: authorization },
    body: method === 'PUT' ? body : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 ${method} ${key} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res;
}

/* -------------------------------------------------------- Supabase Storage
 * The Storage REST API, called directly with the service role key as a
 * bearer token — that key is a server secret with full storage access
 * (it bypasses Storage RLS entirely), so it is read from process.env fresh
 * on every call and never attached to anything that reaches the browser: not
 * the returned public URL, not a thrown error's message, not a log line.
 */

/** Percent-encode each path segment; never trust a raw filename in the URL. */
const supabaseObjectPath = (key) => key.split('/').map(encodeURIComponent).join('/');

async function supabaseRequest({ method, key, body, contentType }) {
  const cfg = supabaseConfig();
  const url = `${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${supabaseObjectPath(key)}`;
  const headers = {
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    apikey: cfg.serviceRoleKey,
  };
  if (contentType) headers['Content-Type'] = contentType;
  // POST creates or (with this header) overwrites — used for both a fresh
  // upload and a same-key replace, so a retried upload can never be refused
  // as a duplicate.
  if (method === 'POST') headers['x-upsert'] = 'true';

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'DELETE' ? undefined : body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Deliberately does not include any header: the body Supabase returns is
    // its own error JSON, never our Authorization/apikey.
    throw new Error(`Supabase storage ${method} ${key} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res;
}

function supabasePublicUrl(key) {
  const cfg = supabaseConfig();
  return `${cfg.url}/storage/v1/object/public/${encodeURIComponent(cfg.bucket)}/${supabaseObjectPath(key)}`;
}

/* ------------------------------------------------------------------ API ---*/

/** Write one file. `key` is the storage path, e.g. products/slug/id-800.webp. */
export async function putObject(key, buffer, contentType) {
  if (usingSupabase()) {
    await supabaseRequest({ method: 'POST', key, body: buffer, contentType });
    return supabasePublicUrl(key);
  }

  const s3cfg = s3Config();
  if (s3cfg) {
    await s3Request({ method: 'PUT', key, body: buffer, contentType });
    return `${s3cfg.publicUrl}/${s3cfg.bucket}/${key}`;
  }

  const file = join(UPLOADS_DIR, key);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buffer);
  return `/uploads/${key}`;
}

/** Delete one file. Never throws — a missing object is not a failure to remove it. */
export async function deleteObject(key) {
  try {
    if (usingSupabase()) {
      await supabaseRequest({ method: 'DELETE', key });
    } else if (usingS3()) {
      await s3Request({ method: 'DELETE', key });
    } else {
      await unlink(join(UPLOADS_DIR, key));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[uploads] could not delete', key, err.message);
  }
}

/* ------------------------------------------------------------ resizing ---*/

const WIDTHS = [400, 800, 1200, 1600];

/**
 * Resize an uploaded product photo into a responsive set and store every
 * variant, returning what product_images needs to render it and what
 * lib/images.js needs to build a <picture> element from it directly (no
 * build-time manifest involved — this is a live upload).
 *
 * AVIF is skipped here (its useful quality needs effort 6, which is fine for
 * a one-time build step but far too slow for an admin waiting on an upload);
 * webp + a jpeg fallback is exactly what the rest of the site already treats
 * as the baseline format set.
 */
export async function processProductImage(buffer, { slug, id }) {
  const sharp = (await import('sharp')).default;
  const image = sharp(buffer, { failOn: 'none' });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('Could not read this file as an image.');

  const widths = WIDTHS.filter((w) => w <= meta.width);
  if (!widths.length || meta.width > (widths[widths.length - 1] || 0) * 1.1) widths.push(meta.width);

  const variants = { webp: [], jpeg: [] };
  for (const w of widths) {
    const webp = await image.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer();
    const jpeg = await image
      .clone()
      .resize({ width: w, withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

    const webpUrl = await putObject(`products/${slug}/${id}-${w}.webp`, webp, 'image/webp');
    const jpegUrl = await putObject(`products/${slug}/${id}-${w}.jpg`, jpeg, 'image/jpeg');
    variants.webp.push({ w, path: webpUrl });
    variants.jpeg.push({ w, path: jpegUrl });
  }

  const largestJpeg = variants.jpeg[variants.jpeg.length - 1];
  return {
    src: largestJpeg.path,
    width: meta.width,
    height: meta.height,
    variants,
  };
}

/**
 * A single non-product site image (currently just the homepage hero) —
 * resized to a sane maximum width and stored as one JPEG. Simpler than
 * processProductImage() on purpose: this is one image shown at one size,
 * not a responsive gallery photo, and lib/images.js's picture() already
 * renders a plain, non-manifest src as a plain <img> with no loss of
 * function, just without multiple srcset widths.
 */
export async function processSiteImage(buffer, key) {
  const sharp = (await import('sharp')).default;
  const image = sharp(buffer, { failOn: 'none' });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('Could not read this file as an image.');

  const resized = await image
    .resize({ width: Math.min(meta.width, 2400), withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return putObject(key, resized, 'image/jpeg');
}

/** Remove every stored variant of one image, on whichever backend is active.
 * A remote (Supabase/S3) object outlives a delete of the DB row only in the
 * (rare) case the src URL was hand-edited to something this function can't
 * map back to a key — logged, never thrown. */
export async function deleteProductImageFiles({ slug, id, variants }) {
  const parsed = typeof variants === 'string' ? JSON.parse(variants || '{}') : variants || {};
  // Keys are taken from the stored variant URLs, not rebuilt from the
  // product's CURRENT slug: files live under the slug the product had when
  // the photo was uploaded, and a slug rename (renameSlug in
  // routes/products.js) does not move them — rebuilding the key from the new
  // slug pointed at files that never existed and left the real ones behind.
  const keys = new Set();
  for (const list of Object.values(parsed)) {
    for (const v of list || []) {
      const at = String(v.path || '').indexOf('products/');
      if (at !== -1) keys.add(v.path.slice(at));
    }
  }
  if (!keys.size) {
    // No variant paths recorded (older rows): fall back to the naming scheme.
    const widths = new Set();
    for (const list of Object.values(parsed)) for (const v of list || []) widths.add(v.w);
    for (const w of widths) for (const ext of ['webp', 'jpg']) keys.add(`products/${slug}/${id}-${w}.${ext}`);
  }
  await Promise.all([...keys].map((key) => deleteObject(key)));
}

export const localUploadPath = (key) => join(UPLOADS_DIR, key);
export const isLocalUpload = (src) => src.startsWith('/uploads/');
export { extname };
