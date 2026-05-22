import { useMemo, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useScanScope } from '../store/ScanContext.jsx';

// System Data explorer. Surfaces the big, opaque places macOS files under
// "System Data" — Xcode caches, iOS backups, Docker images, local Time
// Machine snapshots — with exact sizes. Regenerable dev artifacts get a
// one-click "Move to Trash"; irreplaceable/valuable items are review-only
// with a copyable reclaim command. Snapshots have their own (permanent but
// safe) delete action.

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard may be unavailable */ }
  }
  return (
    <button className="sysdata-cmd" onClick={copy} title="Copy command">
      <code>{text}</code>
      <span className="sysdata-cmd__copy">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export function SystemData() {
  const { progress, markActive } = useScanScope('system-data');
  const [state, setState] = useState('idle'); // idle | scanning | results
  const [scan, setScan] = useState(null);
  const [error, setError] = useState(null);

  // Which bucket is being confirmed/cleared.
  const [confirmBucket, setConfirmBucket] = useState(null);
  const [busyBucket, setBusyBucket] = useState(null);
  const [confirmSnapshots, setConfirmSnapshots] = useState(false);
  const [busySnapshots, setBusySnapshots] = useState(false);
  const [report, setReport] = useState(null); // last action result banner
  // Curated "run a safe command" reclaim (Docker / simulators).
  const [confirmRun, setConfirmRun] = useState(null);
  const [busyRun, setBusyRun] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [previewOut, setPreviewOut] = useState(null); // { id, text }

  async function runScan() {
    setState('scanning');
    setError(null);
    setReport(null);
    markActive(true);
    try {
      const r = await window.api.scanSystemData();
      setScan(r);
      setState('results');
    } catch (err) {
      setError(err.message || String(err));
      setState('idle');
    } finally {
      markActive(false);
    }
  }

  const maxBytes = useMemo(() => {
    if (!scan?.buckets) return 0;
    return scan.buckets.reduce((m, b) => Math.max(m, b.bytes), 0);
  }, [scan]);

  async function clearBucket(bucket) {
    setBusyBucket(bucket.id);
    try {
      const r = await window.api.clearSystemDataBucket(bucket.id);
      setReport({
        kind: 'bucket',
        label: bucket.label,
        dryRun: r.dryRun,
        freedBytes: r.freedBytes,
        removedCount: r.removedCount,
        failed: (r.results || []).filter((x) => !x.ok),
      });
      await runScanQuiet();
    } catch (err) {
      setReport({ kind: 'bucket', label: bucket.label, error: err.message || String(err) });
    } finally {
      setBusyBucket(null);
      setConfirmBucket(null);
    }
  }

  async function deleteSnapshots() {
    setBusySnapshots(true);
    try {
      const ids = (scan?.snapshots?.items || []).map((s) => s.id);
      const r = await window.api.deleteLocalSnapshots(ids);
      const ok = r.results.filter((x) => x.ok).length;
      const failed = r.results.filter((x) => !x.ok);
      setReport({ kind: 'snapshots', dryRun: r.dryRun, removedCount: ok, total: r.results.length, failed });
      await runScanQuiet();
    } catch (err) {
      setReport({ kind: 'snapshots', error: err.message || String(err) });
    } finally {
      setBusySnapshots(false);
      setConfirmSnapshots(false);
    }
  }

  async function runReclaim(bucket) {
    setBusyRun(bucket.id);
    try {
      const r = await window.api.runSystemDataReclaim(bucket.id);
      setReport({
        kind: 'reclaim',
        label: bucket.label,
        command: r.command,
        dryRun: r.dryRun,
        notInstalled: r.notInstalled,
        error: r.ok ? null : r.error,
        stdout: (r.stdout || '').trim(),
      });
      await runScanQuiet();
    } catch (err) {
      setReport({ kind: 'reclaim', label: bucket.label, error: err.message || String(err) });
    } finally {
      setBusyRun(null);
      setConfirmRun(null);
    }
  }

  async function previewReclaim(bucket) {
    setPreviewing(bucket.id);
    try {
      const r = await window.api.previewSystemDataReclaim(bucket.id);
      const text = r.ok ? ((r.stdout || '').trim() || '(no output)') : (r.error || 'preview unavailable');
      setPreviewOut({ id: bucket.id, text });
    } catch (err) {
      setPreviewOut({ id: bucket.id, text: err.message || String(err) });
    } finally {
      setPreviewing(null);
    }
  }

  // Refresh sizes after an action without flipping the whole view back to
  // the scanning state (keeps the results on screen).
  async function runScanQuiet() {
    try {
      const r = await window.api.scanSystemData();
      setScan(r);
    } catch { /* leave previous scan in place */ }
  }

  const snaps = scan?.snapshots;

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">System Data</h1>
        <p className="module__subtitle">
          macOS hides a lot inside the "System Data" bucket. This finds the big, specific things —
          dev caches, iOS backups, Docker images, and local Time Machine snapshots — so you can
          reclaim the safe ones and review the rest.
        </p>
      </header>

      {error && <div className="module__error">Scan failed: {error}</div>}

      {report && (
        <div className={`sysdata-report ${report.error ? 'sysdata-report--err' : ''}`}>
          {report.error ? (
            report.kind === 'reclaim' && report.notInstalled
              ? <><code>{report.command}</code> — that tool isn't installed on this Mac.</>
              : <>Couldn't complete{report.command ? <> <code>{report.command}</code></> : ''}: {report.error}</>
          ) : report.kind === 'snapshots' ? (
            report.dryRun
              ? `Dry-run: would delete ${report.removedCount} of ${report.total} local snapshots (nothing removed).`
              : `Deleted ${report.removedCount} of ${report.total} local snapshots.${report.failed.length ? ` ${report.failed.length} failed — they may need Full Disk Access.` : ''}`
          ) : report.kind === 'reclaim' ? (
            report.dryRun
              ? <>Dry-run: would run <code>{report.command}</code> (nothing executed — turn off dry-run in Settings → Safety).</>
              : <>Ran <code>{report.command}</code>.</>
          ) : (
            report.dryRun
              ? `Dry-run: would free ${formatBytes(report.freedBytes)} from ${report.label} (nothing removed).`
              : `Moved ${formatCount(report.removedCount)} item${report.removedCount === 1 ? '' : 's'} from ${report.label} to Trash · ${formatBytes(report.freedBytes)}.`
          )}
          {report.failed && report.failed.length > 0 && !report.error && report.kind === 'snapshots' && (
            <ul className="sysdata-report__fails">
              {report.failed.slice(0, 4).map((f, i) => <li key={i}><code>{f.id}</code> — {f.error}</li>)}
            </ul>
          )}
          {report.kind === 'reclaim' && report.stdout && (
            <pre className="sysdata-pre">{report.stdout}</pre>
          )}
        </div>
      )}

      {state === 'idle' && !scan && (
        <div className="welcome" style={{ padding: '20px 0 0' }}>
          <div className="map-cta">
            <button className="btn btn--primary" onClick={runScan}>Scan System Data</button>
          </div>
          <p className="welcome__note" style={{ marginTop: 18 }}>
            This measures each location's full size, so the first scan can take a little while
            if your Xcode caches or backups are large.
          </p>
        </div>
      )}

      {state === 'scanning' && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">Measuring System Data…</p>
          <p className="scan-state__hint">
            {progress?.currentItem ? <><code>{progress.currentItem}</code></> : 'Starting…'}
            {progress?.itemsTotal ? ` · ${progress.itemsDone || 0}/${progress.itemsTotal}` : ''}
          </p>
        </div>
      )}

      {scan && state === 'results' && (
        <>
          <div className="results-summary">
            <div>
              <div className="results-summary__bignum">{formatBytes(scan.totalBytes)}</div>
              <div className="results-summary__label">
                across the locations below · scanned in {(scan.durationMs / 1000).toFixed(1)}s
                {' · '}snapshots &amp; purgeable space not included in this total
              </div>
            </div>
            <button className="btn btn--ghost" onClick={runScan}>Rescan</button>
          </div>

          {/* Time Machine local snapshots */}
          <div className="sysdata-snap module__card">
            <div className="sysdata-snap__head">
              <div>
                <div className="sysdata-snap__title">Local Time Machine snapshots</div>
                <div className="sysdata-snap__sub">
                  {!snaps?.supported
                    ? 'Could not read snapshots (tmutil may need Full Disk Access).'
                    : snaps.count === 0
                      ? 'No local snapshots — nothing to reclaim here.'
                      : <>{snaps.count} snapshot{snaps.count === 1 ? '' : 's'} on this volume{snaps.items[0]?.date ? <> · newest {snaps.items[0].date}</> : null}. macOS counts these as System Data; they regenerate and your real backups are safe.</>}
                </div>
              </div>
              {snaps?.supported && snaps.count > 0 && (
                <button
                  className="btn btn--danger"
                  disabled={busySnapshots}
                  onClick={() => setConfirmSnapshots(true)}
                >
                  {busySnapshots ? 'Deleting…' : `Delete ${snaps.count} snapshot${snaps.count === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
            {snaps?.supported && snaps.count > 0 && (
              <div className="sysdata-snap__list">
                {snaps.items.slice(0, 8).map((s) => (
                  <span key={s.id} className="sysdata-snap__chip" title={s.raw}>{s.date || s.id}</span>
                ))}
                {snaps.count > 8 && <span className="sysdata-snap__chip sysdata-snap__chip--more">+{snaps.count - 8} more</span>}
              </div>
            )}
          </div>

          {/* Bucket rows */}
          <div className="sysdata-list">
            {scan.buckets.map((b) => {
              const pct = maxBytes > 0 ? Math.max(2, Math.round((b.bytes / maxBytes) * 100)) : 0;
              const trashable = b.action === 'trash' && b.exists && b.bytes > 0;
              return (
                <div key={b.id} className={`sysdata-row ${b.exists ? '' : 'sysdata-row--absent'}`}>
                  <div className="sysdata-row__top">
                    <span className="sysdata-row__label">
                      {b.label}
                      {b.action === 'review' && <span className="sysdata-tag">review</span>}
                    </span>
                    <span className="sysdata-row__size">
                      {b.exists ? <>{formatBytes(b.bytes)} · {formatCount(b.fileCount)} files</> : 'not present'}
                    </span>
                  </div>
                  {b.exists && (
                    <div className="sysdata-bar">
                      <div className={`sysdata-bar__fill ${b.action === 'trash' ? 'sysdata-bar__fill--safe' : ''}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <div className="sysdata-row__bottom">
                    <span className="sysdata-row__note">
                      {b.note} <code className="sysdata-row__path">{abbreviateHome(b.path)}</code>
                    </span>
                    {trashable && (
                      <button
                        className="btn btn--ghost sysdata-row__action"
                        disabled={busyBucket === b.id}
                        onClick={() => setConfirmBucket(b)}
                      >
                        {busyBucket === b.id ? 'Clearing…' : 'Move to Trash'}
                      </button>
                    )}
                  </div>
                  {b.reclaim && b.exists && (
                    <div className="sysdata-run">
                      <button
                        className="btn btn--primary sysdata-run__go"
                        disabled={busyRun === b.id}
                        onClick={() => setConfirmRun(b)}
                      >
                        {busyRun === b.id ? 'Running…' : b.reclaim.label}
                      </button>
                      {b.reclaim.previewArgs && (
                        <button
                          className="btn btn--ghost"
                          disabled={previewing === b.id}
                          onClick={() => previewReclaim(b)}
                        >
                          {previewing === b.id ? 'Checking…' : 'Check usage first'}
                        </button>
                      )}
                      <code className="sysdata-run__cmd">{b.reclaim.display}</code>
                    </div>
                  )}
                  {previewOut && previewOut.id === b.id && (
                    <pre className="sysdata-pre">{previewOut.text}</pre>
                  )}
                  {b.advanced && b.exists && (
                    <details className="sysdata-adv">
                      <summary>Advanced: reclaim more (run manually)</summary>
                      <p className="sysdata-adv__warn">{b.advanced.warn}</p>
                      <CopyButton text={b.advanced.display} />
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <ConfirmModal
        open={!!confirmBucket}
        title={confirmBucket ? `Clear ${confirmBucket.label}?` : ''}
        body={confirmBucket && (
          <>
            <p>
              Everything inside <code>{abbreviateHome(confirmBucket.path)}</code>{' '}
              (<strong>{formatBytes(confirmBucket.bytes)}</strong>) will move to your Trash.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{confirmBucket.note}</p>
          </>
        )}
        confirmLabel="Move to Trash"
        onConfirm={() => clearBucket(confirmBucket)}
        onCancel={() => setConfirmBucket(null)}
        busy={busyBucket === confirmBucket?.id}
      />

      <ConfirmModal
        open={!!confirmRun}
        title={confirmRun ? confirmRun.reclaim.label : ''}
        body={confirmRun && (
          <>
            <p>
              This runs <code>{confirmRun.reclaim.display}</code> for you.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{confirmRun.reclaim.safeNote}</p>
          </>
        )}
        confirmLabel="Run command"
        onConfirm={() => runReclaim(confirmRun)}
        onCancel={() => setConfirmRun(null)}
        busy={busyRun === confirmRun?.id}
      />

      <ConfirmModal
        open={confirmSnapshots}
        title="Delete local Time Machine snapshots?"
        body={
          <>
            <p>
              This permanently removes <strong>{snaps?.count || 0}</strong> local snapshot
              {snaps?.count === 1 ? '' : 's'} from this volume. Snapshots <em>cannot</em> be
              moved to Trash, so this can't be undone.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              This is safe: macOS recreates local snapshots automatically, and your real
              Time Machine backups on external/network drives are not affected.
            </p>
          </>
        }
        confirmLabel={`Delete ${snaps?.count || 0} snapshot${snaps?.count === 1 ? '' : 's'}`}
        onConfirm={deleteSnapshots}
        onCancel={() => setConfirmSnapshots(false)}
        busy={busySnapshots}
      />
    </div>
  );
}
