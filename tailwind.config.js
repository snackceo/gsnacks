
/** @type {import('tailwindcss').Config} */
import tailwindAnimate from 'tailwindcss-animate';

export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        '4xl': '2rem',
        '5xl': '3rem',
      }
    },
  },
  plugins: [tailwindAnimate],
}
