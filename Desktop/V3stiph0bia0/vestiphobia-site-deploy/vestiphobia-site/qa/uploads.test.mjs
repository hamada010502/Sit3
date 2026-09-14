/**
 * VESTIPHOBIA — product image storage tests.
 *
 *   npm run test:uploads
 *
 * Covers the storage-backend swap to Supabase Storage: backend detection and
 * priority, upload, upload failure, delete, delete failure, the "replace"
 * flow (upload new + delete old), that the database never ends up holding a
 * reference to an object that was never actually written, admin
 * authorization on the upload route, and that the Supabase service role key
 * never leaks into a response or an error message.
 *
 * No real Supabase project or credentials are used: SUPABASE_URL points at a
 * tiny local HTTP server (below) that stands in for the Storage REST API for
 * the duration of this file. Runs against a throwaway SQLite file, exactly
 * like qa/server.test.mjs.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import http from 'node:http';

const DB_FILE = join(tmpdir(), `vestiphobia-uploads-test-${process.pid}.db`);
process.env.SQLITE_PATH = DB_FILE;
delete process.env.DATABASE_URL;
process.env.PORT = String(4500 + (process.pid % 200));
process.env.IP_SALT = 'test-salt';

// storageBackend() and friends read process.env fresh on every call rather
// than caching a value at import time, so no backend/credential env var may
// be left over from the shell this test runs in.
const STORAGE_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_REGION',
  'S3_PUBLIC_URL',
];
for (const k of STORAGE_VARS) delete process.env[k];

const { migrate, seed } = await import('../server/db/migrate.js');
const { getDb, closeDb } = await import('../server/db/index.js');
const { createAdmin, login, destroySession } = await import('../server/lib/auth.js');
const uploads = await import('../server/lib/uploads.js');
const { uploadProductImage, deleteProductImage, getProductImages } = await import('../server/routes/products.js');
const { start, server } = await import('../server/index.js');
const sharp = (await import('sharp')).default;

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const SLUG = 'vestiphobia-001-fear-tee';
const PASSWORD = 'a-long-enough-test-passphrase';
const SERVICE_ROLE_KEY = 'test-service-role-key-do-not-leak';
const BUCKET = 'product-images';

/* ---------------------------------------------------- mock Supabase Storage
 * A local HTTP server standing in for `{SUPABASE_URL}/storage/v1/object/…`.
 * Records every request it receives (method, path, headers, body length) and
 * can be told to fail the next PUT/POST or DELETE, to exercise the failure
 * paths without a real Supabase project.
 */
let mock;
let mockPort;
let requests = [];
let mockMode = 'ok'; // 'ok' | 'fail-upload' | 'fail-delete'

function setSupabaseEnv() {
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
  process.env.SUPABASE_STORAGE_BUCKET = BUCKET;
}

function multipartBody(boundary, fileBuffer, filename = 'test.png') {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, fileBuffer, tail]);
}

const tinyImage = () =>
  sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();

let productId;

before(async () => {
  await migrate({ quiet: true });
  await seed({ quiet: true });
  const db = await getDb();
  productId = (await db.get('SELECT id FROM products WHERE slug = ?', [SLUG])).id;
  await createAdmin('uploads-tester@vestiphobia.test', PASSWORD);
  await start();

  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        bodyLength: body.length,
      });

      const failUpload = mockMode === 'fail-upload' && (req.method === 'POST' || req.method === 'PUT');
      const failDelete = mockMode === 'fail-delete' && req.method === 'DELETE';
      if (failUpload || failDelete) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'mock storage failure', statusCode: '500' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Key: `${BUCKET}${req.url}` }));
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  mockPort = mock.address().port;
});

after(async () => {
  server.close();
  await new Promise((resolve) => mock.close(resolve));
  await closeDb();
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
    try {
      rmSync(f);
    } catch {
      /* already gone */
    }
  }
});

beforeEach(() => {
  requests = [];
  mockMode = 'ok';
});

afterEach(() => {
  for (const k of STORAGE_VARS) delete process.env[k];
});

/* --------------------------------------------------------- backend detection */

test('with no storage env vars set, the backend is local disk', () => {
  assert.equal(uploads.storageBackend(), 'local');
  assert.equal(uploads.usingSupabase(), false);
});

test('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_STORAGE_BUCKET activates the Supabase backend', () => {
  setSupabaseEnv();
  assert.equal(uploads.storageBackend(), 'supabase');
  assert.equal(uploads.usingSupabase(), true);
});

test('a partial Supabase configuration (missing bucket) does not activate the backend', () => {
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
  // SUPABASE_STORAGE_BUCKET intentionally left unset.
  assert.equal(uploads.storageBackend(), 'local');
});

test('Supabase configuration takes priority over a simultaneously-configured generic S3 backend', () => {
  setSupabaseEnv();
  process.env.S3_BUCKET = 'other-bucket';
  process.env.S3_ENDPOINT = 'http://example.test';
  process.env.S3_ACCESS_KEY_ID = 'k';
  process.env.S3_SECRET_ACCESS_KEY = 's';
  assert.equal(uploads.storageBackend(), 'supabase');
});

test('the generic S3 backend still activates on its own when Supabase is not configured', () => {
  process.env.S3_BUCKET = 'other-bucket';
  process.env.S3_ENDPOINT = 'http://example.test';
  process.env.S3_ACCESS_KEY_ID = 'k';
  process.env.S3_SECRET_ACCESS_KEY = 's';
  assert.equal(uploads.storageBackend(), 's3');
});

/* -------------------------------------------------------------------- upload */

test('putObject uploads to Supabase Storage and returns the public URL', async () => {
  setSupabaseEnv();
  const key = 'products/test-product/abc123-800.webp';
  const buf = Buffer.from('fake-image-bytes');
  const url = await uploads.putObject(key, buf, 'image/webp');

  assert.equal(url, `http://127.0.0.1:${mockPort}/storage/v1/object/public/${BUCKET}/${key}`);
  const req = requests.find((r) => r.method === 'POST');
  assert.ok(req, 'expected a POST to the mock Supabase Storage server');
  assert.equal(req.url, `/storage/v1/object/${BUCKET}/${key}`);
  assert.equal(req.headers['authorization'], `Bearer ${SERVICE_ROLE_KEY}`);
  assert.equal(req.headers['apikey'], SERVICE_ROLE_KEY);
  assert.equal(req.headers['x-upsert'], 'true');
  assert.equal(req.headers['content-type'], 'image/webp');
  assert.equal(req.bodyLength, buf.length);
});

test('putObject percent-encodes the storage path instead of trusting it raw', async () => {
  setSupabaseEnv();
  // Not a filename an admin ever types by hand (the app always builds this
  // path itself from a product slug and a generated id) — but the transport
  // must still be safe if it ever were.
  const key = 'products/weird slug/name with spaces & stuff.webp';
  await uploads.putObject(key, Buffer.from('x'), 'image/webp');
  const req = requests.find((r) => r.method === 'POST');
  assert.ok(req);
  assert.ok(!req.url.includes(' '), 'the request path must not contain a literal space');
});

/* ----------------------------------------------------------- upload failure */

test('putObject rejects when Supabase Storage refuses the upload, without leaking the service key', async () => {
  setSupabaseEnv();
  mockMode = 'fail-upload';
  await assert.rejects(
    () => uploads.putObject('products/x/y-800.webp', Buffer.from('x'), 'image/webp'),
    (err) => {
      assert.match(err.message, /failed: 500/);
      assert.doesNotMatch(err.message, new RegExp(SERVICE_ROLE_KEY));
      return true;
    }
  );
});

/* -------------------------------------------------------------------- delete */

test('deleteObject removes a Supabase Storage object', async () => {
  setSupabaseEnv();
  await uploads.deleteObject('products/x/y-800.webp');
  const req = requests.find((r) => r.method === 'DELETE');
  assert.ok(req, 'expected a DELETE to the mock Supabase Storage server');
  assert.equal(req.headers['authorization'], `Bearer ${SERVICE_ROLE_KEY}`);
});

test('deleteObject never throws even when Supabase Storage refuses the delete', async () => {
  setSupabaseEnv();
  mockMode = 'fail-delete';
  await assert.doesNotReject(() => uploads.deleteObject('products/x/y-800.webp'));
});

/* ------------------------------------------------ database reference consistency */

test('a successful admin upload writes a product_images row pointing at the Supabase public URL', async () => {
  setSupabaseEnv();
  const buf = await tinyImage();
  const r = await uploadProductImage(
    SLUG,
    { buffer: buf, alt: 'a red square', role: null },
    { adminId: null, ip: '127.0.0.1' }
  );
  assert.equal(r.ok, true);

  const images = await getProductImages(SLUG);
  const inserted = images.find((im) => im.id === r.id);
  assert.ok(inserted, 'the uploaded image must be present in the database');
  assert.match(
    inserted.src,
    new RegExp(`^http://127\\.0\\.0\\.1:${mockPort}/storage/v1/object/public/${BUCKET}/`)
  );

  await deleteProductImage(SLUG, r.id, { adminId: null, ip: '127.0.0.1' });
});

test('a failed Supabase upload leaves no product_images row behind (no broken reference)', async () => {
  setSupabaseEnv();
  mockMode = 'fail-upload';
  const before = (await getProductImages(SLUG)).length;

  const buf = await tinyImage();
  const r = await uploadProductImage(
    SLUG,
    { buffer: buf, alt: 'never gets saved', role: null },
    { adminId: null, ip: '127.0.0.1' }
  );
  assert.equal(r.ok, false, 'the upload must be reported as failed');

  const after = (await getProductImages(SLUG)).length;
  assert.equal(after, before, 'no row may be inserted when the storage write failed');
});

test('replacing an image (upload new, then delete old) leaves exactly the new image referenced', async () => {
  setSupabaseEnv();

  const first = await uploadProductImage(
    SLUG,
    { buffer: await tinyImage(), alt: 'first', role: null },
    { adminId: null, ip: '127.0.0.1' }
  );
  assert.equal(first.ok, true);

  requests = []; // isolate what happens during the "replace" step itself
  const second = await uploadProductImage(
    SLUG,
    { buffer: await tinyImage(), alt: 'second', role: null },
    { adminId: null, ip: '127.0.0.1' }
  );
  assert.equal(second.ok, true);

  const del = await deleteProductImage(SLUG, first.id, { adminId: null, ip: '127.0.0.1' });
  assert.equal(del.ok, true);

  const images = await getProductImages(SLUG);
  assert.ok(images.some((im) => im.id === second.id), 'the new image must remain');
  assert.ok(!images.some((im) => im.id === first.id), 'the replaced image must be gone');
  assert.ok(
    requests.some((r) => r.method === 'DELETE'),
    'the old image variants must be removed from storage, not just from the database'
  );

  await deleteProductImage(SLUG, second.id, { adminId: null, ip: '127.0.0.1' });
});

/* ----------------------------------------------------------- admin authorization */

test('the image-upload route refuses an anonymous request and writes nothing', async () => {
  const before = (await getProductImages(SLUG)).length;
  const boundary = '----uploadtestboundary1';
  const res = await fetch(`${BASE}/admin/products/${SLUG}/images`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, Origin: BASE },
    body: multipartBody(boundary, Buffer.from('not-checked-because-unauthenticated')),
    redirect: 'manual',
  });
  assert.equal(res.status, 401);
  assert.equal((await getProductImages(SLUG)).length, before);
});

test('the image-upload route refuses a cross-origin request even with a valid session', async () => {
  const result = await login('uploads-tester@vestiphobia.test', PASSWORD, {});
  const cookie = `vesti_admin=${result.session.token}`;
  const before = (await getProductImages(SLUG)).length;

  const boundary = '----uploadtestboundary2';
  const res = await fetch(`${BASE}/admin/products/${SLUG}/images`, {
    method: 'POST',
    headers: {
      cookie,
      Origin: 'https://evil.example.com',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartBody(boundary, Buffer.from('not-checked-because-cross-origin')),
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /m=forbidden/);
  assert.equal((await getProductImages(SLUG)).length, before);
  await destroySession(result.session.token);
});

/* ----------------------------------------------------------- credential protection */

test('the health endpoint reports the Supabase backend without exposing the service role key', async () => {
  setSupabaseEnv();
  const res = await fetch(`${BASE}/api/health`);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.uploads, 'supabase');
  assert.doesNotMatch(text, new RegExp(SERVICE_ROLE_KEY));
});

test('the health endpoint reports "local" when no remote storage backend is configured', async () => {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  assert.equal(body.uploads, 'local');
});
