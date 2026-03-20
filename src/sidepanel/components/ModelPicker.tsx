import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Zap, Brain, Cpu } from 'lucide-react';
import type { GeminiModelOption } from '../../../shared/types';
import { AVAILABLE_MODELS, FREEMIUM_MODEL, normalizeModel } from '../../../shared/types';

interface ModelPickerProps {
  selectedModel: GeminiModelOption;
  onModelChange: (model: GeminiModelOption) => void;
  hasCustomKey?: boolean;
}

const MODEL_ICONS: Record<GeminiModelOption, React.ReactNode> = {
  'gemini-3.1-flash-lite-preview': <Zap size={12} />,
  'gemini-2.5-flash': <Cpu size={12} />,
  'gemini-3-flash-preview': <Brain size={12} />,
};

const SPEED_LABELS: Record<'fast' | 'standard' | 'deep', string> = {
  fast: 'Quick notes',
  standard: 'Balanced',
  deep: 'Deeper pass',
};

/** Compact display labels for header - canonical model IDs unchanged */
const COMPACT_LABELS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': '3.1 Lite',
  'gemini-2.5-flash': '2.5 Flash',
  'gemini-3-flash-preview': '3 Preview',
};

const MODEL_MOODS: Record<GeminiModelOption, string> = {
  'gemini-3.1-flash-lite-preview': 'Best when you want faster note-taking.',
  'gemini-2.5-flash': 'Stable default for everyday watching.',
  'gemini-3-flash-preview': 'Takes a slower, more thorough pass.',
};

export const ModelPicker = ({ selectedModel, onModelChange, hasCustomKey = false }: ModelPickerProps) => {
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
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group h-[42px] min-w-[170px] rounded-xl border border-sc-border-soft/90 bg-[linear-gradient(180deg,rgba(15,19,27,0.96),rgba(10,13,19,0.92))] px-3.5 text-left text-sc-text-soft transition-all duration-200 hover:border-sc-line-strong/70 hover:bg-sc-surface-1/80 focus:outline-none focus-visible:ring-0"
        style={{ '--model-accent-rgb': selectedModel === 'gemini-3-flash-preview' ? '215, 174, 251' : '168, 199, 250' } as React.CSSProperties}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.28), 0 0 14px rgba(var(--model-accent-rgb), 0.18)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'none';
        }}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select AI model"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-sc-border-soft/80 bg-sc-surface-1/80 text-sc-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {MODEL_ICONS[selectedModel]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-sc text-[11px] font-semibold tracking-[0.08em] text-sc-text">
                {COMPACT_LABELS[selectedModel]}
              </span>
              <span className="rounded-full border border-sc-border-soft/80 px-1.5 py-[2px] text-[8px] font-mono uppercase tracking-[0.12em] text-sc-muted/80">
                {currentModel?.speed ? SPEED_LABELS[currentModel.speed] : 'Balanced'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-sc-muted/70">
              {hasCustomKey ? 'Using your Gemini key' : 'Managed model'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full border border-white/10 ${hasCustomKey ? 'bg-sc-supported shadow-[0_0_8px_rgba(137,176,134,0.65)]' : 'bg-sc-accent shadow-[0_0_8px_rgba(168,199,250,0.45)]'}`}
              title={hasCustomKey ? 'Using your API key (BYOK mode)' : 'Using the managed model'}
            />
            <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[300px] overflow-hidden rounded-[22px] border border-sc-border-soft/90 bg-[radial-gradient(circle_at_top,rgba(36,52,79,0.45),transparent_42%),linear-gradient(180deg,rgba(24,28,38,0.98),rgba(13,16,23,0.98))] shadow-[0_22px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          role="listbox"
          aria-label="Available models"
        >
          <div className="border-b border-sc-border-soft/60 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-sc text-[10px] font-semibold uppercase tracking-[0.16em] text-sc-muted/70">
                  Choose analysis mode
                </p>
                <p className="mt-1 text-[12px] text-sc-text-soft/80">
                  Pick how quickly SourceCheck should build notes for this video.
                </p>
              </div>
              <span className="rounded-full border border-sc-border-soft/80 px-2 py-1 text-[8px] font-mono uppercase tracking-[0.14em] text-sc-muted/70">
                {hasCustomKey ? 'BYOK' : 'Managed'}
              </span>
            </div>
          </div>

          {availableModels.map((model) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selectedModel === model.id}
              onClick={() => handleSelect(model.id)}
              className={`group flex w-full items-start justify-between gap-3 border-b border-sc-border-soft/40 px-5 py-4 text-left transition-colors duration-150 last:border-b-0 hover:bg-white/[0.035] ${
                selectedModel === model.id ? 'bg-white/[0.055]' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sc-border-soft/80 bg-sc-surface-1/70 text-sc-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  {MODEL_ICONS[model.id]}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-sc text-[16px] font-semibold tracking-[0.03em] text-sc-text">
                      {model.label}
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[8px] font-mono uppercase tracking-[0.12em] ${
                      model.speed === 'fast'
                        ? 'bg-[rgba(75,175,120,0.16)] text-[rgb(106,213,150)]'
                        : model.speed === 'standard'
                          ? 'bg-[rgba(85,124,186,0.16)] text-[rgb(157,190,242)]'
                          : 'bg-[rgba(144,94,201,0.18)] text-[rgb(213,174,251)]'
                    }`}>
                      {SPEED_LABELS[model.speed]}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-sc-text-soft/80">
                    {MODEL_MOODS[model.id]}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                {selectedModel === model.id && (
                  <span className="rounded-full border border-[rgba(75,175,120,0.35)] bg-[rgba(75,175,120,0.14)] px-2 py-1 text-[9px] font-mono font-semibold uppercase tracking-[0.12em] text-[rgb(106,213,150)]">
                    Current
                  </span>
                )}
              </div>
            </button>
          ))}

          <div className="border-t border-sc-border-soft/60 bg-black/10 px-5 py-3">
            <p className="text-[11px] leading-relaxed text-sc-muted/75">
              {hasCustomKey
                ? 'Your Gemini key unlocks all available modes.'
                : 'Managed mode stays on Gemini 2.5 Flash for predictable cost and performance.'}
            </p>
          </div>
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
