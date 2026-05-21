import { useEffect, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';

// Cleanup history + restore. Reads the durable log from the main process
// and lets the user put items back from Trash (best-effort). This is the
// safety net that makes cleaning feel reversible.

const SCOPE_LABEL = {
  'system-junk':    'System Junk',
  'large-old':      'Large & Old Files',
  'apps':           'Uninstaller',
  'duplicates':     'Duplicates',
  'stale-projects': 'Stale Projects',
  'trash':          'Empty Trash',
  'cleanup':        'Cleanup',
};

function dayKey(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function timeStr(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function History({ isActive }) {
  const [entries, setEntries] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [restoring, setRestoring] = useState(null);   // entry id currently restoring
  const [restoreMsg, setRestoreMsg] = useState({});    // entryId -> message
  const [confirmClear, setConfirmClear] = useState(false);

  async function refresh() {
    try {
      const list = await window.api.getHistory();
      setEntries(Array.isArray(list) ? list : []);
    } catch {
      setEntries([]);
    }
  }

  useEffect(() => { if (isActive) refresh(); }, [isActive]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function restore(entry) {
    setRestoring(entry.id);
    setRestoreMsg((m) => ({ ...m, [entry.id]: null }));
    try {
      const r = await window.api.restoreHistory(entry.id);
      const failed = (r.results || []).filter((x) => !x.ok && !x.already).length;
      const msg = r.ok
        ? `Restored ${r.restored} item${r.restored === 1 ? '' : 's'}.`
        : `Restored ${r.restored || 0}; ${failed} couldn't be restored (already gone or the spot is taken).`;
      setRestoreMsg((m) => ({ ...m, [entry.id]: msg }));
      await refresh();
    } catch (err) {
      setRestoreMsg((m) => ({ ...m, [entry.id]: `Restore failed: ${err.message || err}` }));
    } finally {
      setRestoring(null);
    }
  }

  async function doClear() {
    try { await window.api.clearHistory(); } finally {
      setConfirmClear(false);
      refresh();
    }
  }

  // Group entries by day for a tidy timeline.
  const groups = [];
  if (entries) {
    let last = null;
    for (const e of entries) {
      const key = dayKey(e.at);
      if (!last || last.key !== key) { last = { key, items: [] }; groups.push(last); }
      last.items.push(e);
    }
  }

  function entryRestorable(e) {
    return e.restorable && e.items.some((it) => !it.restoredAt);
  }

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">History</h1>
        <p className="module__subtitle">
          Everything MacCleaner has moved to Trash, newest first. Most items can be put back —
          emptying the Trash is the only thing that's permanent.
        </p>
      </header>

      {entries && entries.length > 0 && (
        <div className="toolbar" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>
          <button className="btn btn--ghost" onClick={() => setConfirmClear(true)}>Clear history</button>
        </div>
      )}

      {!entries ? (
        <div className="scan-state"><div className="spinner" /><p className="scan-state__text">Loading history…</p></div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          Nothing yet. When you clean something, it'll show up here so you can review or undo it.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="hist-day">
            <div className="hist-day__label">{g.key}</div>
            {g.items.map((e) => {
              const isOpen = expanded.has(e.id);
              const allRestored = e.restorable && e.items.every((it) => it.restoredAt);
              return (
                <div key={e.id} className="hist-entry">
                  <div className="hist-entry__head">
                    <button className="hist-entry__main" onClick={() => toggle(e.id)}>
                      <span className={`category__chevron ${isOpen ? 'category__chevron--open' : ''}`}>›</span>
                      <span className="hist-entry__title">
                        {SCOPE_LABEL[e.scope] || e.scope}
                        <span className="hist-entry__time">{timeStr(e.at)}</span>
                        {!e.restorable && <span className="hist-badge hist-badge--perm">permanent</span>}
                        {allRestored && <span className="hist-badge hist-badge--restored">restored</span>}
                      </span>
                      <span className="hist-entry__meta">
                        {formatCount(e.itemCount)} item{e.itemCount === 1 ? '' : 's'} · {formatBytes(e.totalBytes)}
                      </span>
                    </button>
                    {entryRestorable(e) && (
                      <button
                        className="btn btn--primary hist-entry__restore"
                        disabled={restoring === e.id}
                        onClick={() => restore(e)}
                      >
                        {restoring === e.id ? 'Restoring…' : 'Put back'}
                      </button>
                    )}
                  </div>
                  {restoreMsg[e.id] && <div className="hist-entry__msg">{restoreMsg[e.id]}</div>}
                  {isOpen && (
                    <div className="hist-entry__items">
                      {e.items.slice(0, 100).map((it, i) => (
                        <div key={i} className={`hist-item ${it.restoredAt ? 'hist-item--restored' : ''}`}>
                          <span className="hist-item__name" title={it.path}>{abbreviateHome(it.path)}</span>
                          <span className="hist-item__bytes">
                            {it.bytes != null ? formatBytes(it.bytes) : ''}
                            {it.restoredAt && ' · back'}
                          </span>
                        </div>
                      ))}
                      {e.items.length > 100 && (
                        <div className="file-table__more">…and {formatCount(e.items.length - 100)} more</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}

      <ConfirmModal
        open={confirmClear}
        title="Clear cleanup history?"
        body={<p>This removes the log only. It does <strong>not</strong> delete or restore any files — items already in your Trash stay there.</p>}
        confirmLabel="Clear history"
        onConfirm={doClear}
        onCancel={() => setConfirmClear(false)}
        busy={false}
      />
    </div>
  );
}
