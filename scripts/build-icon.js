#!/usr/bin/env node
// Build icon.icns from build/icon.svg.
//
// Pipeline:
//   1. sharp rasterizes the SVG into each iconset PNG size macOS expects.
//   2. macOS's built-in iconutil bundles them into icon.icns.
//
// This script only runs on macOS. iconutil ships with Xcode CLI tools
// (which most dev Macs already have). Run once after editing icon.svg:
//
//     npm run build:icon
//
// The resulting build/icon.icns is what electron-builder picks up.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('build-icon: `sharp` is not installed. Run `npm install` first.');
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.error('build-icon: must run on macOS (uses iconutil).');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'build', 'icon.svg');
const ICONSET = path.join(ROOT, 'build', 'icon.iconset');
const OUT = path.join(ROOT, 'build', 'icon.icns');

if (!fs.existsSync(SRC)) {
  console.error(`build-icon: source not found at ${SRC}`);
  process.exit(1);
}

// Apple's required iconset entries. Filename pattern is fixed; iconutil
// pairs the @1x and @2x variants at packaging time.
const ENTRIES = [
  { name: 'icon_16x16.png',      size: 16 },
  { name: 'icon_16x16@2x.png',   size: 32 },
  { name: 'icon_32x32.png',      size: 32 },
  { name: 'icon_32x32@2x.png',   size: 64 },
  { name: 'icon_128x128.png',    size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png',    size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png',    size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

(async () => {
  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });

  const svg = fs.readFileSync(SRC);
  for (const e of ENTRIES) {
    const dst = path.join(ICONSET, e.name);
    await sharp(svg, { density: 384 })
      .resize(e.size, e.size, { fit: 'fill' })
      .png()
      .toFile(dst);
    process.stdout.write(`✓ ${e.name} (${e.size}px)\n`);
  }

  execFileSync('iconutil', ['-c', 'icns', '-o', OUT, ICONSET], { stdio: 'inherit' });
  fs.rmSync(ICONSET, { recursive: true, force: true });
  console.log(`✓ wrote ${path.relative(ROOT, OUT)}`);

  // ── Tray icon ───────────────────────────────────────────────────
  // Separate monochrome template image for the menu bar. Two sizes
  // for Retina (@2x). macOS recolors automatically.
  const TRAY_SRC = path.join(ROOT, 'build', 'tray-icon.svg');
  if (fs.existsSync(TRAY_SRC)) {
    const traySvg = fs.readFileSync(TRAY_SRC);
    await sharp(traySvg, { density: 384 })
      .resize(22, 22, { fit: 'fill' })
      .png()
      .toFile(path.join(ROOT, 'build', 'trayTemplate.png'));
    await sharp(traySvg, { density: 384 })
      .resize(44, 44, { fit: 'fill' })
      .png()
      .toFile(path.join(ROOT, 'build', 'trayTemplate@2x.png'));
    console.log('✓ wrote build/trayTemplate.png + @2x');
  }
})().catch((err) => {
  console.error('build-icon failed:', err.message || err);
  process.exit(1);
});
