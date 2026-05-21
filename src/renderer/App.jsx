import { useEffect, useState } from 'react';
import { Dashboard } from './modules/Dashboard.jsx';
import { MacHealth } from './modules/MacHealth.jsx';
import { Performance } from './modules/Performance.jsx';
import { SystemJunk } from './modules/SystemJunk.jsx';
import { LargeOldFiles } from './modules/LargeOldFiles.jsx';
import { Uninstaller } from './modules/Uninstaller.jsx';
import { Duplicates } from './modules/Duplicates.jsx';
import { Settings } from './modules/Settings.jsx';
import { ScanProvider, useScans } from './store/ScanContext.jsx';
import { SettingsProvider, useSettings } from './store/SettingsContext.jsx';
import { Brand, SidebarIcon } from './components/Icons.jsx';
import { Onboarding } from './components/Onboarding.jsx';
import { SPONSOR_URL, SPONSOR_AVATAR, openSponsors } from './components/SponsorCard.jsx';
import { SystemInfoModal } from './components/SystemInfoModal.jsx';

// One source of truth for module metadata. The accent token here drives:
//   - sidebar icon color + active strip
//   - main-pane ambient radial gradient
//   - tile top-edge color + glow
const MODULES = [
  { id: 'dashboard',   label: 'Dashboard',          accent: 'indigo', group: null,      Icon: SidebarIcon.dashboard,   component: Dashboard },
  { id: 'mac-health',  label: 'Mac Health',         accent: 'indigo', group: 'System',  Icon: SidebarIcon.macHealth,   component: MacHealth },
  { id: 'performance', label: 'Performance',        accent: 'amber',  group: 'System',  Icon: SidebarIcon.performance, component: Performance },
  { id: 'system-junk', label: 'System Junk',        accent: 'green',  group: 'Cleanup', Icon: SidebarIcon.systemJunk,  component: SystemJunk },
  { id: 'large-old',   label: 'Large & Old Files',  accent: 'blue',   group: 'Cleanup', Icon: SidebarIcon.largeOld,    component: LargeOldFiles },
  { id: 'duplicates',  label: 'Duplicates',         accent: 'orange', group: 'Cleanup', Icon: SidebarIcon.duplicates,  component: Duplicates },
  { id: 'uninstaller', label: 'Uninstaller',        accent: 'purple', group: 'Apps',    Icon: SidebarIcon.uninstaller, component: Uninstaller },
  { id: 'settings',    label: 'Settings',           accent: 'indigo', group: null,      Icon: SidebarIcon.settings,    component: Settings,  pinBottom: true },
];

const SCOPE_LABEL = {
  'system-junk': 'System Junk',
  'large-old':   'Large & Old Files',
  'apps':        'Installed apps',
  'leftovers':   'App leftovers',
  'duplicates':  'Duplicates',
};

const MODULE_SCOPES = {
  'dashboard':   [],
  'mac-health':  [],
  'performance': [],
  'system-junk': ['system-junk'],
  'large-old':   ['large-old'],
  'uninstaller': ['apps', 'leftovers'],
  'duplicates':  ['duplicates'],
  'settings':    [],
};

export function App() {
  return (
    <SettingsProvider>
      <ScanProvider>
        <AppShell />
      </ScanProvider>
    </SettingsProvider>
  );
}

function AppShell() {
  const [activeId, setActiveId] = useState('dashboard');
  const [systemInfo, setSystemInfo] = useState(null);
  const [ipcError, setIpcError] = useState(null);
  const [showSysInfo, setShowSysInfo] = useState(false);
  const { activeScans } = useScans();
  const { settings, loading: settingsLoading } = useSettings();
  // Show onboarding while settings haven't loaded yet (so it doesn't
  // flash) OR explicitly when firstRun.completed is false.
  const showOnboarding = !settingsLoading && settings && !settings.firstRun?.completed;

  useEffect(() => {
    if (!window.api?.getSystemInfo) {
      setIpcError('window.api is missing — preload script did not run.');
      return;
    }
    window.api.getSystemInfo().then(setSystemInfo).catch((err) => setIpcError(String(err)));
  }, []);

  // macOS Cmd+, convention — opens settings from anywhere in the app.
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey && e.key === ',') {
        e.preventDefault();
        setActiveId('settings');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tray menu items send us a tab id to switch to when the window is
  // brought to front.
  useEffect(() => {
    if (!window.api?.onTrayNavigate) return undefined;
    return window.api.onTrayNavigate((tabId) => {
      if (typeof tabId === 'string') setActiveId(tabId);
    });
  }, []);

  const activeModule = MODULES.find((m) => m.id === activeId);
  const activeEntries = Object.entries(activeScans);

  // Build two grouped nav lists: top-of-sidebar items and bottom-pinned
  // items (Settings sits at the bottom, separated from the main flow).
  const topModules = MODULES.filter((m) => !m.pinBottom);
  const bottomModules = MODULES.filter((m) => m.pinBottom);

  function buildItems(list) {
    let lastGroup = null;
    const items = [];
    for (const m of list) {
      if (m.group && m.group !== lastGroup) {
        items.push({ kind: 'header', label: m.group, key: `h-${m.group}` });
        lastGroup = m.group;
      }
      if (!m.group) lastGroup = null;
      items.push({ kind: 'item', module: m, key: m.id });
    }
    return items;
  }
  const navItems = buildItems(topModules);
  const bottomItems = buildItems(bottomModules);

  return (
    <div className="app" data-accent={activeModule.accent}>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Brand size={26} />
          <span className="sidebar__title">MacCleaner</span>
        </div>

        <nav className="sidebar__nav">
          {navItems.map((it) => renderNavItem(it, activeId, activeScans, setActiveId))}
        </nav>

        <div className="sidebar__bottom-nav">
          {bottomItems.map((it) => renderNavItem(it, activeId, activeScans, setActiveId))}
          <SponsorButton />
        </div>

        <div className="sidebar__footer">
          <SystemInfoCard info={systemInfo} error={ipcError} onClick={() => setShowSysInfo(true)} />
        </div>
      </aside>

      <main className="main">
        {MODULES.map((m) => {
          const Mod = m.component;
          const visible = m.id === activeId;
          return (
            <div
              key={m.id}
              className="module-host"
              data-accent={m.accent}
              style={{ display: visible ? 'block' : 'none' }}
            >
              <Mod isActive={visible} setActiveTab={setActiveId} />
            </div>
          );
        })}
      </main>

      {showOnboarding && <Onboarding />}

      <SystemInfoModal open={showSysInfo} onClose={() => setShowSysInfo(false)} />

      {activeEntries.length > 0 && (
        <div className="scan-dock" role="status" aria-live="polite">
          {activeEntries.map(([scope, p]) => (
            <div key={scope} className="scan-dock__row">
              <div className="spinner spinner--small" />
              <div className="scan-dock__text">
                <span className="scan-dock__scope">{SCOPE_LABEL[scope] || scope}</span>
                <span className="scan-dock__detail">{progressLabel(p)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SponsorButton() {
  const [avatarOk, setAvatarOk] = useState(true);
  function open() {
    window.api?.openExternal?.(SPONSOR_URL).catch(() => { /* no-op */ });
  }
  return (
    <button className="nav-item nav-item--sponsor" onClick={open} title="Support development on GitHub Sponsors">
      <span className="nav-item__icon nav-item__icon--sponsor">
        {avatarOk ? (
          <img
            className="nav-item__avatar"
            src={SPONSOR_AVATAR}
            alt=""
            onError={() => setAvatarOk(false)}
          />
        ) : (
          <SidebarIcon.sponsor />
        )}
      </span>
      <span className="nav-item__label">Sponsor</span>
    </button>
  );
}

function renderNavItem(it, activeId, activeScans, setActiveId) {
  if (it.kind === 'header') {
    return <div key={it.key} className="sidebar__section">{it.label}</div>;
  }
  const m = it.module;
  const scopes = MODULE_SCOPES[m.id] || [];
  const isScanning = scopes.some((s) => activeScans[s]);
  const isActive = m.id === activeId;
  return (
    <button
      key={m.id}
      className={`nav-item ${isActive ? 'nav-item--active' : ''}`}
      data-accent={m.accent}
      onClick={() => setActiveId(m.id)}
    >
      <span className="nav-item__icon"><m.Icon /></span>
      <span className="nav-item__label">{m.label}</span>
      {isScanning && <span className="nav-item__dot" title="Scan in progress" />}
    </button>
  );
}

function progressLabel(p) {
  if (!p) return 'Starting…';
  if (p.phase === 'starting') return 'Starting…';
  if (p.phase === 'starting-category' || p.phase === 'measuring') {
    const inItem = p.currentItem ? ` · ${p.currentItem}` : '';
    if (p.itemsTotal) return `${p.category}${inItem} (${p.itemsDone || 0}/${p.itemsTotal})`;
    return p.category ? `${p.category}${inItem}` : `Scanning${inItem}`;
  }
  if (p.phase === 'starting-root' || p.phase === 'walking') {
    const visited = (p.visited || 0).toLocaleString();
    const found = (p.foundLarge || 0) + (p.foundOld || 0);
    return `${p.currentRoot || ''} · ${visited} scanned · ${found} flagged`;
  }
  if (p.phase === 'reading') {
    return p.bundleCount ? `${p.processed || 0} / ${p.bundleCount} apps${p.currentItem ? ` (${p.currentItem})` : ''}` : 'Reading apps…';
  }
  if (p.phase === 'searching') {
    return `Searching ${p.currentItem} (${(p.rootIdx || 0) + 1}/${p.rootCount})`;
  }
  if (p.phase === 'partial-hashing') return `Fingerprinting · ${p.done || 0}/${p.totalCandidates || 0}`;
  if (p.phase === 'full-hashing')    return `Hashing matches · ${p.done || 0}/${p.totalCandidates || 0}`;
  return 'Working…';
}

function SystemInfoCard({ info, error, onClick }) {
  if (error) return <div className="sysinfo sysinfo--error">IPC error: {error}</div>;
  if (!info) return <div className="sysinfo">Connecting…</div>;
  return (
    <button className="sysinfo sysinfo--button" onClick={onClick} title="View full system information">
      <div className="sysinfo__row">
        <span>Host</span>
        <span className="sysinfo__value">{info.hostname}</span>
      </div>
      <div className="sysinfo__row">
        <span>Memory</span>
        <span className="sysinfo__value">
          {(info.totalMemGB - info.freeMemGB).toFixed(1)} / {info.totalMemGB} GB
        </span>
      </div>
      <div className="sysinfo__hint">System info ›</div>
    </button>
  );
}
