/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Holographic theme colors
        holo: {
          bg: '#0a0a0f',
          panel: 'rgba(20, 20, 30, 0.8)',
          border: 'rgba(100, 150, 255, 0.2)',
          glow: 'rgba(100, 150, 255, 0.4)',
          accent: '#4a9eff',
          text: '#e0e0e0',
          muted: '#888888',
        }
      },
      boxShadow: {
        'holo': '0 0 20px rgba(100, 150, 255, 0.15)',
        'holo-lg': '0 0 40px rgba(100, 150, 255, 0.2)',
      },
      backdropBlur: {
        'holo': '12px',
      }
    },
  },
  plugins: [],
}
