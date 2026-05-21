import { useEffect, useState } from 'react';

// System Information panel. Opened from the sidebar info card. Fetches a
// one-shot categorized report from the main process and renders it as
// copyable sections — click any value to copy it, or "Copy all" to grab
// the whole report as plain text (handy for support threads / bug reports).

function reportToText(report) {
  if (!report?.sections) return '';
  const lines = ['MacCleaner — System Information', ''];
  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    for (const item of section.items) {
      lines.push(`${item.label}: ${item.value}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SystemInfoModal({ open, onClose }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setReport(null);
    setError(null);
    window.api.getSystemReport()
      .then((r) => { if (alive) setReport(r); })
      .catch((e) => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function flash(key, text) {
    const ok = await copyText(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    }
  }

  return (
    <div className="sysmodal" role="dialog" aria-modal="true" aria-label="System Information">
      <div className="sysmodal__backdrop" onClick={onClose} />
      <div className="sysmodal__panel">
        <header className="sysmodal__header">
          <h2 className="sysmodal__title">System Information</h2>
          <div className="sysmodal__header-actions">
            <button
              className="btn btn--ghost"
              disabled={!report}
              onClick={() => flash('__all__', reportToText(report))}
            >
              {copiedKey === '__all__' ? 'Copied!' : 'Copy all'}
            </button>
            <button className="sysmodal__close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>

        <div className="sysmodal__body">
          {error && <div className="module__error">Couldn't read system info: {error}</div>}
          {!report && !error && <div className="sysmodal__loading">Reading system information…</div>}

          {report?.sections.map((section) => (
            <div key={section.title} className="sysmodal__section">
              <div className="sysmodal__section-title">{section.title}</div>
              <div className="sysmodal__rows">
                {section.items.map((item, i) => {
                  const key = `${section.title}-${i}`;
                  return (
                    <button
                      key={key}
                      className="sysmodal__row"
                      title="Click to copy"
                      onClick={() => flash(key, `${item.value}`)}
                    >
                      <span className="sysmodal__row-label">{item.label}</span>
                      <span className="sysmodal__row-value">{item.value}</span>
                      <span className="sysmodal__row-copy">
                        {copiedKey === key ? 'Copied' : 'Copy'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
