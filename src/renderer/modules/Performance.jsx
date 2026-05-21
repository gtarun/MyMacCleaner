import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatCount } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';

// Live process table. Polls processes:list every 2 seconds while the
// tab is visible. Renders sortable + filterable rows, lets the user
// kill non-protected processes with SIGTERM (or force-kill with SIGKILL).
//
// Recommendations are computed from the same snapshot — top RAM hog,
// top CPU hog, count of multi-GB background apps, etc.

const SORT_OPTIONS = [
  { id: 'mem', label: 'Memory (high → low)' },
  { id: 'cpu', label: 'CPU (high → low)' },
];

function formatCpu(n) { return `${n.toFixed(n < 10 ? 1 : 0)}%`; }
function formatMem(p) { return `${formatBytes(p.rssBytes)} · ${p.mem.toFixed(1)}%`; }

export function Performance({ isActive }) {
  const [snapshot, setSnapshot] = useState(null);
  const [sortBy, setSortBy] = useState('mem');
  const [query, setQuery] = useState('');
  const [killTarget, setKillTarget] = useState(null);
  const [killForce, setKillForce] = useState(false);
  const [killReport, setKillReport] = useState(null);
  const [error, setError] = useState(null);

  // Poll every 2s while visible. Pause when navigated away so we don't
  // pile up `ps` invocations in the background.
  useEffect(() => {
    if (!isActive) return undefined;
    let alive = true;
    async function tick() {
      try {
        const r = await window.api.listProcesses({ limit: 80, sortBy });
        if (alive) setSnapshot(r);
      } catch (err) {
        if (alive) setError(err.message || String(err));
      }
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [isActive, sortBy]);

  const items = useMemo(() => {
    if (!snapshot?.items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return snapshot.items;
    return snapshot.items.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.command.toLowerCase().includes(q) ||
      String(p.pid).includes(q),
    );
  }, [snapshot, query]);

  const totals = useMemo(() => {
    if (!snapshot?.items) return { cpu: 0, mem: 0, rssBytes: 0 };
    return snapshot.items.reduce(
      (acc, p) => ({ cpu: acc.cpu + p.cpu, mem: acc.mem + p.mem, rssBytes: acc.rssBytes + p.rssBytes }),
      { cpu: 0, mem: 0, rssBytes: 0 },
    );
  }, [snapshot]);

  const recs = useMemo(() => buildRecommendations(snapshot?.items || []), [snapshot]);

  async function doKill() {
    if (!killTarget) return;
    const r = await window.api.killProcess(killTarget.pid, killForce);
    setKillReport(r);
    setKillTarget(null);
    setKillForce(false);
    // Refresh immediately after a kill so the row disappears (or persists
    // with a flag) without waiting for the next tick.
    try {
      const next = await window.api.listProcesses({ limit: 80, sortBy });
      setSnapshot(next);
    } catch { /* ignore */ }
  }

  function requestKill(proc, force = false) {
    setKillTarget(proc);
    setKillForce(force);
  }

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Performance</h1>
        <p className="module__subtitle">
          Live snapshot of what's using your CPU and memory right now. Quit anything
          you don't need to free up resources.
        </p>
      </header>

      {error && <div className="module__error">{error}</div>}

      <div className="perf-totals">
        <div className="perf-total">
          <div className="perf-total__label">CPU (aggregate)</div>
          <div className="perf-total__value">{formatCpu(totals.cpu)}</div>
        </div>
        <div className="perf-total">
          <div className="perf-total__label">Memory used by processes</div>
          <div className="perf-total__value">{formatBytes(totals.rssBytes)}</div>
        </div>
        <div className="perf-total">
          <div className="perf-total__label">Processes</div>
          <div className="perf-total__value">{formatCount(snapshot?.items.length || 0)}</div>
        </div>
      </div>

      {recs.length > 0 && (
        <div className="perf-recs">
          {recs.map((r) => (
            <div key={r.id} className={`perf-rec perf-rec--${r.severity}`}>
              <div className="perf-rec__main">
                <div className="perf-rec__title">{r.title}</div>
                <div className="perf-rec__detail">{r.detail}</div>
              </div>
              {r.action && (
                <button className="btn btn--accent" onClick={() => requestKill(r.action.proc, false)}>
                  {r.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <input
          className="toolbar__search"
          type="search"
          placeholder="Filter by name, command, or PID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="toolbar__sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="proc-table">
        <div className="proc-table__head">
          <span>Process</span>
          <span style={{ textAlign: 'right' }}>PID</span>
          <span style={{ textAlign: 'right' }}>CPU</span>
          <span style={{ textAlign: 'right' }}>Memory</span>
          <span />
        </div>
        {items.length === 0 ? (
          <div className="proc-table__empty">
            {snapshot ? 'No matches.' : 'Loading processes…'}
          </div>
        ) : (
          items.map((p) => (
            <div key={p.pid} className={`proc-row ${p.protected ? 'proc-row--protected' : ''}`}>
              <div className="proc-row__name" title={p.fullCommand}>
                <div className="proc-row__title">{p.name}</div>
                <div className="proc-row__sub">{p.user} · {p.command}</div>
              </div>
              <div className="proc-row__pid">{p.pid}</div>
              <div className={`proc-row__cpu ${p.cpu > 60 ? 'proc-row__cpu--hot' : ''}`}>
                {formatCpu(p.cpu)}
              </div>
              <div className="proc-row__mem">{formatMem(p)}</div>
              <div className="proc-row__actions">
                <button
                  className="btn btn--ghost"
                  disabled={p.protected}
                  title={p.protected ? 'Protected system process' : 'Quit (SIGTERM)'}
                  onClick={() => requestKill(p, false)}
                >
                  Quit
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {killReport && (
        <div className={`module__error ${killReport.ok ? '' : ''}`} style={{
          marginTop: 16,
          background: killReport.ok ? 'rgba(52, 199, 89, 0.08)' : undefined,
          borderColor: killReport.ok ? 'rgba(52, 199, 89, 0.3)' : undefined,
          color: killReport.ok ? '#a4ecb8' : undefined,
        }}>
          {killReport.ok
            ? `Sent ${killReport.signal} to ${killReport.name} (pid ${killReport.pid})`
            : `Kill failed: ${killReport.error}`}
        </div>
      )}

      <ConfirmModal
        open={!!killTarget}
        title={`Quit ${killTarget?.name || 'this process'}?`}
        body={
          killTarget && (
            <>
              <p>
                {killForce
                  ? <>Force-quit <strong>{killTarget.name}</strong> (pid {killTarget.pid}) with SIGKILL. <strong>Unsaved work will be lost.</strong></>
                  : <>Quit <strong>{killTarget.name}</strong> (pid {killTarget.pid}) gracefully with SIGTERM. The app gets a chance to save state.</>}
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {killTarget.user} · using {formatBytes(killTarget.rssBytes)} RAM and {formatCpu(killTarget.cpu)} CPU
              </p>
            </>
          )
        }
        confirmLabel={killForce ? 'Force quit' : 'Quit'}
        onConfirm={doKill}
        onCancel={() => { setKillTarget(null); setKillForce(false); }}
        busy={false}
      />
    </div>
  );
}

function buildRecommendations(items) {
  if (!items?.length) return [];
  const recs = [];

  // Single top RAM hog over 4 GB.
  const sortedByMem = [...items].sort((a, b) => b.rssBytes - a.rssBytes);
  const topMem = sortedByMem[0];
  if (topMem && !topMem.protected && topMem.rssBytes > 4 * 1024 * 1024 * 1024) {
    recs.push({
      id: 'top-mem',
      severity: 'warn',
      title: `${topMem.name} is using ${formatBytes(topMem.rssBytes)} of RAM`,
      detail: `That's a lot for one app. Closing background tabs or quitting it will free up memory immediately.`,
      action: { label: `Quit ${topMem.name}`, proc: topMem },
    });
  }

  // Hot CPU process (>70% sustained — we only see this tick, but it's a useful signal).
  const cpuHogs = items.filter((p) => p.cpu > 70 && !p.protected);
  if (cpuHogs.length > 0) {
    const hog = cpuHogs[0];
    recs.push({
      id: 'top-cpu',
      severity: 'warn',
      title: `${hog.name} is using ${formatCpu(hog.cpu)} CPU`,
      detail: 'Sustained high CPU drains the battery and slows everything else. Quit it if you can.',
      action: { label: `Quit ${hog.name}`, proc: hog },
    });
  }

  // Many large processes — clutter signal.
  const big = items.filter((p) => p.rssBytes > 1024 * 1024 * 1024 && !p.protected);
  if (big.length >= 5) {
    const total = big.reduce((s, p) => s + p.rssBytes, 0);
    recs.push({
      id: 'many-big',
      severity: 'info',
      title: `${big.length} apps are each using over 1 GB`,
      detail: `Combined RAM footprint: ${formatBytes(total)}. Quitting the ones you're not using will help if memory is tight.`,
    });
  }

  return recs;
}
