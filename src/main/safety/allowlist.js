// Defense-in-depth allowlist.
//
// Even if the scanner has a bug and surfaces something it shouldn't, the
// Trash wrapper validates every path through `isPathSafeToRemove` before
// calling shell.trashItem. A path passes only if it sits *inside* one of
// the explicitly-allowed roots AND is not under any of the never-touch
// denylist entries.
//
// Rule of thumb: when in doubt, leave it out. The user can always remove
// something manually; they can't always recover from us nuking their
// Photos library.

const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();

// Roots the cleaner is allowed to remove items from. Every path the user
// confirms must resolve into one of these (after symlink resolution).
const ALLOWED_ROOTS = [
  // System Junk (Phase 2)
  path.join(HOME, 'Library', 'Caches'),
  path.join(HOME, 'Library', 'Logs'),
  // Developer Junk (Phase 3)
  path.join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData'),
  path.join(HOME, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport'),
  path.join(HOME, 'Library', 'Developer', 'Xcode', 'watchOS DeviceSupport'),
  path.join(HOME, 'Library', 'Developer', 'Xcode', 'tvOS DeviceSupport'),
  path.join(HOME, 'Library', 'Developer', 'Xcode', 'Archives'),
  path.join(HOME, 'Library', 'Developer', 'CoreSimulator', 'Caches'),
  path.join(HOME, '.npm'),
  path.join(HOME, '.pnpm-store'),
  // ~/Library/Caches/Yarn is already covered by ~/Library/Caches above

  // Uninstaller (Phase 4) — both the .app bundle locations and the
  // leftover-file sibling directories.
  '/Applications',
  path.join(HOME, 'Applications'),
  path.join(HOME, 'Library', 'Application Support'),
  path.join(HOME, 'Library', 'Preferences'),
  // ~/Library/Caches already covered above
  // ~/Library/Logs already covered above
  path.join(HOME, 'Library', 'Containers'),
  path.join(HOME, 'Library', 'Group Containers'),
  path.join(HOME, 'Library', 'Saved Application State'),
  path.join(HOME, 'Library', 'LaunchAgents'),
  path.join(HOME, 'Library', 'HTTPStorages'),
  path.join(HOME, 'Library', 'WebKit'),
  path.join(HOME, 'Library', 'Cookies'),

  // Large & Old Files (Phase 5) — user content. Higher-risk; the UI
  // compensates by never pre-checking and requiring deliberate selection.
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'Movies'),
  path.join(HOME, 'Pictures'),
];

// Paths we refuse to touch regardless of category. These either contain
// user data masquerading as cache, are required for macOS to function, or
// have caused well-documented breakage when cleaned by other tools.
const NEVER_TOUCH = [
  // User data
  path.join(HOME, 'Library', 'Mail'),
  path.join(HOME, 'Library', 'Messages'),
  path.join(HOME, 'Library', 'Keychains'),
  path.join(HOME, 'Library', 'Application Support', 'MobileSync'),
  path.join(HOME, 'Pictures', 'Photos Library.photoslibrary'),
  path.join(HOME, 'Library', 'Containers', 'com.apple.mail'),
  path.join(HOME, 'Library', 'Caches', 'com.apple.Mail'),
  path.join(HOME, 'Library', 'Caches', 'com.apple.mail'),
  path.join(HOME, 'Library', 'Caches', 'CloudKit'),
  path.join(HOME, 'Library', 'Caches', 'com.apple.bird'), // iCloud Drive

  // System
  '/System',
  '/private/var/db',
  '/private/var/folders',
];

/**
 * Resolves a path absolutely without following symlinks (we don't want a
 * crafted symlink in a cache dir to escape the allowed root).
 */
function normalize(p) {
  return path.resolve(p);
}

// Per-session set of roots the user has explicitly added via a system
// dialog. Picking a folder via the OS picker is consent. We still apply
// the never-touch rules to anything inside.
const runtimeAllowedRoots = new Set();

// User-defined exclusions (from settings). Anything at or inside one of
// these is refused by the safety gate, regardless of allowlist status.
// Loaded at boot and refreshed whenever settings change.
let userExclusions = [];

function setExclusions(list) {
  userExclusions = (Array.isArray(list) ? list : [])
    .filter((p) => typeof p === 'string' && p.length)
    .map(normalize);
}

function isExcluded(p) {
  if (typeof p !== 'string' || !p.length) return false;
  const abs = normalize(p);
  return userExclusions.some((ex) => isInside(abs, ex));
}

function listExclusions() {
  return [...userExclusions];
}

function addRuntimeAllowedRoot(p) {
  runtimeAllowedRoots.add(normalize(p));
}

function clearRuntimeAllowedRoots() {
  runtimeAllowedRoots.clear();
}

function listRuntimeAllowedRoots() {
  return [...runtimeAllowedRoots];
}

/**
 * Used by the folder picker. Refuses paths that are too broad (the home
 * dir, root, /System) or contain any never-touch subtree.
 */
function validatePickedRoot(p) {
  if (typeof p !== 'string' || !p) return { ok: false, reason: 'empty path' };
  const abs = normalize(p);

  if (abs === '/' || abs === HOME) return { ok: false, reason: 'too broad — pick a specific folder' };
  if (abs.startsWith('/System')) return { ok: false, reason: '/System is off-limits' };
  if (abs === '/Users') return { ok: false, reason: 'too broad — pick a specific folder' };

  // Reject if any never-touch entry would be inside this root.
  for (const block of NEVER_TOUCH) {
    if (isInside(block, abs)) {
      return { ok: false, reason: `would include protected path ${block}` };
    }
  }
  return { ok: true };
}

/**
 * Returns true iff `child` is inside `parent` (or equal to it). Uses path
 * segment boundaries so /tmp/foo isn't considered inside /tmp/foobar.
 */
function isInside(child, parent) {
  const c = normalize(child);
  const p = normalize(parent);
  if (c === p) return true;
  const withSep = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(withSep);
}

/**
 * The single safety gate. Every removal goes through this function.
 *
 * Returns { ok: true } if the path is inside an allowed root and not
 * inside any never-touch entry. Returns { ok: false, reason } otherwise.
 */
function checkPathSafety(p) {
  if (typeof p !== 'string' || !p.length) {
    return { ok: false, reason: 'empty path' };
  }
  const abs = normalize(p);

  // Reject obvious nonsense: root, home itself, Library itself.
  if (abs === '/' || abs === HOME || abs === path.join(HOME, 'Library')) {
    return { ok: false, reason: 'refusing to remove top-level directory' };
  }

  // User exclusions win over everything — if they said "never touch this",
  // we never touch it, even if it's inside an allowed root.
  if (isExcluded(abs)) {
    return { ok: false, reason: 'path is in your exclusions list' };
  }

  // Must be STRICTLY inside an allowed root — equal-to-root is rejected so
  // we never accidentally remove the root itself (which would wipe every
  // cache the user has). Only descendants are removable.
  const allowedRoot =
    ALLOWED_ROOTS.find((root) => isInside(abs, root) && abs !== normalize(root)) ||
    [...runtimeAllowedRoots].find((root) => isInside(abs, root) && abs !== root);
  if (!allowedRoot) {
    return { ok: false, reason: 'not strictly inside any allowed root' };
  }

  // Must not be inside any never-touch entry.
  const blocked = NEVER_TOUCH.find((deny) => isInside(abs, deny));
  if (blocked) {
    return { ok: false, reason: `inside never-touch path: ${blocked}` };
  }

  return { ok: true, allowedRoot };
}

module.exports = {
  ALLOWED_ROOTS,
  NEVER_TOUCH,
  checkPathSafety,
  isInside,
  validatePickedRoot,
  addRuntimeAllowedRoot,
  clearRuntimeAllowedRoots,
  listRuntimeAllowedRoots,
  setExclusions,
  isExcluded,
  listExclusions,
};
