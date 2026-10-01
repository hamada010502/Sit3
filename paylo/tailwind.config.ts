import type { Config } from 'tailwindcss';

/**
 * Paylo design tokens — Forest & Cream (supersedes Cherry Cola / Cream Vanilla).
 * Values sampled from the reference fintech landing page, then checked for contrast.
 *
 * Three roles, as before:
 *   brand  — primary accent: buttons, links, logo, active states (forest green)
 *   night  — dark surface: card-style panels, the hero phone, any dark block
 *   cream / paper — the clean surfaces; ink is the text on them
 * Plus `accent` (bright green) for highlights only: headline words, dots, icons, badges.
 * It is 2.3:1 on cream and 2.5:1 under white text, so it never carries body text or
 * a button label — `accent-deep` (4.7:1) is the readable green when one is needed.
 * `danger` is the one red: errors, failures, destructive actions. `success`/`warn` are
 * status semantics only.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#04380E', dark: '#022707', tint: '#E3EEDF' },
        // display = large-headline highlights (3.1:1 on cream, the large-text minimum).
        accent: { DEFAULT: '#00BD3E', display: '#00A235', deep: '#00802A' },
        night: { DEFAULT: '#09180C', soft: '#1A2B1D' },
        cream: { DEFAULT: '#F8F4EC', deep: '#ECE6DA' },
        paper: '#FFFFFF',
        ink: { DEFAULT: '#0A1B0A', soft: '#5B6658' },
        danger: '#B42318',
        success: '#17703A',
        warn: '#8A6318',
      },
      fontFamily: {
        sans: ['Figtree', 'Cairo', 'system-ui', 'sans-serif'],
        display: ['Figtree', 'Cairo', 'system-ui', 'sans-serif'],
      },
      opacity: { 8: '.08', 12: '.12', 15: '.15' },
      borderRadius: { DEFAULT: '8px', lg: '10px', xl: '12px', '2xl': '16px', '3xl': '24px' },
      boxShadow: {
        hair: '0 1px 2px rgba(10, 27, 10, .04)',
        lift: '0 10px 30px rgba(10, 27, 10, .10)',
        phone: '0 30px 60px -20px rgba(9, 24, 12, .45)',
      },
      maxWidth: { prose: '62ch' },
    },
  },
  plugins: [],
};
export default config;
