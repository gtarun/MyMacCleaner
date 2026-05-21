import { useState } from 'react';
import { useSettings } from '../store/SettingsContext.jsx';
import { useScans } from '../store/ScanContext.jsx';
import { formatBytes, abbreviateHome } from '../lib/format.js';

const TABS = [
  { id: 'scanning',    label: 'Scanning'    },
  { id: 'schedule',    label: 'Schedule'    },
  { id: 'safety',      label: 'Safety'      },
  { id: 'permissions', label: 'Permissions' },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SCHEDULE_SCOPES = [
  { id: 'system-junk', label: 'System Junk' },
  { id: 'large-old',   label: 'Large & Old Files' },
  { id: 'apps',        label: 'Installed apps' },
];

const DEFAULT_LARGE_OLD_ROOTS = [
  '~/Documents', '~/Downloads', '~/Desktop', '~/Movies', '~/Pictures',
];

export function Settings() {
  const { settings, loading, update } = useSettings();
  const { results } = useScans();
  const [tab, setTab] = useState('scanning');

  if (loading || !settings) {
    return (
      <div className="module">
        <div className="scan-state">
          <div className="spinner" />
          <p className="scan-state__text">Loading settings…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Settings</h1>
        <p className="module__subtitle">
          Customize scan roots, toggle dry-run mode, and check permission status.
        </p>
      </header>

      <div className="settings-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`settings-tab ${tab === t.id ? 'settings-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'scanning' && <ScanningTab settings={settings} update={update} />}
      {tab === 'schedule' && <ScheduleTab settings={settings} update={update} />}
      {tab === 'safety' && <SafetyTab settings={settings} update={update} results={results} />}
      {tab === 'permissions' && <PermissionsTab />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function ScheduleTab({ settings, update }) {
  const sched = settings.schedule || {};
  const [busy, setBusy] = useState(false);
  const [runReport, setRunReport] = useState(null);

  function patch(p) {
    update({ schedule: p });
  }

  function toggleScope(scopeId) {
    const list = Array.isArray(sched.scopes) ? sched.scopes : [];
    const next = list.includes(scopeId) ? list.filter((s) => s !== scopeId) : [...list, scopeId];
    patch({ scopes: next });
  }

  async function runNow() {
    setBusy(true);
    setRunReport(null);
    try {
      const r = await window.api.runScheduledScan();
      setRunReport(r);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section__title">Background scanning</h3>
        <p className="settings-section__hint">
          MacCleaner can run scans automatically while the app is open. Scheduled runs only
          measure — they never move anything to Trash. You still review and confirm before
          any cleanup.
        </p>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={!!sched.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span>Enable automatic scans</span>
        </label>

        {sched.enabled && (
          <>
            <div className="settings-grid" style={{ marginTop: 12 }}>
              <label className="settings-field">
                <span className="settings-field__label">Frequency</span>
                <div className="settings-field__input">
                  <select
                    value={sched.frequency || 'weekly'}
                    onChange={(e) => patch({ frequency: e.target.value })}
                    style={{ background: 'transparent', border: 0, color: 'var(--text-primary)', font: 'inherit', width: '100%', outline: 'none' }}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </label>

              {sched.frequency === 'weekly' && (
                <label className="settings-field">
                  <span className="settings-field__label">Day of week</span>
                  <div className="settings-field__input">
                    <select
                      value={sched.dayOfWeek ?? 1}
                      onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}
                      style={{ background: 'transparent', border: 0, color: 'var(--text-primary)', font: 'inherit', width: '100%', outline: 'none' }}
                    >
                      {DAY_NAMES.map((name, i) => (
                        <option key={i} value={i}>{name}</option>
                      ))}
                    </select>
                  </div>
                </label>
              )}

              <label className="settings-field">
                <span className="settings-field__label">Hour of day</span>
                <div className="settings-field__input">
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={sched.hourOfDay ?? 9}
                    onChange={(e) => patch({ hourOfDay: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
                  />
                  <span className="settings-field__suffix">:00 local</span>
                </div>
              </label>
            </div>

            <div className="settings-section__hint" style={{ marginTop: 16, marginBottom: 8 }}>
              Modules to run:
            </div>
            <div className="settings-scopes">
              {SCHEDULE_SCOPES.map((s) => {
                const enabled = (sched.scopes || []).includes(s.id);
                return (
                  <label key={s.id} className="settings-toggle">
                    <input type="checkbox" checked={enabled} onChange={() => toggleScope(s.id)} />
                    <span>{s.label}</span>
                  </label>
                );
              })}
            </div>

            <label className="settings-toggle" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={!!sched.notifyOnComplete}
                onChange={(e) => patch({ notifyOnComplete: e.target.checked })}
              />
              <span>Show a notification when each run finishes</span>
            </label>
          </>
        )}
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Run now</h3>
        <p className="settings-section__hint">
          Trigger the same scopes immediately. Results land in the Dashboard tiles and become
          the new "last scanned" record.
        </p>
        <div className="settings-actions">
          <button className="btn btn--accent" onClick={runNow} disabled={busy}>
            {busy ? 'Running…' : 'Run scheduled scopes now'}
          </button>
        </div>
        {sched.lastRunAt && (
          <div className="settings-section__hint" style={{ marginTop: 10 }}>
            Last run: {new Date(sched.lastRunAt).toLocaleString()}
            {sched.lastRunDurationMs && <> · took {(sched.lastRunDurationMs / 1000).toFixed(1)}s</>}
          </div>
        )}
        {runReport?.skipped && (
          <div className="module__error" style={{ marginTop: 12 }}>
            Skipped: {runReport.reason}
          </div>
        )}
      </section>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function ScanningTab({ settings, update }) {
  const lo = settings.largeOld || {};
  const dup = settings.duplicates || {};
  const stale = settings.staleProjects || {};
  const customRoots = Array.isArray(lo.roots) ? lo.roots : null;

  function updateStaleNumber(key, valueRaw, transform = (v) => v) {
    const num = Number(valueRaw);
    if (!Number.isFinite(num) || num < 0) return;
    update({ staleProjects: { [key]: transform(num) } });
  }

  async function addLargeOldRoot() {
    const r = await window.api.pickFolders();
    if (r.canceled || r.accepted.length === 0) return;
    const next = [...(customRoots || []), ...r.accepted.filter((p) => !(customRoots || []).includes(p))];
    update({ largeOld: { roots: next } });
  }

  function removeLargeOldRoot(p) {
    const next = (customRoots || []).filter((r) => r !== p);
    update({ largeOld: { roots: next.length ? next : null } });
  }

  function resetLargeOldRoots() {
    update({ largeOld: { roots: null } });
  }

  async function addDupRoot() {
    const r = await window.api.pickFolders();
    if (r.canceled || r.accepted.length === 0) return;
    const next = Array.from(new Set([...(dup.roots || []), ...r.accepted]));
    update({ duplicates: { roots: next } });
  }

  function removeDupRoot(p) {
    update({ duplicates: { roots: (dup.roots || []).filter((r) => r !== p) } });
  }

  function updateLargeOldNumber(key, valueRaw, transform = (v) => v) {
    const num = Number(valueRaw);
    if (!Number.isFinite(num) || num < 0) return;
    update({ largeOld: { [key]: transform(num) } });
  }

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section__title">Large &amp; Old Files</h3>
        <p className="settings-section__hint">
          Folders the scanner walks. The defaults cover most user content; add custom roots for
          external drives, code repos, or anywhere else you want surveyed.
        </p>

        <div className="settings-list">
          {(customRoots || DEFAULT_LARGE_OLD_ROOTS).map((p) => (
            <div key={p} className="settings-row">
              <code className="settings-row__path">{abbreviateHome(p).replace(/^~\//, '~/')}</code>
              {customRoots && (
                <button className="settings-row__remove" onClick={() => removeLargeOldRoot(p)}>×</button>
              )}
            </div>
          ))}
        </div>

        <div className="settings-actions">
          <button className="btn btn--ghost" onClick={addLargeOldRoot}>+ Add folder</button>
          {customRoots && (
            <button className="btn btn--ghost" onClick={resetLargeOldRoots}>Reset to defaults</button>
          )}
        </div>

        <div className="settings-grid">
          <label className="settings-field">
            <span className="settings-field__label">Minimum file size</span>
            <div className="settings-field__input">
              <input
                type="number"
                min="1"
                value={Math.round((lo.minBytes || 0) / 1024 / 1024)}
                onChange={(e) => updateLargeOldNumber('minBytes', e.target.value, (v) => v * 1024 * 1024)}
              />
              <span className="settings-field__suffix">MB</span>
            </div>
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Minimum age</span>
            <div className="settings-field__input">
              <input
                type="number"
                min="0"
                value={lo.minAgeDays || 0}
                onChange={(e) => updateLargeOldNumber('minAgeDays', e.target.value)}
              />
              <span className="settings-field__suffix">days</span>
            </div>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Duplicates — persistent folders</h3>
        <p className="settings-section__hint">
          Folders saved between sessions so the Duplicates tab remembers your scan scope.
          You can also add folders directly from the Duplicates tab.
        </p>

        <div className="settings-list">
          {(dup.roots || []).length === 0 && (
            <div className="settings-row settings-row--empty">No persistent folders yet.</div>
          )}
          {(dup.roots || []).map((p) => (
            <div key={p} className="settings-row">
              <code className="settings-row__path">{abbreviateHome(p)}</code>
              <button className="settings-row__remove" onClick={() => removeDupRoot(p)}>×</button>
            </div>
          ))}
        </div>

        <div className="settings-actions">
          <button className="btn btn--ghost" onClick={addDupRoot}>+ Add folder</button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Stale Projects</h3>
        <p className="settings-section__hint">
          Thresholds for the Stale Projects scan. A project is flagged only when its source has
          been idle at least this long and its build/dependency dirs are at least this big. It
          searches the same folders as Duplicates.
        </p>
        <div className="settings-grid">
          <label className="settings-field">
            <span className="settings-field__label">Idle for at least</span>
            <div className="settings-field__input">
              <input
                type="number"
                min="0"
                value={stale.minAgeDays ?? 90}
                onChange={(e) => updateStaleNumber('minAgeDays', e.target.value)}
              />
              <span className="settings-field__suffix">days</span>
            </div>
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Minimum size</span>
            <div className="settings-field__input">
              <input
                type="number"
                min="1"
                value={Math.round((stale.minBytes || 0) / 1024 / 1024)}
                onChange={(e) => updateStaleNumber('minBytes', e.target.value, (v) => v * 1024 * 1024)}
              />
              <span className="settings-field__suffix">MB</span>
            </div>
          </label>
        </div>
      </section>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function SafetyTab({ settings, update, results }) {
  const safety = settings.safety || {};
  const lastCleaned = settings.lastCleaned || {};
  const exclusions = Array.isArray(settings.exclusions) ? settings.exclusions : [];

  function toggleDryRun() {
    update({ safety: { dryRun: !safety.dryRun } });
  }

  async function addExclusion() {
    const r = await window.api.pickPaths();
    if (r.canceled || r.paths.length === 0) return;
    const next = Array.from(new Set([...exclusions, ...r.paths]));
    update({ exclusions: next });
  }

  function removeExclusion(p) {
    update({ exclusions: exclusions.filter((x) => x !== p) });
  }

  const cleanedRows = [
    { scope: 'system-junk',    label: 'System Junk' },
    { scope: 'large-old',      label: 'Large & Old Files' },
    { scope: 'apps',           label: 'Uninstaller' },
    { scope: 'duplicates',     label: 'Duplicates' },
    { scope: 'stale-projects', label: 'Stale Projects' },
    { scope: 'trash',          label: 'Empty Trash' },
  ];

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section__title">Dry-run mode</h3>
        <p className="settings-section__hint">
          When dry-run is on, MacCleaner runs the full scan-and-confirm flow but never actually
          calls <code>shell.trashItem</code>. The done screen shows "Would free" instead of "Freed".
          Useful when learning what the app removes.
        </p>
        <label className="settings-toggle">
          <input type="checkbox" checked={!!safety.dryRun} onChange={toggleDryRun} />
          <span>Preview only — don't move anything to Trash</span>
        </label>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Exclusions</h3>
        <p className="settings-section__hint">
          Folders here are never scanned and never removed — the safety gate hard-refuses anything
          inside them, even if it would otherwise qualify. Use this for project folders, archives,
          or anything you want fully off-limits.
        </p>

        <div className="settings-list">
          {exclusions.length === 0 && (
            <div className="settings-row settings-row--empty">No exclusions — nothing is protected beyond the built-in never-touch list.</div>
          )}
          {exclusions.map((p) => (
            <div key={p} className="settings-row">
              <code className="settings-row__path">{abbreviateHome(p)}</code>
              <button className="settings-row__remove" onClick={() => removeExclusion(p)}>×</button>
            </div>
          ))}
        </div>

        <div className="settings-actions">
          <button className="btn btn--ghost" onClick={addExclusion}>+ Add folder to exclude</button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Activity</h3>
        <div className="settings-list">
          {cleanedRows.map((row) => {
            const lc = lastCleaned[row.scope];
            const result = results[row.scope];
            return (
              <div key={row.scope} className="settings-row settings-row--activity">
                <span className="settings-row__label">{row.label}</span>
                <span className="settings-row__detail">
                  {lc?.at
                    ? <>last cleaned {relTime(lc.at)}</>
                    : 'never cleaned'}
                  {result?.recordedAt && (
                    <> · last scan {relTime(result.recordedAt)}</>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function PermissionsTab() {
  function openPrivacy(pane) {
    const url = `x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`;
    window.open(url);
  }

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section__title">Granted by macOS</h3>
        <p className="settings-section__hint">
          MacCleaner only reaches into folders it can already see. The first time you scan
          your Documents, Desktop, or Downloads, macOS will show a permission prompt — approve
          it. If you missed the prompt or want to revoke later, manage it in System Settings.
        </p>
        <button className="btn btn--primary" onClick={() => openPrivacy('AllFiles')}>
          Open Privacy &amp; Security settings
        </button>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Full Disk Access (optional)</h3>
        <p className="settings-section__hint">
          If you want MacCleaner to surface caches inside <code>~/Library/Mail</code>,{' '}
          <code>~/Library/Messages</code>, or other protected paths, grant Full Disk Access.
          MacCleaner never deletes from those locations regardless — it would just be able to
          report on them.
        </p>
        <button className="btn btn--ghost" onClick={() => openPrivacy('AllFiles')}>
          Open Full Disk Access pane
        </button>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">First-launch Gatekeeper note</h3>
        <p className="settings-section__hint">
          MacCleaner is unsigned for personal use. The first time you launch the .app, macOS
          blocks it. Right-click MacCleaner in Finder → <strong>Open</strong> to confirm. After
          that, Gatekeeper remembers and the app launches normally.
        </p>
      </section>
    </>
  );
}

function relTime(ms) {
  if (!ms) return '';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
