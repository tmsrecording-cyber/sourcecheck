import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isReloading: boolean;
}

/**
 * Error Boundary component to catch React rendering errors
 * and prevent the entire sidepanel from crashing.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    isReloading: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isReloading: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[SourceCheck/ErrorBoundary] Uncaught error:', error);
    console.error('[SourceCheck/ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  private handleReloadExtension = () => {
    this.setState({ isReloading: true });
    
    // Attempt to reload the extension via runtime message to service worker
    try {
      chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' }).catch(() => {
        // If service worker is dead, try direct runtime reload
        if (chrome.runtime?.reload) {
          chrome.runtime.reload();
        }
      });
    } catch {
      // Fallback: try direct reload
      if (chrome.runtime?.reload) {
        chrome.runtime.reload();
      }
    }
    
    // Give feedback that something is happening
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  private handleReloadPanel = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full min-h-0 w-full items-center justify-center bg-sc-bg-0 px-5 font-sc">
          <div className="w-full max-w-[320px]">
            <div className="instrument-shell px-5 py-5 border border-sc-border shadow-sc-main bg-sc-surface-glass backdrop-blur-md">
              <div className="relative">
                <div className="flex items-center gap-3 text-sc-disputed">
                  <AlertTriangle size={24} />
                  <h2 className="text-[16px] font-bold">Something went wrong</h2>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-sc-text-soft">
                  The side panel encountered an error. Try refreshing the page or reloading the extension.
                </p>
                {this.state.error && (
                  <details className="mt-4">
                    <summary className="text-[11px] text-sc-muted cursor-pointer">Error details</summary>
                    <pre className="mt-2 p-2 bg-sc-surface-2 rounded text-[10px] text-sc-text-soft overflow-auto">
                      {this.state.error.message}
                    </pre>
                  </details>
                )}
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={this.handleReloadPanel}
                    disabled={this.state.isReloading}
                    className="w-full px-4 py-2 bg-sc-accent text-sc-bg-0 rounded text-[13px] font-medium hover:bg-sc-accent-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Reload Panel
                  </button>
                  <button
                    type="button"
                    onClick={this.handleReloadExtension}
                    disabled={this.state.isReloading}
                    className="w-full px-4 py-2 bg-sc-surface-2 border border-sc-border text-sc-text rounded text-[13px] font-medium hover:bg-sc-surface-1 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {this.state.isReloading ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Reloading...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={14} />
                        Reload Extension
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
