/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: 'var(--bg-side)',
        'chat-bg': 'var(--bg-root)',
        'msg-border': 'var(--border-sem)',
        'text-muted': 'var(--text-mute)',
        surface: 'var(--bg-surface)',
        'surface-hover': 'var(--bg-surface-hover)',
        'surface-active': 'var(--bg-surface-active)',
        'text-main': 'var(--text-main)',
        'text-soft': 'var(--text-soft)',
        'text-mute': 'var(--text-mute)',
        'glass-fill': 'var(--glass-fill)',
        'glass-border': 'var(--glass-border)',
        overlay: 'var(--overlay-bg)',
        accent: {
          DEFAULT: '#7c8cf8',
          hover: '#6a7af0',
        },
      },
      fontFamily: {
        sans: [
          '"Geist"',
          '"Outfit"',
          'system-ui',
          '-apple-system',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          'sans-serif',
        ],
        mono: [
          '"Geist Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        bubble: '12px',
        btn: '6px',
      },
    },
  },
  plugins: [],
}
