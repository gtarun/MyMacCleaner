import { useEffect, useState } from 'react';

// True while the app window is actually on screen. Goes false when the
// window is minimized or fully occluded by other windows (Chromium flips
// document.visibilityState to "hidden" in those cases).
//
// We use this to PAUSE polling loops — the Performance `ps` poll and the
// Mac Health / Trash refresh — when nobody can see the result. Without it
// those timers keep firing (and shelling out / walking the disk) in the
// background, which is a real source of fan noise and heat when the app is
// left open behind other windows.
export function useWindowVisible() {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    function update() {
      setVisible(document.visibilityState !== 'hidden');
    }
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return visible;
}
