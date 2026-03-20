/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        sc: {
          // Google dark neutrals
          'bg-0': '#171717',
          'bg-1': '#202124',
          'bg-2': '#3C4043',
          'surface-0': '#202124',
          'surface-1': '#2B2D31',
          'surface-2': '#3C4043',
          'surface-glass': 'rgba(32, 33, 36, 0.92)',
          line: 'rgba(255, 255, 255, 0.08)',
          'line-strong': 'rgba(255, 255, 255, 0.14)',
          'border-soft': 'rgba(95, 99, 104, 0.32)',
          border: 'rgba(95, 99, 104, 0.56)',
          'border-strong': 'rgba(154, 160, 166, 0.72)',

          // Text
          text: '#FFFFFF',
          'text-soft': '#E8EAED',
          muted: '#9AA0A6',
          'text-faint': '#80868B',

          // Baseline accent and semantic states
          accent: '#8AB4F8',
          'accent-soft': '#AECBFA',
          supported: '#81C995',
          partial: '#FDE293',
          disputed: '#F28B82',
          neutral: '#9AA0A6',
          'model-blue': '#8AB4F8',
          'model-green': '#81C995',
          'model-yellow': '#FDE293',
          'status-red': '#F28B82',

          // Google brand colors for logo identity
          'google-blue': '#4285F4',
          'google-red': '#EA4335',
          'google-yellow': '#FBBC05',
          'google-green': '#34A853',
        }
      },
      boxShadow: {
        'sc-soft': '0 8px 16px rgba(0, 0, 0, 0.24)',
        'sc-main': '0 18px 40px rgba(0, 0, 0, 0.34)',
        'sc-card': '0 12px 28px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        'sc-input': 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 8px 16px rgba(0, 0, 0, 0.22)',
        'sc-glow-blue': '0 0 16px rgba(138, 180, 248, 0.18)',
        'sc-glass': 'inset 0 1px 0 rgba(255, 255, 255, 0.05), inset 1px 0 0 rgba(255, 255, 255, 0.02)',
        'sc-hero': '0 0 18px rgba(138, 180, 248, 0.14), inset 0 0 0 1px rgba(138, 180, 248, 0.08)',
        'sc-mechanical': 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 4px 10px rgba(0, 0, 0, 0.22)',
        'sc-mechanical-active': 'inset 0 2px 6px rgba(0, 0, 0, 0.32)',
      },
      fontFamily: {
        sc: ['"Avenir Next"', '"Manrope"', '"Inter"', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      keyframes: {
        scanSkeleton: {
          '0%': { backgroundPosition: '220% 0' },
          '100%': { backgroundPosition: '-220% 0' },
        },
        cardSlideIn: {
          '0%': { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          '60%': { opacity: '1', transform: 'translateY(-2px) scale(1.005)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        revealDown: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        railScan: {
          '0%': { transform: 'translateY(-14px)', opacity: '0' },
          '18%': { opacity: '1' },
          '100%': { transform: 'translateY(120%)', opacity: '0' },
        },
        sweepHorizontal: {
          '0%': { top: '-2px', opacity: '0' },
          '8%': { opacity: '0.7' },
          '88%': { opacity: '0.5' },
          '100%': { top: '100%', opacity: '0' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        railNodePulse: {
          '0%, 100%': { 
            transform: 'scale(1)', 
            opacity: '1', 
            boxShadow: '0 0 0 3px rgba(var(--model-accent-rgb, 138, 180, 248), 0.08)' 
          },
          '50%': { 
            transform: 'scale(1.4)', 
            opacity: '0.7', 
            boxShadow: '0 0 8px rgba(var(--model-accent-rgb, 138, 180, 248), 0.2)' 
          },
        },
        scanHeadDrift: {
          '0%, 100%': { 
            opacity: '0.82', 
            transform: 'rotate(45deg) translateX(0) scale(1)', 
            filter: 'drop-shadow(0 0 0 rgba(var(--model-accent-rgb, 138, 180, 248), 0))' 
          },
          '50%': { 
            opacity: '1', 
            transform: 'rotate(45deg) translateX(1.5px) scale(1.05)', 
            filter: 'drop-shadow(0 0 4px rgba(var(--model-accent-rgb, 138, 180, 248), 0.24))' 
          },
        },
        dotBounce: {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.3' },
          '40%': { transform: 'translateY(-3px)', opacity: '1' },
        },
        hudFlicker: {
          '0%, 100%': { opacity: '0.56' },
          '16%': { opacity: '0.82' },
          '22%': { opacity: '0.44' },
          '48%': { opacity: '0.74' },
          '60%': { opacity: '0.62' },
        },
        cursorBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        }
      },
      animation: {
        'scan-skeleton': 'scanSkeleton 1.8s linear infinite',
        'card-slide-in': 'cardSlideIn 0.4s cubic-bezier(0.16, 0.85, 0.3, 1) both',
        'reveal-down': 'revealDown 0.3s cubic-bezier(0.22, 0.9, 0.24, 1) both',
        'rail-scan': 'railScan 2.1s linear infinite',
        'sweep-horizontal': 'sweepHorizontal 3s linear infinite',
        'pulse-glow': 'pulseGlow 1.6s ease-in-out infinite',
        'rail-node-pulse': 'railNodePulse 2.4s ease-in-out infinite',
        'scan-head-drift': 'scanHeadDrift 2.8s ease-in-out infinite',
        'dot-bounce': 'dotBounce 1s infinite',
        'hud-flicker': 'hudFlicker 2.8s steps(2, end) infinite',
        'cursor-blink': 'cursorBlink 1s step-end infinite',
      }
    },
  },
  plugins: [],
}
