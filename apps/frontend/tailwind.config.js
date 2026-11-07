/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // ── ColocOS Design System ──────────────────────────────────────────────
      colors: {
        // Surface system — near-black industrial dark
        surface: {
          DEFAULT: '#0a0b0d',
          1: '#0f1114',
          2: '#14161a',
          3: '#1c1f25',
          4: '#252830',
          border: '#2a2d35',
        },
        // Health status palette — calibrated for 3D readability
        health: {
          critical: '#ff3b3b',
          'critical-glow': '#ff3b3b40',
          warning:  '#ff9500',
          'warning-glow': '#ff950040',
          ok:       '#00e676',
          'ok-glow': '#00e67640',
          empty:    '#3a3d45',
          'empty-glow': '#3a3d4530',
        },
        // UI accent
        accent: {
          DEFAULT: '#4fc3f7',
          dim: '#4fc3f720',
          bright: '#81d4fa',
        },
        // Text hierarchy
        text: {
          primary: '#e8eaf0',
          secondary: '#8b8fa8',
          tertiary: '#5a5d6e',
          mono: '#64b5f6',
        },
      },
      fontFamily: {
        // Display — tight, technical
        display: ['"Barlow Condensed"', 'sans-serif'],
        // Body — neutral, readable
        body: ['"DM Sans"', 'sans-serif'],
        // Data — monospaced for numbers
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        'glow-critical': '0 0 20px 2px #ff3b3b40, 0 0 60px 8px #ff3b3b20',
        'glow-warning':  '0 0 20px 2px #ff950040, 0 0 60px 8px #ff950020',
        'glow-ok':       '0 0 20px 2px #00e67640, 0 0 60px 8px #00e67620',
        'glow-accent':   '0 0 20px 2px #4fc3f740',
        'panel':         'inset 0 1px 0 #ffffff08, 0 4px 24px #00000060',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan':       'scan 4s linear infinite',
        'fade-up':    'fadeUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in':   'slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        scan: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%':   { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};