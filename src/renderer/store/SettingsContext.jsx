// Settings store — mirrors main process state and dispatches updates.
//
// Loads once on mount, subscribes to settings:changed events so any
// update (from this window or future ones) refreshes every subscriber.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!window.api?.getSettings) {
      setLoading(false);
      return undefined;
    }
    window.api.getSettings().then((s) => { setSettings(s); setLoading(false); });
    const unsub = window.api.onSettingsChanged?.((next) => setSettings(next));
    return unsub;
  }, []);

  const update = useCallback(async (patch) => {
    const next = await window.api.updateSettings(patch);
    setSettings(next);
    return next;
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
