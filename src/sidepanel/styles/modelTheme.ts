import type { CSSProperties } from 'react';
import {
  FREEMIUM_MODEL,
  normalizeModel,
  type GeminiModelOption,
} from '../../../shared/types';

export type ModelTone = {
  id: GeminiModelOption;
  name: 'blue' | 'green' | 'indigo';
  hex: string;
  rgb: string;
};

export const MODEL_TONES: Record<GeminiModelOption, ModelTone> = {
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'blue',
    hex: '#8AB4F8',
    rgb: '138, 180, 248',
  },
  'gemini-3.1-flash-lite-preview': {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'green',
    hex: '#81C995',
    rgb: '129, 201, 149',
  },
};

const DEFAULT_MODEL_TONE = MODEL_TONES[FREEMIUM_MODEL];

type ModelCssVars = CSSProperties & Record<`--${string}`, string>;

export const getModelTone = (model?: string): ModelTone => {
  const normalized = normalizeModel(model);
  return MODEL_TONES[normalized] ?? DEFAULT_MODEL_TONE;
};

export const buildModelCssVars = (model?: string): ModelCssVars => {
  const tone = getModelTone(model);
  const maxTintAlpha = 0.32;
  const maxGlowAlpha = 0.48;
  const glowHaloAlpha = 0.24;

  return {
    '--model-accent-rgb': tone.rgb,
    '--model-accent-solid': tone.hex,
    '--model-accent-10': `rgba(${tone.rgb}, 0.10)`,
    '--model-accent-18': `rgba(${tone.rgb}, 0.18)`,
    '--model-accent-24': `rgba(${tone.rgb}, 0.24)`,
    '--model-accent-32': `rgba(${tone.rgb}, ${maxTintAlpha})`,
    '--model-accent-48': `rgba(${tone.rgb}, ${maxGlowAlpha})`,
    '--model-accent-glow': `0 0 16px rgba(${tone.rgb}, ${glowHaloAlpha}), 0 0 4px rgba(${tone.rgb}, ${maxGlowAlpha})`,
  };
};
