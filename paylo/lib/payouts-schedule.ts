import { getSetting } from './db';

/**
 * Weekly payout calendar (v2 §4.3): cutoff Tuesday 18:00, transfer Wednesday.
 * Day numbers follow JS getUTCDay(): 0 = Sunday. All arithmetic is UTC so the
 * cycle does not drift with the server's local timezone.
 */
export function payoutConfig() {
  return {
    cutoffDay: Number(getSetting('payout_cutoff_day') || 2),
    cutoffHour: Number(getSetting('payout_cutoff_hour') || 18),
    transferDay: Number(getSetting('payout_transfer_day') || 3),
  };
}

export function nextCutoff(from: Date = new Date()): Date {
  const { cutoffDay, cutoffHour } = payoutConfig();
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), cutoffHour, 0, 0));
  let delta = (cutoffDay - d.getUTCDay() + 7) % 7;
  if (delta === 0 && from.getTime() >= d.getTime()) delta = 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

export function nextTransferDate(from: Date = new Date()): Date {
  const { transferDay } = payoutConfig();
  const cutoff = nextCutoff(from);
  const d = new Date(cutoff);
  d.setUTCDate(d.getUTCDate() + ((transferDay - cutoff.getUTCDay() + 7) % 7 || 7));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** The cutoff that governs the payout run happening now. */
export function currentCutoff(from: Date = new Date()): Date {
  const next = nextCutoff(from);
  const prev = new Date(next);
  prev.setUTCDate(prev.getUTCDate() - 7);
  return prev;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const isoStamp = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
