// Mac Health collector.
//
// Pulls a snapshot of disk / memory / CPU / uptime in one call. The
// renderer polls this every few seconds while the Mac Health tab is
// active, so each individual collector must stay fast and side-effect
// free.
//
// Shell-outs:
//   - `df -k <home>`           → disk usage on the data volume
//   - `sysctl -n hw.model`     → friendly Mac model (MacBookAir10,1 etc.)
//   - `sw_vers -productName -productVersion`  → macOS marketing version

const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function diskUsage() {
  try {
    // -k → 1024-byte blocks. Asking df about $HOME gives us the data
    // volume (modern APFS Macs have a separate read-only system volume
    // that would otherwise be reported here).
    const { stdout } = await execFileAsync('df', ['-k', os.homedir()]);
    // Header line + one data line. Columns: filesystem, total, used,
    // available, capacity, ..., mounted-on. macOS df adds extra columns
    // before "Mounted on" so we split on whitespace and pick by index.
    const data = stdout.trim().split('\n')[1];
    if (!data) return null;
    const cols = data.split(/\s+/);
    const totalKB = parseInt(cols[1], 10);
    const usedKB  = parseInt(cols[2], 10);
    const freeKB  = parseInt(cols[3], 10);
    if ([totalKB, usedKB, freeKB].some(Number.isNaN)) return null;
    return {
      totalBytes: totalKB * 1024,
      usedBytes:  usedKB  * 1024,
      freeBytes:  freeKB  * 1024,
      percentUsed: usedKB / (usedKB + freeKB),
      mountPath: cols[cols.length - 1],
    };
  } catch {
    return null;
  }
}

function memoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: total - free,
    percentUsed: (total - free) / total,
  };
}

function cpuInfo() {
  const cpus = os.cpus();
  const load = os.loadavg();
  return {
    model: cpus[0]?.model || 'Unknown',
    cores: cpus.length,
    speedMHz: cpus[0]?.speed || 0,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    arch: os.arch(),
  };
}

function uptime() {
  return {
    seconds: os.uptime(),
    bootedAt: Date.now() - os.uptime() * 1000,
  };
}

async function macModel() {
  try {
    const { stdout } = await execFileAsync('sysctl', ['-n', 'hw.model']);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function macOSVersion() {
  try {
    const [{ stdout: nameOut }, { stdout: verOut }] = await Promise.all([
      execFileAsync('sw_vers', ['-productName']).catch(() => ({ stdout: 'macOS' })),
      execFileAsync('sw_vers', ['-productVersion']).catch(() => ({ stdout: os.release() })),
    ]);
    return { name: nameOut.trim() || 'macOS', version: verOut.trim() };
  } catch {
    return { name: 'macOS', version: os.release() };
  }
}

/**
 * One-shot snapshot. The renderer polls this; we make sure every async
 * collector runs in parallel so a single call stays under ~50ms even
 * when shell-outs are involved.
 */
async function getHealth() {
  const startedAt = Date.now();
  const [disk, model, osVer] = await Promise.all([
    diskUsage(),
    macModel(),
    macOSVersion(),
  ]);
  const mem = memoryUsage();
  const cpu = cpuInfo();
  const up = uptime();

  // Tiny health verdict, used by the UI to color the hero card.
  let verdict = 'Excellent';
  let reasons = [];
  if (disk && disk.percentUsed >= 0.90)      { verdict = 'Needs attention'; reasons.push('Disk over 90% full'); }
  else if (disk && disk.percentUsed >= 0.80) { verdict = 'Good';            reasons.push('Disk getting full'); }
  if (mem.percentUsed >= 0.92)               { verdict = 'Needs attention'; reasons.push('Memory pressure high'); }

  return {
    snapshotAt: startedAt,
    durationMs: Date.now() - startedAt,
    disk,
    memory: mem,
    cpu,
    uptime: up,
    host: {
      hostname: os.hostname(),
      model,
      ...osVer,
    },
    verdict,
    reasons,
  };
}

module.exports = { getHealth };
