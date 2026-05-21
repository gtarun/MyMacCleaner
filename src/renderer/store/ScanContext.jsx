// Global scan state — survives tab switches and powers the top banner.
//
// Three pieces of cross-module state live here:
//   1. activeScans  — what is running RIGHT NOW (drives banner + sidebar dots)
//   2. results      — last summary per scope (drives Dashboard cards)
//   3. requestedScans — Dashboard's "Scan everything" sets this; each
//                      module watches its scope and starts a scan when
//                      it sees a matching request.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ScanContext = createContext(null);

export function ScanProvider({ children }) {
  const [activeScans, setActiveScans] = useState({});
  const [results, setResultsState] = useState({});
  const [requestedScans, setRequestedScans] = useState(new Set());

  // Hydrate from persisted lastResults on app boot. This is how the
  // Dashboard shows last-known numbers immediately, before the user
  // re-runs anything, and also how scheduled-scan summaries from
  // previous sessions surface in the UI.
  useEffect(() => {
    if (!window.api?.getSettings) return;
    window.api.getSettings()
      .then((s) => {
        if (s?.lastResults && Object.keys(s.lastResults).length > 0) {
          setResultsState((prev) => Object.keys(prev).length ? prev : s.lastResults);
        }
      })
      .catch(() => {});
  }, []);

  // Scheduled scans complete in the main process while the user might
  // be looking at any tab. The scheduler broadcasts per-scope summaries
  // here so the in-memory results map stays current.
  useEffect(() => {
    if (!window.api?.onScheduledResult) return undefined;
    return window.api.onScheduledResult(({ scope, summary }) => {
      if (!scope || !summary) return;
      setResultsState((prev) => ({ ...prev, [scope]: summary }));
    });
  }, []);

  // Subscribe ONCE to progress events from main. Each module no longer
  // needs its own subscription — they read from this store.
  useEffect(() => {
    if (!window.api?.onScanProgress) return undefined;
    return window.api.onScanProgress((payload) => {
      const { scope, phase, ...rest } = payload;
      setActiveScans((prev) => {
        if (phase === 'done') {
          if (!prev[scope]) return prev;
          const next = { ...prev };
          delete next[scope];
          return next;
        }
        return { ...prev, [scope]: { phase, ...rest, updatedAt: Date.now() } };
      });
    });
  }, []);

  const setActive = useCallback((scope, active) => {
    setActiveScans((prev) => {
      if (active) {
        if (prev[scope]) return prev;
        return { ...prev, [scope]: { phase: 'starting', updatedAt: Date.now() } };
      }
      if (!prev[scope]) return prev;
      const next = { ...prev };
      delete next[scope];
      return next;
    });
  }, []);

  // Modules call this when a scan finishes so the Dashboard has something
  // to display. Pass `null` to clear a stale result (e.g. after cleanup).
  // Side-effect: persists the summary into settings.lastResults so it
  // survives the next launch — the in-memory state is the source of
  // truth for the live UI, but settings is the durable copy.
  const setResult = useCallback((scope, summary) => {
    setResultsState((prev) => {
      if (summary == null) {
        if (!prev[scope]) return prev;
        const next = { ...prev };
        delete next[scope];
        return next;
      }
      return { ...prev, [scope]: { ...summary, recordedAt: Date.now() } };
    });
    if (summary != null && window.api?.updateSettings) {
      // Fire and forget — write small JSON. Failures don't block the UI.
      window.api.updateSettings({
        lastResults: { [scope]: { ...summary, recordedAt: Date.now() } },
      }).catch(() => {});
    }
  }, []);

  const requestScan = useCallback((scope) => {
    setRequestedScans((prev) => {
      if (prev.has(scope)) return prev;
      const next = new Set(prev);
      next.add(scope);
      return next;
    });
  }, []);

  const clearRequest = useCallback((scope) => {
    setRequestedScans((prev) => {
      if (!prev.has(scope)) return prev;
      const next = new Set(prev);
      next.delete(scope);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ activeScans, results, requestedScans, setActive, setResult, requestScan, clearRequest }),
    [activeScans, results, requestedScans, setActive, setResult, requestScan, clearRequest],
  );
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScans() {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error('useScans must be used inside <ScanProvider>');
  return ctx;
}

/**
 * Per-scope convenience hook. The module gets back live progress, the
 * latest summary, whether a scan has been requested by another part of
 * the app, and bound setters for all of these.
 */
export function useScanScope(scope) {
  const ctx = useScans();
  return {
    progress: ctx.activeScans[scope] || null,
    result: ctx.results[scope] || null,
    requested: ctx.requestedScans.has(scope),
    markActive: useCallback((active) => ctx.setActive(scope, active), [scope, ctx]),
    setResult: useCallback((summary) => ctx.setResult(scope, summary), [scope, ctx]),
    requestScan: useCallback(() => ctx.requestScan(scope), [scope, ctx]),
    clearRequest: useCallback(() => ctx.clearRequest(scope), [scope, ctx]),
  };
}
