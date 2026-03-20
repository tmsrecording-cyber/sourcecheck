/**
 * SourceCheck Logo Component
 *
 * LOGO RULE:
 * 1. Large/brand use: full refined version with glow, highlight, micro-flares
 * 2. Small UI/icon use: simplified silhouette, no glow, no flares, maximum clarity
 *
 * Colors: Google Gemini palette
 * - Blue: #4992EA
 * - Red: #E8535D
 * - Yellow: #DBB82D
 * - Green: #84B381
 */

import React from 'react';

interface SourceCheckLogoProps {
  /** Size of the logo in pixels (default: 24) */
  size?: number;
  /** Optional className for additional styling */
  className?: string;
  /** Whether to show the animated version (default: false) */
  animated?: boolean;
  /** Variant: 'small' for UI icons, 'large' for brand/display (default: 'small') */
  variant?: 'small' | 'large';
}

const COLORS = {
  blue: '#4992EA',
  red: '#E8535D',
  yellow: '#DBB82D',
  green: '#84B381',
};

/**
 * SMALL VARIANT (UI/Icon use)
 * - Simplified silhouette
 * - No glow, no micro-flares
 * - Maximum clarity at small sizes
 * - 4 solid color segments only
 */
const SmallLogo: React.FC<{ size: number; className?: string; animated?: boolean }> = ({
  size,
  className,
  animated,
}) => {
  const shadowId = React.useId();

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SourceCheck"
      role="img"
    >
      <defs>
        <filter id={shadowId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.15" floodColor="#000000" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Soft base shadow to give the mark a little depth at small sizes */}
      <g transform="translate(1.4 1.6)" opacity="0.28">
        <path d="M14 50 L31 71 L39 63 L22 42 Z" fill="#000000" />
        <path d="M31 71 L49 53 L57 61 L39 79 Z" fill="#000000" />
        <path d="M49 53 L67 35 L75 43 L57 61 Z" fill="#000000" />
        <path d="M67 35 L85 17 L93 25 L75 43 Z" fill="#000000" />
      </g>

      <g filter={`url(#${shadowId})`}>
        <path
          d="M14 50 L31 71 L39 63 L22 42 Z"
          fill={COLORS.blue}
          className={animated ? 'animate-pulse' : ''}
        />
        <path d="M31 71 L49 53 L57 61 L39 79 Z" fill={COLORS.red} />
        <path d="M49 53 L67 35 L75 43 L57 61 Z" fill={COLORS.yellow} />
        <path d="M67 35 L85 17 L93 25 L75 43 Z" fill={COLORS.green} />
      </g>

      {/* Specular highlight across the first bend for a more polished finish */}
      <path
        d="M18 46 L31 59 L35 55 L22 42 Z"
        fill="#FFFFFF"
        opacity="0.18"
      />
    </svg>
  );
};

/**
 * LARGE VARIANT (Brand/Display use)
 * - Full refined version
 * - Glow, highlight, micro-flares
 * - Rich effects for visual impact
 */
const LargeLogo: React.FC<{ size: number; className?: string; animated?: boolean }> = ({
  size,
  className,
  animated,
}) => {
  const uid = React.useId();
  const gradientId = `sc-logo-gradient-${uid}`;
  const glowId = `sc-logo-glow-${uid}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SourceCheck"
      role="img"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={COLORS.blue} />
          <stop offset="33%" stopColor={COLORS.red} />
          <stop offset="66%" stopColor={COLORS.yellow} />
          <stop offset="100%" stopColor={COLORS.green} />
        </linearGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur"/>
          <feComposite in="blur" in2="SourceGraphic" operator="over"/>
        </filter>
      </defs>

      {/* Outer glow */}
      <path
        d="M14 50 L31 71 L39 63 L22 42 Z M31 71 L49 53 L57 61 L39 79 Z M49 53 L67 35 L75 43 L57 61 Z M67 35 L85 17 L93 25 L75 43 Z"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.22"
        filter={`url(#${glowId})`}
        className={animated ? 'animate-pulse' : ''}
      />

      {/* Main mark */}
      <path
        d="M14 50 L31 71 L39 63 L22 42 Z M31 71 L49 53 L57 61 L39 79 Z M49 53 L67 35 L75 43 L57 61 Z M67 35 L85 17 L93 25 L75 43 Z"
        fill={`url(#${gradientId})`}
        opacity="0.96"
      />

      {/* Thin highlight to keep the icon from feeling flat */}
      <path
        d="M18 46 L31 59 L35 55 L22 42 Z M35 57 L49 43 L53 47 L39 61 Z M54 39 L68 25 L72 29 L58 43 Z"
        fill="#FFFFFF"
        opacity="0.2"
      />

      {/* Crisp edge line to keep the shape readable at small sizes */}
      <path
        d="M14 50 L31 71 L39 63 L22 42 Z M31 71 L49 53 L57 61 L39 79 Z M49 53 L67 35 L75 43 L57 61 Z M67 35 L85 17 L93 25 L75 43 Z"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/**
 * SourceCheck Logo - Unified Component
 *
 * Automatically uses simplified variant for small sizes (< 32px)
 * and rich variant for larger sizes, or manually controlled via variant prop.
 */
export const SourceCheckLogo: React.FC<SourceCheckLogoProps> = ({
  size = 24,
  className = '',
  animated = false,
  variant,
}) => {
  // Auto-select variant based on size if not specified
  const useLarge = variant === 'large' || (variant === undefined && size >= 32);

  if (useLarge) {
    return <LargeLogo size={size} className={className} animated={animated} />;
  }
  return <SmallLogo size={size} className={className} animated={animated} />;
};

/**
 * SourceCheck Logo Large - Explicit large variant
 * For empty states, onboarding, branding
 */
export const SourceCheckLogoLarge: React.FC<Omit<SourceCheckLogoProps, 'variant'>> = ({
  size = 48,
  className = '',
  animated = false,
}) => (
  <LargeLogo size={size} className={className} animated={animated} />
);

/**
 * SourceCheck Logo Small - Explicit small variant
 * For headers, inline icons, toolbar
 */
export const SourceCheckLogoSmall: React.FC<Omit<SourceCheckLogoProps, 'variant'>> = ({
  size = 18,
  className = '',
  animated = false,
}) => (
  <SmallLogo size={size} className={className} animated={animated} />
);

export default SourceCheckLogo;
