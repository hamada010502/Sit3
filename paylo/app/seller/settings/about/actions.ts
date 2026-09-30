'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { MAX_SECTIONS } from '@/lib/store-page';
import type { AboutSection } from '@/lib/types';
import { saveUpload } from '../../products/actions';

interface Posted { uid?: string; heading?: string; body?: string; image?: string | null }

export async function saveAboutAction(_prev: { ok?: boolean; error?: string } | null, formData: FormData) {
  const { seller } = requireApprovedSeller();
  let posted: Posted[] = [];
  try { posted = JSON.parse(String(formData.get('sections') || '[]')); } catch { return { error: 'apply_error_generic' }; }
  if (!Array.isArray(posted)) return { error: 'apply_error_generic' };

  // A kept photo must already be one of this store's About photos — never a posted path.
  const prior = new Set<string>();
  try { for (const s of JSON.parse(seller.about_sections || '[]') as AboutSection[]) if (s.image) prior.add(s.image); } catch { /* none */ }

  const sections: AboutSection[] = [];
  for (const p of posted.slice(0, MAX_SECTIONS)) {
    const heading = String(p.heading || '').trim().slice(0, 80);
    const body = String(p.body || '').trim().slice(0, 2000);
    const f = p.uid && /^[a-z0-9]{1,16}$/.test(p.uid) ? formData.get(`about_image_${p.uid}`) : null;
    const uploaded = f instanceof File ? await saveUpload(f) : null;
    const image = uploaded ?? (p.image && prior.has(p.image) ? p.image : null);
    if (heading || body || image) sections.push({ heading, body, image });
  }
  getDb().prepare('UPDATE sellers SET about_sections = ? WHERE id = ?').run(sections.length ? JSON.stringify(sections) : null, seller.id);
  audit('seller', seller.id, seller.store_name, 'seller', seller.id, 'about.updated', { sections: sections.length });
  revalidatePath('/seller/settings/about');
  revalidatePath(`/s/${seller.slug}`);
  revalidatePath(`/s/${seller.slug}/about`);
  return { ok: true };
}
