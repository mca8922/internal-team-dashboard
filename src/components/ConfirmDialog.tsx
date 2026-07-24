'use client';

// Confirm dialog — a modern modal card that replaces the browser's native
// confirm() banner. Mounted once via <ConfirmProvider>; any client component
// calls const confirm = useConfirm() and awaits confirm({...}), which resolves
// to true (confirmed) or false (cancelled / dismissed).
import * as React from 'react';
import { Icon, type IconName } from './Icon';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  icon?: IconName;
}

type Resolver = (ok: boolean) => void;

const ConfirmCtx = React.createContext<(opts: ConfirmOptions) => Promise<boolean>>(() =>
  Promise.resolve(false),
);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<Resolver | null>(null);

  const confirm = React.useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(o);
    });
  }, []);

  const close = React.useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  // Escape cancels, Enter confirms — keyboard parity with native confirm().
  React.useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts, close]);

  const danger = opts?.tone === 'danger';

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts ? (
        <div className="modal-backdrop confirm-backdrop" onClick={() => close(false)}>
          <div
            className="confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-label={opts.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`confirm-icon${danger ? ' danger' : ''}`}>
              <Icon name={opts.icon || (danger ? 'trash' : 'bell')} size={22} />
            </div>
            <h2 className="confirm-title">{opts.title}</h2>
            {opts.message ? <p className="confirm-message">{opts.message}</p> : null}
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => close(false)}>
                {opts.cancelLabel || 'Cancel'}
              </button>
              <button
                className={`btn${danger ? ' btn-danger' : ''}`}
                onClick={() => close(true)}
                autoFocus
              >
                {opts.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return React.useContext(ConfirmCtx);
}
