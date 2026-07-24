'use client';

// Toast provider — ported from the prototype. Wraps the authenticated app.
import * as React from 'react';
import { Icon } from './Icon';

type ToastKind = 'success' | 'error' | 'warning';
interface ToastItem {
  id: string;
  msg: string;
  kind: ToastKind;
}

const ToastCtx = React.createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const push = React.useCallback((msg: string, kind: ToastKind = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
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
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastCtx);
}
