import type { ReactNode } from "react";

/**
 * Themed confirmation overlay aligned with Journal / Strategies delete modals.
 * Use instead of window.confirm for consistent UI.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  zIndex = 1200,
  confirmDanger = true,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  zIndex?: number;
  /** When false, confirm uses accent styling (e.g. non-destructive actions). */
  confirmDanger?: boolean;
}) {
  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: 12,
          padding: 24,
          width: "90%",
          maxWidth: 480,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 12,
            marginTop: 0,
            color: confirmDanger ? "var(--danger)" : "var(--text-primary)",
          }}
        >
          {title}
        </h3>
        <div
          style={{
            fontSize: 14,
            color: "var(--text-primary)",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          {children}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              padding: "10px 20px",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              background: confirmDanger ? "var(--danger)" : "var(--accent)",
              border: "none",
              borderRadius: 6,
              padding: "10px 20px",
              color: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
