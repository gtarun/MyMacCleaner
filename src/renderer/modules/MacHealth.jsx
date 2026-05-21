import { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format.js';
import { useScans } from '../store/ScanContext.jsx';
import { RingChart } from '../components/RingChart.jsx';

function formatUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function verdictColor(verdict) {
  if (verdict === 'Needs attention') return '#ff5b52';
  if (verdict === 'Good') return '#ffcc02';
  return '#34c759';
}

function relTime(ms) {
  if (!ms) return null;
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// Heuristics: turn ScanContext results + raw health metrics into
// human-readable recommendations the user can act on.
function buildRecommendations(health, results, setActiveTab) {
  const recs = [];

  if (health?.disk && health.disk.percentUsed >= 0.85) {
    recs.push({
      severity: 'warn',
      title: `Disk is ${Math.round(health.disk.percentUsed * 100)}% full`,
      detail: `${formatBytes(health.disk.freeBytes)} free of ${formatBytes(health.disk.totalBytes)}. Run a Smart Scan to see what can be reclaimed.`,
      action: { label: 'Open Dashboard', tab: 'dashboard' },
    });
  }

  if (health?.memory?.percentUsed >= 0.92) {
    recs.push({
      severity: 'warn',
      title: 'Memory pressure is high',
      detail: 'Closing memory-hungry apps will improve responsiveness immediately.',
    });
  }

  const sj = results['system-junk'];
  if (sj && sj.totalBytes >= 2 * 1024 * 1024 * 1024) {
    recs.push({
      severity: 'info',
      title: `${formatBytes(sj.totalBytes)} of System Junk`,
      detail: `${sj.itemCount} cache and log items can be moved to Trash safely.`,
      action: { label: 'Clean now', tab: 'system-junk' },
    });
  }

  const lo = results['large-old'];
  if (lo && lo.flaggedCount > 0) {
    recs.push({
      severity: 'info',
      title: `${lo.flaggedCount} files flagged`,
      detail: `Large or stale files totalling ${formatBytes(lo.totalBytes)} are worth a review.`,
      action: { label: 'Review', tab: 'large-old' },
    });
  }

  const dup = results['duplicates'];
  if (dup && dup.reclaimable > 0) {
    recs.push({
      severity: 'info',
      title: `${formatBytes(dup.reclaimable)} of duplicate copies`,
      detail: `${dup.groupCount} duplicate sets — keep one copy of each and trash the rest.`,
      action: { label: 'Review', tab: 'duplicates' },
    });
  }

  // No scans yet → nudge to run one.
  const anyScanned = Object.keys(results).length > 0;
  if (!anyScanned && recs.length === 0) {
    recs.push({
      severity: 'info',
      title: 'Run a Smart Scan',
      detail: 'You haven\'t scanned this Mac yet. Smart Scan checks every cleaner module at once.',
      action: { label: 'Open Dashboard', tab: 'dashboard' },
    });
  }

  return recs;
}

export function MacHealth({ isActive, setActiveTab }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const { results } = useScans();

  // Initial fetch + refresh every 5s while the tab is visible. We bail
  // out of the polling loop when navigating away so we're not waking the
  // main process for nothing.
  useEffect(() => {
    if (!isActive) return undefined;
    let mounted = true;
    async function tick() {
      try {
        const h = await window.api.getHealth();
        if (mounted) setHealth(h);
      } catch (err) {
        if (mounted) setError(err.message || String(err));
      }
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, [isActive]);

  const recs = buildRecommendations(health, results, setActiveTab);

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Mac Health</h1>
        <p className="module__subtitle">
          A live snapshot of disk, memory, CPU, and any cleanup opportunities the scanners surfaced.
        </p>
      </header>

      {error && <div className="module__error">Health snapshot failed: {error}</div>}

      {/* Hero row — host card on the left, verdict pill on the right. */}
      <div className="health-hero">
        <div className="health-hero__main">
          <div className="health-hero__label">This Mac</div>
          <div className="health-hero__name">{health?.host?.hostname || '—'}</div>
          <div className="health-hero__sub">
            {health?.host?.model
              ? <>{health.host.model} · {health?.host?.name} {health?.host?.version}</>
              : 'Gathering snapshot…'}
          </div>
          {health?.uptime && (
            <div className="health-hero__uptime">
              Up for {formatUptime(health.uptime.seconds)}
            </div>
          )}
        </div>
        <div className="health-hero__verdict" style={{ '--verdict-color': verdictColor(health?.verdict) }}>
          <div className="health-hero__verdict-dot" />
          <div className="health-hero__verdict-text">
            <div className="health-hero__verdict-label">Status</div>
            <div className="health-hero__verdict-value">{health?.verdict || '—'}</div>
          </div>
        </div>
      </div>

      {/* 4-up metric grid */}
      <div className="health-grid">
        <div className="health-card">
          <div className="health-card__title">Disk</div>
          {health?.disk ? (
            <>
              <div className="health-card__ring">
                <RingChart
                  percent={health.disk.percentUsed}
                  label={`${Math.round(health.disk.percentUsed * 100)}%`}
                  color="var(--acc-blue)"
                />
              </div>
              <div className="health-card__detail">
                <strong>{formatBytes(health.disk.usedBytes)}</strong> used
                <span> · {formatBytes(health.disk.freeBytes)} free</span>
              </div>
              <div className="health-card__sub">of {formatBytes(health.disk.totalBytes)} · {health.disk.mountPath}</div>
            </>
          ) : (
            <div className="health-card__empty">Gathering…</div>
          )}
        </div>

        <div className="health-card">
          <div className="health-card__title">Memory</div>
          <div className="health-card__ring">
            <RingChart
              percent={health?.memory?.percentUsed || 0}
              label={`${Math.round((health?.memory?.percentUsed || 0) * 100)}%`}
              color="var(--acc-green)"
            />
          </div>
          <div className="health-card__detail">
            <strong>{formatBytes(health?.memory?.usedBytes || 0)}</strong> used
            <span> · {formatBytes(health?.memory?.freeBytes || 0)} free</span>
          </div>
          <div className="health-card__sub">of {formatBytes(health?.memory?.totalBytes || 0)}</div>
        </div>

        <div className="health-card">
          <div className="health-card__title">CPU</div>
          {health?.cpu ? (
            <>
              <div className="health-card__bignum">{health.cpu.cores}<span>cores</span></div>
              <div className="health-card__detail">{health.cpu.model.replace(/\s+@.*$/, '')}</div>
              <div className="health-card__sub">
                load {health.cpu.load1.toFixed(2)} · {health.cpu.load5.toFixed(2)} · {health.cpu.load15.toFixed(2)}
              </div>
            </>
          ) : (
            <div className="health-card__empty">Gathering…</div>
          )}
        </div>

        <div className="health-card">
          <div className="health-card__title">Uptime</div>
          {health?.uptime ? (
            <>
              <div className="health-card__bignum">{formatUptime(health.uptime.seconds)}</div>
              <div className="health-card__detail">
                booted {new Date(health.uptime.bootedAt).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}
              </div>
              <div className="health-card__sub">
                regular reboots keep macOS healthy
              </div>
            </>
          ) : (
            <div className="health-card__empty">Gathering…</div>
          )}
        </div>
      </div>

      {/* Recommendations */}
      <div className="health-recs">
        <div className="health-recs__title">Recommendations</div>
        {recs.length === 0 ? (
          <div className="health-recs__empty">Nothing to flag — everything looks good.</div>
        ) : (
          recs.map((r, i) => (
            <div key={i} className={`health-rec health-rec--${r.severity}`}>
              <div className="health-rec__main">
                <div className="health-rec__title">{r.title}</div>
                <div className="health-rec__detail">{r.detail}</div>
              </div>
              {r.action && (
                <button className="btn btn--primary" onClick={() => setActiveTab(r.action.tab)}>
                  {r.action.label}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Per-module last-scan timestamps — keeps history visible without
          requiring the user to dig into Settings. */}
      <div className="health-history">
        <div className="health-history__title">Recent scans</div>
        {['system-junk', 'large-old', 'apps', 'duplicates'].map((scope) => {
          const r = results[scope];
          const label = ({
            'system-junk': 'System Junk',
            'large-old':   'Large & Old Files',
            'apps':        'Uninstaller',
            'duplicates':  'Duplicates',
          })[scope];
          return (
            <div key={scope} className="health-history__row">
              <span className="health-history__label">{label}</span>
              <span className="health-history__detail">{r ? relTime(r.recordedAt) : 'not scanned yet'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
