import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#FAF9F6', // Warm off-white/soft cream
        foreground: '#0B1120', // Deep navy/near-black
        accent: {
          DEFAULT: '#0F766E', // Teal
          hover: '#0D9488',
        }
      },
      fontFamily: {
        sans: ['var(--font-general-sans)', 'sans-serif'],
      }
    },
  },
  plugins: [],
};
export default config;
