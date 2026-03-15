export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        bgDark: 'var(--sc-bg-0)',
        bgCard: 'var(--sc-surface-0)',
        surfaceDark: 'var(--sc-surface-1)',
        surfaceBorder: 'var(--sc-border)',
        surfaceBorderHover: 'var(--sc-border-strong)',
        textMain: 'var(--sc-text)',
        textMuted: 'var(--sc-muted)',
        accent: 'var(--sc-accent)',
        accentMuted: 'var(--sc-neutral)',
        accentSoft: 'var(--sc-accent-soft)',
        accentWarm: 'var(--sc-partial)',
        primary: 'var(--sc-neutral)',
        primarySoft: 'var(--sc-text-faint)',
        accentGlow: 'rgba(200, 163, 106, 0.14)',
        primaryGlow: 'rgba(122, 109, 95, 0.12)',
        emeraldGlow: 'rgba(137, 176, 134, 0.16)',
        amberGlow: 'rgba(196, 143, 83, 0.14)',
        roseGlow: 'rgba(198, 111, 93, 0.16)',
        glass: 'var(--sc-surface-glass)',
        supported: 'var(--sc-supported)',
        partial: 'var(--sc-partial)',
        disputed: 'var(--sc-disputed)',
        neutral: 'var(--sc-neutral)',
      },
      fontFamily: {
        sans: ['"Avenir Next"', 'Manrope', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', '"SF Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glass: '0 20px 70px rgba(0, 0, 0, 0.28)',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 4px rgba(83, 208, 195, 0.45)' },
          '50%': { opacity: '0.65', boxShadow: '0 0 10px rgba(83, 208, 195, 0.65)' },
        },
        dotBounce: {
          '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: '0.3' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        progressSweep: {
          '0%': { transform: 'translateX(-45%)' },
          '100%': { transform: 'translateX(135%)' },
        },
        cursorBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        fadeInUp: 'fadeInUp 0.35s ease-out both',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        pulseGlow: 'pulseGlow 2s ease-in-out infinite',
        dotBounce: 'dotBounce 1.2s ease-in-out infinite',
        progressSweep: 'progressSweep 2.6s ease-in-out infinite',
        cursorBlink: 'cursorBlink 1.1s step-end infinite',
      },
    },
  },
  plugins: [],
}
