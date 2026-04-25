/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        secondary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        surface: {
          page: 'var(--color-surface-page)',
          base: 'var(--color-surface-base)',
          elevated: 'var(--color-surface-elevated)',
          inset: 'var(--color-surface-inset)',
          soft: 'var(--color-surface-soft)',
        },
        border: {
          subtle: 'var(--color-border-subtle)',
          strong: 'var(--color-border-strong)',
        },
        content: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          faint: 'var(--color-text-faint)',
        },
        divider: 'var(--color-divider)',
        success: {
          DEFAULT: '#4ade80',
          soft: '#22c55e',
        },
        danger: {
          DEFAULT: '#fb7185',
          soft: '#ef4444',
        },
        warning: '#fbbf24',
        info: '#60a5fa',
        chart: {
          purple: '#8b7cfe',
          lavender: '#c4b5fd',
          red: '#ff5b5b',
          green: '#43d57c',
        },
      },
      boxShadow: {
        glow: '0 0 20px rgba(167, 139, 250, 0.22)',
        'glow-strong': '0 0 30px rgba(139, 92, 246, 0.35)',
        card: '0 4px 24px rgba(0, 0, 0, 0.25)',
        'card-hover': '0 8px 32px rgba(0, 0, 0, 0.35)',
      },
      borderRadius: {
        sm: '0.625rem',
        DEFAULT: '0.75rem',
        md: '1rem',
        lg: '1.25rem',
        xl: '1.5rem',
        '2xl': '1.75rem',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-primary': 'linear-gradient(135deg, #8b5cf6, #6366f1)',
        'gradient-cta': 'linear-gradient(135deg, #a78bfa, #7c3aed)',
        'gradient-card': 'linear-gradient(180deg, var(--color-surface-elevated), var(--color-surface-base))',
        noise: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.03\'/%3E%3C/svg%3E")',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(139, 92, 246, 0.4)' },
          '50%': { boxShadow: '0 0 16px 4px rgba(139, 92, 246, 0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
