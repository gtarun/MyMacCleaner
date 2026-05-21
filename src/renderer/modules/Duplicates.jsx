import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useScanScope } from '../store/ScanContext.jsx';

// Pretty labels for each scanner phase. Used in the inline status row.
const PHASE_LABEL = {
  walking: 'Walking folders',
  'partial-hashing': 'Hashing fingerprints (first/last 64 KB)',
  'full-hashing': 'Computing full SHA-256 for matches',
};

export function Duplicates() {
  const { progress, markActive, setResult, requested, clearRequest } = useScanScope('duplicates');
  const [state, setState] = useState('idle'); // idle, scanning, results, done
  const [roots, setRoots] = useState([]);
  const [scan, setScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [rejectedRoots, setRejectedRoots] = useState([]);
  // keeperByGroup: groupId -> path of the copy to KEEP (others get trashed).
  const [keeperByGroup, setKeeperByGroup] = useState({});
  // expanded: set of group ids that are open in the UI.
  const [expanded, setExpanded] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanReport, setCleanReport] = useState(null);

  // Restore any roots the user previously picked in this session.
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
    setKeeperByGroup({});
    setExpanded(new Set());
    markActive(true);
    try {
      const result = await window.api.scanDuplicates(roots);
      setScan(result);
      // Initial keepers: oldest copy of each group (scanner already
      // sorted copies by mtime ascending).
      const keepers = {};
      for (const g of result.groups) keepers[g.id] = g.copies[0]?.path;
      setKeeperByGroup(keepers);
      // Expand the biggest group by default — the user usually wants to
      // see what the largest set of duplicates actually is.
      if (result.groups.length > 0) setExpanded(new Set([result.groups[0].id]));
      setResult({
        groupCount: result.groups.length,
        reclaimable: result.totalReclaimable,
        duplicateFiles: result.totalDuplicateFiles,
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
    if (requested && state !== 'scanning' && roots.length > 0) runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  function setKeeper(groupId, path) {
    setKeeperByGroup((prev) => ({ ...prev, [groupId]: path }));
  }

  function toggleExpand(groupId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  // Files marked for removal = everything except the keeper in each group.
  const toRemove = useMemo(() => {
    if (!scan) return [];
    const out = [];
    for (const g of scan.groups) {
      const keeper = keeperByGroup[g.id];
      for (const c of g.copies) {
        if (c.path !== keeper) out.push({ groupId: g.id, path: c.path, bytes: g.bytes });
      }
    }
    return out;
  }, [scan, keeperByGroup]);

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
    setKeeperByGroup({});
    setExpanded(new Set());
    setCleanReport(null);
    setState('idle');
  }

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Duplicate Files</h1>
        <p className="module__subtitle">
          Three-stage match (size → 64 KB fingerprint → full SHA-256). Only byte-identical copies are reported.
        </p>
      </header>

      {/* Folder picker — always visible, even on results page, so the user
          can adjust their scope and rescan. */}
      <div className="module__card" style={{ marginBottom: 16 }}>
        <div className="dup-roots-header">
          <span className="dup-roots-title">Folders to scan</span>
          <button className="btn btn--ghost" onClick={pickMore}>+ Add folder</button>
        </div>
        {roots.length === 0 ? (
          <div className="dup-roots-empty">
            Click <strong>Add folder</strong> to pick directories. Folders are scanned recursively but bundles
            (<code>.app</code>, <code>.photoslibrary</code>) and hidden folders are skipped.
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
          <button
            className="module__cta"
            onClick={runScan}
            disabled={roots.length === 0}
            style={{ marginTop: 16 }}
          >
            {scan ? 'Rescan' : 'Find duplicates'}
          </button>
        )}
        {scanError && <div className="module__error">Scan failed: {scanError}</div>}
      </div>

      {state === 'scanning' && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">
            {PHASE_LABEL[progress?.phase] || 'Starting…'}
          </p>
          <p className="scan-state__hint">
            {progress?.phase === 'walking' && progress?.currentRoot && (
              <><code>{progress.currentRoot}</code> · {formatCount(progress.visited || 0)} files</>
            )}
            {(progress?.phase === 'partial-hashing' || progress?.phase === 'full-hashing') && (
              <>{progress.done || 0} / {progress.totalCandidates || 0} candidates</>
            )}
          </p>
        </div>
      )}

      {state === 'results' && scan && (
        <>
          <div className="results-summary">
            <div>
              <div className="results-summary__bignum">{formatBytes(scan.totalReclaimable)}</div>
              <div className="results-summary__label">
                reclaimable across {formatCount(scan.groups.length)} duplicate sets
                {' · '}{formatCount(scan.visitedCount)} files compared in {(scan.durationMs / 1000).toFixed(1)}s
              </div>
            </div>
          </div>

          {scan.groups.length === 0 ? (
            <div className="empty-state">
              No duplicates found. Try adding more folders or different roots.
            </div>
          ) : (
            <>
              <div className="dup-groups">
                {scan.groups.slice(0, 200).map((g) => {
                  const isOpen = expanded.has(g.id);
                  const keeper = keeperByGroup[g.id];
                  return (
                    <div key={g.id} className="dup-group">
                      <button className="dup-group__header" onClick={() => toggleExpand(g.id)}>
                        <span className={`category__chevron ${isOpen ? 'category__chevron--open' : ''}`}>›</span>
                        <span className="dup-group__main">
                          <span className="dup-group__name">
                            {g.copies.length} copies × {formatBytes(g.bytes)}
                          </span>
                          <span className="dup-group__keeper">
                            keeping <code>{abbreviateHome(keeper || g.copies[0].path)}</code>
                          </span>
                        </span>
                        <span className="dup-group__reclaim">{formatBytes(g.reclaimable)}</span>
                      </button>
                      {isOpen && (
                        <div className="dup-group__body">
                          {g.copies.map((c) => {
                            const isKeeper = c.path === keeper;
                            return (
                              <label className={`dup-copy ${isKeeper ? 'dup-copy--keeper' : ''}`} key={c.path}>
                                <input
                                  type="radio"
                                  name={`keeper-${g.id}`}
                                  checked={isKeeper}
                                  onChange={() => setKeeper(g.id, c.path)}
                                />
                                <span className="dup-copy__path" title={c.path}>{abbreviateHome(c.path)}</span>
                                <span className="dup-copy__meta">
                                  {isKeeper ? 'KEEP' : 'remove'}
                                  {' · '}
                                  modified {formatDate(c.mtimeMs)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {scan.groups.length > 200 && (
                  <div className="file-table__more">
                    Showing the 200 biggest duplicate sets out of {formatCount(scan.groups.length)}.
                  </div>
                )}
              </div>

              <div className="action-bar">
                <div className="action-bar__summary">
                  <span className="action-bar__count">{toRemove.length}</span> copies to remove ·{' '}
                  <strong>{formatBytes(toRemoveBytes)}</strong>
                </div>
                <button
                  className="btn btn--primary"
                  disabled={toRemove.length === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  Move duplicates to Trash
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
              ? 'Dry-run mode is on — no copies were actually removed. Toggle it off in Settings → Safety.'
              : <>Removed {cleanReport.succeeded} of {cleanReport.attempted} duplicate copies. Originals stay where they were.</>}
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
        title="Move duplicate copies to Trash?"
        body={
          <>
            <p>
              <strong>{toRemove.length}</strong> non-keeper copies totaling{' '}
              <strong>{formatBytes(toRemoveBytes)}</strong> will move to your Trash.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              One copy of each duplicate set stays exactly where it is.
            </p>
          </>
        }
        confirmLabel={`Move ${toRemove.length} copies to Trash`}
        onConfirm={confirmClean}
        onCancel={() => setConfirmOpen(false)}
        busy={cleaning}
      />
    </div>
  );
}

function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}
