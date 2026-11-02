'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Toast = { id: number; message: string };
type ToastContextValue = (message: string) => void;

const ToastContext = createContext<ToastContextValue>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(0);

  const notify = useCallback((message: string) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        className={`toast${toast ? ' show' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast?.message ?? ''}
      </div>
    </ToastContext.Provider>
  );
}
