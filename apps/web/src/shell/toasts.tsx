import { Toast } from "@the-office/ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** How long a toast stays before it goes by itself. */
const TOAST_MS = 4000;

/** A Notification's toast stays longer: it brings something the user didn't just do. */
const NOTICE_MS = 10_000;

type ShowToast = (text: string) => void;

/** A toast with who speaks and what about, kept under the key it can be dismissed by. */
export interface Notice {
  readonly key: string;
  readonly title: ReactNode;
  readonly description: ReactNode;
}

export interface Notices {
  show(notice: Notice): void;
  dismiss(key: string): void;
}

const ToastContext = createContext<ShowToast | undefined>(undefined);
const NoticesContext = createContext<Notices | undefined>(undefined);

interface ShownToast {
  readonly key: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
}

/**
 * Shows short messages in the page's corner, the in-app channel: a confirmation of what the user
 * just did, or a Notification's notice. The stack itself has no role: each Toast is a status of
 * its own.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<readonly ShownToast[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((key: string) => {
    setToasts((shown) => shown.filter((toast) => toast.key !== key));
  }, []);
  const add = useCallback(
    (toast: ShownToast, stayMs: number) => {
      setToasts((shown) => [...shown.filter(({ key }) => key !== toast.key), toast]);
      setTimeout(() => dismiss(toast.key), stayMs);
    },
    [dismiss],
  );
  const showToast = useCallback<ShowToast>(
    (text) => add({ key: `toast-${nextId.current++}`, title: text }, TOAST_MS),
    [add],
  );
  const notices = useMemo<Notices>(
    () => ({
      show: ({ key, title, description }) => add({ key, title, description }, NOTICE_MS),
      dismiss,
    }),
    [add, dismiss],
  );
  return (
    <ToastContext value={showToast}>
      <NoticesContext value={notices}>
        {children}
        <div className="toasts">
          {toasts.map((toast) => (
            <Toast
              key={toast.key}
              title={toast.title}
              description={toast.description}
              onClose={() => dismiss(toast.key)}
            />
          ))}
        </div>
      </NoticesContext>
    </ToastContext>
  );
}

export function useToast(): ShowToast {
  const showToast = useContext(ToastContext);
  if (showToast === undefined) throw new Error("useToast needs the shell's ToastProvider.");
  return showToast;
}

export function useNotices(): Notices {
  const notices = useContext(NoticesContext);
  if (notices === undefined) throw new Error("useNotices needs the shell's ToastProvider.");
  return notices;
}
