export const panelTones = {
  background: {
    canvas: 'var(--sc-bg-0)',
    panel: 'var(--sc-surface-0)',
    elevated: 'var(--sc-surface-1)',
    glass: 'var(--sc-surface-glass)',
  },
  text: {
    primary: 'var(--sc-text)',
    secondary: 'var(--sc-text-soft)',
    muted: 'var(--sc-muted)',
    faint: 'var(--sc-text-faint)',
  },
  border: {
    soft: 'var(--sc-border-soft)',
    default: 'var(--sc-border)',
    strong: 'var(--sc-border-strong)',
  },
  status: {
    accent: 'var(--sc-accent)',
    accentSoft: 'var(--sc-accent-soft)',
    supported: 'var(--sc-supported)',
    partial: 'var(--sc-partial)',
    disputed: 'var(--sc-disputed)',
    neutral: 'var(--sc-neutral)',
  },
  effects: {
    shadow: 'var(--sc-shadow)',
    shadowSoft: 'var(--sc-shadow-soft)',
    heroGlow: 'var(--sc-hero-glow)',
    glassHighlight: 'var(--sc-glass-highlight)',
  },
} as const;
