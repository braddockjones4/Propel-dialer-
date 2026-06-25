/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#C9A84C',
          light:   '#E8D5A3',
          dark:    '#9A7A2E',
          muted:   '#7A6030',
        },
        ink: {
          DEFAULT: '#0A0A0A',
          50:  '#F5F5F5',
          100: '#E8E8E8',
          200: '#C8C8C8',
          300: '#A0A0A0',
          400: '#707070',
          500: '#505050',
          600: '#333333',
          700: '#242424',
          800: '#181818',
          900: '#111111',
          950: '#0A0A0A',
        },
      },
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
