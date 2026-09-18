export function formatSYP(amount: number, lang: 'en' | 'ar' = 'en') {
  const n = new Intl.NumberFormat(lang === 'ar' ? 'ar-SY' : 'en-US', { maximumFractionDigits: 0 }).format(amount);
  return lang === 'ar' ? `${n} ل.س` : `${n} SYP`;
}
export function calcCommission(subtotal: number, ratePct: number) {
  return Math.round((subtotal * ratePct) / 100);
}
