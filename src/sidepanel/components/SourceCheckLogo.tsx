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
}) => (
  <svg
    viewBox="0 0 100 100"
    width={size}
    height={size}
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    aria-label="SourceCheck"
    role="img"
  >
    {/* Clean 4-segment checkmark - no effects */}
    {/* Blue segment */}
    <path
      d="M15 52 L32 72 L38 66 L21 46 Z"
      fill={COLORS.blue}
      className={animated ? 'animate-pulse' : ''}
    />
    {/* Red segment */}
    <path
      d="M32 72 L52 52 L58 58 L38 78 Z"
      fill={COLORS.red}
    />
    {/* Yellow segment */}
    <path
      d="M52 52 L70 34 L76 40 L58 58 Z"
      fill={COLORS.yellow}
    />
    {/* Green segment */}
    <path
      d="M70 34 L85 19 L90 24 L76 40 Z"
      fill={COLORS.green}
    />
  </svg>
);

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
  const gradientId = `sc-logo-gradient-${size}`;
  const glowId = `sc-logo-glow-${size}`;

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
        d="M18 52 C25 42, 35 48, 44 58 L48 62 C52 66, 56 64, 62 58 L82 35 C85 32, 88 34, 90 37 C92 40, 91 43, 88 45 L68 68 C58 78, 48 76, 40 68 L32 60 C22 50, 18 52, 12 60 C8 65, 10 68, 15 70"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.25"
        filter={`url(#${glowId})`}
        className={animated ? 'animate-pulse' : ''}
      />

      {/* Main checkmark with curved endpoints */}
      <path
        d="M15 55 C22 45, 32 52, 42 62 L46 66 C50 70, 54 68, 60 62 L85 32 C88 28, 92 30, 94 34 C96 38, 95 42, 90 45 L65 75 C55 85, 45 82, 38 75 L28 65 C18 55, 15 58, 10 65 C6 70, 8 75, 15 78"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Micro-flares at endpoints */}
      <path d="M10 62 L5 55 L15 60 Z" fill={COLORS.blue} opacity="0.9" />
      <path d="M45 80 L42 88 L52 82 Z" fill={COLORS.yellow} opacity="0.9" />
      <path d="M92 30 L98 22 L95 35 Z" fill={COLORS.green} opacity="0.9" />

      {/* Specular highlight */}
      <path
        d="M18 52 C24 44, 32 50, 40 58 L38 60 C30 52, 22 46, 16 54 Z"
        fill="#FFFFFF"
        opacity="0.35"
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
