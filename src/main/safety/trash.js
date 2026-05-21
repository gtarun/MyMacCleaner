// Trash wrapper — the ONLY way the app removes anything from disk.
//
// Wraps electron.shell.trashItem and runs every path back through the
// allowlist before acting. If the scanner ever forgets to filter
// something, this gate stops it.

const { shell } = require('electron');
const { checkPathSafety } = require('./allowlist');

/**
 * Move a list of paths to the Trash, sequentially.
 *
 * Returns an array of { path, ok, dryRun?, error? } in input order. A
 * failed item does NOT abort subsequent items — partial success is what
 * the UI wants to render.
 *
 * `dryRun: true` runs the safety gate (so allowlist violations still
 * surface as errors) but never calls shell.trashItem. The result looks
 * identical to a successful run except each item carries `dryRun: true`,
 * which the UI uses to swap "Freed X.X GB" for "Would free X.X GB".
 */
async function trashItems(paths, { dryRun = false } = {}) {
  const results = [];
  for (const p of paths) {
    const safety = checkPathSafety(p);
    if (!safety.ok) {
      results.push({ path: p, ok: false, error: `blocked: ${safety.reason}` });
      continue;
    }
    if (dryRun) {
      results.push({ path: p, ok: true, dryRun: true });
      continue;
    }
    try {
      await shell.trashItem(p);
      results.push({ path: p, ok: true });
    } catch (err) {
      results.push({ path: p, ok: false, error: err.message || String(err) });
    }
  }
  return results;
}

module.exports = { trashItems };
