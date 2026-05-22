// Inline SVG icon set.
//
// Two flavors live here:
//   - SidebarIcon — small monochrome line icons used in the nav rail.
//   - TileIcon    — larger icons with gradient fills meant to feel 3D-ish
//                   in the dashboard tiles.
//
// We deliberately avoid an icon library dependency. These are stamped
// inline so the bundle stays small and we can hand-tune the gradients
// to match each module's accent.

/* ─────────────────────────────────────────────────────────────────────
 * Sidebar icons (24×24, currentColor stroke, line style)
 * ──────────────────────────────────────────────────────────────────── */

const SvgWrap = ({ size = 22, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

export const SidebarIcon = {
  dashboard: () => (
    <SvgWrap>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </SvgWrap>
  ),
  systemJunk: () => (
    <SvgWrap>
      {/* Spray bottle / cleanup */}
      <path d="M9 3h4l1 3v2H8V6l1-3z" />
      <path d="M8 8h6v3l2 2v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8l2-2V8z" />
      <path d="M14 6h3a2 2 0 0 1 2 2v2" />
    </SvgWrap>
  ),
  largeOld: () => (
    <SvgWrap>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M8 13h8" />
      <path d="M8 16h5" />
    </SvgWrap>
  ),
  duplicates: () => (
    <SvgWrap>
      <rect x="4" y="4" width="13" height="13" rx="2" />
      <rect x="7" y="7" width="13" height="13" rx="2" />
    </SvgWrap>
  ),
  uninstaller: () => (
    <SvgWrap>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <path d="M14 17h7M17.5 13.5v7" />
    </SvgWrap>
  ),
  settings: () => (
    <SvgWrap>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5l1.5 2.5h2.5l1.2 2.2 2.2 1.3v2.5l1.6 2-1.6 2v2.5l-2.2 1.3-1.2 2.2H13.5L12 21.5 10.5 19H8l-1.2-2.2L4.6 15.5V13l-1.6-2 1.6-2V6.5l2.2-1.3L8 3h2.5z" />
    </SvgWrap>
  ),
  macHealth: () => (
    <SvgWrap>
      {/* Heart-pulse — health vibe without leaning on a literal heart */}
      <path d="M3 12h4l2-5 3 10 2-5h7" />
    </SvgWrap>
  ),
  performance: () => (
    <SvgWrap>
      {/* Lightning bolt — power / performance */}
      <path d="M13 3 L4 14 h6 l-1 7 L20 10 h-6 l1 -7 z" />
    </SvgWrap>
  ),
  sponsor: () => (
    <SvgWrap>
      {/* Heart — GitHub Sponsors */}
      <path d="M19.5 5.5a4.5 4.5 0 0 0-7.5 1.6A4.5 4.5 0 0 0 4.5 5.5C2.5 7.4 2.5 10.6 4.5 12.5L12 20l7.5-7.5c2-1.9 2-5.1 0-7z" />
    </SvgWrap>
  ),
  diskMap: () => (
    <SvgWrap>
      {/* Treemap blocks — disk space visualizer */}
      <rect x="3" y="3" width="11" height="11" rx="1.5" />
      <rect x="16" y="3" width="5" height="6" rx="1.5" />
      <rect x="16" y="11" width="5" height="10" rx="1.5" />
      <rect x="3" y="16" width="11" height="5" rx="1.5" />
    </SvgWrap>
  ),
  history: () => (
    <SvgWrap>
      {/* Counter-clockwise arrow around a clock — history / restore */}
      <path d="M3 5v5h5" />
      <path d="M3.5 10a9 9 0 1 1 1.5 5" />
      <path d="M12 8v4l3 2" />
    </SvgWrap>
  ),
  staleProjects: () => (
    <SvgWrap>
      {/* Folder with a clock — idle/stale project dirs */}
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h5a2 2 0 0 1 2 2v2.5" />
      <path d="M3 9v9a2 2 0 0 0 2 2h6" />
      <circle cx="17.5" cy="16.5" r="4.5" />
      <path d="M17.5 14.5v2l1.4 1.4" />
    </SvgWrap>
  ),
  systemData: () => (
    <SvgWrap>
      {/* Stacked database cylinders — opaque "System Data" */}
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" />
      <path d="M5 10.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" />
    </SvgWrap>
  ),
};

/* ─────────────────────────────────────────────────────────────────────
 * Tile icons (gradient fills — "3D-ish" approximation of CleanMyMac's
 * rendered icons). Each one accepts a `glow` color picked from the
 * module accent so the icon glows in the right hue.
 * ──────────────────────────────────────────────────────────────────── */

function TileSvg({ id, size = 60, children, glow = '#34c759', viewBox = '0 0 64 64' }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none">
      <defs>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id={`${id}-accent`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={glow} stopOpacity="0.95" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.55" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {/* Soft halo behind the shape */}
      <circle cx="32" cy="32" r="20" fill={glow} opacity="0.18" filter={`url(#${id}-soft)`} />
      {children}
    </svg>
  );
}

export const TileIcon = {
  // System Junk — sponge / cleanup icon
  systemJunk: ({ size = 60, glow = '#34c759' }) => (
    <TileSvg id="sj" size={size} glow={glow}>
      <rect x="14" y="22" width="36" height="28" rx="6" fill={`url(#sj-accent)`} />
      <rect x="14" y="22" width="36" height="9" rx="6" fill={`url(#sj-light)`} />
      <circle cx="22" cy="36" r="2.2" fill="#fff" opacity="0.7" />
      <circle cx="30" cy="42" r="1.8" fill="#fff" opacity="0.55" />
      <circle cx="40" cy="36" r="2.4" fill="#fff" opacity="0.8" />
      <circle cx="42" cy="44" r="1.6" fill="#fff" opacity="0.5" />
      <rect x="22" y="14" width="20" height="10" rx="3" fill={glow} opacity="0.85" />
      <rect x="22" y="14" width="20" height="4" rx="3" fill="#fff" opacity="0.3" />
    </TileSvg>
  ),

  // Large & Old — folder with stacked papers
  largeOld: ({ size = 60, glow = '#5fcad9' }) => (
    <TileSvg id="lo" size={size} glow={glow}>
      <rect x="14" y="20" width="36" height="30" rx="5" fill={`url(#lo-accent)`} />
      <path d="M14 25 L26 25 L30 22 L50 22 L50 28 L14 28 Z" fill={glow} opacity="0.85" />
      <rect x="14" y="20" width="36" height="7" rx="5" fill={`url(#lo-light)`} />
      <rect x="20" y="33" width="24" height="2.5" rx="1.25" fill="#fff" opacity="0.7" />
      <rect x="20" y="38" width="18" height="2.5" rx="1.25" fill="#fff" opacity="0.55" />
      <rect x="20" y="43" width="22" height="2.5" rx="1.25" fill="#fff" opacity="0.55" />
    </TileSvg>
  ),

  // Duplicates — two overlapping documents
  duplicates: ({ size = 60, glow = '#ff9f43' }) => (
    <TileSvg id="dup" size={size} glow={glow}>
      <rect x="14" y="14" width="26" height="34" rx="4" fill={glow} opacity="0.6" />
      <rect x="24" y="20" width="26" height="34" rx="4" fill={`url(#dup-accent)`} />
      <rect x="24" y="20" width="26" height="10" rx="4" fill={`url(#dup-light)`} />
      <rect x="29" y="33" width="16" height="2.4" rx="1.2" fill="#fff" opacity="0.7" />
      <rect x="29" y="38" width="12" height="2.4" rx="1.2" fill="#fff" opacity="0.55" />
      <rect x="29" y="43" width="14" height="2.4" rx="1.2" fill="#fff" opacity="0.55" />
    </TileSvg>
  ),

  // Uninstaller — apps grid with X mark
  uninstaller: ({ size = 60, glow = '#bf6bf2' }) => (
    <TileSvg id="un" size={size} glow={glow}>
      <rect x="12" y="12" width="16" height="16" rx="4" fill={glow} opacity="0.55" />
      <rect x="36" y="12" width="16" height="16" rx="4" fill={glow} opacity="0.75" />
      <rect x="12" y="36" width="16" height="16" rx="4" fill={`url(#un-accent)`} />
      <rect x="36" y="36" width="16" height="16" rx="4" fill={glow} opacity="0.4" />
      <rect x="12" y="12" width="16" height="6" rx="4" fill={`url(#un-light)`} />
      <rect x="36" y="36" width="16" height="6" rx="4" fill={`url(#un-light)`} />
    </TileSvg>
  ),

  // Stale Projects — folder with a clock badge
  staleProjects: ({ size = 60, glow = '#2dd4bf' }) => (
    <TileSvg id="stp" size={size} glow={glow}>
      <rect x="12" y="20" width="40" height="30" rx="5" fill={`url(#stp-accent)`} />
      <path d="M12 25 L26 25 L30 22 L52 22 L52 28 L12 28 Z" fill={glow} opacity="0.85" />
      <rect x="12" y="20" width="40" height="7" rx="5" fill={`url(#stp-light)`} />
      <circle cx="42" cy="42" r="11" fill="#1a1f24" stroke={glow} strokeWidth="2.5" />
      <path d="M42 36 L42 42 L46 45" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </TileSvg>
  ),

  // Dashboard — gauge / smart-care
  dashboard: ({ size = 60, glow = '#7b78f0' }) => (
    <TileSvg id="dash" size={size} glow={glow}>
      <circle cx="32" cy="32" r="20" fill="none" stroke={glow} strokeOpacity="0.35" strokeWidth="3" />
      <circle cx="32" cy="32" r="20" fill="none" stroke={`url(#dash-accent)`} strokeWidth="3"
              strokeDasharray="65 100" strokeLinecap="round" transform="rotate(-90 32 32)" />
      <circle cx="32" cy="32" r="12" fill={`url(#dash-accent)`} />
      <circle cx="32" cy="32" r="12" fill={`url(#dash-light)`} />
      <path d="M27 32 L31 36 L38 28" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </TileSvg>
  ),
};

/* ─────────────────────────────────────────────────────────────────────
 * Brand mark — used in the sidebar header.
 * ──────────────────────────────────────────────────────────────────── */

export function Brand({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5856d6" />
          <stop offset="100%" stopColor="#007aff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#brand-grad)" />
      <path d="M10 21l4-10 4 7 4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
