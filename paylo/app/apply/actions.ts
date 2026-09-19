'use server';
import { redirect } from 'next/navigation';
import { getDb, newId } from '@/lib/db';
import { createSession, findUserByEmail, hashPassword } from '@/lib/auth';
import { GOVERNORATES, type User } from '@/lib/types';
import { audit } from '@/lib/audit';

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export async function applyAction(_prev: { error?: string } | null, formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const storeName = String(formData.get('store_name') || '').trim();
  const slug = slugify(String(formData.get('slug') || storeName));
  const instagram = String(formData.get('instagram') || '').trim().replace(/^@/, '');
  const phone = String(formData.get('phone') || '').trim();
  const governorate = String(formData.get('governorate') || '');
  const bio = String(formData.get('bio') || '').trim();

  if (!name || !email.includes('@') || password.length < 8 || !storeName || !slug || !phone || !(GOVERNORATES as readonly string[]).includes(governorate)) {
    return { error: 'apply_error_generic' };
  }
  const db = getDb();
  if (findUserByEmail(email)) return { error: 'apply_error_email' };
  if (db.prepare('SELECT 1 FROM sellers WHERE slug = ?').get(slug)) return { error: 'apply_error_slug' };

  const userId = newId();
  db.transaction(() => {
    db.prepare("INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, 'seller', ?)").run(userId, email, '', name);
    db.prepare('INSERT INTO sellers (id, user_id, store_name, slug, instagram, phone, governorate, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), userId, storeName, slug, instagram || null, phone, governorate, bio || null);
  })();
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  audit('seller', userId, email, 'seller', slug, 'applied', { storeName, governorate });
  createSession(user);
  redirect('/seller');
}
