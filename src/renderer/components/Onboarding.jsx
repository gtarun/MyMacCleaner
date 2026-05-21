// First-launch onboarding overlay.
//
// Three steps, each a full-screen card over the dark canvas. The user
// can skip at any time; finishing or skipping persists firstRun.completed
// so it never reappears.

import { useState } from 'react';
import { Brand, TileIcon, SidebarIcon } from './Icons.jsx';
import { useSettings } from '../store/SettingsContext.jsx';

const STEPS = ['welcome', 'permissions', 'ready'];

export function Onboarding({ onDone }) {
  const { update } = useSettings();
  const [step, setStep] = useState(0);
  const [permResults, setPermResults] = useState(null);
  const [requestingPerms, setRequestingPerms] = useState(false);

  async function complete() {
    await update({ firstRun: { completed: true, completedAt: Date.now() } });
    onDone?.();
  }

  async function requestPermissions() {
    setRequestingPerms(true);
    try {
      const r = await window.api.requestFolderAccess();
      setPermResults(r);
    } finally {
      setRequestingPerms(false);
    }
  }

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else complete();
  }

  function back() {
    if (step > 0) setStep(step - 1);
  }

  const current = STEPS[step];

  return (
    <div className="onboarding">
      <div className="onboarding__bg" />
      <div className="onboarding__card">
        <button className="onboarding__skip" onClick={complete}>Skip intro</button>

        {current === 'welcome' && (
          <>
            <div className="onboarding__brand">
              <Brand size={64} />
            </div>
            <h1 className="onboarding__title">Welcome to MacCleaner</h1>
            <p className="onboarding__lede">
              Find regenerable junk, oversized files, leftover app data, and duplicates —
              all in one scan, all reviewable before anything moves.
            </p>

            <div className="onboarding__featurelist">
              <Feature accent="green"  Icon={SidebarIcon.systemJunk}  title="System Junk"        body="Caches, logs, and developer leftovers your apps regenerate on demand." />
              <Feature accent="blue"   Icon={SidebarIcon.largeOld}    title="Large & Old Files"   body="Files over 100 MB or untouched for six months." />
              <Feature accent="purple" Icon={SidebarIcon.uninstaller} title="Real Uninstaller"    body="Removes the app plus its leftover files across ten Library subdirectories." />
              <Feature accent="orange" Icon={SidebarIcon.duplicates}  title="Duplicate Files"     body="Byte-identical copies in folders you choose." />
            </div>

            <div className="onboarding__safety">
              <div className="onboarding__safety-icon">✓</div>
              <div>
                <strong>Nothing is permanently deleted.</strong> Every removal goes to your
                Trash. You can recover anything until you empty it.
              </div>
            </div>
          </>
        )}

        {current === 'permissions' && (
          <>
            <div className="onboarding__brand"><PermsIcon /></div>
            <h1 className="onboarding__title">Grant folder access</h1>
            <p className="onboarding__lede">
              macOS asks every app for permission before letting it read your Documents,
              Downloads, or Desktop. Tap the button below and macOS will show three
              standard prompts — approve each so MacCleaner can find oversized files there.
            </p>

            <button
              className="onboarding__cta-pill"
              onClick={requestPermissions}
              disabled={requestingPerms}
            >
              {requestingPerms ? 'Asking macOS…'
                : permResults ? 'Ask again' : 'Trigger macOS permission prompts'}
            </button>

            {permResults && (
              <div className="onboarding__perm-list">
                {permResults.map((r) => (
                  <div key={r.key} className={`onboarding__perm ${r.granted ? 'onboarding__perm--ok' : 'onboarding__perm--no'}`}>
                    <span className="onboarding__perm-icon">{r.granted ? '✓' : '!'}</span>
                    <span className="onboarding__perm-label">~/{r.key.charAt(0).toUpperCase() + r.key.slice(1)}</span>
                    <span className="onboarding__perm-status">
                      {r.granted ? 'access granted' : 'not granted — re-trigger or grant via System Settings'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="onboarding__fineprint">
              You can change these later in System Settings → Privacy &amp; Security → Files
              and Folders. If you skip, MacCleaner just won't surface files from those
              folders until you grant access.
            </p>
          </>
        )}

        {current === 'ready' && (
          <>
            <div className="onboarding__ready">
              <div className="onboarding__ready-halo" />
              <div className="onboarding__ready-badge">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white"
                     strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              </div>
            </div>
            <h1 className="onboarding__title">You're ready</h1>
            <p className="onboarding__lede">
              Tap Smart Scan on the Dashboard whenever you want a fresh report. Each module's
              tab lets you drill into the details and review before cleaning.
            </p>
            <div className="onboarding__tips">
              <div className="onboarding__tip">
                <strong>Press ⌘,</strong> from anywhere to open Settings — schedule weekly scans,
                toggle dry-run mode, manage permissions.
              </div>
              <div className="onboarding__tip">
                <strong>Closing the window</strong> hides MacCleaner to the menu bar so the
                scheduler keeps running. Quit from the menu bar to fully exit.
              </div>
            </div>

            <button
              className="onboarding__sponsor"
              onClick={() => window.api?.openExternal?.('https://github.com/sponsors/gtarun')}
            >
              <span className="onboarding__sponsor-heart" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z" />
                </svg>
              </span>
              <span className="onboarding__sponsor-text">
                <strong>Enjoying MacCleaner?</strong>
                <span>It's free and open. Support development on GitHub Sponsors.</span>
              </span>
              <span className="onboarding__sponsor-cta">Sponsor</span>
            </button>
          </>
        )}

        <div className="onboarding__nav">
          <div className="onboarding__dots">
            {STEPS.map((_, i) => (
              <div key={i} className={`onboarding__dot ${i === step ? 'onboarding__dot--active' : ''}`} />
            ))}
          </div>
          <div className="onboarding__nav-actions">
            {step > 0 && (
              <button className="btn btn--ghost" onClick={back}>Back</button>
            )}
            <button className="btn btn--accent" onClick={next}>
              {step < STEPS.length - 1 ? 'Continue' : 'Get started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ accent, Icon, title, body }) {
  return (
    <div className="onboarding__feature" data-accent={accent}>
      <div className="onboarding__feature-icon"><Icon /></div>
      <div className="onboarding__feature-text">
        <div className="onboarding__feature-title">{title}</div>
        <div className="onboarding__feature-body">{body}</div>
      </div>
    </div>
  );
}

function PermsIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="permgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#5856d6" />
          <stop offset="100%" stopColor="#007aff" />
        </linearGradient>
      </defs>
      <rect x="10" y="22" width="44" height="32" rx="6" fill="url(#permgrad)" />
      <rect x="10" y="22" width="44" height="8" rx="6" fill="white" fillOpacity="0.25" />
      <path d="M22 22 V14 a10 10 0 0 1 20 0 V22"
            stroke="url(#permgrad)" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <circle cx="32" cy="38" r="4" fill="white" />
      <rect x="30" y="40" width="4" height="8" rx="2" fill="white" />
    </svg>
  );
}
