import { useEffect, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { RevealButton } from '../components/RevealButton.jsx';
import { useScanScope } from '../store/ScanContext.jsx';

// Emoji glyphs by installer type — same lightweight approach as LargeOldFiles.
const ICONS = { dmg: '💿', pkg: '📦', mpkg: '📦', xip: '🗜', iso: '💿', zip: '🗜', other: '📦' };
function iconFor(ext) {
  const k = (ext || '').replace('.', '');
  return ICONS[k] || ICONS.other;
}

function formatAge(days) {
  if (days == null) return '—';
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function Installers() {
  const { progress, markActive, setResult, requested, clearRequest } = useScanScope('installers');
  const [state, setState] = useState('idle'); // idle | scanning | results | done
  const [scan, setScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [selected, setSelected] = useState(new Set());
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
      const result = await window.api.scanInstallers();
      setScan(result);
      setResult({
        totalBytes: result.totalBytes,
        flaggedCount: result.items.length,
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

  function toggleAll(items) {
    setSelected((prev) => {
      const ids = items.map((i) => i.id);
      const allChecked = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allChecked) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  const items = scan?.items || [];
  const selectedItems = items.filter((i) => selected.has(i.id));
  const selectedBytes = selectedItems.reduce((s, i) => s + i.bytes, 0);

  async function confirmClean() {
    setCleaning(true);
    try {
      const paths = selectedItems.map((i) => i.path);
      const results = await window.api.trashItems(paths, {
        scope: 'installers',
        items: selectedItems.map((i) => ({ path: i.path, bytes: i.bytes })),
      });
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
        <h1 className="module__title">Leftover Installers</h1>
        <p className="module__subtitle">
          Disk images and packages sitting in <code>~/Downloads</code> that you already installed
          from and haven't touched in a month. Some of the safest bytes to reclaim.
        </p>
      </header>

      {state === 'idle' && (
        <div className="module__card">
          <p className="module__placeholder">
            Scans <code>~/Downloads</code> for <code>.dmg</code>, <code>.pkg</code>,{' '}
            <code>.xip</code>, <code>.iso</code>, and <code>.zip</code> files older than 30 days.
            Fresh downloads are left alone.
          </p>
          <div className="warn-card" style={{ marginTop: 18 }}>
            <strong>Downloads can hold real work.</strong> Nothing is pre-selected — review each
            row. Items move to Trash (recoverable until you empty it).
          </div>
          <button className="module__cta" onClick={runScan} style={{ marginTop: 20 }}>
            Scan Downloads
          </button>
          {scanError && <div className="module__error">Scan failed: {scanError}</div>}
        </div>
      )}

      {state === 'scanning' && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">
            {progress?.currentRoot ? `Scanning ${progress.currentRoot}` : 'Starting…'}
          </p>
          <p className="scan-state__hint">
            {progress?.visited != null && <>{formatCount(progress.visited)} installers checked</>}
            {progress?.found != null && <> · {progress.found} flagged</>}
            {progress?.currentItem && <> · <code>{progress.currentItem}</code></>}
          </p>
        </div>
      )}

      {state === 'results' && scan && (
        <>
          <div className="results-summary">
            <div>
              <div className="results-summary__bignum">
                {items.length > 0 ? formatBytes(scan.totalBytes) : 'Clean'}
              </div>
              <div className="results-summary__label">
                {items.length > 0
                  ? <>{formatCount(items.length)} old installer{items.length === 1 ? '' : 's'} · scanned in {(scan.durationMs / 1000).toFixed(1)}s</>
                  : <>No installers older than 30 days · scanned in {(scan.durationMs / 1000).toFixed(1)}s</>}
              </div>
            </div>
            <button className="btn btn--ghost" onClick={runScan}>Rescan</button>
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              Nothing to clean. Your Downloads folder has no stale installers.
            </div>
          ) : (
            <>
              <div className="file-table">
                <div className="file-table__header">
                  <input
                    type="checkbox"
                    checked={items.every((i) => selected.has(i.id))}
                    ref={(el) => {
                      if (!el) return;
                      const some = items.some((i) => selected.has(i.id));
                      const all = items.every((i) => selected.has(i.id));
                      el.indeterminate = some && !all;
                    }}
                    onChange={() => toggleAll(items)}
                  />
                  <span>Installer</span>
                  <span style={{ textAlign: 'right' }}>Size</span>
                  <span style={{ textAlign: 'right' }}>Downloaded</span>
                </div>
                {items.slice(0, 500).map((file) => (
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
                      <RevealButton path={file.path} />
                    </div>
                    <span className="file-row__size">{formatBytes(file.bytes)}</span>
                    <span className="file-row__date">{formatAge(file.ageDays)}</span>
                  </label>
                ))}
                {items.length > 500 && (
                  <div className="file-table__more">
                    Showing the 500 biggest of {formatCount(items.length)}.
                  </div>
                )}
              </div>

              <div className="action-bar">
                <div className="action-bar__summary">
                  <span className="action-bar__count">{selectedItems.length}</span> selected ·{' '}
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
                  : `Freed ${formatBytes(cleanReport.bytesFreed)} (some skipped)`)}
          </h2>
          <p className="done-state__note">
            {cleanReport.dryRun
              ? 'Dry-run mode is on. Nothing was actually removed — toggle it off in Settings → Safety to clean for real.'
              : 'Installers are in your Trash. Empty it from Finder to permanently reclaim disk space.'}
          </p>
          {cleanReport.failed.length > 0 && (
            <details className="done-state__failed">
              <summary>{cleanReport.failed.length} could not be removed</summary>
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
        title="Move these installers to Trash?"
        body={
          <>
            <p>
              <strong>{selectedItems.length}</strong> installer{selectedItems.length === 1 ? '' : 's'} totaling{' '}
              <strong>{formatBytes(selectedBytes)}</strong> will move to your Trash.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              You can restore any of them from Finder before emptying the Trash.
            </p>
          </>
        }
        confirmLabel={`Move ${selectedItems.length} to Trash`}
        onConfirm={confirmClean}
        onCancel={() => setConfirmOpen(false)}
        busy={cleaning}
      />
    </div>
  );
}
