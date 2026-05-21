import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useScanScope } from '../store/ScanContext.jsx';

// Finds heavy regenerable dirs (node_modules, target, .venv, Pods, …) that
// sit next to a project whose source hasn't changed in months. Reuses the
// same picked-roots as Duplicates, so heavy dirs inside picked folders are
// trash-able through the runtime allowlist.

function idleLabel(days) {
  if (days == null) return 'unknown age';
  if (days >= 365) return `idle ${(days / 365).toFixed(1)} yr`;
  if (days >= 60) return `idle ${Math.round(days / 30)} mo`;
  return `idle ${days} d`;
}

export function StaleProjects() {
  const { progress, markActive, setResult, requested, clearRequest } = useScanScope('stale-projects');
  const [state, setState] = useState('idle'); // idle, scanning, results, done
  const [roots, setRoots] = useState([]);
  const [scan, setScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [rejectedRoots, setRejectedRoots] = useState([]);
  // selected: projectId -> Set(heavyDirPath) chosen for removal.
  const [selected, setSelected] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanReport, setCleanReport] = useState(null);

  useEffect(() => {
    window.api.listPickedRoots?.().then(setRoots).catch(() => {});
  }, []);

  async function pickMore() {
    setRejectedRoots([]);
    const result = await window.api.pickFolders();
    if (result.canceled) return;
    if (result.accepted.length > 0) {
      setRoots((prev) => {
        const set = new Set(prev);
        for (const p of result.accepted) set.add(p);
        return [...set];
      });
    }
    if (result.rejected.length > 0) setRejectedRoots(result.rejected);
  }

  function removeRoot(p) {
    setRoots((prev) => prev.filter((r) => r !== p));
  }

  async function runScan() {
    if (roots.length === 0) return;
    clearRequest();
    setState('scanning');
    setScanError(null);
    setScan(null);
    setSelected({});
    setExpanded(new Set());
    markActive(true);
    try {
      const result = await window.api.scanStaleProjects(roots);
      setScan(result);
      // Default: select every heavy dir in every project.
      const sel = {};
      for (const p of result.projects) sel[p.id] = new Set(p.heavyDirs.map((h) => h.path));
      setSelected(sel);
      if (result.projects.length > 0) setExpanded(new Set([result.projects[0].id]));
      setResult({
        projectCount: result.projectCount,
        reclaimable: result.totalReclaimable,
        totalBytes: result.totalReclaimable,
        visited: result.visitedDirs,
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
    if (requested && state !== 'scanning' && roots.length > 0) runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleHeavy(projectId, heavyPath) {
    setSelected((prev) => {
      const cur = new Set(prev[projectId] || []);
      cur.has(heavyPath) ? cur.delete(heavyPath) : cur.add(heavyPath);
      return { ...prev, [projectId]: cur };
    });
  }

  // Flatten selected heavy dirs into a removal list.
  const toRemove = useMemo(() => {
    if (!scan) return [];
    const out = [];
    for (const p of scan.projects) {
      const sel = selected[p.id];
      if (!sel) continue;
      for (const h of p.heavyDirs) {
        if (sel.has(h.path)) out.push({ path: h.path, bytes: h.bytes });
      }
    }
    return out;
  }, [scan, selected]);

  const toRemoveBytes = toRemove.reduce((s, x) => s + x.bytes, 0);

  async function confirmClean() {
    setCleaning(true);
    try {
      const paths = toRemove.map((x) => x.path);
      const results = await window.api.trashItems(paths);
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      const dryRun = results.some((r) => r.dryRun);
      const bytesFreed = toRemove
        .filter((_, i) => results[i]?.ok)
        .reduce((s, x) => s + x.bytes, 0);
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
    setSelected({});
    setExpanded(new Set());
    setCleanReport(null);
    setState('idle');
  }

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Stale Projects</h1>
        <p className="module__subtitle">
          Finds <code>node_modules</code>, <code>target</code>, <code>.venv</code>, build outputs and the like
          next to projects you haven't touched in months. They regenerate from source, so they're safe to reclaim.
        </p>
      </header>

      <div className="module__card" style={{ marginBottom: 16 }}>
        <div className="dup-roots-header">
          <span className="dup-roots-title">Folders to search</span>
          <button className="btn btn--ghost" onClick={pickMore}>+ Add folder</button>
        </div>
        {roots.length === 0 ? (
          <div className="dup-roots-empty">
            Click <strong>Add folder</strong> to pick where your code lives (e.g. <code>~/Developer</code>,
            <code>~/Projects</code>). Folders shared with Duplicates appear here too.
          </div>
        ) : (
          <div className="dup-roots-chips">
            {roots.map((r) => (
              <div key={r} className="dup-chip">
                <span className="dup-chip__label" title={r}>{abbreviateHome(r)}</span>
                <button className="dup-chip__remove" onClick={() => removeRoot(r)} title="Remove">×</button>
              </div>
            ))}
          </div>
        )}
        {rejectedRoots.length > 0 && (
          <div className="module__error" style={{ marginTop: 12 }}>
            Rejected:
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {rejectedRoots.map((r, i) => (
                <li key={i}><code>{r.path}</code> — {r.reason}</li>
              ))}
            </ul>
          </div>
        )}
        {state !== 'scanning' && (
          <button className="module__cta" onClick={runScan} disabled={roots.length === 0} style={{ marginTop: 16 }}>
            {scan ? 'Rescan' : 'Find stale projects'}
          </button>
        )}
        {scanError && <div className="module__error">Scan failed: {scanError}</div>}
      </div>

      {state === 'scanning' && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">Searching for stale projects…</p>
          <p className="scan-state__hint">
            {progress?.currentItem && <><code>{progress.currentItem}</code> · </>}
            {formatCount(progress?.visited || 0)} folders · {formatCount(progress?.found || 0)} flagged
          </p>
        </div>
      )}

      {state === 'results' && scan && (
        <>
          <div className="results-summary">
            <div>
              <div className="results-summary__bignum">{formatBytes(scan.totalReclaimable)}</div>
              <div className="results-summary__label">
                reclaimable across {formatCount(scan.projectCount)} stale project{scan.projectCount === 1 ? '' : 's'}
                {' · '}idle ≥ {scan.minAgeDays} days
                {' · '}{formatCount(scan.visitedDirs)} folders scanned in {(scan.durationMs / 1000).toFixed(1)}s
              </div>
            </div>
          </div>

          {scan.projects.length === 0 ? (
            <div className="empty-state">
              No stale projects found. Everything here has been touched recently, or the heavy dirs are small.
            </div>
          ) : (
            <>
              <div className="dup-groups">
                {scan.projects.slice(0, 200).map((p) => {
                  const isOpen = expanded.has(p.id);
                  const sel = selected[p.id] || new Set();
                  const selBytes = p.heavyDirs.filter((h) => sel.has(h.path)).reduce((s, h) => s + h.bytes, 0);
                  return (
                    <div key={p.id} className="dup-group">
                      <button className="dup-group__header" onClick={() => toggleExpand(p.id)}>
                        <span className={`category__chevron ${isOpen ? 'category__chevron--open' : ''}`}>›</span>
                        <span className="dup-group__main">
                          <span className="dup-group__name">
                            {p.name}
                            {p.markers.length > 0 && <span className="stale-badge">{p.markers[0]}</span>}
                            <span className="stale-idle">{idleLabel(p.idleDays)}</span>
                          </span>
                          <span className="dup-group__keeper">
                            <code>{p.displayPath}</code> · {p.heavyDirs.length} dir{p.heavyDirs.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="dup-group__reclaim">{formatBytes(selBytes)}</span>
                      </button>
                      {isOpen && (
                        <div className="dup-group__body">
                          {p.heavyDirs.map((h) => {
                            const checked = sel.has(h.path);
                            return (
                              <label className={`dup-copy ${checked ? 'dup-copy--keeper' : ''}`} key={h.path}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleHeavy(p.id, h.path)}
                                />
                                <span className="dup-copy__path" title={h.path}>{h.name}</span>
                                <span className="dup-copy__meta">
                                  {formatBytes(h.bytes)} · {formatCount(h.fileCount)} files
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {scan.projects.length > 200 && (
                  <div className="file-table__more">
                    Showing the 200 biggest of {formatCount(scan.projects.length)} stale projects.
                  </div>
                )}
              </div>

              <div className="action-bar">
                <div className="action-bar__summary">
                  <span className="action-bar__count">{toRemove.length}</span> dirs to remove ·{' '}
                  <strong>{formatBytes(toRemoveBytes)}</strong>
                </div>
                <button
                  className="btn btn--primary"
                  disabled={toRemove.length === 0}
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
              : `Freed ${formatBytes(cleanReport.bytesFreed)}`}
          </h2>
          <p className="done-state__note">
            {cleanReport.dryRun
              ? 'Dry-run mode is on — nothing was actually removed. Toggle it off in Settings → Safety.'
              : <>Moved {cleanReport.succeeded} of {cleanReport.attempted} directories to Trash. They regenerate next time you build or install.</>}
          </p>
          {cleanReport.failed.length > 0 && (
            <details className="done-state__failed">
              <summary>{cleanReport.failed.length} items could not be removed</summary>
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
        title="Move these directories to Trash?"
        body={
          <>
            <p>
              <strong>{toRemove.length}</strong> regenerable director{toRemove.length === 1 ? 'y' : 'ies'} totaling{' '}
              <strong>{formatBytes(toRemoveBytes)}</strong> will move to your Trash.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              These rebuild from source the next time you run a build or install dependencies. Your source code is untouched.
            </p>
          </>
        }
        confirmLabel={`Move ${toRemove.length} to Trash`}
        onConfirm={confirmClean}
        onCancel={() => setConfirmOpen(false)}
        busy={cleaning}
      />
    </div>
  );
}
