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
  // gemini-2.5-flash — Hexagon: solid, reliable, the dependable standard
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5L9.8 3.75V8.25L6 10.5L2.2 8.25V3.75L6 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="6" cy="6" r="1.2" fill="currentColor" />
    </svg>
  );
};

/** Full display labels */
const MODEL_LABELS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': 'Dual',
  'gemini-2.5-flash': 'Flash 2.5',
};

/** Compact labels for header - short enough to fit the side panel comfortably */
const COMPACT_LABELS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': 'Dual',
  'gemini-2.5-flash': '2.5 Flash',
};

/** Simple speed tags */
const SPEED_TAGS: Record<'fast' | 'standard' | 'deep', string> = {
  fast: 'scan fast · verify deep',
  standard: 'balanced',
  deep: 'thorough',
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

  // Freemium users: static badge — no dropdown, no false choice
  if (!hasCustomKey) {
    return (
      <div className={`relative ${compact ? 'w-[128px]' : ''}`} style={pickerStyle}>
        <div
          className={`flex items-center rounded-md border bg-sc-surface-1/30 ${compact ? 'h-7 w-full gap-1.5 px-2' : 'h-7 gap-1 px-2'}`}
          style={{
            borderColor: 'var(--sc-border-soft)',
            borderLeftColor: `rgba(${currentTone.rgb}, 0.50)`,
            borderLeftWidth: '2px',
          }}
          title="Add an API key in settings to choose a model"
        >
          <span className="flex-shrink-0 opacity-50" style={{ color: currentTone.hex }}>
            <ModelIcon model={displayModelId} size={compact ? 10 : 11} />
          </span>
          <span className={`min-w-0 truncate text-sc-muted/60 ${compact ? 'flex-1 text-[10px] font-medium tracking-[0.02em]' : 'text-[11px]'}`}>
            {compact ? COMPACT_LABELS[displayModelId] : MODEL_LABELS[displayModelId]}
          </span>
          <Lock size={8} className="shrink-0 text-sc-muted/30 ml-0.5" />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${compact ? 'w-[128px]' : ''}`} style={pickerStyle}>
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
          borderLeftColor: `rgba(${currentTone.rgb}, 0.72)`,
          borderLeftWidth: '2px',
          background: isOpen
            ? `linear-gradient(180deg, rgba(${currentTone.rgb}, 0.14), rgba(var(--sc-surface-0-rgb), 0.94))`
            : undefined,
          boxShadow: isOpen
            ? `0 12px 28px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(${currentTone.rgb}, 0.12)`
            : undefined,
        }}
      >
        {/* Icon — no container, just the mark with model color */}
        <span className="flex-shrink-0 opacity-75" style={{ color: currentTone.hex }}>
          <ModelIcon model={displayModelId} size={compact ? 10 : 11} />
        </span>
        <span className={`min-w-0 truncate text-sc-text ${compact ? 'flex-1 text-[10px] font-medium tracking-[0.02em]' : 'text-[11px]'}`}>
          {compact ? COMPACT_LABELS[displayModelId] : MODEL_LABELS[displayModelId]}
        </span>
        <ChevronDown size={9} className={`model-picker-chevron shrink-0 text-sc-muted/50 ${isOpen ? 'rotate' : ''}`} />
      </motion.button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[210px] overflow-hidden rounded-lg border border-sc-border/60 bg-sc-surface-0 shadow-lg"
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
                className={`flex w-full items-center gap-3 border-b border-sc-border-soft/40 px-3 py-2 text-left transition-colors last:border-b-0 ${locked ? 'cursor-default opacity-40' : 'hover:bg-sc-surface-1/60'}`}
                style={isSelected && !locked
                  ? {
                      background: `linear-gradient(90deg, rgba(${tone.rgb}, 0.08), transparent 60%)`,
                      borderLeft: `2px solid rgba(${tone.rgb}, 0.70)`,
                    }
                  : { borderLeft: '2px solid transparent' }}
              >
                {/* Tiny icon — model identity mark, no container */}
                <span className="flex-shrink-0 opacity-80" style={{ color: tone.hex }}>
                  <ModelIcon model={model.id} size={11} />
                </span>

                {/* Name */}
                <span className="flex-1 min-w-0 text-[12px] font-medium text-sc-text truncate">
                  {MODEL_LABELS[model.id]}
                  {locked && (
                    <span className="ml-2 text-[9px] font-mono text-sc-muted/50 font-normal tracking-wide">key required</span>
                  )}
                </span>

                {/* Speed — monospace, right-aligned, muted */}
                {!locked && (
                  <span className="flex-shrink-0 font-mono text-[9px] tracking-[0.06em] text-sc-muted/45">
                    {SPEED_TAGS[model.speed].toLowerCase()}
                  </span>
                )}
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
