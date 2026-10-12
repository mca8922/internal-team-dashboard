'use client';

// Toast provider — ported from the prototype. Wraps the authenticated app.
import * as React from 'react';
import { Icon } from './Icon';

type ToastKind = 'success' | 'error' | 'warning';
// An optional inline button (e.g. "Undo"). A toast carrying one stays up a
// little longer so there's time to reach it, and closes once it's clicked.
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: string;
  msg: string;
  kind: ToastKind;
  action?: ToastAction;
}

type PushToast = (msg: string, kind?: ToastKind, opts?: { action?: ToastAction }) => void;

const ToastCtx = React.createContext<PushToast>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const dismiss = React.useCallback(
    (id: string) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );
  const push = React.useCallback<PushToast>(
    (msg, kind = 'success', opts) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t, { id, msg, kind, action: opts?.action }]);
      setTimeout(() => dismiss(id), opts?.action ? 7000 : 3500);
    },
    [dismiss],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span style={{ display: 'inline-flex' }}>
              <Icon name={t.kind === 'error' ? 'x' : t.kind === 'warning' ? 'bell' : 'check'} size={14} />
            </span>
            <span>{t.msg}</span>
            {t.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.onClick();
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastCtx);
}
