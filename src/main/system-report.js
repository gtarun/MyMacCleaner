// Full system report — a richer, one-shot collection of everything we
// can cheaply learn about the machine, grouped into sections for display.
//
// This backs the "System Information" panel the user opens from the
// sidebar card. Unlike health.js (which the Mac Health tab polls every
// few seconds), this runs once when the panel opens, so it can afford a
// few more shell-outs to gather identifiers, core counts, etc.
//
// Everything here is read-only and local. We deliberately avoid pulling
// hardware serial numbers or other personally-identifying device IDs.

const os = require('node:os');
const { app } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function sysctl(key) {
  try {
    const { stdout } = await execFileAsync('sysctl', ['-n', key]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function swVers(flag) {
  try {
    const { stdout } = await execFileAsync('sw_vers', [flag]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function diskUsage() {
  try {
    const { stdout } = await execFileAsync('df', ['-k', os.homedir()]);
    const data = stdout.trim().split('\n')[1];
    if (!data) return null;
    const cols = data.split(/\s+/);
    const totalKB = parseInt(cols[1], 10);
    const usedKB = parseInt(cols[2], 10);
    const freeKB = parseInt(cols[3], 10);
    if ([totalKB, usedKB, freeKB].some(Number.isNaN)) return null;
    return {
      filesystem: cols[0],
      totalBytes: totalKB * 1024,
      usedBytes: usedKB * 1024,
      freeBytes: freeKB * 1024,
      percentUsed: usedKB / (usedKB + freeKB),
      mountPath: cols[cols.length - 1],
    };
  } catch {
    return null;
  }
}

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function localIPv4s() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

/**
 * Build the categorized report. Returns:
 *   { generatedAt, sections: [ { title, items: [ { label, value } ] } ] }
 * Values are always strings so the renderer can copy them verbatim.
 */
async function getSystemReport() {
  const [
    chip, model, physCpu, logCpu, memSize,
    osVersion, osBuild, disk,
  ] = await Promise.all([
    sysctl('machdep.cpu.brand_string'),
    sysctl('hw.model'),
    sysctl('hw.physicalcpu'),
    sysctl('hw.logicalcpu'),
    sysctl('hw.memsize'),
    swVers('-productVersion'),
    swVers('-buildVersion'),
    diskUsage(),
  ]);

  const totalMem = memSize ? Number(memSize) : os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const load = os.loadavg();
  const ips = localIPv4s();

  const sections = [
    {
      title: 'Overview',
      items: [
        { label: 'Computer name', value: os.hostname() },
        { label: 'macOS', value: osVersion ? `macOS ${osVersion}${osBuild ? ` (${osBuild})` : ''}` : os.release() },
        { label: 'Model identifier', value: model || '—' },
        { label: 'Uptime', value: fmtUptime(os.uptime()) },
        { label: 'Booted', value: new Date(Date.now() - os.uptime() * 1000).toLocaleString() },
      ],
    },
    {
      title: 'Processor',
      items: [
        { label: 'Chip', value: chip || os.cpus()[0]?.model || '—' },
        { label: 'Architecture', value: os.arch() },
        { label: 'Physical cores', value: physCpu || '—' },
        { label: 'Logical cores', value: logCpu || String(os.cpus().length) },
        { label: 'Load average', value: `${load[0].toFixed(2)}, ${load[1].toFixed(2)}, ${load[2].toFixed(2)}` },
      ],
    },
    {
      title: 'Memory',
      items: [
        { label: 'Total', value: fmtBytes(totalMem) },
        { label: 'Used', value: `${fmtBytes(usedMem)} (${Math.round((usedMem / totalMem) * 100)}%)` },
        { label: 'Free', value: fmtBytes(freeMem) },
      ],
    },
    {
      title: 'Storage',
      items: disk ? [
        { label: 'Volume', value: disk.mountPath },
        { label: 'Filesystem', value: disk.filesystem },
        { label: 'Total', value: fmtBytes(disk.totalBytes) },
        { label: 'Used', value: `${fmtBytes(disk.usedBytes)} (${Math.round(disk.percentUsed * 100)}%)` },
        { label: 'Free', value: fmtBytes(disk.freeBytes) },
      ] : [{ label: 'Storage', value: 'unavailable' }],
    },
    {
      title: 'Network',
      items: ips.length
        ? ips.map((ip) => ({ label: ip.name, value: ip.address }))
        : [{ label: 'Local IP', value: 'no active network interface' }],
    },
    {
      title: 'Software',
      items: [
        { label: 'MacCleaner', value: safeAppVersion() },
        { label: 'Electron', value: process.versions.electron || '—' },
        { label: 'Chromium', value: process.versions.chrome || '—' },
        { label: 'Node', value: process.versions.node || '—' },
        { label: 'V8', value: process.versions.v8 || '—' },
        { label: 'User', value: os.userInfo().username },
        { label: 'Home', value: os.homedir() },
      ],
    },
  ];

  return { generatedAt: Date.now(), sections };
}

function safeAppVersion() {
  try { return app.getVersion(); } catch { return '—'; }
}

module.exports = { getSystemReport };
