import type { Config } from 'tailwindcss';

/**
 * Paylo design tokens.
 * Two brand colours: Cherry Cola and Cream Vanilla. Everything else is a derivation —
 * `ink` is a very dark warm brown rather than black, so the whole surface stays warm.
 * `success`/`warn` are status semantics only and never carry brand meaning; destructive
 * actions reuse `cherry` and separate themselves by treatment, not by a second red.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cherry: { DEFAULT: '#9A0002', dark: '#7A0002', tint: '#F4E4E2' },
        cream: { DEFAULT: '#EFE6DE', deep: '#E3D8CE' },
        paper: '#FFFFFF',
        ink: { DEFAULT: '#2A1A17', soft: '#6B5A54' },
        success: '#2F6B4F',
        warn: '#8A6318',
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'Cairo', 'system-ui', 'sans-serif'] },
      opacity: { 8: '.08', 12: '.12', 15: '.15' },
      borderRadius: { DEFAULT: '8px', lg: '10px', xl: '12px', '2xl': '14px' },
      boxShadow: {
        hair: '0 1px 2px rgba(42, 26, 23, .04)',
        lift: '0 10px 30px rgba(42, 26, 23, .10)',
      },
      maxWidth: { prose: '62ch' },
    },
  },
  plugins: [],
};
export default config;
