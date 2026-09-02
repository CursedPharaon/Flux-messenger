/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        flux: {
          bg: '#0f0f14',
          card: '#1a1a22',
          border: '#2a2a35',
          accent: '#7c3aed',
          accentHover: '#6d28d9',
          text: '#e5e7eb',
          muted: '#9ca3af'
        }
      }
    }
  },
  plugins: []
};
