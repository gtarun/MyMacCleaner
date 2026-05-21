// Process list + kill, backed by macOS `ps`.
//
// `ps axo …` lets us pick exactly the columns we want. The `=` after
// each field name suppresses the header so we get pure data rows.
// We sort client-side (rather than relying on `ps -r`) because BSD ps
// behaves differently from GNU ps across macOS releases.

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Processes we refuse to kill from this app, regardless of UI nudging.
// These are either critical to keeping macOS running, or owned by
// system daemons that the user can't normally signal anyway.
const PROTECTED_NAMES = new Set([
  'launchd', 'kernel_task', 'WindowServer', 'loginwindow',
  'configd', 'logd', 'cfprefsd', 'syslogd', 'mds', 'mds_stores',
  'powerd', 'coreduetd', 'bluetoothd', 'wifid', 'distnoted',
  'opendirectoryd', 'securityd', 'trustd', 'systemstats',
  'SystemUIServer', // killing this freezes the menu bar
]);

const PROTECTED_USERS = new Set(['root', '_windowserver', '_coreaudiod', '_locationd']);

function isProtected(p) {
  if (!p) return true;
  if (p.pid <= 100) return true;
  if (PROTECTED_NAMES.has(p.command)) return true;
  if (PROTECTED_USERS.has(p.user)) return true;
  return false;
}

/**
 * Parse the output of `ps axo pid=,user=,%cpu=,%mem=,rss=,etime=,comm=,command=`.
 * Returns an array of process descriptors.
 */
function parsePs(stdout) {
  const out = [];
  for (const rawLine of stdout.split('\n')) {
    if (!rawLine.trim()) continue;
    // Whitespace-delimited up through `comm`. Everything after is the
    // full command line which may itself contain spaces.
    const m = rawLine.match(/^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, user, cpu, mem, rssKB, etime, command, fullCommand] = m;
    out.push({
      pid: Number(pid),
      user,
      cpu: Number(cpu),
      mem: Number(mem),
      rssBytes: Number(rssKB) * 1024,
      etime,
      command,                          // short command name (basename of executable)
      fullCommand,                      // full argv, used for friendly naming
      name: prettyName(command, fullCommand),
    });
  }
  return out;
}

/**
 * Try to surface a friendly name. For .app bundles, ps's `comm` is
 * usually the helper executable inside Contents/MacOS/ — recovering the
 * .app name produces a much better label.
 */
function prettyName(command, fullCommand) {
  // Look for /Applications/Foo.app/... or .../Frameworks/Foo Helper.app
  const m = fullCommand.match(/\/([^/]+)\.app\//);
  if (m) return m[1];
  return command;
}

async function listProcesses({ limit = 80, sortBy = 'mem' } = {}) {
  let stdout;
  try {
    const r = await execFileAsync('ps', [
      'axo', 'pid=,user=,%cpu=,%mem=,rss=,etime=,comm=,command=',
    ], { maxBuffer: 4 * 1024 * 1024 });
    stdout = r.stdout;
  } catch (err) {
    throw new Error(`ps failed: ${err.message || err}`);
  }

  let procs = parsePs(stdout);
  // Skip our own electron helper processes — the user can't usefully
  // kill them and they'd appear as "MacCleaner Helper (Renderer)" etc.
  procs = procs.filter((p) => !p.command.includes('MacCleaner'));

  // Sort & cap.
  const key = sortBy === 'cpu' ? 'cpu' : 'rssBytes';
  procs.sort((a, b) => b[key] - a[key]);
  procs = procs.slice(0, limit);

  // Annotate with protected flag so the UI can disable the kill button.
  for (const p of procs) p.protected = isProtected(p);

  return {
    snapshotAt: Date.now(),
    sortBy,
    items: procs,
  };
}

/**
 * Send SIGTERM (default) or SIGKILL to a PID. Refuses to signal anything
 * on the protected list — defense in depth, since the UI also gates this.
 */
async function killProcess(pid, { force = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, error: 'invalid pid' };
  }
  // Re-resolve the process to apply the same protections the UI uses.
  const { items } = await listProcesses({ limit: 5000 });
  const target = items.find((p) => p.pid === pid);
  if (!target) return { ok: false, error: 'process not found (already exited?)' };
  if (target.protected) return { ok: false, error: `refusing to signal protected process: ${target.command}` };

  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(pid, signal);
    return { ok: true, pid, signal, name: target.name };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { listProcesses, killProcess };
