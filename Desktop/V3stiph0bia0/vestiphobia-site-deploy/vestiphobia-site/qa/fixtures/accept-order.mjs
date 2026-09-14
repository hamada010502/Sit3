/**
 * Accept one order and report what happened, in a process of its own.
 *
 * The overselling test needs genuine concurrency. node:sqlite is synchronous,
 * so two "parallel" accepts inside one process would simply run one after the
 * other and prove nothing. Separate OS processes contending for the same
 * database file is the real thing.
 *
 *   node qa/fixtures/accept-order.mjs VST-2026-0001
 *
 * Prints OK or CONFLICT (or ERROR:<message>) and exits 0 either way — the
 * parent counts the outcomes.
 */

import { setOrderStatus } from '../../server/routes/orders.js';
import { closeDb } from '../../server/db/index.js';

const orderNumber = process.argv[2];

try {
  const result = await setOrderStatus(orderNumber, 'ACCEPTED', { adminId: null });
  if (result.status === 200) console.log('OK');
  else if (result.body?.code === 'INVENTORY_CONFLICT') console.log('CONFLICT');
  else console.log(`ERROR:${result.status}:${result.body?.error || ''}`);
} catch (err) {
  console.log(`ERROR:${err.message}`);
  // The stack goes to stderr so the parent can still parse stdout, but a
  // failure here is never a mystery.
  console.error(err.stack || String(err));
} finally {
  await closeDb();
}
