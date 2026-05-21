import { useEffect, useMemo, useState } from 'react';
import { formatBytes, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useScanScope } from '../store/ScanContext.jsx';

const SORT_OPTIONS = [
  { id: 'size',    label: 'Largest first' },
  { id: 'name',    label: 'A → Z' },
  { id: 'oldest',  label: 'Least recently used' },
];

export function Uninstaller({ isActive = true }) {
  const {
    progress: appsProgress,
    markActive: markAppsActive,
    setResult: setAppsResult,
    requested: appsRequested,
    clearRequest: clearAppsRequest,
  } = useScanScope('apps');
  const { progress: leftoversProgress, markActive: markLeftoversActive } = useScanScope('leftovers');
  const [state, setState] = useState('idle'); // idle, loading, list, done
  const [apps, setApps] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('size');
  const [expandedId, setExpandedId] = useState(null);          // currently-open app row
  const [leftoversByApp, setLeftoversByApp] = useState({});    // bundleId → result
  const [loadingLeftovers, setLoadingLeftovers] = useState({}); // bundleId → bool
  const [selectionByApp, setSelectionByApp] = useState({});    // bundleId → Set<itemId>
  const [confirmFor, setConfirmFor] = useState(null);          // app object
  const [cleaning, setCleaning] = useState(false);
  const [doneReport, setDoneReport] = useState(null);

  async function loadApps() {
    clearAppsRequest();
    setState('loading');
    setError(null);
    markAppsActive(true);
    try {
      const result = await window.api.listApps();
      setApps(result.apps);
      const totalBytes = result.apps.reduce((s, a) => s + (a.bytes || 0), 0);
      setAppsResult({ count: result.apps.length, totalBytes });
      setState('list');
    } catch (err) {
      setError(err.message || String(err));
      setState('idle');
    } finally {
      markAppsActive(false);
    }
  }

  async function expandApp(app) {
    if (expandedId === app.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(app.id);
    if (leftoversByApp[app.bundleId]) return; // cached

    setLoadingLeftovers((prev) => ({ ...prev, [app.bundleId]: true }));
    markLeftoversActive(true);
    try {
      const result = await window.api.findLeftovers(app.bundleId, app.name);
      setLeftoversByApp((prev) => ({ ...prev, [app.bundleId]: result }));
      // Pre-select all leftovers AND the .app bundle.
      const allItemIds = new Set();
      allItemIds.add(`bundle::${app.bundlePath}`);
      for (const g of result.groups) for (const i of g.items) allItemIds.add(i.id);
      setSelectionByApp((prev) => ({ ...prev, [app.bundleId]: allItemIds }));
    } catch (err) {
      setLeftoversByApp((prev) => ({
        ...prev,
        [app.bundleId]: { error: err.message || String(err), groups: [], itemCount: 0, totalBytes: 0 },
      }));
    } finally {
      setLoadingLeftovers((prev) => ({ ...prev, [app.bundleId]: false }));
      markLeftoversActive(false);
    }
  }

  function toggleLeftover(bundleId, itemId) {
    setSelectionByApp((prev) => {
      const cur = new Set(prev[bundleId] || []);
      if (cur.has(itemId)) cur.delete(itemId);
      else cur.add(itemId);
      return { ...prev, [bundleId]: cur };
    });
  }

  function toggleGroup(bundleId, items) {
    setSelectionByApp((prev) => {
      const cur = new Set(prev[bundleId] || []);
      const allChecked = items.every((i) => cur.has(i.id));
      if (allChecked) items.forEach((i) => cur.delete(i.id));
      else items.forEach((i) => cur.add(i.id));
      return { ...prev, [bundleId]: cur };
    });
  }

  function selectionInfo(app) {
    const sel = selectionByApp[app.bundleId] || new Set();
    const leftovers = leftoversByApp[app.bundleId];
    const bundleKey = `bundle::${app.bundlePath}`;
    const includesBundle = sel.has(bundleKey);
    let bytes = includesBundle ? app.bytes : 0;
    let count = includesBundle ? 1 : 0;
    if (leftovers?.groups) {
      for (const g of leftovers.groups) for (const i of g.items) {
        if (sel.has(i.id)) { bytes += i.bytes; count += 1; }
      }
    }
    return { bytes, count, includesBundle };
  }

  async function confirmUninstall() {
    if (!confirmFor) return;
    const app = confirmFor;
    const sel = selectionByApp[app.bundleId] || new Set();
    const leftovers = leftoversByApp[app.bundleId];
    const bundleKey = `bundle::${app.bundlePath}`;
    const paths = [];
    const items = [];
    if (sel.has(bundleKey)) { paths.push(app.bundlePath); items.push({ path: app.bundlePath, bytes: app.bytes }); }
    if (leftovers?.groups) {
      for (const g of leftovers.groups) for (const i of g.items) {
        if (sel.has(i.id)) { paths.push(i.path); items.push({ path: i.path, bytes: i.bytes }); }
      }
    }
    if (paths.length === 0) return;

    setCleaning(true);
    try {
      const results = await window.api.trashItems(paths, { scope: 'apps', items });
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      const dryRun = results.some((r) => r.dryRun);
      setDoneReport({
        app: app.name,
        dryRun,
        attempted: results.length,
        succeeded: okCount,
        failed,
        bytesFreed: paths
          .map((p, idx) => results[idx]?.ok ? (p === app.bundlePath ? app.bytes : findBytesByPath(leftovers, p)) : 0)
          .reduce((s, n) => s + n, 0),
      });
      setConfirmFor(null);
      // Remove the uninstalled app from the list if its bundle was trashed
      if (sel.has(bundleKey) && okCount > 0) {
        setApps((prev) => prev.filter((a) => a.id !== app.id));
      }
      setExpandedId(null);
      setLeftoversByApp((prev) => { const next = { ...prev }; delete next[app.bundleId]; return next; });
      setState('done');
    } catch (err) {
      setDoneReport({ app: app.name, attempted: 0, succeeded: 0, failed: [{ path: '', error: err.message }], bytesFreed: 0 });
      setConfirmFor(null);
      setState('done');
    } finally {
      setCleaning(false);
    }
  }

  function findBytesByPath(leftovers, p) {
    if (!leftovers?.groups) return 0;
    for (const g of leftovers.groups) for (const i of g.items) if (i.path === p) return i.bytes;
    return 0;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = apps;
    if (q) arr = arr.filter((a) =>
      a.name.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q)
    );
    if (sortBy === 'name') arr = [...arr].sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'oldest') {
      arr = [...arr].sort((a, b) => {
        // Items without a lastUsed date sink to the bottom for "least recent" — they're either new or never opened.
        if (!a.lastUsed && !b.lastUsed) return 0;
        if (!a.lastUsed) return 1;
        if (!b.lastUsed) return -1;
        return String(a.lastUsed).localeCompare(String(b.lastUsed));
      });
    }
    // 'size' is the default order from the scanner.
    return arr;
  }, [apps, query, sortBy]);

  // Auto-load on FIRST visit (not on app start — the component now stays
  // mounted across tab switches, so mount happens once at boot regardless
  // of whether the user navigates here). Also fires when the Dashboard
  // requests an `apps` scan via "Scan everything".
  useEffect(() => {
    if (isActive && state === 'idle') loadApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    if (appsRequested && state !== 'loading') loadApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appsRequested]);

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Uninstaller</h1>
        <p className="module__subtitle">
          Remove apps along with their support files, caches, and preferences across ten <code>~/Library</code> subdirectories.
        </p>
      </header>

      {state === 'loading' && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">Listing installed apps…</p>
          <p className="scan-state__hint">
            {appsProgress?.processed != null && appsProgress?.bundleCount != null && (
              <>Read {appsProgress.processed} / {appsProgress.bundleCount}</>
            )}
            {appsProgress?.currentItem && <> · <code>{appsProgress.currentItem}</code></>}
          </p>
        </div>
      )}

      {error && (
        <div className="module__card">
          <div className="module__error">Failed: {error}</div>
          <button className="btn btn--primary" onClick={loadApps} style={{ marginTop: 16 }}>Retry</button>
        </div>
      )}

      {state === 'list' && (
        <>
          <div className="toolbar">
            <input
              className="toolbar__search"
              type="search"
              placeholder="Search apps…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="toolbar__sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className="btn btn--ghost" onClick={loadApps}>Reload</button>
          </div>

          <div className="apps-list">
            {filtered.length === 0 && (
              <div className="apps-empty">
                {query ? 'No apps match your search.' : 'No third-party apps found in /Applications.'}
              </div>
            )}

            {filtered.map((app) => {
              const isOpen = expandedId === app.id;
              const leftovers = leftoversByApp[app.bundleId];
              const loadingLO = loadingLeftovers[app.bundleId];
              const sel = selectionByApp[app.bundleId] || new Set();
              const info = selectionInfo(app);
              return (
                <div key={app.id} className={`app-row ${isOpen ? 'app-row--open' : ''}`}>
                  <button className="app-row__header" onClick={() => expandApp(app)}>
                    <span className={`app-row__chevron ${isOpen ? 'app-row__chevron--open' : ''}`}>›</span>
                    <div className="app-row__main">
                      <div className="app-row__name">{app.name}</div>
                      <div className="app-row__sub">
                        {app.bundleId}
                        {app.version && <> · v{app.version}</>}
                        {app.lastUsed && <> · last used {formatLastUsed(app.lastUsed)}</>}
                      </div>
                    </div>
                    <div className="app-row__size">{formatBytes(app.bytes)}</div>
                  </button>

                  {isOpen && (
                    <div className="app-row__body">
                      {loadingLO && (
                        <div className="app-row__loading">
                          <div className="spinner spinner--small" />
                          {leftoversProgress?.currentItem
                            ? <>Searching <code>{leftoversProgress.currentItem}</code> ({(leftoversProgress.rootIdx || 0) + 1}/{leftoversProgress.rootCount})</>
                            : <>Searching <code>~/Library</code> for leftover files…</>
                          }
                        </div>
                      )}

                      {leftovers && !loadingLO && (
                        <>
                          {/* The app bundle itself */}
                          <div className="lo-group">
                            <div className="lo-group__header">
                              <input
                                type="checkbox"
                                checked={sel.has(`bundle::${app.bundlePath}`)}
                                onChange={() => toggleLeftover(app.bundleId, `bundle::${app.bundlePath}`)}
                              />
                              <span className="lo-group__title">Application bundle</span>
                              <span className="lo-group__size">{formatBytes(app.bytes)}</span>
                            </div>
                            <div className="lo-item lo-item--bundle">
                              <span className="lo-item__name">{app.name}.app</span>
                              <span className="lo-item__path">{abbreviateHome(app.bundlePath)}</span>
                            </div>
                          </div>

                          {leftovers.groups.length === 0 && (
                            <div className="lo-empty">No leftover files found across <code>~/Library</code>.</div>
                          )}

                          {leftovers.groups.map((group) => {
                            const allChecked = group.items.every((i) => sel.has(i.id));
                            const someChecked = group.items.some((i) => sel.has(i.id));
                            return (
                              <div key={group.id} className="lo-group">
                                <div className="lo-group__header">
                                  <input
                                    type="checkbox"
                                    checked={allChecked}
                                    ref={(el) => el && (el.indeterminate = !allChecked && someChecked)}
                                    onChange={() => toggleGroup(app.bundleId, group.items)}
                                  />
                                  <span className="lo-group__title">{group.label}</span>
                                  <span className="lo-group__size">{formatBytes(group.totalBytes)}</span>
                                </div>
                                {group.items.map((item) => (
                                  <label className="lo-item" key={item.id}>
                                    <input
                                      type="checkbox"
                                      checked={sel.has(item.id)}
                                      onChange={() => toggleLeftover(app.bundleId, item.id)}
                                    />
                                    <span className="lo-item__name">{item.name}</span>
                                    <span className="lo-item__path" title={item.path}>{abbreviateHome(item.path)}</span>
                                    <span className="lo-item__size">{formatBytes(item.bytes)}</span>
                                  </label>
                                ))}
                              </div>
                            );
                          })}

                          <div className="app-row__actions">
                            <div className="app-row__selection">
                              <strong>{info.count}</strong> items selected ·{' '}
                              <strong>{formatBytes(info.bytes)}</strong>
                            </div>
                            <button
                              className="btn btn--primary"
                              disabled={info.count === 0}
                              onClick={() => setConfirmFor(app)}
                            >
                              Move to Trash
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {state === 'done' && doneReport && (
        <div className="module__card done-state">
          <div className="done-state__icon">{doneReport.dryRun ? '◌' : '✓'}</div>
          <h2 className="done-state__title">
            {doneReport.dryRun
              ? `Would uninstall ${doneReport.app} · free ${formatBytes(doneReport.bytesFreed)}`
              : `Removed ${doneReport.app} · freed ${formatBytes(doneReport.bytesFreed)}`}
          </h2>
          <p className="done-state__note">
            {doneReport.dryRun
              ? 'Dry-run mode is on. Nothing was actually removed — turn it off in Settings → Safety to uninstall for real.'
              : <>{doneReport.succeeded} of {doneReport.attempted} items moved to Trash. Restore from Finder if needed.</>}
          </p>
          {doneReport.failed.length > 0 && (
            <details className="done-state__failed">
              <summary>{doneReport.failed.length} items could not be removed</summary>
              <ul>
                {doneReport.failed.map((f, i) => (
                  <li key={i}><code>{f.path || '(no path)'}</code> — {f.error}</li>
                ))}
              </ul>
            </details>
          )}
          <button className="btn btn--primary" onClick={() => { setDoneReport(null); setState('list'); }} style={{ marginTop: 20 }}>
            Back to apps
          </button>
        </div>
      )}

      <ConfirmModal
        open={!!confirmFor}
        title={`Uninstall ${confirmFor?.name}?`}
        body={
          confirmFor && (
            <>
              <p>
                {selectionInfo(confirmFor).count} items totaling{' '}
                <strong>{formatBytes(selectionInfo(confirmFor).bytes)}</strong> will move to your Trash.
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {selectionInfo(confirmFor).includesBundle
                  ? 'The app itself plus its support files, preferences, and caches.'
                  : 'Leftover files only — the application bundle will stay where it is.'}
              </p>
            </>
          )
        }
        confirmLabel="Move to Trash"
        onConfirm={confirmUninstall}
        onCancel={() => setConfirmFor(null)}
        busy={cleaning}
      />
    </div>
  );
}

function formatLastUsed(raw) {
  if (!raw) return 'never';
  // Format from mdls is "2024-05-12 14:23:11 +0000"
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(raw);
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}`);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
