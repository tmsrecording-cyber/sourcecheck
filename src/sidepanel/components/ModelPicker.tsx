import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Zap, Brain, Cpu } from 'lucide-react';
import type { GeminiModelOption } from '../../../shared/types';
import { AVAILABLE_MODELS, FREEMIUM_MODEL, normalizeModel } from '../../../shared/types';

interface ModelPickerProps {
  selectedModel: GeminiModelOption;
  onModelChange: (model: GeminiModelOption) => void;
  hasCustomKey?: boolean;
  compact?: boolean;
}

const MODEL_ICONS: Record<GeminiModelOption, React.ReactNode> = {
  'gemini-3.1-flash-lite-preview': <Zap size={12} />,
  'gemini-2.5-flash': <Cpu size={12} />,
  'gemini-3-flash-preview': <Brain size={12} />,
};

/** Full display labels */
const MODEL_LABELS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': 'Flash 3.1 Lite',
  'gemini-2.5-flash': 'Flash 2.5',
  'gemini-3-flash-preview': 'Flash 3 Preview',
};

/** Compact labels for header - just version number */
const COMPACT_LABELS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': '3.1',
  'gemini-2.5-flash': '2.5',
  'gemini-3-flash-preview': '3',
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
  
  // Freemium users can only use the freemium model; BYOK users see all options
  const availableModels = hasCustomKey 
    ? AVAILABLE_MODELS 
    : AVAILABLE_MODELS.filter(m => m.id === FREEMIUM_MODEL);
  
  const currentModel = availableModels.find(m => m.id === selectedModel) ?? availableModels[0];

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
    <div ref={containerRef} className="relative">
      {/* Trigger - Compact for header, full for elsewhere */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`group flex items-center gap-1 rounded-md bg-sc-surface-1/50 text-sc-text-soft hover:bg-sc-surface-1 focus:outline-none ${compact ? 'h-6 px-1.5' : 'h-7 px-2'}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select AI model"
      >
        <span className={`text-sc-text ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
          {compact ? COMPACT_LABELS[selectedModel] : MODEL_LABELS[selectedModel]}
        </span>
        {!compact && (
          <span className="text-[9px] uppercase tracking-wider text-sc-muted">
            {currentModel?.speed ? SPEED_TAGS[currentModel.speed] : 'Balanced'}
          </span>
        )}
        <ChevronDown size={compact ? 9 : 10} className={`text-sc-muted/60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Simple Dropdown - Name + Tag only */}
      {isOpen && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[200px] overflow-hidden rounded-lg border border-sc-border/60 bg-sc-surface-0 shadow-lg"
          role="listbox"
          aria-label="Available models"
        >
          {availableModels.map((model) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selectedModel === model.id}
              onClick={() => handleSelect(model.id)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-sc-surface-1 ${
                selectedModel === model.id ? 'bg-sc-surface-1' : ''
              }`}
            >
              <span className="text-[11px] font-medium text-sc-text">
                {MODEL_LABELS[model.id]}
              </span>
              <span className="rounded border border-sc-border-soft/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-sc-muted">
                {SPEED_TAGS[model.speed]}
              </span>
            </button>
          ))}
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
