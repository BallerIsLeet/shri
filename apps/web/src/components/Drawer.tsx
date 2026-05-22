"use client";

import { useEffect, type ReactNode } from "react";

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element | null {
  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:text-ink"
          >
            Close
          </button>
        </header>
        <div className="space-y-4">{children}</div>
        {footer && (
          <footer className="mt-6 flex items-center justify-end gap-2 border-t border-ink/10 pt-4">
            {footer}
          </footer>
        )}
      </aside>
    </>
  );
}
