import { useState, useEffect } from 'react';
import { Key } from 'lucide-react';
import { PROVIDER_SETTINGS_KEY, GEMINI_MODELS, DEFAULT_GEMINI_MODEL } from '../../background/providers/types';
import type { GeminiModel } from '../../background/providers/types';

interface SettingsPanelProps {
  onSaved: () => void;
}

const MODEL_LABELS: Record<GeminiModel, string> = {
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash-Lite Preview',
  'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
};

export const SettingsPanel = ({ onSaved }: SettingsPanelProps) => {
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState<GeminiModel>(DEFAULT_GEMINI_MODEL);
  const [customModel, setCustomModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    chrome.storage.local.get([PROVIDER_SETTINGS_KEY], (result) => {
      const stored = result[PROVIDER_SETTINGS_KEY];
      if (!stored || typeof stored !== 'object') return;
      if (typeof stored.model === 'string' && stored.model.trim()) {
        const trimmedModel = stored.model.trim();
        if ((GEMINI_MODELS as readonly string[]).includes(trimmedModel)) {
          setSelectedModel(trimmedModel as GeminiModel);
        } else {
          setCustomModel(trimmedModel);
          setShowAdvanced(true);
        }
      }
    });
  }, []);

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('Please enter your Gemini API key.');
      return;
    }
    if (!trimmed.startsWith('AIza')) {
      setError('That doesn\'t look like a Gemini API key. Keys start with "AIza".');
      return;
    }

    const effectiveModel = customModel.trim() || selectedModel;

    setSaving(true);
    setError(null);

    try {
      await chrome.storage.local.set({
        [PROVIDER_SETTINGS_KEY]: { provider: 'gemini', apiKey: trimmed, model: effectiveModel },
      });
      onSaved();
    } catch (err) {
      setError('Failed to save. Please try again.');
      console.error('[SourceCheck/UI] Failed to save provider settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSave();
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-bgDark px-5">
      <div className="w-full max-w-[320px]">
        <div className="instrument-shell px-5 py-5">
          <div className="signal-rail" style={{ left: '24px', top: '18px', bottom: '18px' }} />
          <div className="relative pl-[42px]">
            <span
              className="rail-node"
              style={{
                top: '10px',
                background: 'rgba(214, 186, 122, 0.9)',
                boxShadow: '0 0 0 4px rgba(214, 186, 122, 0.18)',
              }}
            />
            <span
              className="rail-connector"
              style={{
                top: '14px',
                background: 'linear-gradient(90deg, rgba(214, 186, 122, 0.9), rgba(0, 0, 0, 0))',
              }}
            />
            <div className="capture-plate ml-1 px-4 py-4">
              <div className="status-led text-accentSoft">Setup required</div>
              <div className="mt-3 flex items-center gap-2">
                <Key size={14} className="text-accentSoft" />
                <h1 className="panel-shell-title text-[16px] font-semibold text-textMain">
                  Experimental local settings
                </h1>
              </div>
              <p className="panel-shell-copy mt-2 text-[13px] leading-relaxed text-textMuted/90">
                These controls are not the active runtime path in this build.
                Live analysis still runs through the configured SourceCheck backend.
              </p>

              <div className="mt-4 space-y-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="AIzaSy..."
                  className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-[13px] text-textMain placeholder:text-textMuted/50 focus:border-accentSoft/60 focus:outline-none"
                  autoComplete="off"
                  spellCheck={false}
                />

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-textMuted/70">Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as GeminiModel)}
                    className="w-full rounded border border-white/15 bg-bgDark px-3 py-2 text-[13px] text-textMain focus:border-accentSoft/60 focus:outline-none"
                  >
                    {GEMINI_MODELS.map((m) => (
                      <option key={m} value={m}>{MODEL_LABELS[m]}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-[11px] text-textMuted/60 transition-colors hover:text-textMuted"
                >
                  {showAdvanced ? '▲ Hide advanced' : '▼ Advanced'}
                </button>

                {showAdvanced && (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-textMuted/70">
                      Custom model override
                    </label>
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="e.g. gemini-2.5-pro-preview"
                      className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-[13px] text-textMain placeholder:text-textMuted/50 focus:border-accentSoft/60 focus:outline-none"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="mt-1 text-[11px] text-textMuted/50">
                      Overrides the model selector above when non-empty.
                    </p>
                  </div>
                )}

                {error && (
                  <p className="text-[12px] leading-relaxed text-disputed">{error}</p>
                )}
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="w-full rounded border border-accentSoft/30 bg-accentSoft/10 px-3 py-2 text-[13px] font-medium text-accentSoft transition-colors hover:bg-accentSoft/20 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save & start'}
                </button>
              </div>

              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="text-[12px] leading-relaxed text-textMuted">
                  <strong className="text-textMain/80">Google AI Studio API key</strong>
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-textMuted">
                  1. Go to{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accentSoft underline"
                  >
                    Google AI Studio
                  </a>
                  <br />
                  2. Click &ldquo;Create API key&rdquo; (no billing required for free tier)
                  <br />
                  3. Copy and paste the key starting with &ldquo;AIza&rdquo;
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-textMuted/60">
                  Current beta: requests route through SourceCheck backend. Full local mode coming.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
