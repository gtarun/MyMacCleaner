import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useScanScope } from '../store/ScanContext.jsx';

const TABS = [
  { id: 'large', label: 'Large files', hint: '≥ 100 MB' },
  { id: 'old',   label: 'Stale files', hint: 'not opened in 6+ months' },
];

// Cheap emoji "icons" by extension — keeps the UI readable without
// bundling a real icon set. Sized down via CSS, not the emoji itself.
const ICONS = {
  video: '🎬', audio: '🎵', image: '🖼', archive: '📦',
  pdf: '📄', text: '📝', code: '⚙', exec: '⚡', other: '📁',
};
const EXT_TO_KIND = {
  '.mp4': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video', '.webm': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.aac': 'audio', '.m4a': 'audio', '.aif': 'audio', '.aiff': 'audio',
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.heic': 'image', '.tiff': 'image', '.psd': 'image', '.raw': 'image', '.nef': 'image', '.cr2': 'image',
  '.zip': 'archive', '.tar': 'archive', '.gz': 'archive', '.bz2': 'archive', '.7z': 'archive', '.rar': 'archive', '.dmg': 'archive', '.iso': 'archive', '.pkg': 'archive',
  '.pdf': 'pdf',
  '.txt': 'text', '.md': 'text', '.rtf': 'text', '.doc': 'text', '.docx': 'text',
  '.js': 'code', '.ts': 'code', '.jsx': 'code', '.tsx': 'code', '.py': 'code', '.rb': 'code', '.go': 'code', '.rs': 'code', '.swift': 'code', '.json': 'code',
  '.exe': 'exec', '.bin': 'exec',
};

function iconFor(ext) {
  return ICONS[EXT_TO_KIND[ext] || 'other'];
}

function formatDate(ms) {
  if (!ms) return '—';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function LargeOldFiles() {
  const { progress, markActive, setResult, requested, clearRequest } = useScanScope('large-old');
  const [state, setState] = useState('idle'); // idle, scanning, results, done
  const [scan, setScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [tab, setTab] = useState('large');
  const [selected, setSelected] = useState(new Set()); // file ids
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanReport, setCleanReport] = useState(null);

  async function runScan() {
    clearRequest();
    setState('scanning');
    setScanError(null);
    setSelected(new Set());
    markActive(true);
    try {
      const result = await window.api.scanLargeOld();
      setScan(result);
      // Surface a summary so the Dashboard card can render.
      // De-dupe files that show up in both lists for an accurate count.
      const dedupedIds = new Set();
      let dedupedBytes = 0;
      for (const arr of [result.large, result.old]) {
        for (const f of arr) {
          if (dedupedIds.has(f.id)) continue;
          dedupedIds.add(f.id);
          dedupedBytes += f.bytes;
        }
      }
      setResult({
        totalBytes: dedupedBytes,
        flaggedCount: dedupedIds.size,
        large: result.large.length,
        old: result.old.length,
        visited: result.visitedCount,
      });
      setState('results');
    } catch (err) {
      setScanError(err.message || String(err));
      setState('idle');
    } finally {
      markActive(false);
    }
  }

  useEffect(() => {
    if (requested && state !== 'scanning') runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllVisible(items) {
    setSelected((prev) => {
      const visibleIds = items.map((i) => i.id);
      const allChecked = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allChecked) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const visibleItems = useMemo(() => {
    if (!scan) return [];
    return tab === 'large' ? scan.large : scan.old;
  }, [scan, tab]);

  // De-duped selected files (an item might appear in both Large AND Old)
  const selectedItems = useMemo(() => {
    if (!scan) return [];
    const seen = new Set();
    const out = [];
    for (const arr of [scan.large, scan.old]) {
      for (const i of arr) {
        if (selected.has(i.id) && !seen.has(i.id)) {
          seen.add(i.id);
          out.push(i);
        }
      }
    }
    return out;
  }, [scan, selected]);

  const selectedBytes = selectedItems.reduce((s, i) => s + i.bytes, 0);

  async function confirmClean() {
    setCleaning(true);
    try {
      const paths = selectedItems.map((i) => i.path);
      const results = await window.api.trashItems(paths);
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      const dryRun = results.some((r) => r.dryRun);
      const bytesFreed = selectedItems
        .filter((_, idx) => results[idx]?.ok)
        .reduce((s, i) => s + i.bytes, 0);
      setCleanReport({ attempted: results.length, succeeded: okCount, failed, bytesFreed, dryRun });
      setConfirmOpen(false);
      setState('done');
    } catch (err) {
      setCleanReport({ attempted: 0, succeeded: 0, failed: [{ path: '', error: err.message }], bytesFreed: 0 });
      setConfirmOpen(false);
      setState('done');
    } finally {
      setCleaning(false);
    }
  }

  function reset() {
    setScan(null);
    setScanError(null);
    setSelected(new Set());
    setCleanReport(null);
    setState('idle');
  }

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Large &amp; Old Files</h1>
        <p className="module__subtitle">
          Surface files over 100 MB or untouched for 6+ months across Documents, Downloads, Desktop, Movies, and Pictures.
        </p>
      </header>

      {state === 'idle' && (
        <div className="module__card">
          <p className="module__placeholder">
            Scans 5 folders: <code>~/Documents</code>, <code>~/Downloads</code>,{' '}
            <code>~/Desktop</code>, <code>~/Movies</code>, <code>~/Pictures</code>. Bundles
            (<code>.app</code>, <code>.photoslibrary</code>, etc.) are treated as opaque —
            we never descend into them. iCloud-offloaded files are skipped.
          </p>
          <div className="warn-card" style={{ marginTop: 18 }}>
            <strong>These are your files.</strong> Nothing is pre-selected; review every
            row carefully. Items move to Trash (recoverable until you empty it).
          </div>
          <button className="module__cta" onClick={runScan} style={{ marginTop: 20 }}>
            Scan default folders
          </button>
          {scanError && <div className="module__error">Scan failed: {scanError}</div>}
        </div>
      )}

      {state === 'scanning' && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">
            {progress?.currentRoot ? `Walking ${progress.currentRoot}` : 'Starting walk…'}
          </p>
          <p className="scan-state__hint">
            {progress?.visited != null && (
              <>{formatCount(progress.visited)} files scanned</>
            )}
            {progress?.foundLarge != null && progress?.foundOld != null && (
              <> · {progress.foundLarge} large · {progress.foundOld} stale flagged</>
            )}
            {progress?.currentItem && <> · <code>{progress.currentItem}</code></>}
          </p>
        </div>
      )}

      {state === 'results' && scan && (
        <>
          <div className="results-summary">
            <div>
              <div className="results-summary__bignum">
                {formatCount(scan.large.length + scan.old.length - countOverlap(scan))}
              </div>
              <div className="results-summary__label">
                files flagged · {formatCount(scan.visitedCount)} scanned in {(scan.durationMs/1000).toFixed(1)}s
                {scan.skippedCount > 0 && (
                  <> · {scan.skippedCount} dev folders skipped</>
                )}
              </div>
            </div>
            <button className="btn btn--ghost" onClick={runScan}>Rescan</button>
          </div>

          <div className="tabs">
            {TABS.map((t) => {
              const count = t.id === 'large' ? scan.large.length : scan.old.length;
              return (
                <button
                  key={t.id}
                  className={`tab ${tab === t.id ? 'tab--active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <span className="tab__label">{t.label}</span>
                  <span className="tab__count">{formatCount(count)}</span>
                  <span className="tab__hint">{t.hint}</span>
                </button>
              );
            })}
          </div>

          {visibleItems.length === 0 ? (
            <div className="empty-state">
              Nothing here. {tab === 'large' ? 'No files ≥ 100 MB.' : 'No files older than 6 months.'}
            </div>
          ) : (
            <>
              <div className="file-table">
                <div className="file-table__header">
                  <input
                    type="checkbox"
                    checked={visibleItems.every((i) => selected.has(i.id))}
                    ref={(el) => {
                      if (!el) return;
                      const some = visibleItems.some((i) => selected.has(i.id));
                      const all = visibleItems.every((i) => selected.has(i.id));
                      el.indeterminate = some && !all;
                    }}
                    onChange={() => toggleAllVisible(visibleItems)}
                  />
                  <span>File</span>
                  <span style={{ textAlign: 'right' }}>Size</span>
                  <span style={{ textAlign: 'right' }}>Last opened</span>
                </div>
                {visibleItems.slice(0, 500).map((file) => (
                  <label className="file-row" key={file.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(file.id)}
                      onChange={() => toggle(file.id)}
                    />
                    <div className="file-row__main">
                      <span className="file-row__icon">{iconFor(file.ext)}</span>
                      <div className="file-row__textcol">
                        <div className="file-row__name">{file.name}</div>
                        <div className="file-row__path" title={file.path}>
                          {abbreviateHome(file.path)}
                        </div>
                      </div>
                    </div>
                    <span className="file-row__size">{formatBytes(file.bytes)}</span>
                    <span className="file-row__date">{formatDate(file.atimeMs)}</span>
                  </label>
                ))}
                {visibleItems.length > 500 && (
                  <div className="file-table__more">
                    Showing first 500 of {formatCount(visibleItems.length)}. Filter by selecting some and clearing your scan to see more.
                  </div>
                )}
              </div>

              <div className="action-bar">
                <div className="action-bar__summary">
                  <span className="action-bar__count">{selectedItems.length}</span> files selected ·{' '}
                  <strong>{formatBytes(selectedBytes)}</strong>
                </div>
                <button
                  className="btn btn--primary"
                  disabled={selectedItems.length === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  Move to Trash
                </button>
              </div>
            </>
          )}
        </>
      )}

      {state === 'done' && cleanReport && (
        <div className="module__card done-state">
          <div className="done-state__icon">{cleanReport.dryRun ? '◌' : '✓'}</div>
          <h2 className="done-state__title">
            {cleanReport.dryRun
              ? `Would free ${formatBytes(cleanReport.bytesFreed)}`
              : (cleanReport.succeeded === cleanReport.attempted
                  ? `Freed ${formatBytes(cleanReport.bytesFreed)}`
                  : `Freed ${formatBytes(cleanReport.bytesFreed)} (some files skipped)`)}
          </h2>
          <p className="done-state__note">
            {cleanReport.dryRun
              ? 'Dry-run mode is on. Nothing was actually removed — toggle it off in Settings → Safety to clean for real.'
              : 'Files are in your Trash. Empty it from Finder to permanently reclaim disk space.'}
          </p>
          {cleanReport.failed.length > 0 && (
            <details className="done-state__failed">
              <summary>{cleanReport.failed.length} files could not be removed</summary>
              <ul>
                {cleanReport.failed.slice(0, 20).map((f, i) => (
                  <li key={i}><code>{f.path || '(no path)'}</code> — {f.error}</li>
                ))}
              </ul>
            </details>
          )}
          <button className="btn btn--primary" onClick={reset} style={{ marginTop: 20 }}>
            Scan again
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Move these files to Trash?"
        body={
          <>
            <p>
              <strong>{selectedItems.length}</strong> files totaling{' '}
              <strong>{formatBytes(selectedBytes)}</strong> will move to your Trash.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              These are personal files — make sure none of them are important. You can
              restore from Finder any time before emptying the Trash.
            </p>
          </>
        }
        confirmLabel={`Move ${selectedItems.length} files to Trash`}
        onConfirm={confirmClean}
        onCancel={() => setConfirmOpen(false)}
        busy={cleaning}
      />
    </div>
  );
}

function countOverlap(scan) {
  const oldIds = new Set(scan.old.map((i) => i.id));
  let overlap = 0;
  for (const i of scan.large) if (oldIds.has(i.id)) overlap += 1;
  return overlap;
}
