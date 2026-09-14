/**
 * Proves the build actually refuses a broken configuration rather than
 * silently shipping it.
 *
 * Copies the project's data file aside, writes a deliberately invalid product
 * (negative price, no sizes, an image with no alt text, a duplicate slug),
 * runs the build, and expects a non-zero exit. The original file is always
 * restored, including on failure.
 *
 * Exits 0 when the build correctly refused; non-zero otherwise.
 */

import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TARGET = join(ROOT, 'data/products.js');
const BACKUP = join(ROOT, 'data/products.js.qa-backup');

const BROKEN = `
export const products = [
  {
    id: 'broken-a', slug: 'dupe', name: 'A', shortName: 'A',
    price: -5, currency: 'USD', sizes: [],
    images: [{ src: '/assets/images/02_medium_shot.jpeg', role: 'main', alt: '' }],
    shortDescription: 'x', description: ['x'],
    fabric: null, gsm: null, careInstructions: [],
    details: { confirmed: [], pending: 'x' },
    sizeGuide: { measurements: null, note: 'x' },
    stockBySize: { NOPE: 1 },
    availability: 'in_stock', category: 'X', tags: [], featured: true, badge: null, related: [],
  },
  {
    id: 'broken-b', slug: 'dupe', name: 'B', shortName: 'B',
    price: 10, currency: 'USD', sizes: [{ label: 'M', available: true }],
    images: [{ src: '/assets/images/02_medium_shot.jpeg', role: 'main', alt: 'ok' }],
    shortDescription: 'x', description: ['x'],
    fabric: null, gsm: null, careInstructions: [],
    details: { confirmed: [], pending: 'x' },
    sizeGuide: { measurements: null, note: 'x' },
    stockBySize: {},
    availability: 'in_stock', category: 'X', tags: [], featured: false, badge: null, related: [],
  },
];
export const getProduct = (slug) => products.find((p) => p.slug === slug) || null;
export const featuredProduct = () => products[0];
export const sizeState = () => 'available';
export const toStoreShape = (p) => ({
  id: p.id, slug: p.slug, name: p.name, shortName: p.shortName,
  price: p.price, currency: p.currency, image: p.images[0].src, sizes: [],
});
export const toProductViewModel = (p) => ({
  ...p,
  sizes: [],
  details: p.details,
  soldOut: p.availability === 'sold_out',
});
export const categorySlug = (c) => (c ? String(c).toLowerCase() : 'collection');
export const groupByCategory = (list) => [{ key: 'collection', label: 'the collection', products: list }];
export default products;
`;

const runBuild = () =>
  new Promise((res) => {
    const child = spawn('node', ['build.js'], { cwd: ROOT, stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => res({ code, out }));
  });

let restored = false;
const restore = async () => {
  if (restored) return;
  restored = true;
  try {
    await rename(BACKUP, TARGET);
  } catch {
    /* nothing to restore */
  }
};
process.on('exit', () => {});

try {
  await writeFile(BACKUP, await readFile(TARGET, 'utf8'), 'utf8');
  await writeFile(TARGET, BROKEN, 'utf8');

  const { code, out } = await runBuild();
  await restore();

  if (code === 0) {
    console.error('build accepted an invalid configuration');
    process.exit(1);
  }

  const expected = ['duplicate product slug', 'price must be a positive number', 'no sizes defined', 'no alt text'];
  const missed = expected.filter((e) => !out.includes(e));
  if (missed.length) {
    console.error(`build failed but did not report: ${missed.join(', ')}`);
    process.exit(1);
  }

  // Restore and confirm the real build works again, so a QA run never leaves
  // the project in a broken state.
  const after = await runBuild();
  if (after.code !== 0) {
    console.error('project did not build again after restoring products.js');
    process.exit(1);
  }

  console.log('build correctly rejected the invalid configuration and recovered');
  process.exit(0);
} catch (err) {
  await restore();
  try {
    await unlink(BACKUP);
  } catch {
    /* already restored */
  }
  console.error(err);
  process.exit(1);
}
