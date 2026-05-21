#!/usr/bin/env node
// Tag and push v{version} to trigger the GitHub Actions release workflow.
//
//   npm run release              # tag current package.json version
//   npm run release patch        # bump patch, commit, tag, push branch + tag
//   npm run release -- --dry-run
//   npm run release:build        # local DMGs only

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { LEVELS, bumpVersion, previewBump, readVersion, PKG_PATH, ROOT } = require('./bump');

const LOCK_PATH = path.join(ROOT, 'package-lock.json');

function run(cmd, args = []) {
  const line = [cmd, ...args].join(' ');
  console.log(`> ${line}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
}

function capture(cmd, args = []) {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT }).trim();
}

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noPushBranch = argv.includes('--no-push-branch');
const flags = new Set(['--dry-run', '--no-push-branch']);
const bumpLevel = argv.find((a) => !a.startsWith('-') && LEVELS.has(a));

function versionFilesChanged() {
  const lines = capture('git', ['status', '--porcelain', '--', 'package.json', 'package-lock.json']);
  return Boolean(lines);
}

function assertCleanOrOnlyVersionFiles() {
  const dirty = capture('git', ['status', '--porcelain']);
  if (!dirty) return;
  if (versionFilesChanged() && dirty.split('\n').every((line) => {
    const file = line.slice(3).trim();
    return file === 'package.json' || file === 'package-lock.json';
  })) {
    return;
  }
  fail('working tree is not clean — commit or stash unrelated changes before releasing');
}

try {
  capture('git', ['rev-parse', '--git-dir']);
} catch {
  fail('not a git repository');
}

const remote = 'origin';
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

if (bumpLevel) {
  assertCleanOrOnlyVersionFiles();

  const before = readVersion();
  if (dryRun) {
    const after = previewBump(before, bumpLevel) || `(${bumpLevel} via npm)`;
    console.log(`release: dry run — would bump ${bumpLevel}: ${before} → ${after}`);
    console.log('release: would commit package.json + package-lock.json');
  } else {
    bumpVersion(bumpLevel);
    run('git', ['add', 'package.json']);
    if (fs.existsSync(LOCK_PATH)) run('git', ['add', 'package-lock.json']);
    const version = readVersion();
    run('git', ['commit', '-m', `chore: release v${version}`]);
  }
} else {
  assertCleanOrOnlyVersionFiles();
  if (versionFilesChanged()) {
    fail('package.json / package-lock.json are modified — commit them or run `npm run release patch` to bump and commit');
  }
}

const version = readVersion();
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  fail(`invalid version in package.json: ${JSON.stringify(version)}`);
}

const tag = `v${version}`;

const existing = capture('git', ['tag', '-l', tag]);
if (existing) {
  fail(`tag ${tag} already exists — use a higher bump level or delete the tag`);
}

try {
  capture('git', ['rev-parse', '--verify', `${remote}/HEAD`]);
} catch {
  try {
    capture('git', ['rev-parse', '--verify', `${remote}/main`]);
  } catch {
    fail(`remote "${remote}" not found or has no main branch`);
  }
}

const aheadBehind = capture('git', ['rev-list', '--left-right', '--count', `${remote}/${branch}...HEAD`]);
const [behind, ahead] = aheadBehind.split(/\s+/).map(Number);
if (behind > 0) {
  fail(`branch ${branch} is ${behind} commit(s) behind ${remote}/${branch} — pull first`);
}

console.log(`release: version ${version} → tag ${tag} on ${branch}`);
if (ahead > 0 && !bumpLevel) {
  console.warn(`release: ${ahead} local commit(s) not on ${remote}/${branch} — will push branch with --no-push-branch omitted`);
}

if (dryRun) {
  console.log(`release: dry run — would tag ${tag} and push to ${remote}`);
  if (!noPushBranch) console.log(`release: would push ${remote} ${branch}`);
  console.log('release: GitHub Actions would upload dist-electron/*.dmg');
  process.exit(0);
}

run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);

if (!noPushBranch) {
  run('git', ['push', remote, branch]);
}
run('git', ['push', remote, tag]);

console.log('');
console.log(`release: pushed ${tag}${noPushBranch ? '' : ` and ${branch}`}`);
console.log('release: watch https://github.com/gtarun/MyMacCleaner/actions');
console.log(`release: assets → https://github.com/gtarun/MyMacCleaner/releases/tag/${tag}`);
