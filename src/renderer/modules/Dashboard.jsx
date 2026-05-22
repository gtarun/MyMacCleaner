import { useEffect, useState } from 'react';
import { useScans } from '../store/ScanContext.jsx';
import { formatBytes, formatCount } from '../lib/format.js';
import { TileIcon, SidebarIcon } from '../components/Icons.jsx';
import { SponsorCard } from '../components/SponsorCard.jsx';

// Accent hex per module — passed into TileIcon so each tile's 3D-ish
// glyph picks up its module color.
const ACCENT_HEX = {
  green:  '#34c759',
  blue:   '#5fcad9',
  orange: '#ff9f43',
  purple: '#bf6bf2',
  indigo: '#7b78f0',
  teal:   '#2dd4bf',
};

const TILES = [
  {
    scope: 'system-junk',
    tab: 'system-junk',
    accent: 'green',
    label: 'System Junk',
    tagline: 'Caches, logs, and developer leftovers your apps regenerate on demand.',
    Icon: TileIcon.systemJunk,
    chipIcon: SidebarIcon.systemJunk,
    summarize: (r) => ({
      bignum: r.totalBytes > 0 ? formatBytes(r.totalBytes) : 'Clean',
      caption: r.totalBytes > 0
        ? `of System Junk Found across ${formatCount(r.itemCount)} items`
        : 'Nothing to clean right now',
    }),
    featurable: true,
  },
  {
    scope: 'large-old',
    tab: 'large-old',
    accent: 'blue',
    label: 'Large & Old Files',
    Icon: TileIcon.largeOld,
    chipIcon: SidebarIcon.largeOld,
    summarize: (r) => ({
      bignum: r.flaggedCount > 0 ? formatBytes(r.totalBytes) : 'Clean',
      caption: r.flaggedCount > 0
        ? `across ${formatCount(r.flaggedCount)} flagged files`
        : 'No oversized or stale files',
    }),
  },
  {
    scope: 'apps',
    tab: 'uninstaller',
    accent: 'purple',
    label: 'Applications',
    Icon: TileIcon.uninstaller,
    chipIcon: SidebarIcon.uninstaller,
    summarize: (r) => ({
      bignum: formatCount(r.count),
      caption: `apps · ${formatBytes(r.totalBytes || 0)} on disk`,
    }),
  },
  {
    scope: 'duplicates',
    tab: 'duplicates',
    accent: 'orange',
    label: 'Duplicates',
    Icon: TileIcon.duplicates,
    chipIcon: SidebarIcon.duplicates,
    summarize: (r) => ({
      bignum: r.reclaimable > 0 ? formatBytes(r.reclaimable) : 'Clean',
      caption: r.reclaimable > 0
        ? `across ${formatCount(r.groupCount)} duplicate sets`
        : 'No duplicates in scanned folders',
    }),
    needsFolderPick: true,
  },
  {
    scope: 'stale-projects',
    tab: 'stale',
    accent: 'teal',
    label: 'Stale Projects',
    Icon: TileIcon.staleProjects,
    chipIcon: SidebarIcon.staleProjects,
    summarize: (r) => ({
      bignum: r.reclaimable > 0 ? formatBytes(r.reclaimable) : 'Clean',
      caption: r.reclaimable > 0
        ? `across ${formatCount(r.projectCount)} stale project${r.projectCount === 1 ? '' : 's'}`
        : 'No stale build/dependency dirs',
    }),
    needsFolderPick: true,
  },
];

const SCOPES_FOR_SCAN_EVERYTHING = ['system-junk', 'large-old', 'apps'];

// Sparkle positions for the welcome state glow. Picked once at module
// load so they stay stable across re-renders (random per-render would
// make them visibly jump on each tick).
const SPARKLE_POSITIONS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2;
  return {
    top: 50 + 38 * Math.sin(angle),
    left: 50 + 38 * Math.cos(angle),
    delay: i * 0.4,
    duration: 3.5 + (i % 3) * 0.4,
  };
});

function relativeTime(ms) {
  if (!ms) return '';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 30) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function progressDetail(p) {
  if (!p) return null;
  if (p.phase === 'starting' || p.phase === 'starting-category') return p.category || 'Starting…';
  if (p.phase === 'measuring')      return p.itemsTotal ? `${p.itemsDone || 0}/${p.itemsTotal}` : (p.category || 'Scanning');
  if (p.phase === 'walking')        return `${(p.visited || 0).toLocaleString()} files`;
  if (p.phase === 'reading')        return p.bundleCount ? `${p.processed || 0}/${p.bundleCount}` : 'Reading…';
  if (p.phase === 'partial-hashing') return `Fingerprint ${p.done || 0}/${p.totalCandidates || 0}`;
  if (p.phase === 'full-hashing')    return `Hash ${p.done || 0}/${p.totalCandidates || 0}`;
  return 'Working…';
}

// Compact "your machine" card for the top of the Dashboard. Fetches a
// single health snapshot on mount — no polling, so it adds nothing to idle
// CPU/heat (see the resource-use guidance).
function MachineCard({ setActiveTab }) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let mounted = true;
    window.api.getHealth?.().then((h) => { if (mounted) setHealth(h); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!health) {
    return <div className="machine-card machine-card--loading">Reading your Mac…</div>;
  }

  const { host = {}, cpu = {}, memory, disk } = health;
  const title = host.model || host.hostname || 'Your Mac';
  const os = host.name ? `${host.name} ${host.version || ''}`.trim() : null;
  const diskPct = disk ? Math.round(disk.percentUsed * 100) : null;

  const stats = [];
  if (os) stats.push({ label: 'macOS', value: os });
  if (cpu.model) stats.push({ label: 'Chip', value: cpu.model, sub: cpu.cores ? `${cpu.cores} cores` : null });
  if (memory) stats.push({ label: 'Memory', value: `${(memory.totalBytes / 1024 ** 3).toFixed(0)} GB` });

  return (
    <div className="machine-card">
      <div className="machine-card__id">
        <div className="machine-card__model">{title}</div>
        {host.hostname && host.model && <div className="machine-card__host">{host.hostname}</div>}
      </div>

      <div className="machine-card__stats">
        {stats.map((s) => (
          <div key={s.label} className="machine-stat">
            <div className="machine-stat__label">{s.label}</div>
            <div className="machine-stat__value" title={s.value}>{s.value}</div>
            {s.sub && <div className="machine-stat__sub">{s.sub}</div>}
          </div>
        ))}

        {disk && (
          <button
            className="machine-stat machine-stat--disk"
            onClick={() => setActiveTab('disk-map')}
            title="Open Disk Space"
          >
            <div className="machine-stat__label">Storage</div>
            <div className="machine-stat__value">
              {formatBytes(disk.usedBytes)} <span className="machine-stat__muted">/ {formatBytes(disk.totalBytes)}</span>
            </div>
            <div className="machine-bar">
              <div
                className={`machine-bar__fill ${diskPct >= 90 ? 'machine-bar__fill--warn' : ''}`}
                style={{ width: `${Math.max(2, diskPct)}%` }}
              />
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

export function Dashboard({ setActiveTab }) {
  const { activeScans, results, requestScan } = useScans();

  function scanEverything() {
    for (const scope of SCOPES_FOR_SCAN_EVERYTHING) requestScan(scope);
  }

  const anyScanning = SCOPES_FOR_SCAN_EVERYTHING.some((s) => activeScans[s]);
  const anyResults = TILES.some((t) => results[t.scope]);

  // "Reclaimable" — sum of cleaner modules. Apps don't count (they're
  // not reclaimable until you uninstall something).
  const totalReclaimable = ['system-junk', 'large-old', 'duplicates']
    .map((s) => results[s]?.totalBytes ?? results[s]?.reclaimable ?? 0)
    .reduce((a, b) => a + b, 0);

  /* ─── Welcome state ───────────────────────────────────────────── */
  if (!anyResults && !anyScanning) {
    return (
      <div className="module">
        <header className="module__header">
          <h1 className="module__title">MacCleaner</h1>
          <p className="module__subtitle">
            One scan, four cleaners. Caches and dev junk, large &amp; old files, duplicates, and a real app uninstaller.
          </p>
        </header>

        <MachineCard setActiveTab={setActiveTab} />

        <div className="welcome">
          <div className="welcome__glow">
            <div className="welcome__halo" />
            {/* Sparkle dots float around the glow at random offsets — pure
                CSS animation, computed once at render time. */}
            {SPARKLE_POSITIONS.map((s, i) => (
              <div
                key={i}
                className="welcome__sparkle"
                style={{
                  top: `${s.top}%`,
                  left: `${s.left}%`,
                  animationDelay: `${s.delay}s`,
                  animationDuration: `${s.duration}s`,
                }}
              />
            ))}
            <button className="welcome__cta" onClick={scanEverything}>
              <span className="welcome__cta-label">Smart Scan</span>
              <span className="welcome__cta-sub">Tap to scan everything</span>
            </button>
          </div>

          <div className="welcome__chips">
            {TILES.filter((t) => !t.needsFolderPick).map((t) => (
              <div key={t.scope} className="welcome__chip" data-accent={t.accent}>
                <span className="welcome__chip-icon"><t.chipIcon /></span>
                <span>{t.label}</span>
              </div>
            ))}
          </div>

          <div className="welcome__note">
            Duplicates and Stale Projects run separately — open their tabs to pick folders.
          </div>

          <SponsorCard sticky />
        </div>
      </div>
    );
  }

  /* ─── Results state ───────────────────────────────────────────── */
  // Pick the featured tile: whichever of the cleaner tiles has the
  // biggest result. CleanMyMac calls this out as the headliner card.
  const cleanerTiles = TILES.filter((t) => t.featurable);
  let featuredScope = cleanerTiles[0]?.scope;
  let featuredBytes = 0;
  for (const t of cleanerTiles) {
    const r = results[t.scope];
    if (!r) continue;
    const bytes = r.totalBytes ?? r.reclaimable ?? 0;
    if (bytes > featuredBytes) { featuredBytes = bytes; featuredScope = t.scope; }
  }

  return (
    <div className="module">
      <header className="dash-hero">
        <h2 className="dash-hero__title">
          There {totalReclaimable === 0 ? 'is nothing' : 'are'}{' '}
          {totalReclaimable > 0 && <strong>{formatBytes(totalReclaimable)} of reclaimable space</strong>}
          {' '}on your Mac.
        </h2>
        <button className="dash-hero__cta" onClick={scanEverything} disabled={anyScanning}>
          {anyScanning ? 'Scanning…' : 'Rescan everything'}
        </button>
      </header>

      <MachineCard setActiveTab={setActiveTab} />

      <div className="tiles">
        {TILES.map((t) => {
          const progress = activeScans[t.scope];
          const result = results[t.scope];
          const isScanning = !!progress;
          const summary = result ? t.summarize(result) : null;
          const isFeature = t.scope === featuredScope && summary;
          const glow = ACCENT_HEX[t.accent];

          return (
            <div key={t.scope} className={`tile ${isFeature ? 'tile--feature' : ''}`} data-accent={t.accent}>
              {/* Heading row: module name on the left, 3D icon on the right.
                  Always present so the user can identify the card at a glance,
                  regardless of scan state. */}
              <div className="tile__head">
                <div className="tile__heading">
                  <span className="tile__module">{t.label}</span>
                </div>
                <div className="tile__icon">
                  <t.Icon size={isFeature ? 72 : 44} glow={glow} />
                </div>
              </div>

              <div className="tile__body">
                {isScanning ? (
                  <div className="tile__primary tile__primary--scanning">
                    <div className="spinner spinner--small" /> {progressDetail(progress) || 'Scanning…'}
                  </div>
                ) : summary ? (
                  <>
                    <div className="tile__bignum">{summary.bignum}</div>
                    <div className="tile__caption">{summary.caption}</div>
                    {result?.recordedAt && (
                      <div className="tile__time">scanned {relativeTime(result.recordedAt)}</div>
                    )}
                  </>
                ) : (
                  <p className="tile__desc">{t.tagline || 'Not scanned yet.'}</p>
                )}
              </div>

              <div className="tile__actions">
                {result ? (
                  <>
                    <button className="tile__action" onClick={() => setActiveTab(t.tab)}>Review</button>
                    {(result.totalBytes > 0 || result.reclaimable > 0) && (
                      <button
                        className="tile__action tile__action--primary"
                        onClick={() => setActiveTab(t.tab)}
                      >
                        Clean
                      </button>
                    )}
                  </>
                ) : !isScanning ? (
                  <button
                    className="tile__action"
                    onClick={() => t.needsFolderPick ? setActiveTab(t.tab) : requestScan(t.scope)}
                  >
                    {t.needsFolderPick ? 'Pick folders' : 'Scan'}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <SponsorCard sticky />
    </div>
  );
}
