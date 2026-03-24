import { useState, useEffect, useMemo } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, ExternalLink, ArrowLeft } from 'lucide-react';
import { 
  PROVIDER_SETTINGS_KEY,
  PROVIDER_SETTINGS_SESSION_KEY, 
  PROVIDER_SETTINGS_LOCAL_KEY, 
  PROVIDER_REMEMBER_KEY,
  getStoredProviderApiKey,
  getRememberKeyPreference,
} from '../../background/providers/types';

interface SettingsPanelProps {
  onBack: () => void;
  onSaved: () => void | Promise<void>;
  lastError?: { code?: string; message?: string } | null;
}

type KeyStatus = 'missing' | 'present' | 'invalid' | 'quota_exhausted';

/**
 * Error codes that can trigger troubleshooting guidance
 */
type ErrorCode = 'AUTH_ERROR' | 'INVALID_API_KEY' | 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UPSTREAM_ERROR' | 'UNKNOWN_ERROR';

interface TroubleshootingGuide {
  title: string;
  steps: string[];
  link?: { text: string; url: string };
}


const STATUS_CONFIG: Record<KeyStatus, { label: string; color: string; rgb: string; icon: React.ReactNode }> = {
  missing: {
    label: 'Setup required',
    color: 'var(--sc-model-blue)',
    rgb: 'var(--sc-model-blue-rgb)',
    icon: <Key size={14} className="text-sc-accent" />,
  },
  present: {
    label: 'API key configured',
    color: 'var(--sc-supported)',
    rgb: 'var(--sc-supported-rgb)',
    icon: <CheckCircle2 size={14} className="text-sc-supported" />,
  },
  invalid: {
    label: 'Invalid key',
    color: 'var(--sc-disputed)',
    rgb: 'var(--sc-disputed-rgb)',
    icon: <AlertCircle size={14} className="text-sc-disputed" />,
  },
  quota_exhausted: {
    label: 'Quota exhausted',
    color: 'var(--sc-disputed)',
    rgb: 'var(--sc-disputed-rgb)',
    icon: <AlertCircle size={14} className="text-sc-disputed" />,
  },
};

export const SettingsPanel = ({ onBack, onSaved, lastError }: SettingsPanelProps) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [storedKeyLast4, setStoredKeyLast4] = useState<string | null>(null);
  const [rememberKey, setRememberKey] = useState(false);

  const getActionErrorMessage = (value: unknown, fallback: string) => {
    if (value instanceof Error && value.message.trim()) {
      return value.message;
    }
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    return fallback;
  };

  // Derive keyStatus from hasStoredKey + lastError (always fresh, never stale)
  const keyStatus: KeyStatus = useMemo(() => {
    if (!hasStoredKey) return 'missing';
    if (lastError?.code === 'AUTH_ERROR' || lastError?.code === 'INVALID_API_KEY' || lastError?.message?.toLowerCase().includes('invalid')) {
      return 'invalid';
    }
    if (lastError?.code === 'QUOTA_EXHAUSTED' || lastError?.message?.toLowerCase().includes('quota')) {
      return 'quota_exhausted';
    }
    return 'present';
  }, [hasStoredKey, lastError]);

  // Determine effective error code for troubleshooting
  const effectiveErrorCode: ErrorCode = useMemo(() => {
    const code = lastError?.code;
    if (code === 'AUTH_ERROR' || code === 'INVALID_API_KEY') return 'AUTH_ERROR';
    if (code === 'QUOTA_EXHAUSTED') return 'QUOTA_EXHAUSTED';
    if (code === 'RATE_LIMITED') return 'RATE_LIMITED';
    if (code === 'NETWORK_ERROR') return 'NETWORK_ERROR';
    if (code === 'UPSTREAM_ERROR' || code === 'PROVIDER_OVERLOADED') return 'UPSTREAM_ERROR';
    return 'UNKNOWN_ERROR';
  }, [lastError]);

  // Troubleshooting content by error code
  const troubleshootingContent: Record<ErrorCode, TroubleshootingGuide | null> = {
    AUTH_ERROR: {
      title: 'API key issue',
      steps: [
        'Verify your key starts with "AIza" (39 characters)',
        'If you just created it, wait 2–3 minutes for activation',
        'Try generating a new key in AI Studio',
      ],
      link: { text: 'Get a new API key', url: 'https://aistudio.google.com/app/apikey' },
    },
    INVALID_API_KEY: {
      title: 'API key invalid',
      steps: [
        'Verify your key starts with "AIza" (39 characters)',
        'If you just created it, wait 2–3 minutes for activation',
        'Try generating a new key in AI Studio',
      ],
      link: { text: 'Get a new API key', url: 'https://aistudio.google.com/app/apikey' },
    },
    QUOTA_EXHAUSTED: {
      title: 'Quota exhausted',
      steps: [
        'Free tier has rate limits per minute and per day',
        'Wait a few minutes and try again',
        'Or create a new project in AI Studio for fresh quota',
      ],
      link: { text: 'Create new project', url: 'https://aistudio.google.com/app/apikey' },
    },
    RATE_LIMITED: {
      title: 'Rate limited',
      steps: [
        'Too many requests in a short time',
        'Wait 30–60 seconds and try again',
        'This is temporary and clears automatically',
      ],
    },
    NETWORK_ERROR: {
      title: 'Network issue',
      steps: [
        'Check your internet connection',
        'Verify YouTube is loading properly',
        'Try refreshing the page',
      ],
    },
    UPSTREAM_ERROR: {
      title: 'Service temporarily unavailable',
      steps: [
        'Google AI service is experiencing issues',
        'This usually resolves in a few minutes',
        'Try again shortly',
      ],
    },
    UNKNOWN_ERROR: null,
  };

  useEffect(() => {
    // Session-first storage: read from session, fallback to local
    Promise.all([
      new Promise<void>((resolve) => {
        // Check session first (current browser session)
        chrome.storage.session.get([PROVIDER_SETTINGS_SESSION_KEY], (sessionResult) => {
          if (chrome.runtime.lastError) {
            // Fallback to local on error
            checkLocalStorage();
            return;
          }
          
          const sessionStored = sessionResult[PROVIDER_SETTINGS_SESSION_KEY];
          const sessionKey = getStoredProviderApiKey(sessionStored);
          
          if (sessionKey) {
            setStoredKeyLast4(sessionKey.slice(-4));
            setHasStoredKey(true);
            // Also load remember preference
            void getRememberKeyPreference().then(setRememberKey);
            resolve();
          } else {
            // Fallback to local storage
            checkLocalStorage();
          }
          
          function checkLocalStorage() {
            chrome.storage.local.get([PROVIDER_SETTINGS_LOCAL_KEY, PROVIDER_SETTINGS_KEY], (localResult) => {
              // Check new local key first
              const localStored = localResult[PROVIDER_SETTINGS_LOCAL_KEY];
              const localKey = getStoredProviderApiKey(localStored);
              
              if (localKey) {
                setStoredKeyLast4(localKey.slice(-4));
                setHasStoredKey(true);
                void getRememberKeyPreference().then(setRememberKey);
                resolve();
                return;
              }
              
              // Legacy fallback: old key format
              const legacyStored = localResult[PROVIDER_SETTINGS_KEY];
              const legacyKey = getStoredProviderApiKey(legacyStored);
              
              if (legacyKey) {
                setStoredKeyLast4(legacyKey.slice(-4));
                setHasStoredKey(true);
                setRememberKey(true); // Legacy assumed remember=true
              } else {
                setHasStoredKey(false);
                setRememberKey(false);
              }
              resolve();
            });
          }
        });
      }),
      // Note: Model is now passed via effectiveModel prop from runtimeState
      // This reflects what the server is actually using, not just user preference
    ]);
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
    if (trimmed.length < 20) {
      setError('Key appears too short. Gemini API keys are typically 39 characters.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Session-first storage: always write to session, conditionally to local
      const settings = { provider: 'gemini', apiKey: trimmed };
      
      // Always save to session (current browser session)
      await chrome.storage.session.set({
        [PROVIDER_SETTINGS_SESSION_KEY]: settings,
      });
      
      // Save to local only if "Remember key" is enabled
      if (rememberKey) {
        await chrome.storage.local.set({
          [PROVIDER_SETTINGS_LOCAL_KEY]: settings,
          [PROVIDER_REMEMBER_KEY]: true,
        });
      } else {
        // If not remembering, clear any existing local copy
        await chrome.storage.local.remove([PROVIDER_SETTINGS_LOCAL_KEY, PROVIDER_REMEMBER_KEY]);
      }
      
      // Clean up legacy key if present
      await chrome.storage.local.remove(PROVIDER_SETTINGS_KEY);
      
      setHasStoredKey(true);
      setStoredKeyLast4(trimmed.slice(-4));
      setApiKey('');
      await onSaved();
    } catch (err) {
      setError(getActionErrorMessage(err, 'Failed to save. Please try again.'));
      console.error('[SourceCheck/UI] Settings save flow failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    try {
      // Clear from both session and local storage
      await chrome.storage.session.remove(PROVIDER_SETTINGS_SESSION_KEY);
      await chrome.storage.local.remove([PROVIDER_SETTINGS_LOCAL_KEY, PROVIDER_REMEMBER_KEY, PROVIDER_SETTINGS_KEY]);
      setHasStoredKey(false);
      setStoredKeyLast4(null);
      setApiKey('');
      setRememberKey(false);
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
                boxShadow: `0 0 0 4px rgba(${statusConfig.rgb}, 0.16), 0 0 10px rgba(${statusConfig.rgb}, 0.20)`,
              }}
            />
            <span
              className="rail-connector"
              style={{
                top: '14px',
                background: `linear-gradient(90deg, rgba(${statusConfig.rgb}, 0.88), rgba(${statusConfig.rgb}, 0))`,
              }}
            />
            <div className="capture-plate ml-1 px-4 py-4 border border-sc-border-soft bg-sc-surface-0 shadow-sc-soft">
              <button
                onClick={onBack}
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
                  ? 'SourceCheck works without a key using managed quota. Add your own Google AI Studio key to use your own Gemini quota and unlock model selection.'
                  : keyStatus === 'present'
                  ? 'Your API key is saved. SourceCheck will use your Gemini quota for BYOK requests.'
                  : keyStatus === 'invalid'
                  ? 'Your saved API key was rejected. Update it below or remove it to return to the default managed model.'
                  : 'Your saved API key has no quota available right now. Use a different key or try again later.'}
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

                {error && (
                  <div className="flex items-start gap-2 rounded border border-sc-disputed/30 bg-sc-disputed/10 px-3 py-2">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-sc-disputed" />
                    <p className="text-[12px] leading-relaxed text-sc-disputed">{error}</p>
                  </div>
                )}
                {/* Remember key toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberKey}
                    onChange={(e) => setRememberKey(e.target.checked)}
                    className="rounded border-sc-border bg-sc-bg-1 text-sc-accent-soft focus:ring-sc-accent-soft"
                  />
                  <span className="text-[12px] text-sc-text-soft">
                    Remember key across browser sessions
                  </span>
                </label>
                <p className="text-[11px] text-sc-muted">
                  {rememberKey 
                    ? 'Key will persist after browser restarts.' 
                    : 'Key is cleared when you close the browser (recommended).'}
                </p>

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
                
                {/* Troubleshooting Section */}
                {effectiveErrorCode !== 'UNKNOWN_ERROR' && troubleshootingContent[effectiveErrorCode] && (
                  <div className="mt-4 rounded border border-sc-partial/30 bg-sc-partial/10 px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle size={12} className="text-sc-partial" />
                      <h3 className="text-[11px] font-semibold text-sc-partial">
                        {troubleshootingContent[effectiveErrorCode]?.title}
                      </h3>
                    </div>
                    <ol className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-sc-text-soft list-decimal list-inside">
                      {troubleshootingContent[effectiveErrorCode]?.steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                    {troubleshootingContent[effectiveErrorCode]?.link && (hasStoredKey || apiKey.trim()) && (
                      <a
                        href={troubleshootingContent[effectiveErrorCode]?.link?.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-sc-accent hover:text-sc-accent/80"
                      >
                        {troubleshootingContent[effectiveErrorCode]?.link?.text} <ExternalLink size={10} />
                      </a>
                    )}
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
