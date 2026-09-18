import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        karry: '#FFEBD2',
        tangerine: '#FFA364',
        crusta: '#FC7643',
        blossom: '#AF4F41',
        bluewood: '#273248',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
