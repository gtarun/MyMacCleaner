#!/usr/bin/env node
// Bump package.json (and package-lock.json) using npm semver rules.
//
//   npm run bump              # patch (default)
//   npm run bump patch
//   npm run bump minor
//   npm run bump major

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

const LEVELS = new Set([
  'patch',
  'minor',
  'major',
  'prepatch',
  'preminor',
  'premajor',
  'prerelease',
]);

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  return pkg.version;
}

function previewBump(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) return null;
  let maj = Number(match[1]);
  let min = Number(match[2]);
  let pat = Number(match[3]);
  const pre = match[4];

  switch (level) {
    case 'major':
      maj += 1;
      min = 0;
      pat = 0;
      break;
    case 'minor':
      min += 1;
      pat = 0;
      break;
    case 'patch':
      pat += 1;
      break;
    default:
      return null;
  }
  return `${maj}.${min}.${pat}${pre}`;
}

function bumpVersion(level, { dryRun = false } = {}) {
  if (!LEVELS.has(level)) {
    throw new Error(`invalid bump level "${level}" (use patch, minor, or major)`);
  }

  const before = readVersion();
  if (dryRun) {
    const after = previewBump(before, level) || `(npm version ${level})`;
    return { before, after, level, dryRun: true };
  }

  execFileSync('npm', ['version', level, '--no-git-tag-version'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const after = readVersion();
  return { before, after, level, dryRun: false };
}

function fail(msg) {
  console.error(`bump: ${msg}`);
  process.exit(1);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const level = argv.find((a) => !a.startsWith('-')) || 'patch';

  if (!LEVELS.has(level)) {
    fail(`invalid level "${level}" — use: ${[...LEVELS].join(', ')}`);
  }

  const before = readVersion();
  if (dryRun) {
    const after = previewBump(before, level);
    console.log(`bump: dry run — ${before} → ${after ?? '(prerelease bump via npm)'}`);
    process.exit(0);
  }

  const result = bumpVersion(level);
  console.log(`bump: ${result.before} → ${result.after}`);
}

module.exports = { LEVELS, bumpVersion, previewBump, readVersion, PKG_PATH, ROOT };
