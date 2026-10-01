/**
 * Identity normalisation and format checks for accounts and seller applications.
 * Pure functions — no database access — so the same rules run in forms, server actions,
 * migrations and tests.
 *
 * What is deliberately NOT here: a national-ID checksum (no documented public algorithm
 * for the Syrian national number exists, and an invented one would reject real people)
 * and any "government verification" call (there is no reliable free API; approval stays
 * a manual review).
 */

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → ASCII, so pasted Arabic numerals work. */
export function asciiDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/**
 * Syrian mobile numbers → canonical +9639XXXXXXXX. Accepts 09XXXXXXXX, 9XXXXXXXX,
 * 9639XXXXXXXX, +9639XXXXXXXX and 009639XXXXXXXX, with spaces, dashes or brackets.
 * Returns null for anything else (landlines and foreign numbers are not account phones).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = asciiDigits(String(raw)).replace(/[\s\-().]/g, '');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(?:\+|00)?963(9\d{8})$/))) return '+963' + m[1];
  if ((m = s.match(/^0(9\d{8})$/))) return '+963' + m[1];
  if ((m = s.match(/^(9\d{8})$/))) return '+963' + m[1];
  return null;
}

/** Digits only (Arabic numerals converted); spaces and dashes removed. */
export function normalizeNationalId(raw: string | null | undefined): string {
  return asciiDigits(String(raw ?? '')).replace(/[\s\-]/g, '');
}

/**
 * The Syrian national number (الرقم الوطني) is 11 digits. Format only — there is no
 * checksum to verify, so a well-formed number can still be wrong; the reviewer checks it
 * against the ID photo.
 */
export const NATIONAL_ID_LENGTH = 11;
export function isValidNationalIdFormat(raw: string | null | undefined): boolean {
  return new RegExp(`^\\d{${NATIONAL_ID_LENGTH}}$`).test(normalizeNationalId(raw));
}

/**
 * Rejects obvious placeholder names: empty, one character, digits only, a single repeated
 * character, or keyboard/test fillers (test, asdf, qwerty, xxx, name, …). Real names in
 * Arabic or Latin script pass.
 */
export function isPlaceholderName(raw: string | null | undefined): boolean {
  const s = asciiDigits(String(raw ?? '')).trim().toLowerCase().replace(/\s+/g, ' ');
  if (s.replace(/\s/g, '').length < 2) return true;
  if (/^[\d\s.\-]+$/.test(s)) return true;
  if (/^(.)\1+$/.test(s.replace(/\s/g, ''))) return true;
  const fillers = /^(test|testing|tester|asdf\w*|qwer\w*|xxx+|aaa+|abc|abcd|name|full name|user|none|null|n\/a|na|fake|dummy|sample|تجربة|اختبار|اسم)( \w+)?$/;
  return fillers.test(s) || s.split(' ').every((w) => fillers.test(w));
}
