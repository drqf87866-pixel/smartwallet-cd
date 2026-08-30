const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{ts,tsx}',
    // Klassen, die erst zur Laufzeit vom Client-JS gesetzt werden (Toast, Spinner, Tab-Toggle)
    './public/assets/app.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Body-Schrift: freundlich, warm statt System-Sans
        sans: ['Karla', ...defaultTheme.fontFamily.sans],
        // Akzent-Schrift für große Beträge & Überschriften ("Warm Minimal")
        serif: ['Newsreader', 'Georgia', ...defaultTheme.fontFamily.serif],
      },
      colors: {
        // "Warm Minimal": Indigo → Terracotta (Primärakzent)
        indigo: {
          50: 'hsl(20, 60%, 96%)',
          100: 'hsl(20, 55%, 92%)',
          200: 'hsl(19, 55%, 85%)',
          300: 'hsl(18, 50%, 75%)',
          400: 'hsl(17, 50%, 63%)',
          500: 'hsl(16, 52%, 54%)',
          600: 'hsl(15, 55%, 46%)',
          700: 'hsl(14, 55%, 38%)',
          800: 'hsl(13, 50%, 30%)',
          900: 'hsl(12, 45%, 23%)',
        },
        // Slate → warmes Stone/Taupe (Neutraltöne)
        slate: {
          50: 'hsl(35, 30%, 97%)',
          100: 'hsl(33, 25%, 94%)',
          200: 'hsl(32, 18%, 88%)',
          300: 'hsl(30, 14%, 78%)',
          400: 'hsl(28, 10%, 62%)',
          500: 'hsl(27, 9%, 50%)',
          600: 'hsl(26, 10%, 40%)',
          700: 'hsl(25, 12%, 32%)',
          800: 'hsl(24, 14%, 22%)',
          900: 'hsl(23, 16%, 15%)',
        },
        // Emerald → Salbeigrün (Erfolg/positiv)
        emerald: {
          50: 'hsl(140, 35%, 95%)',
          100: 'hsl(140, 32%, 89%)',
          200: 'hsl(142, 28%, 80%)',
          300: 'hsl(144, 24%, 68%)',
          400: 'hsl(146, 22%, 55%)',
          600: 'hsl(148, 28%, 38%)',
          700: 'hsl(149, 30%, 30%)',
        },
      },
    },
  },
  plugins: [],
};
