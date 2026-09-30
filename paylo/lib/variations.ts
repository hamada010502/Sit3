import { getDb, newId } from './db';
import type { VariationPreset } from './types';

export class VariationError extends Error {}
const MAX_VALUES = 30;

export function parseValues(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw.split(/[,\n]/).map((x) => x.trim().slice(0, 40)).filter(Boolean)) {
    const k = v.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out.slice(0, MAX_VALUES);
}

type Row = { id: string; seller_id: string; name: string; values: string };
const toPreset = (r: Row): VariationPreset => ({ id: r.id, seller_id: r.seller_id, name: r.name, values: JSON.parse(r.values) });

export const sellerPresets = (sellerId: string) =>
  (getDb().prepare('SELECT id, seller_id, name, "values" FROM variation_presets WHERE seller_id = ? ORDER BY name').all(sellerId) as Row[]).map(toPreset);

export function savePreset(sellerId: string, name: string, rawValues: string, id?: string): VariationPreset {
  const clean = name.trim().slice(0, 30);
  const values = parseValues(rawValues);
  if (!clean) throw new VariationError('variation_name_required');
  if (values.length < 2) throw new VariationError('variation_values_min');
  const db = getDb();
  const clash = db.prepare('SELECT id FROM variation_presets WHERE seller_id = ? AND lower(name) = lower(?)').get(sellerId, clean) as { id: string } | undefined;
  if (clash && clash.id !== id) throw new VariationError('variation_exists');
  if (id) {
    db.prepare('UPDATE variation_presets SET name = ?, "values" = ? WHERE id = ? AND seller_id = ?').run(clean, JSON.stringify(values), id, sellerId);
  } else {
    id = newId();
    db.prepare('INSERT INTO variation_presets (id, seller_id, name, "values") VALUES (?, ?, ?, ?)').run(id, sellerId, clean, JSON.stringify(values));
  }
  return toPreset(db.prepare('SELECT id, seller_id, name, "values" FROM variation_presets WHERE id = ?').get(id) as Row);
}

export function deletePreset(sellerId: string, id: string) {
  getDb().prepare('DELETE FROM variation_presets WHERE id = ? AND seller_id = ?').run(id, sellerId);
}
