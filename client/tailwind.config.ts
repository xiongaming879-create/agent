/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#0A0A0A',
        'chat-bg': '#080808',
        'msg-border': '#161616',
        'text-muted': '#4d4d4d',
        surface: '#0c0c0c',
        'surface-hover': '#161616',
        'surface-active': '#1a1a1a',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        bubble: '12px',
        btn: '6px',
      },
    },
  },
  plugins: [],
}
