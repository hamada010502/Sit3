/*
 * Shopier-parity features. Each numbered section maps to one item in the parity plan.
 * Run against a freshly seeded DB: scripts/run-e2e.sh parity-tests
 */
const { chromium } = require('playwright');
const { createHmac } = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');
const LOGISTICS_SECRET = process.env.LOGISTICS_WEBHOOK_SECRET || 'dev-logistics-secret';

let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); passed++; console.log('  ✓ ' + m); };
const step = (m) => console.log('\n' + m);

(async () => {
  const db = new Database(DB_PATH);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const newPage = async () => (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const login = async (p, email, pw) => {
    await p.goto(BASE + '/login');
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', pw);
    await p.click('button[type=submit]');
  };
  const spice = db.prepare("SELECT * FROM sellers WHERE slug = 'spice-house'").get();

  const seller = await newPage();
  await login(seller, 'spice@paylo.sy', 'seller1234');
  await seller.waitForURL('**/seller');
  const admin = await newPage();
  await login(admin, 'admin@paylo.sy', 'admin1234');
  await admin.waitForURL('**/admin');

  /* ---------------- 1. Next payout, prominent ---------------- */
  step('1. Next payout date is prominent on the seller dashboard');
  const card = seller.locator('[data-testid=next-payout]');
  ok(await card.count() === 1, 'dashboard has a dedicated next-payout card');
  const cardText = await card.innerText();
  ok(/Wednesday/.test(cardText), 'card names the transfer weekday (Wednesday)');
  ok(/Tuesday 18:00 UTC/.test(cardText), 'card states the Tuesday 18:00 UTC cutoff');
  ok(/(days|hours) left/.test(cardText), 'card shows time remaining to the cutoff');
  ok(/156,750/.test(cardText), 'card shows the amount going out in this run (156,750 SYP)');

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close();
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
