/**
 * TEMPORARY DEBUG TOOL — mirrors browser console output to the Vite dev
 * server (POST /__dev_console), which prints it into the dev-server log.
 * Exists purely so the agent can read what the user's live session logs
 * during the feed investigation. Dev-only; a no-op everywhere else.
 * Remove once the feed investigation closes.
 */

export function installDevConsoleMirror(): void {
  if (typeof window === 'undefined') return;
  if ((window as any).__devConsoleMirrorInstalled) return;
  (window as any).__devConsoleMirrorInstalled = true;

  const send = (level: string, args: unknown[]) => {
    try {
      const lines = args.map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) {
          return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
        }
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      });
      // Trim monster payloads (events, profiles) so one log line can't
      // blow up the request.
      const trimmed = lines.map((l) => (l.length > 2000 ? l.slice(0, 2000) + '…' : l));
      const body = JSON.stringify({ level, lines: trimmed });
      fetch('/__dev_console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    } catch {
      /* never break the app for a debug mirror */
    }
  };

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      send(level, args);
    };
  }

  window.addEventListener('error', (e) => {
    send('error', [`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    send('error', [`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`]);
  });
}
