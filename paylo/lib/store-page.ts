import type { AboutSection, Seller } from './types';

export const MAX_SECTIONS = 8;

/** Sections to show on the About page: the builder's, or the legacy single text block. */
export function aboutSections(seller: Pick<Seller, 'about_sections' | 'about'>): AboutSection[] {
  if (seller.about_sections) {
    try {
      const rows = JSON.parse(seller.about_sections) as AboutSection[];
      if (Array.isArray(rows) && rows.length) return rows;
    } catch { /* fall through to legacy */ }
  }
  return seller.about ? [{ heading: '', body: seller.about, image: null }] : [];
}
