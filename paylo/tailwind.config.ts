import type { Config } from 'tailwindcss';

/**
 * Paylo design tokens — canonical brand per Full Spec v2 §1.1.
 * Velvet Rose (accent/CTA), Midnight Tide (deep surfaces), Pearl Dust (white).
 * `ink`/`mist` are tint/shade derivations of Midnight Tide, never pure black (v2 §1.1).
 * `success`/`warn`/`danger` are UI status semantics only — they never carry brand meaning.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rose: { DEFAULT: '#E63E88', 600: '#C42E71', 700: '#A32560', 50: '#FDEDF4', 100: '#FBD9E8' },
        tide: { DEFAULT: '#384D95', 700: '#2C3D77', 800: '#22305F', 900: '#16203F' },
        pearl: '#FFFFFF',
        mist: '#F4F5FA',
        ink: { DEFAULT: '#1E2748', soft: '#5A648A' },
        success: '#1E9E6A',
        warn: '#B7791F',
        danger: '#D94141',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Cairo', 'system-ui', 'sans-serif'],
      },
      opacity: { 8: '.08', 12: '.12', 15: '.15' },
      borderRadius: { DEFAULT: '10px', lg: '12px', xl: '14px', '2xl': '16px' },
      boxShadow: {
        soft: '0 2px 8px rgba(30, 39, 72, .06), 0 1px 2px rgba(30, 39, 72, .04)',
        lift: '0 12px 32px rgba(30, 39, 72, .12)',
        deep: '0 20px 48px rgba(22, 32, 63, .28)',
      },
    },
  },
  plugins: [],
};
export default config;
