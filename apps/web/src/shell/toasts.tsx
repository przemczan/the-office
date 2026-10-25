import { Toast } from "@the-office/ui";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/** How long a toast stays before it goes by itself. */
const TOAST_MS = 4000;

type ShowToast = (text: string) => void;

const ToastContext = createContext<ShowToast | undefined>(undefined);

interface ShownToast {
  readonly id: number;
  readonly text: string;
}

/**
 * Shows a short confirmation in the page's corner, the in-app channel for what just happened. The
 * stack itself has no role: each Toast is a status of its own.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<readonly ShownToast[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => {
    setToasts((shown) => shown.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback<ShowToast>(
    (text) => {
      const id = nextId.current++;
      setToasts((shown) => [...shown, { id, text }]);
      setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );
  return (
    <ToastContext value={showToast}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <Toast key={toast.id} title={toast.text} onClose={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ShowToast {
  const showToast = useContext(ToastContext);
  if (showToast === undefined) throw new Error("useToast needs the shell's ToastProvider.");
  return showToast;
}
