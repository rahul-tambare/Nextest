import React, { useState } from 'react';

/**
 * #3 Reusable confirmation modal for destructive actions.
 * Replaces browser confirm() with a styled modal.
 * 
 * Props:
 *   isOpen, onConfirm, onCancel, title, message,
 *   confirmText, cancelText, variant ('danger' | 'warning'),
 *   requireType (string to type to confirm, e.g. workspace name for bulk deletes)
 */
export default function ConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  requireType = null,
  itemCount = null,
}) {
  const [typed, setTyped] = useState('');

  if (!isOpen) return null;

  const canConfirm = requireType ? typed === requireType : true;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="confirm-modal-icon">
          {variant === 'danger' ? '⚠️' : '❓'}
        </div>
        <h3 className="confirm-modal-title">{title}</h3>
        <p className="confirm-modal-message">{message}</p>

        {itemCount != null && (
          <div className="confirm-modal-count">
            <span className="badge badge-error" style={{ fontSize: '12px' }}>
              {itemCount} item{itemCount !== 1 ? 's' : ''} will be affected
            </span>
          </div>
        )}

        {requireType && (
          <div className="confirm-modal-typebox">
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
              Type <strong style={{ color: 'var(--color-error)' }}>{requireType}</strong> to confirm:
            </p>
            <input
              className="input"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={requireType}
              autoFocus
            />
          </div>
        )}

        <div className="confirm-modal-actions">
          <button className="btn btn-ghost" onClick={() => { setTyped(''); onCancel(); }}>
            {cancelText}
          </button>
          <button
            className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => { setTyped(''); onConfirm(); }}
            disabled={!canConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
