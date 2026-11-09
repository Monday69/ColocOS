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
        // Système natif (SF Pro sur iOS) — base des matériaux « Liquid Glass »
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
        // Display — tight, technical
        display: ['"Barlow Condensed"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        // Body — neutral, readable
        body: ['"DM Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        // Data — monospaced for numbers
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      // Courbe iOS standard : sortie douce, sans rebond (sheets, tiroirs)
      transitionTimingFunction: {
        ios: 'cubic-bezier(0.32, 0.72, 0, 1)',
        'ios-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        250: '250ms',
        400: '400ms',
      },
      boxShadow: {
        'glow-critical': '0 0 20px 2px #ff3b3b40, 0 0 60px 8px #ff3b3b20',
        'glow-warning':  '0 0 20px 2px #ff950040, 0 0 60px 8px #ff950020',
        'glow-ok':       '0 0 20px 2px #00e67640, 0 0 60px 8px #00e67620',
        'glow-accent':   '0 0 20px 2px #4fc3f740',
        'panel':         'inset 0 1px 0 #ffffff08, 0 4px 24px #00000060',
        // « Liquid Glass » — ombre portée large et douce
        'glass':         '0 8px 32px 0 rgba(0,0,0,0.4)',
        'glass-lg':      '0 16px 48px 0 rgba(0,0,0,0.55)',
        'capsule':       '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.10)',
      },
      backgroundImage: {
        // Reflet spéculaire haut de carte (iOS material sheen)
        sheen: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 42%)',
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