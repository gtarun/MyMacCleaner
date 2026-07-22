// Small "Show in Finder" button.
//
// Reveals a file or folder in Finder via the read-only shell:show-in-folder
// IPC channel (it selects the item, never opens/executes it). Safe to drop
// into any results row. Stops event propagation so it can live inside a
// <label> row without toggling that row's checkbox/radio.

export function RevealButton({ path, className = '', title = 'Show in Finder' }) {
  function reveal(e) {
    e.preventDefault();
    e.stopPropagation();
    if (path) window.api.showInFinder?.(path);
  }
  return (
    <button
      type="button"
      className={`reveal-btn ${className}`}
      onClick={reveal}
      title={title}
      aria-label={title}
    >
      {/* Classic "reveal / open in place" glyph: box with an out-arrow. */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 4h6v6" />
        <path d="M20 4l-8 8" />
        <path d="M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
  );
}
