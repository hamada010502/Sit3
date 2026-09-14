/**
 * VESTIPHOBIA — product catalogue.
 *
 * Adding a product = append an object here and re-run `npm run build`.
 * No template, route or stylesheet needs to be touched: the shop grid, the
 * product route (/products/<slug>/), structured data, the sitemap, search and
 * the cart are all generated from this array.
 *
 * FIELD REFERENCE
 *   id                stable internal id, never shown to customers
 *   slug              URL segment under /products/
 *   name              full display name
 *   shortName         compact name for cart lines and mobile headers
 *   price             number (17 = $17.00)
 *   compareAtPrice    original price for a sale; null = not on sale
 *   currency          ISO 4217 code
 *   sizes             [{ label, available }] — available:false greys the size out
 *   stockBySize       { S: n|null, … } actual units; null = quantity unknown
 *   lowStockThreshold at or below this (and stock known) the size reads "low stock"
 *   images            [{ src, alt, role }] — role: main|detail|side|back|campaign
 *   shortDescription  one line, used for meta description and cards
 *   description       paragraphs under DESCRIPTION
 *   fabric            null until confirmed — row hides while null
 *   gsm               null until confirmed — row hides while null
 *   gsmApproximate    true renders the weight as "Approx. N GSM"
 *   fit               null until confirmed — row hides while null
 *   careInstructions  [] until confirmed — section hides while empty
 *   details           confirmed facts + an honest note about what is pending
 *   sizeGuide         { note, measurements } — measurements null until confirmed
 *   availability      'in_stock' | 'sold_out' | 'coming_soon'
 *   category, tags    grouping labels, used once there is more than one product
 *   featured          surfaces the product on the homepage
 *   badge             small overlay label on the shop card; null for none
 *   related           array of slugs
 *
 * HONESTY RULE
 *   Never fill fabric, gsm, careInstructions, stockBySize or sizeGuide with a
 *   guess. Every one of them is hidden by the UI while unset, which is the
 *   correct behaviour — a hidden section is honest, an invented one is not.
 */

const IMG = '/assets/images';

export const products = [
  {
    id: 'vestiphobia-001',
    slug: 'vestiphobia-001-fear-tee',
    name: 'VESTIPHOBIA 001 — FEAR TEE',
    shortName: 'FEAR TEE',
    price: 17,
    compareAtPrice: null,
    currency: 'USD',

    sizes: [
      { label: 'S', available: true },
      { label: 'M', available: true },
      { label: 'L', available: true },
      { label: 'XL', available: true },
      { label: 'XXL', available: true },
    ],

    stockBySize: { S: 25, M: 25, L: 25, XL: 25, XXL: 25 },
    lowStockThreshold: 3,

    images: [
      {
        src: `${IMG}/02_medium_shot.jpeg`,
        role: 'main',
        alt: 'Model wearing the black VESTIPHOBIA Fear Tee with the red wordmark across the chest, standing in a tiled kitchen holding a bouquet wrapped in red paper.',
      },
      {
        src: `${IMG}/04_tshirt_detail.jpeg`,
        role: 'detail',
        alt: 'Close detail of the red VESTIPHOBIA wordmark printed across the front of the black tee.',
      },
      {
        src: `${IMG}/06_right_facing_profile.jpeg`,
        role: 'side',
        alt: 'Right-facing profile view of the model showing the silhouette and shoulder line of the Fear Tee.',
      },
      {
        src: `${IMG}/07_back_facing.jpeg`,
        role: 'back',
        alt: 'Back view of the model wearing the Fear Tee.',
      },
      {
        src: `${IMG}/01_red_concrete_wide.jpeg`,
        role: 'campaign',
        alt: 'Campaign image: the model standing alone in front of a vast red-lit concrete wall, wearing the Fear Tee.',
      },
      {
        src: `${IMG}/04_red_concrete_wall_three_quarter_back.jpeg`,
        role: 'campaign',
        alt: 'Campaign image: three-quarter rear view of the model against the red-lit concrete wall.',
      },
    ],

    shortDescription:
      'Heavyweight cotton. Raw red graphic. Built to be worn hard. 100% Cotton, approx. 240 GSM, regular / relaxed fit.',

    // Owner-supplied copy — use verbatim.
    tagline: 'Heavyweight cotton. Raw red graphic. Built to be worn hard.',

    description: [
      'A black tee carrying the original Vestiphobia mark — a statement on the strange relationship between identity and clothing. Soft hand-feel with structure. Designed for daily rotation.',
    ],

    // Bullet list shown under the description, exactly as supplied.
    highlights: [
      '100% Cotton',
      'Approx. 240 GSM',
      'Regular / Relaxed fit',
      'Screen printed graphic',
      'Limited first drop',
    ],

    // Confirmed by the owner.
    fabric: '100% Cotton',
    gsm: 240,
    gsmApproximate: true,
    fit: 'Regular / Relaxed',
    printMethod: 'Screen printed graphic',

    // Transcribed from the actual garment label supplied by the owner.
    careInstructions: [
      'Machine wash cold',
      'Wash dark colors separately',
      'Do not bleach',
      'Do not soak',
      'Do not use optical brighteners',
      'Iron on reverse while damp (use press cloth)',
      'Do not dry clean',
      'Color may rub off',
      'Keep away from fire',
      'Hang dry recommended',
    ],

    details: {
      confirmed: [
        'Black T-shirt',
        'Red VESTIPHOBIA wordmark screen printed across the front',
        'Available in S, M, L, XL and XXL',
        'Limited first drop',
      ],
      // Nothing is outstanding on this product any more.
      pending: null,
    },

    // Owner-supplied measurement chart. Units are centimetres.
    sizeGuide: {
      note: 'Measurements are approximate. Choose according to your preferred fit.',
      measurements: [
        { size: 'S', 'Bust (cm)': 100, 'Length (cm)': 68, 'Shoulder (cm)': 45.5, 'Sleeve (cm)': 22.5, 'Height (cm)': '160–165' },
        { size: 'M', 'Bust (cm)': 104, 'Length (cm)': 70, 'Shoulder (cm)': 46.5, 'Sleeve (cm)': 23, 'Height (cm)': '165–170' },
        { size: 'L', 'Bust (cm)': 108, 'Length (cm)': 72, 'Shoulder (cm)': 47.5, 'Sleeve (cm)': 23.5, 'Height (cm)': '170–175' },
        { size: 'XL', 'Bust (cm)': 112, 'Length (cm)': 74, 'Shoulder (cm)': 48.5, 'Sleeve (cm)': 24, 'Height (cm)': '175–180' },
        { size: 'XXL', 'Bust (cm)': 116, 'Length (cm)': 76, 'Shoulder (cm)': 49.5, 'Sleeve (cm)': 24.5, 'Height (cm)': '180–185' },
      ],
    },

    availability: 'in_stock',
    category: 'T-SHIRTS',
    tags: ['first drop', 'graphic tee'],
    featured: true,
    // Stored lowercase: the shop card badge forces its own uppercase via CSS
    // (.card__badge), while the product page's eyebrow renders it verbatim
    // in the lowercase editorial voice (.eyebrow--lower) — one value, two
    // presentations, no duplicate field.
    badge: 'first drop',
    related: [],
  },
];

export const getProduct = (slug) => products.find((p) => p.slug === slug) || null;
export const featuredProduct = () => products.find((p) => p.featured) || products[0] || null;

/** A category value into the short, lowercase row label the shop renders. */
const categoryLabel = (category) =>
  category ? String(category).toLowerCase() : 'the collection';

/** URL-safe anchor id for a category's row, shared by every page that renders one. */
export const categorySlug = (category) =>
  category
    ? String(category)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'collection'
    : 'collection';

/**
 * Group products by their `category` field into the rows the shop and
 * homepage both render — one row per category, in the order each category
 * first appears. There is only ever one category in the catalogue today
 * (T-shirts); this is what lets a second one show up later as a new row
 * with no template change, only new product data.
 */
export function groupByCategory(products) {
  const order = [];
  const byKey = new Map();
  for (const p of products) {
    const key = p.category || null;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push(p);
  }
  return order.map((key) => ({
    key: categorySlug(key),
    label: categoryLabel(key),
    products: byKey.get(key),
  }));
}

/**
 * Stock state for one size.
 * 'low' is only ever returned when a real quantity has been configured —
 * an unknown quantity reads as plain 'available', never as scarcity.
 */
export function sizeState(product, label) {
  const size = product.sizes.find((s) => s.label === label);
  if (!size || !size.available) return 'sold_out';
  const qty = product.stockBySize?.[label];
  if (qty === 0) return 'sold_out';
  if (typeof qty === 'number' && qty <= (product.lowStockThreshold ?? 0)) return 'low';
  return 'available';
}

/**
 * Normalise either product shape — the static catalogue here, or a
 * DB-sourced product from server/routes/products.js's publicProduct() —
 * into the one shape pages/product.js actually renders from: sizes as
 * `{label, available, low}` (already resolved, never a raw quantity) and
 * `details.confirmed/pending` instead of two different field names for the
 * same "confirmed facts" bullet list.
 *
 * This is where the two data sources meet. Every other file that renders a
 * product should not need to know which one it came from.
 */
export function toProductViewModel(p) {
  const isDbShape = p.sizes.length > 0 && p.sizes[0].size !== undefined;

  const sizes = isDbShape
    ? p.sizes.map((s) => ({ label: s.size, available: s.available, low: s.low }))
    : p.sizes.map((s) => {
        const state = sizeState(p, s.label);
        return { label: s.label, available: state !== 'sold_out', low: state === 'low' };
      });

  const details = isDbShape
    ? { confirmed: p.detailsConfirmed || [], pending: null }
    : p.details;

  const soldOut = isDbShape ? p.soldOut : p.availability === 'sold_out';

  return { ...p, sizes, details, soldOut };
}

/**
 * Cart/shop-facing view of a product: the fields the browser actually needs.
 * Accepts either shape products come in: the static catalogue here (sizes
 * carry `.label`) or a DB-sourced product from server/routes/products.js
 * (sizes carry `.size`) — both feed this same function from server/index.js's
 * SSR routes, so it has to read whichever key is actually present.
 */
export const toStoreShape = (p) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  shortName: p.shortName,
  price: p.price,
  currency: p.currency,
  image: (p.images.find((i) => i.isPrimary || i.role === 'main') || p.images[0]).src,
  sizes: p.sizes.map((s) => s.label ?? s.size),
});

export default products;
