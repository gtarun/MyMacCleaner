// Shared confirmation modal. Used before any destructive action.

export function ConfirmModal({ open, title, body, confirmLabel, onConfirm, onCancel, busy }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={busy ? null : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        <div className="modal__body">{body}</div>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
