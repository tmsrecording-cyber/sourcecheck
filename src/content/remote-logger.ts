/**
 * Remote Logger Client - Sends logs to a loopback HTTP server in dev builds only.
 *
 * Setup:
 *   1. Run: node scripts/log-server.cjs
 *   2. Set chrome.storage.session['scRemoteLogEndpoint'] = 'http://localhost:9223/log'
 *   3. Reload extension
 */

import {
  getRemoteLoggerEndpointFromStorage,
  REMOTE_LOG_ENDPOINT_KEY,
} from './remoteLoggerConfig';

declare global {
  interface Window {
    __scRemoteLogger?: RemoteLogger;
  }
}

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  source: string;
  message: string;
}

class RemoteLogger {
  private readonly endpoint: string;
  private queue: LogEntry[] = [];
  private flushTimer: number | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.patchConsole();
    this.startFlushTimer();
    console.log('[RemoteLogger] Enabled, endpoint:', this.endpoint);
  }

  private patchConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalDebug = console.debug;

    console.log = (...args: unknown[]) => {
      this.enqueue('INFO', 'console', args);
      originalLog.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      this.enqueue('ERROR', 'console', args);
      originalError.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      this.enqueue('WARN', 'console', args);
      originalWarn.apply(console, args);
    };

    console.debug = (...args: unknown[]) => {
      this.enqueue('DEBUG', 'console', args);
      originalDebug.apply(console, args);
    };
  }

  private enqueue(level: LogEntry['level'], source: string, args: unknown[]) {
    const message = args.map(a => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return '[Object]';
        }
      }
      return String(a);
    }).join(' ');

    this.queue.push({
      timestamp: new Date().toISOString(),
      level,
      source,
      message
    });

    // Keep queue bounded
    if (this.queue.length > 200) {
      this.queue = this.queue.slice(-100);
    }
  }

  private startFlushTimer() {
    this.flushTimer = window.setInterval(() => {
      this.flush();
    }, 500); // Flush every 500ms
  }

  private async flush() {
    if (!this.endpoint || this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    
    for (const entry of batch) {
      try {
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
          // Silent fail - don't block on network
          signal: AbortSignal.timeout(1000)
        });
      } catch {
        // Put back in queue if failed
        this.queue.unshift(entry);
        break;
      }
    }
  }

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}

export async function initRemoteLogger(): Promise<RemoteLogger | null> {
  if (typeof window === 'undefined' || typeof chrome === 'undefined') {
    return null;
  }

  const endpoint = await getRemoteLoggerEndpointFromStorage(chrome.storage?.session);
  if (!endpoint) {
    return null;
  }

  const existingLogger = window.__scRemoteLogger;
  if (existingLogger) {
    return existingLogger;
  }

  const logger = new RemoteLogger(endpoint);
  window.__scRemoteLogger = logger;
  return logger;
}

if (typeof window !== 'undefined') {
  void initRemoteLogger();
}

export { RemoteLogger, REMOTE_LOG_ENDPOINT_KEY };
