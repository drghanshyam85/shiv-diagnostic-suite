/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e', 950: '#082f49' },
        navy: { 800: '#1e293b', 850: '#172033', 900: '#0f172a', 950: '#0a1120' },
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        surface2: 'rgb(var(--c-surface2) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['"Times New Roman"', 'Times', 'serif'],
        deva: ['"Noto Sans Devanagari"', 'Mangal', '"Nirmala UI"', 'sans-serif'],
        mono: ['ui-monospace', 'Consolas', '"Courier New"', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)',
        pop: '0 18px 40px -12px rgb(2 132 199 / 0.28), 0 6px 16px rgb(15 23 42 / 0.14)',
        page: '0 2px 6px rgb(15 23 42 / 0.10), 0 12px 32px rgb(15 23 42 / 0.12)'
      },
      keyframes: {
        pulsebar: { '0%,100%': { transform: 'scaleY(0.3)' }, '50%': { transform: 'scaleY(1)' } },
        slidein: { from: { transform: 'translateY(8px)', opacity: 0 }, to: { transform: 'translateY(0)', opacity: 1 } }
      },
      animation: { pulsebar: 'pulsebar 1s ease-in-out infinite', slidein: 'slidein .18s ease-out' }
    }
  },
  plugins: []
};
