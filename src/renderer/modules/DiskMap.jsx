import { useMemo, useState } from 'react';
import { formatBytes, formatCount, abbreviateHome } from '../lib/format.js';

// Disk space visualizer. Renders a squarified treemap of a folder's size
// tree (one level at a time), with drill-down and a path breadcrumb.
//
// Navigation:
//   - Click a folder block → drill in. If that folder's children were
//     loaded in the current scan, it's instant; if it's deeper than the
//     scan depth, we kick off a fresh scan rooted there.
//   - Click a breadcrumb segment → scan that absolute path.
// Files and bundles are leaves (no drill).

const VIEW_W = 1000;
const VIEW_H = 580;

/* ── Squarified treemap layout ─────────────────────────────────────── */
function rowWorst(row, side) {
  const areas = row.map((r) => r.area);
  const sum = areas.reduce((a, b) => a + b, 0);
  const mx = Math.max(...areas);
  const mn = Math.min(...areas);
  const s2 = side * side;
  const sum2 = sum * sum;
  if (sum2 === 0 || s2 === 0 || mn === 0) return Infinity;
  return Math.max((s2 * mx) / sum2, sum2 / (s2 * mn));
}

function squarify(children, x, y, width, height) {
  const out = [];
  const total = children.reduce((s, c) => s + c.bytes, 0);
  if (total <= 0 || width <= 0 || height <= 0) return out;
  const totalArea = width * height;
  const items = children.map((c) => ({ node: c, area: (c.bytes / total) * totalArea }));

  let rect = { x, y, w: width, h: height };
  let row = [];
  let i = 0;

  function commit(theRow, theRect, horizontal) {
    const sum = theRow.reduce((a, r) => a + r.area, 0);
    if (sum <= 0) return theRect;
    if (horizontal) {
      const rh = sum / theRect.w;
      let cx = theRect.x;
      for (const r of theRow) { const rw = r.area / rh; out.push({ node: r.node, x: cx, y: theRect.y, w: rw, h: rh }); cx += rw; }
      return { x: theRect.x, y: theRect.y + rh, w: theRect.w, h: theRect.h - rh };
    }
    const rw = sum / theRect.h;
    let cy = theRect.y;
    for (const r of theRow) { const rh = r.area / rw; out.push({ node: r.node, x: theRect.x, y: cy, w: rw, h: rh }); cy += rh; }
    return { x: theRect.x + rw, y: theRect.y, w: theRect.w - rw, h: theRect.h };
  }

  while (i < items.length) {
    const horizontal = rect.w < rect.h;
    const side = horizontal ? rect.w : rect.h;
    const cand = items[i];
    if (row.length === 0 || rowWorst([...row, cand], side) <= rowWorst(row, side)) {
      row.push(cand);
      i += 1;
    } else {
      rect = commit(row, rect, horizontal);
      row = [];
    }
  }
  if (row.length) commit(row, rect, rect.w < rect.h);
  return out;
}

// A folder block is drillable if it has loaded children, or it's a real
// (non-bundle, non-aggregate) directory we can re-scan.
function isDrillable(node) {
  if (!node.dir) return false;
  if (node.aggregate || node.bundle) return false;
  return Array.isArray(node.children) || !!node.path;
}

function fillFor(node, i) {
  if (node.aggregate) return 'rgba(255,255,255,0.07)';
  if (!node.dir) return `hsl(350, 30%, ${30 + (i % 5) * 4}%)`;     // files: muted
  const light = 56 - Math.min(22, i * 2);                          // folders: rose ramp
  return `hsl(350, 72%, ${Math.max(34, light)}%)`;
}

export function DiskMap({ isActive }) {
  const [scan, setScan] = useState(null);
  const [stack, setStack] = useState([]);   // nodes within the current scan
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [hover, setHover] = useState(null);

  const viewNode = stack[stack.length - 1] || null;

  async function runScan(root) {
    setScanning(true);
    setError(null);
    setProgress(null);
    // Subscribe to progress for this scan via the shared channel.
    const off = window.api.onScanProgress?.((p) => {
      if (p.scope === 'disk-map' && p.phase !== 'done') setProgress(p);
    });
    try {
      const r = await window.api.scanDiskMap(root ? { root } : {});
      setScan(r);
      setStack([r.node]);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      off?.();
      setScanning(false);
      setProgress(null);
    }
  }

  async function chooseFolder() {
    const r = await window.api.pickPaths();
    if (r.canceled || r.paths.length === 0) return;
    runScan(r.paths[0]);
  }

  function onBlockClick(node) {
    if (!isDrillable(node)) return;
    if (Array.isArray(node.children) && node.children.length > 0) {
      setStack((s) => [...s, node]);
    } else if (node.path) {
      runScan(node.path);   // deeper than the scan — re-scan rooted here
    }
  }

  // Breadcrumb segments from the current view node's absolute path.
  const crumbs = useMemo(() => {
    if (!viewNode?.path) return [];
    const parts = viewNode.path.split('/').filter(Boolean);
    const out = [];
    let acc = '';
    for (const p of parts) { acc += `/${p}`; out.push({ label: p, path: acc }); }
    return out;
  }, [viewNode]);

  const tiles = useMemo(() => {
    if (!viewNode?.children) return [];
    return squarify(viewNode.children, 0, 0, VIEW_W, VIEW_H);
  }, [viewNode]);

  return (
    <div className="module">
      <header className="module__header">
        <h1 className="module__title">Disk Space</h1>
        <p className="module__subtitle">
          A live map of what's actually using your disk. Bigger block = more space. Click a folder to dive in.
        </p>
      </header>

      {error && <div className="module__error">Scan failed: {error}</div>}

      {!scan && !scanning && (
        <div className="welcome" style={{ padding: '20px 0 0' }}>
          <div className="map-cta">
            <button className="btn btn--primary" onClick={() => runScan()}>Scan Home folder</button>
            <button className="btn btn--ghost" onClick={chooseFolder}>Choose a folder…</button>
          </div>
          <p className="welcome__note" style={{ marginTop: 18 }}>
            Mapping a large folder reads every file's size, so the first scan can take a little while.
            Excluded folders (Settings → Safety) are skipped.
          </p>
        </div>
      )}

      {scanning && (
        <div className="module__card scan-state">
          <div className="spinner" />
          <p className="scan-state__text">Measuring disk usage…</p>
          <p className="scan-state__hint">
            {progress?.currentItem && <><code>{progress.currentItem}</code> · </>}
            {formatCount(progress?.dirs || 0)} folders · {formatCount(progress?.files || 0)} files
          </p>
        </div>
      )}

      {scan && !scanning && viewNode && (
        <>
          <div className="map-bar">
            <div className="map-breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c.path} className="map-crumb">
                  {i > 0 && <span className="map-crumb__sep">/</span>}
                  <button
                    className="map-crumb__btn"
                    disabled={i === crumbs.length - 1}
                    onClick={() => runScan(c.path)}
                  >
                    {i === 0 ? abbreviateHome(c.path) : c.label}
                  </button>
                </span>
              ))}
            </div>
            <div className="map-bar__right">
              <span className="map-total">{formatBytes(viewNode.bytes)} · {formatCount(viewNode.fileCount)} files</span>
              <button className="btn btn--ghost" onClick={() => runScan(scan.root)}>Rescan</button>
            </div>
          </div>

          <div className="map-canvas">
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="map-svg">
              {tiles.map((t, i) => {
                const drill = isDrillable(t.node);
                const showLabel = t.w > 84 && t.h > 30;
                return (
                  <g
                    key={(t.node.path || t.node.name) + i}
                    className={`map-tile ${drill ? 'map-tile--drill' : ''}`}
                    onClick={() => onBlockClick(t.node)}
                    onMouseEnter={() => setHover({ node: t.node })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <rect
                      x={t.x + 1} y={t.y + 1}
                      width={Math.max(0, t.w - 2)} height={Math.max(0, t.h - 2)}
                      rx="3"
                      fill={fillFor(t.node, i)}
                      stroke="rgba(0,0,0,0.35)"
                      strokeWidth="1"
                    />
                    {showLabel && (
                      <text x={t.x + 9} y={t.y + 20} className="map-tile__label">
                        {t.node.name.length > Math.floor(t.w / 8) ? t.node.name.slice(0, Math.floor(t.w / 8)) + '…' : t.node.name}
                      </text>
                    )}
                    {showLabel && t.h > 46 && (
                      <text x={t.x + 9} y={t.y + 38} className="map-tile__size">{formatBytes(t.node.bytes)}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="map-hint">
            {hover
              ? <><strong>{hover.node.name}</strong> — {formatBytes(hover.node.bytes)} · {formatCount(hover.node.fileCount)} files{hover.node.bundle ? ' · app bundle' : ''}{!isDrillable(hover.node) && !hover.node.dir ? ' · file' : ''}</>
              : 'Hover a block for details. Click a folder to drill in; click a breadcrumb to jump.'}
          </div>
        </>
      )}
    </div>
  );
}
