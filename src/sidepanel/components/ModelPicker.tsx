import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Zap, Brain, Cpu } from 'lucide-react';
import type { GeminiModelOption, ModelConfig } from '../../../shared/types';
import { AVAILABLE_MODELS } from '../../../shared/types';

interface ModelPickerProps {
  selectedModel: GeminiModelOption;
  onModelChange: (model: GeminiModelOption) => void;
}

const MODEL_ICONS: Record<GeminiModelOption, React.ReactNode> = {
  'gemini-3.1-flash-lite': <Zap size={12} />,
  'gemini-3-flash': <Brain size={12} />,
  'gemini-2.5-flash-lite-preview': <Cpu size={12} />,
};

const SPEED_LABELS: Record<ModelConfig['speed'], string> = {
  fast: 'Fastest',
  balanced: 'Balanced',
  deep: 'Deep',
};

export const ModelPicker = ({ selectedModel, onModelChange }: ModelPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentModel = AVAILABLE_MODELS.find(m => m.id === selectedModel) ?? AVAILABLE_MODELS[0];

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
      {/* Trigger Button - Compact HUD Style */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-[26px] px-3 text-[11px] font-mono tracking-wide border border-sc-border bg-sc-surface-0 hover:bg-sc-surface-1 rounded text-sc-text-soft transition-colors flex items-center gap-2 focus:outline-none focus-visible:ring-0"
        style={{ '--model-accent-rgb': selectedModel === 'gemini-3.1-flash-lite' ? '168, 199, 250' : '215, 174, 251' } as React.CSSProperties}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 0 8px rgba(var(--model-accent-rgb), 0.3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'none';
        }}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select AI model"
      >
        <span className="text-sc-accent">
          {MODEL_ICONS[selectedModel]}
        </span>
        <span>
          {currentModel.label}
        </span>
        <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div 
          className="model-picker-dropdown"
          role="listbox"
          aria-label="Available models"
        >
          <div className="model-picker-header">
            <span>Select Model</span>
          </div>
          
          {AVAILABLE_MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selectedModel === model.id}
              onClick={() => handleSelect(model.id)}
              className={`model-option ${selectedModel === model.id ? 'selected' : ''}`}
            >
              <div className="model-option-main">
                <span className="model-option-icon">
                  {MODEL_ICONS[model.id]}
                </span>
                <div className="model-option-info">
                  <span className="model-option-name">{model.label}</span>
                  <span className="model-option-description">{model.description}</span>
                </div>
              </div>
              <div className="model-option-meta">
                <span className={`model-speed-badge speed-${model.speed}`}>
                  {SPEED_LABELS[model.speed]}
                </span>
                {selectedModel === model.id && (
                  <span className="model-selected-indicator">✓</span>
                )}
              </div>
            </button>
          ))}

          <div className="model-picker-footer">
            <span>Switch models instantly</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Standalone version for backward compatibility (uses default props)
export const ModelPickerStandalone = () => {
  const [selectedModel, setSelectedModel] = useState<GeminiModelOption>('gemini-3.1-flash-lite');
  
  // Load saved model preference on mount
  useEffect(() => {
    chrome.storage.sync.get('selectedModel').then((result) => {
      if (result.selectedModel && AVAILABLE_MODELS.some(m => m.id === result.selectedModel)) {
        setSelectedModel(result.selectedModel as GeminiModelOption);
      }
    });
  }, []);

  const handleModelChange = useCallback((model: GeminiModelOption) => {
    setSelectedModel(model);
    chrome.storage.sync.set({ selectedModel: model });
    
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
