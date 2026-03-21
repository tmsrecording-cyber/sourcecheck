import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Lock } from 'lucide-react';
import type { GeminiModelOption } from '../../../shared/types';
import { AVAILABLE_MODELS, FREEMIUM_MODEL, normalizeModel } from '../../../shared/types';
import { buildModelCssVars, getModelTone } from '../styles/modelTheme';
import { getPressSettle } from '../styles/motionTokens';

interface ModelPickerProps {
  selectedModel: GeminiModelOption;
  onModelChange: (model: GeminiModelOption) => void;
  hasCustomKey?: boolean;
  compact?: boolean;
}

// Custom model icons — designed for small sizes, each communicating the tier's character
const ModelIcon = ({ model, size = 12 }: { model: GeminiModelOption; size?: number }) => {
  if (model === 'gemini-3.1-flash-lite-preview') {
    // Slim filled bolt — speed, minimal weight
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M7 1.5L3.5 6.5H6L5 10.5L8.5 5.5H6.5L7 1.5Z" fill="currentColor" />
      </svg>
    );
  }
  if (model === 'gemini-2.5-flash') {
    // Hexagon — solid, reliable, the dependable standard
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M6 1.5L9.8 3.75V8.25L6 10.5L2.2 8.25V3.75L6 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="6" cy="6" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  // gemini-3-flash-preview — 4-point star (Gemini mark), most capable / experimental
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1C6 1 6.6 4.4 9 6C6.6 7.6 6 11 6 11C6 11 5.4 7.6 3 6C5.4 4.4 6 1 6 1Z" fill="currentColor" />
      <path d="M1 6C1 6 4.4 6.6 6 9C7.6 6.6 11 6 11 6C11 6 7.6 5.4 6 3C4.4 5.4 1 6 1 6Z" fill="currentColor" />
    </svg>
  );
};

/** Full display labels */
const MODEL_LABELS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': 'Flash 3.1 Lite',
  'gemini-2.5-flash': 'Flash 2.5',
  'gemini-3-flash-preview': 'Flash 3 Preview',
};

/** Compact labels for header - short enough to fit the side panel comfortably */
const COMPACT_LABELS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': '3.1 Lite',
  'gemini-2.5-flash': '2.5 Flash',
  'gemini-3-flash-preview': '3 Preview',
};

/** Simple speed tags */
const SPEED_TAGS: Record<'fast' | 'standard' | 'deep', string> = {
  fast: 'Quick',
  standard: 'Balanced',
  deep: 'Thorough',
};

export const ModelPicker = ({ selectedModel, onModelChange, hasCustomKey = false, compact = false }: ModelPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const effectiveSelectedModel = hasCustomKey ? normalizeModel(selectedModel) : FREEMIUM_MODEL;
  const pressFeedback = getPressSettle(prefersReducedMotion);
  
  // Always show all models — locked ones signal what requires an API key
  const availableModels = AVAILABLE_MODELS;
  const isModelLocked = (modelId: GeminiModelOption) => !hasCustomKey && modelId !== FREEMIUM_MODEL;

  const currentModel = availableModels.find(m => m.id === effectiveSelectedModel) ?? availableModels[0];
  const displayModelId = currentModel?.id ?? effectiveSelectedModel;
  const currentTone = getModelTone(displayModelId);
  const pickerStyle = buildModelCssVars(displayModelId) as CSSProperties;

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback((modelId: GeminiModelOption) => {
    onModelChange(modelId);
    setIsOpen(false);
  }, [onModelChange]);

  return (
    <div ref={containerRef} className={`relative ${compact ? 'w-[88px]' : ''}`} style={pickerStyle}>
      {/* Trigger - Compact for header, full for elsewhere */}
      <motion.button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`model-picker-trigger group flex items-center rounded-md border bg-sc-surface-1/50 text-sc-text-soft hover:bg-sc-surface-1 focus:outline-none ${compact ? 'h-7 w-full gap-1.5 px-2' : 'h-7 gap-1 px-2'}`}
        whileTap={pressFeedback}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select AI model"
        style={{
          borderColor: isOpen ? `rgba(${currentTone.rgb}, 0.32)` : 'var(--sc-border-soft)',
          background: isOpen
            ? `linear-gradient(180deg, rgba(${currentTone.rgb}, 0.14), rgba(var(--sc-surface-0-rgb), 0.94))`
            : undefined,
          boxShadow: isOpen
            ? `0 12px 28px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(${currentTone.rgb}, 0.12)`
            : undefined,
        }}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-md border"
          style={{
            width: compact ? '16px' : '18px',
            height: compact ? '16px' : '18px',
            borderColor: `rgba(${currentTone.rgb}, 0.24)`,
            background: `rgba(${currentTone.rgb}, 0.10)`,
            color: currentTone.hex,
          }}
        >
          <ModelIcon model={displayModelId} size={compact ? 11 : 12} />
        </span>
        <span className={`min-w-0 truncate text-sc-text ${compact ? 'flex-1 text-[10px] font-medium tracking-[0.02em]' : 'text-[11px]'}`}>
          {compact ? COMPACT_LABELS[displayModelId] : MODEL_LABELS[displayModelId]}
        </span>
        {!compact && (
          <span className="text-[9px] uppercase tracking-wider text-sc-muted">
            {currentModel?.speed ? SPEED_TAGS[currentModel.speed] : 'Balanced'}
          </span>
        )}
        <ChevronDown size={compact ? 10 : 10} className={`model-picker-chevron shrink-0 text-sc-muted/60 ${isOpen ? 'rotate' : ''}`} />
      </motion.button>

      {/* Simple Dropdown - Name + Tag only */}
      {isOpen && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[200px] overflow-hidden rounded-lg border border-sc-border/60 bg-sc-surface-0 shadow-lg"
          role="listbox"
          aria-label="Available models"
        >
          {availableModels.map((model) => {
            const tone = getModelTone(model.id);
            const isSelected = displayModelId === model.id;
            const locked = isModelLocked(model.id);

            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={locked}
                onClick={() => !locked && handleSelect(model.id)}
                className={`flex w-full items-center justify-between gap-3 border-b border-sc-border-soft/60 px-3 py-2.5 text-left transition-colors last:border-b-0 ${locked ? 'cursor-default opacity-50' : 'hover:bg-sc-surface-1'}`}
                style={isSelected && !locked
                  ? {
                      background: `linear-gradient(180deg, rgba(${tone.rgb}, 0.10), rgba(var(--sc-surface-0-rgb), 0.94))`,
                      boxShadow: `inset 0 0 0 1px rgba(${tone.rgb}, 0.16)`,
                    }
                  : undefined}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
                    style={{
                      borderColor: `rgba(${tone.rgb}, 0.24)`,
                      background: `rgba(${tone.rgb}, 0.10)`,
                      color: tone.hex,
                    }}
                  >
                    <ModelIcon model={model.id} size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium text-sc-text">
                      {MODEL_LABELS[model.id]}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-sc-muted/70">
                      {locked ? (
                        <>
                          <Lock size={8} className="shrink-0" />
                          Requires API key
                        </>
                      ) : (
                        <>
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: tone.hex }}
                          />
                          {model.description}
                        </>
                      )}
                    </span>
                  </span>
                </span>
                <span className={`model-speed-badge ${
                  model.speed === 'fast'
                    ? 'speed-fast'
                    : model.speed === 'deep'
                      ? 'speed-deep'
                      : 'speed-balanced'
                }`}>
                  {SPEED_TAGS[model.speed]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Standalone version for backward compatibility (uses default props)
export const ModelPickerStandalone = () => {
  // MODEL POLICY: Always normalize saved model to allowed values
  const [selectedModel, setSelectedModel] = useState<GeminiModelOption>(FREEMIUM_MODEL);
  
  // Load saved model preference on mount
  useEffect(() => {
    chrome.storage.sync.get('selectedModel').then((result) => {
      const normalizedModel = normalizeModel(result.selectedModel);
      setSelectedModel(normalizedModel);
    }).catch(() => {
      // Ignore storage read errors (e.g., extension context invalidated)
    });
  }, []);

  const handleModelChange = useCallback((model: GeminiModelOption) => {
    setSelectedModel(model);
    chrome.storage.sync.set({ selectedModel: model }).catch(() => {
      // Ignore storage write errors (e.g., extension context invalidated)
    });
    
    // Notify background worker of model change
    chrome.runtime.sendMessage({
      type: 'MODEL_CHANGED',
      model: model  // Service worker expects top-level 'model', not payload.model
    }).catch(() => {
      // Ignore errors if background not ready
    });
  }, []);

  return <ModelPicker selectedModel={selectedModel} onModelChange={handleModelChange} />;
};

export default ModelPickerStandalone;
