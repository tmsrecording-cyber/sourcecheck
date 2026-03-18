import { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, ExternalLink, ArrowLeft } from 'lucide-react';
import { PROVIDER_SETTINGS_KEY, GEMINI_MODELS, DEFAULT_GEMINI_MODEL, normalizeModel, type GeminiModelOption } from '../../background/providers/types';

interface SettingsPanelProps {
  onSaved: () => void;
  lastError?: { code?: string; message?: string } | null;
}

type KeyStatus = 'missing' | 'present' | 'invalid' | 'quota_exhausted';

/** 
 * Display labels for BYOK model selector.
 * These are the three allowed models for Bring Your Own Key mode.
 */
const MODEL_LABELS: Record<GeminiModelOption, string> = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash Lite Preview',
  'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
};

const STATUS_CONFIG: Record<KeyStatus, { label: string; color: string; icon: React.ReactNode }> = {
  missing: {
    label: 'Setup required',
    color: 'rgba(215, 174, 251, 0.9)',
    icon: <Key size={14} className="text-sc-accent-soft" />,
  },
  present: {
    label: 'API key configured',
    color: 'rgba(129, 201, 149, 0.9)',
    icon: <CheckCircle2 size={14} className="text-sc-supported" />,
  },
  invalid: {
    label: 'Invalid key',
    color: 'rgba(242, 139, 130, 0.9)',
    icon: <AlertCircle size={14} className="text-sc-disputed" />,
  },
  quota_exhausted: {
    label: 'Quota exhausted',
    color: 'rgba(242, 139, 130, 0.9)',
    icon: <AlertCircle size={14} className="text-sc-disputed" />,
  },
};

export const SettingsPanel = ({ onSaved, lastError }: SettingsPanelProps) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState<GeminiModelOption>(DEFAULT_GEMINI_MODEL);
  const [customModel, setCustomModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('missing');
  const [storedKeyLast4, setStoredKeyLast4] = useState<string | null>(null);

  useEffect(() => {
    // CANONICAL: Read API key from local, model from sync (single source of truth)
    Promise.all([
      new Promise<void>((resolve) => {
        chrome.storage.local.get([PROVIDER_SETTINGS_KEY], (result) => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          const stored = result[PROVIDER_SETTINGS_KEY];
          if (!stored || typeof stored !== 'object') {
            resolve();
            return;
          }
          
          // Check for stored key
          if (typeof stored.apiKey === 'string' && stored.apiKey.trim()) {
            const key = stored.apiKey.trim();
            setStoredKeyLast4(key.slice(-4));
            
            // Determine status based on last error (UNIFIED: handles AUTH_ERROR, INVALID_API_KEY, QUOTA_EXHAUSTED)
            if (lastError?.code === 'AUTH_ERROR' || lastError?.code === 'INVALID_API_KEY' || lastError?.message?.toLowerCase().includes('invalid')) {
              setKeyStatus('invalid');
            } else if (lastError?.code === 'QUOTA_EXHAUSTED' || lastError?.message?.toLowerCase().includes('quota')) {
              setKeyStatus('quota_exhausted');
            } else {
              setKeyStatus('present');
            }
          } else {
            setKeyStatus('missing');
          }
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        chrome.storage.sync.get(['selectedModel'], (result) => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          // CANONICAL: Model always comes from sync storage
          if (typeof result.selectedModel === 'string' && result.selectedModel.trim()) {
            const normalizedModel = normalizeModel(result.selectedModel.trim());
            setSelectedModel(normalizedModel);
          }
          resolve();
        });
      }),
    ]);
  }, [lastError]);

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
    if (trimmed.length < 20) {
      setError('Key appears too short. Gemini API keys are typically 39 characters.');
      return;
    }

    // MODEL POLICY: Normalize custom model input to allowed values
    const effectiveModel = customModel.trim() 
      ? normalizeModel(customModel.trim())
      : selectedModel;

    setSaving(true);
    setError(null);

    try {
      // CANONICAL: Write API key to local, model to sync (single source of truth)
      await Promise.all([
        chrome.storage.local.set({
          [PROVIDER_SETTINGS_KEY]: { provider: 'gemini', apiKey: trimmed },
        }),
        chrome.storage.sync.set({ selectedModel: effectiveModel }),
      ]);
      setKeyStatus('present');
      setStoredKeyLast4(trimmed.slice(-4));
      setApiKey('');
      onSaved();
    } catch (err) {
      setError('Failed to save. Please try again.');
      console.error('[SourceCheck/UI] Failed to save provider settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    try {
      await chrome.storage.local.remove(PROVIDER_SETTINGS_KEY);
      setKeyStatus('missing');
      setStoredKeyLast4(null);
      setApiKey('');
      // Reset to default model
      setSelectedModel(DEFAULT_GEMINI_MODEL);
    } catch (err) {
      console.error('[SourceCheck/UI] Failed to clear provider settings:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSave();
  };

  const currentStatus = keyStatus;
  const statusConfig = STATUS_CONFIG[currentStatus];

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center bg-sc-bg-0 px-5 font-sc">
      <div className="w-full max-w-[320px]">
        <div className="instrument-shell px-5 py-5">
          <div className="signal-rail" style={{ left: '24px', top: '18px', bottom: '18px' }} />
          <div className="relative pl-[42px]">
            <span
              className="rail-node"
              style={{
                top: '10px',
                background: statusConfig.color,
                boxShadow: `0 0 0 4px ${statusConfig.color.replace('0.9', '0.18')}`,
              }}
            />
            <span
              className="rail-connector"
              style={{
                top: '14px',
                background: `linear-gradient(90deg, ${statusConfig.color}, rgba(0, 0, 0, 0))`,
              }}
            />
            <div className="capture-plate ml-1 px-4 py-4 border border-sc-border-soft bg-sc-surface-0 shadow-sc-soft">
              <button
                onClick={onSaved}
                className="mb-2 flex items-center gap-1 text-[11px] text-sc-muted hover:text-sc-text-soft transition-colors"
                type="button"
              >
                <ArrowLeft size={12} /> Back
              </button>
              <div 
                className="font-mono text-[9px] font-bold tracking-[0.2em] uppercase"
                style={{ color: statusConfig.color }}
              >
                {statusConfig.label}
              </div>
              <div className="mt-3 flex items-center gap-2">
                {statusConfig.icon}
                <h1 className="text-[16px] font-bold tracking-tight text-sc-text">
                  API key settings
                </h1>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-sc-text-soft">
                {keyStatus === 'missing' 
                  ? 'Add your Google AI Studio key to enable local analysis mode.'
                  : keyStatus === 'present'
                  ? 'Your API key is saved. Local analysis is available.'
                  : keyStatus === 'invalid'
                  ? 'Your API key appears invalid or expired. Update it below.'
                  : 'Your API quota is exhausted. Try again tomorrow or use a different key.'}
              </p>

              <div className="mt-4 space-y-2">
                {/* Show current key status if present */}
                {storedKeyLast4 && keyStatus !== 'missing' && (
                  <div className="flex items-center justify-between rounded border border-sc-border bg-sc-surface-1 px-3 py-2">
                    <span className="text-[13px] text-sc-text-soft">
                      Saved key: ••••{storedKeyLast4}
                    </span>
                    <button
                      onClick={handleClearKey}
                      className="text-[11px] text-sc-disputed hover:text-sc-disputed/80 transition-colors"
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                )}
                
                {/* API Key input with show/hide toggle */}
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={storedKeyLast4 ? 'Enter new key to replace...' : 'AIzaSy...'}
                    className="w-full rounded border border-sc-border bg-sc-bg-1 px-3 py-2 pr-10 text-[13px] text-sc-text placeholder:text-sc-muted focus:border-sc-accent-soft focus:outline-none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-sc-muted hover:text-sc-text-soft transition-colors"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-sc-muted">Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as GeminiModelOption)}
                    className="w-full rounded border border-sc-border bg-sc-bg-1 px-3 py-2 text-[13px] text-sc-text focus:border-sc-accent-soft focus:outline-none"
                  >
                    {GEMINI_MODELS.map((m) => (
                      <option key={m} value={m}>{MODEL_LABELS[m]}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-[11px] text-sc-muted transition-colors hover:text-sc-text-soft"
                >
                  {showAdvanced ? '▲ Hide advanced' : '▼ Advanced'}
                </button>

                {showAdvanced && (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-sc-muted">
                      Custom model override
                    </label>
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="e.g. gemini-2.5-flash"
                      className="w-full rounded border border-sc-border bg-sc-bg-1 px-3 py-2 text-[13px] text-sc-text placeholder:text-sc-muted focus:border-sc-accent-soft focus:outline-none"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="mt-1 text-[11px] text-sc-muted">
                      Any non-allowed model will be normalized to the default.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2 rounded border border-sc-disputed/30 bg-sc-disputed/10 px-3 py-2">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-sc-disputed" />
                    <p className="text-[12px] leading-relaxed text-sc-disputed">{error}</p>
                  </div>
                )}
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || !apiKey.trim()}
                  className="w-full rounded border border-sc-accent-soft/30 bg-sc-accent-soft/10 px-3 py-2 text-[13px] font-medium text-sc-accent-soft transition-colors hover:bg-sc-accent-soft/20 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : storedKeyLast4 ? 'Update key' : 'Save & start'}
                </button>
              </div>

              <div className="mt-4 border-t border-sc-line-strong pt-3">
                <p className="text-[12px] leading-relaxed text-sc-text-soft">
                  <strong className="text-sc-text">Get a Google AI Studio key</strong>
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-sc-text-soft">
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sc-accent underline hover:text-sc-accent/80"
                  >
                    Google AI Studio <ExternalLink size={11} />
                  </a>
                </p>
                <ol className="mt-2 space-y-1 text-[11px] leading-relaxed text-sc-muted list-decimal list-inside">
                  <li>Sign in with your Google account</li>
                  <li>Click &ldquo;Create API key&rdquo;</li>
                  <li>Copy the key starting with &ldquo;AIza&rdquo;</li>
                </ol>
                
                {(keyStatus === 'invalid' || keyStatus === 'quota_exhausted') && (
                  <div className="mt-3 rounded border border-sc-disputed/20 bg-sc-disputed/5 px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-sc-text-soft">
                      <strong className="text-sc-disputed">Troubleshooting:</strong>
                      {keyStatus === 'invalid' 
                        ? ' If you just created this key, wait 2–3 minutes for it to activate. If it persists, generate a new key.'
                        : ' Free tier has rate limits. Wait a few minutes or create a new project in AI Studio for a fresh quota.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
