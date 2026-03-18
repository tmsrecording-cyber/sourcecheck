/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        sc: {
          // Authentic Gemini / Google Cloud Dark Mode Palette
          'bg-0': '#131314', // Core Gemini deep background
          'bg-1': '#1E1F22', // Elevated surface
          'bg-2': '#282A2D', // Higher surface
          'surface-0': '#1E1F22', // Default card background
          'surface-1': '#282A2D', // Hovered card
          'surface-2': '#333538', // Borders/Dividers
          'surface-glass': 'rgba(30, 31, 34, 0.75)', // True glass
          line: 'rgba(255, 255, 255, 0.08)',
          'line-strong': 'rgba(255, 255, 255, 0.12)',
          'border-soft': '#333538',
          border: '#444746',
          'border-strong': '#5F6368',
          
          // High-contrast, highly readable text
          text: '#E3E3E3',         // Crisp primary text
          'text-soft': '#C4C7C5',  // Secondary text
          muted: '#9AA0A6',        // De-emphasized
          'text-faint': '#80868B', // Very faint
          
          // The TRUE Gemini CLI Accents
          accent: '#A8C7FA',       // Gemini Sparkle Blue
          'accent-soft': '#D7AEFB', // Gemini Sparkle Purple
          supported: '#81C995',    // Google CLI Success Green
          partial: '#FDE293',      // Google CLI Warning Yellow
          disputed: '#F28B82',     // Google CLI Error Red
          neutral: '#9AA0A6',      // Google CLI Neutral Gray
          // Google Brand Colors (for logo/identity)
          'google-blue': '#4285F4',
          'google-red': '#EA4335',
          'google-yellow': '#FBBC05',
          'google-green': '#34A853',
        }
      },
      boxShadow: {
        'sc-soft': '0 4px 6px rgba(0, 0, 0, 0.3)',
        'sc-main': '0 10px 20px rgba(0, 0, 0, 0.4)',
        // Dual-layer: depth + back-lit glow
        'sc-card': '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        'sc-input': 'inset 0 2px 4px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 255, 255, 0.03)',
        'sc-glow-blue': '0 0 15px rgba(96, 165, 250, 0.2)',
        // Inner highlight for glass edge catching light
        'sc-glass': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05), inset 1px 0 0 0 rgba(255, 255, 255, 0.02)',
        // Enhanced hero with inner glow
        'sc-hero': '0 0 25px rgba(96, 165, 250, 0.15), inset 0 0 0 1px rgba(96, 165, 250, 0.1)',
        // Backlit mechanical button
        'sc-mechanical': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1), 0 2px 4px rgba(0, 0, 0, 0.3)',
        'sc-mechanical-active': 'inset 0 2px 4px rgba(0, 0, 0, 0.4)',
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
            boxShadow: '0 0 0 3px rgba(168, 199, 250, 0.08)' 
          },
          '50%': { 
            transform: 'scale(1.4)', 
            opacity: '0.7', 
            boxShadow: '0 0 8px rgba(168, 199, 250, 0.2)' 
          },
        },
        scanHeadDrift: {
          '0%, 100%': { 
            opacity: '0.82', 
            transform: 'rotate(45deg) translateX(0) scale(1)', 
            filter: 'drop-shadow(0 0 0 rgba(168, 199, 250, 0))' 
          },
          '50%': { 
            opacity: '1', 
            transform: 'rotate(45deg) translateX(1.5px) scale(1.05)', 
            filter: 'drop-shadow(0 0 4px rgba(168, 199, 250, 0.2))' 
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
