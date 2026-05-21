import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useScanScope } from '../store/ScanContext.jsx';

// Three states: 'idle' → 'scanning' → 'results' → (post-clean) 'done'
export function SystemJunk() {
  const { progress, markActive, setResult, requested, clearRequest } = useScanScope('system-junk');
  const [state, setState] = useState('idle');
  const [scan, setScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [selected, setSelected] = useState(new Set()); // item ids
  const [expanded, setExpanded] = useState(new Set()); // category ids
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanReport, setCleanReport] = useState(null);

  async function runScan() {
    clearRequest();
    setState('scanning');
    setScanError(null);
    markActive(true);
    try {
      const result = await window.api.scanSystemJunk();
      setScan(result);
      // Pre-select items only from categories that opt in via defaultChecked.
      // Xcode Archives and any other release-artifact category stay unchecked
      // until the user explicitly opts in.
      const allIds = new Set();
      for (const c of result.categories) {
        if (c.defaultChecked === false) continue;
        for (const i of c.items) allIds.add(i.id);
      }
      setSelected(allIds);
      // Auto-expand the largest category.
      const biggest = [...result.categories].sort((a, b) => b.totalBytes - a.totalBytes)[0];
      setExpanded(new Set(biggest ? [biggest.id] : []));
      // Publish a summary so the Dashboard has something to render.
      setResult({
        totalBytes: result.totalBytes,
        itemCount: result.categories.reduce((s, c) => s + c.itemCount, 0),
        categoryCount: result.categories.length,
      });
      setState('results');
    } catch (err) {
      setScanError(err.message || String(err));
      setState('idle');
    } finally {
      markActive(false);
    }
  }

  // Dashboard's "Scan everything" sets `requested` on this scope. Fire a
  // scan unless we're already mid-scan (guards against re-entry).
  useEffect(() => {
    if (requested && state !== 'scanning') runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  function toggleItem(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCategory(catId, items) {
    setSelected((prev) => {
      const allChecked = items.every((i) => prev.has(i.id));
      const next = new Set(prev);
      if (allChecked) items.forEach((i) => next.delete(i.id));
      else items.forEach((i) => next.add(i.id));
      return next;
    });
  }

  function toggleExpand(catId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  // Items the user has actually selected — what will go to Trash.
  const selectedItems = useMemo(() => {
    if (!scan) return [];
    const out = [];
    for (const c of scan.categories) for (const i of c.items) if (selected.has(i.id)) out.push(i);
    return out;
  }, [scan, selected]);

  const selectedBytes = selectedItems.reduce((s, i) => s + i.bytes, 0);

  async function confirmClean() {
    setCleaning(true);
    try {
      const paths = selectedItems.map((i) => i.path);
      const results = await window.api.trashItems(paths, {
        scope: 'system-junk',
        items: selectedItems.map((i) => ({ path: i.path, bytes: i.bytes })),
      });
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      const dryRun = results.some((r) => r.dryRun);
      setCleanReport({
        attempted: results.length,
        succeeded: okCount,
        failed,
        dryRun,
        bytesFreed: selectedItems.filter((i, idx) => results[idx]?.ok).reduce((s, i) => s + i.bytes, 0),
      });
      setConfirmOpen(false);
      setState('done');
    } catch (err) {
      setCleanReport({ attempted: 0, succeeded: 0, failed: [{ path: '', error: err.message }] });
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
    setExpanded(new Set());
    setCleanReport(null);
    setState('idle');
  }

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">System Junk</h1>
        <p className="module__subtitle">
          Application caches, log files, and crash reports — all regenerable, all moved to Trash (never deleted outright).
        </p>
      </header>

      {state === 'idle' && (
        <div className="module__card">
          <p className="module__placeholder" style={{ marginBottom: 20 }}>
            Scans <code>~/Library/Caches</code>, <code>~/Library/Logs</code>, and{' '}
            <code>~/Library/Logs/DiagnosticReports</code>. Mail, Messages, Photos, and
            iCloud Drive caches are skipped because they contain real user data.
          </p>
          <button className="module__cta" onClick={runScan}>Scan System Junk</button>
          {scanError && <div className="module__error">Scan failed: {scanError}</div>}
        </div>
      )}

      {state === 'scanning' && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">
            {progress?.category ? `Scanning ${progress.category}` : 'Starting scan…'}
          </p>
          <p className="scan-state__hint">
            {progress?.currentItem && <code>{progress.currentItem}</code>}
            {progress?.itemsTotal != null && (
              <> · {progress.itemsDone || 0} of {progress.itemsTotal} items</>
            )}
            {progress?.categoryCount != null && progress?.categoryIdx != null && (
              <> · category {Math.min(progress.categoryIdx + 1, progress.categoryCount)} of {progress.categoryCount}</>
            )}
            {progress?.runningBytes != null && progress.runningBytes > 0 && (
              <> · {formatBytes(progress.runningBytes)} found so far</>
            )}
          </p>
        </div>
      )}

      {state === 'results' && scan && (
        <>
          <div className="results-summary">
            <div>
              <div className="results-summary__bignum">{formatBytes(scan.totalBytes)}</div>
              <div className="results-summary__label">found across {scan.categories.reduce((s, c) => s + c.itemCount, 0)} items</div>
            </div>
            <button className="btn btn--ghost" onClick={runScan}>Rescan</button>
          </div>

          {scan.categories.map((cat, idx) => {
            const isOpen = expanded.has(cat.id);
            const allChecked = cat.items.length > 0 && cat.items.every((i) => selected.has(i.id));
            const someChecked = cat.items.some((i) => selected.has(i.id));
            const prevGroup = idx > 0 ? scan.categories[idx - 1].group : null;
            const showGroupHeader = cat.group !== prevGroup;
            return (
              <div key={cat.id}>
                {showGroupHeader && (
                  <div className="group-header">
                    {cat.group === 'developer' ? 'Developer caches' : 'System'}
                    {cat.group === 'developer' && (
                      <span className="group-header__hint">
                        Big disk wins — Xcode and node tools regenerate these on demand
                      </span>
                    )}
                  </div>
                )}
              <div className="category">
                <div className="category__header">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => el && (el.indeterminate = !allChecked && someChecked)}
                    onChange={() => toggleCategory(cat.id, cat.items)}
                    disabled={cat.items.length === 0}
                  />
                  <button className="category__title" onClick={() => toggleExpand(cat.id)}>
                    <span className={`category__chevron ${isOpen ? 'category__chevron--open' : ''}`}>›</span>
                    <span>{cat.label}</span>
                    <span className="category__desc">{cat.description}</span>
                  </button>
                  <span className="category__size">{formatBytes(cat.totalBytes)}</span>
                </div>

                {isOpen && (
                  <div className="category__body">
                    {cat.items.length === 0 ? (
                      <div className="category__empty">Nothing to clean here.</div>
                    ) : (
                      cat.items.map((item) => (
                        <label className="item" key={item.id}>
                          <input
                            type="checkbox"
                            checked={selected.has(item.id)}
                            onChange={() => toggleItem(item.id)}
                          />
                          <div className="item__main">
                            <div className="item__name">{item.name}</div>
                            <div className="item__path" title={item.path}>
                              {abbreviateHome(item.path)}
                              {' · '}
                              {formatCount(item.fileCount)} files
                            </div>
                          </div>
                          <div className="item__size">{formatBytes(item.bytes)}</div>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
              </div>
            );
          })}

          <div className="action-bar">
            <div className="action-bar__summary">
              <span className="action-bar__count">{selectedItems.length}</span> items selected ·{' '}
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

      {state === 'done' && cleanReport && (
        <div className="module__card done-state">
          <div className="done-state__icon">{cleanReport.dryRun ? '◌' : '✓'}</div>
          <h2 className="done-state__title">
            {cleanReport.dryRun
              ? `Would free ${formatBytes(cleanReport.bytesFreed)}`
              : (cleanReport.succeeded === cleanReport.attempted
                  ? `Freed ${formatBytes(cleanReport.bytesFreed)}`
                  : `Freed ${formatBytes(cleanReport.bytesFreed)} (some items skipped)`)}
          </h2>
          <p className="done-state__note">
            {cleanReport.dryRun
              ? 'Dry-run mode is on in Settings → Safety. Nothing was actually removed. Turn it off when you want the cleanup to take effect.'
              : 'Removed items are in your Trash. Empty it from Finder to permanently reclaim disk space.'}
          </p>
          {cleanReport.failed.length > 0 && (
            <details className="done-state__failed">
              <summary>{cleanReport.failed.length} items could not be removed</summary>
              <ul>
                {cleanReport.failed.slice(0, 20).map((f, i) => (
                  <li key={i}><code>{f.path || '(no path)'}</code> — {f.error}</li>
                ))}
                {cleanReport.failed.length > 20 && <li>…and {cleanReport.failed.length - 20} more</li>}
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
        title="Move to Trash?"
        body={
          <>
            <p>
              {selectedItems.length} items totaling <strong>{formatBytes(selectedBytes)}</strong> will
              move to your Trash. You can restore them from Finder any time before emptying the Trash.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Apps will regenerate their caches as you use them.
            </p>
          </>
        }
        confirmLabel={`Move ${formatBytes(selectedBytes)} to Trash`}
        onConfirm={confirmClean}
        onCancel={() => setConfirmOpen(false)}
        busy={cleaning}
      />
    </div>
  );
}
