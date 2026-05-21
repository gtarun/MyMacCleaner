// Tiny formatting helpers used across modules.

export function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  // 1 decimal under 100, none above — keeps the visual rhythm tight.
  const fixed = n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n);
  return `${fixed} ${units[i]}`;
}

export function formatCount(n) {
  return n.toLocaleString();
}

/**
 * Replace a leading "/Users/<somebody>/" with "~/" for display purposes.
 * Used so per-item paths read as "~/Library/Caches/Foo" instead of the
 * full "/Users/jane/Library/Caches/Foo".
 */
export function abbreviateHome(p) {
  if (typeof p !== 'string') return '';
  return p.replace(/^\/Users\/[^/]+\//, '~/');
}
