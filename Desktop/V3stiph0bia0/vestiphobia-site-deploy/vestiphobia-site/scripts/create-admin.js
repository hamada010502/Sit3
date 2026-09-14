/**
 * Create an admin account.
 *
 *   npm run admin:create -- you@example.com "a long passphrase"
 *   npm run admin:create -- you@example.com            (prompts, no echo)
 *
 * The password is never written to a file and never printed back. Passing it
 * as an argument puts it in your shell history — the prompt form avoids that
 * and is the one to prefer on a real machine.
 */

import { createInterface } from 'node:readline';
import { migrate } from '../server/db/migrate.js';
import { createAdmin, setAdminPassword } from '../server/lib/auth.js';
import { getDb, closeDb } from '../server/db/index.js';

const MIN_LENGTH = 12;

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      // Repaint the prompt without the typed characters.
      if (!['\n', '\r', '\u0004'].includes(String(char))) {
        process.stdout.write(`\r\u001B[2K${question}`);
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const [, , emailArg, passwordArg] = process.argv;

if (!emailArg) {
  console.error('Usage: npm run admin:create -- you@example.com ["a long passphrase"]');
  process.exit(1);
}

const email = String(emailArg).toLowerCase().trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error(`Not a valid email address: ${email}`);
  process.exit(1);
}

try {
  await migrate({ quiet: true });

  const password = passwordArg || (await promptHidden(`Password for ${email}: `));
  if (String(password).length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters. Nothing was created.`);
    process.exit(1);
  }

  const db = await getDb();
  const existing = await db.get('SELECT id FROM admins WHERE email = ?', [email]);

  if (existing) {
    // Resetting an existing account is the recovery path for a forgotten
    // password, and it signs out every session that account still holds.
    await setAdminPassword(existing.id, password);
    console.log(`Password reset for ${email}. All existing sessions were signed out.`);
  } else {
    await createAdmin(email, password);
    console.log(`Admin created: ${email}`);
  }

  await closeDb();
} catch (err) {
  console.error('Could not create the admin account:', err.message);
  process.exit(1);
}
