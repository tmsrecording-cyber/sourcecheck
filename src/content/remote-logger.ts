/**
 * Remote Logger Client - Sends logs to local HTTP server
 * 
 * Setup:
 *   1. Run: node scripts/log-server.cjs
 *   2. In Chrome DevTools console: 
 *      localStorage.setItem('SC_LOG_ENDPOINT', 'http://localhost:9223/log')
 *   3. Reload extension
 */

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
  private endpoint: string | null = null;
  private queue: LogEntry[] = [];
  private flushTimer: number | null = null;
  private enabled = false;

  constructor() {
    this.endpoint = localStorage.getItem('SC_LOG_ENDPOINT');
    this.enabled = !!this.endpoint;
    
    if (this.enabled) {
      this.patchConsole();
      this.startFlushTimer();
      console.log('[RemoteLogger] Enabled, endpoint:', this.endpoint);
    }
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

// Auto-init in browser context
if (typeof window !== 'undefined') {
  window.__scRemoteLogger = new RemoteLogger();
}

export { RemoteLogger };
