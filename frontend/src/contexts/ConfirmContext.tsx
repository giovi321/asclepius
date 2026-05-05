import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";

type Variant = "default" | "destructive";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState {
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      // If another confirm is somehow already open, resolve it to false so we
      // don't leak listeners.
      if (resolveRef.current) {
        resolveRef.current(false);
        resolveRef.current = null;
      }
      resolveRef.current = resolve;
      setPending({ opts, resolve });
    });
  }, []);

  const close = (value: boolean) => {
    if (resolveRef.current) {
      resolveRef.current(value);
      resolveRef.current = null;
    }
    setPending(null);
  };

  const destructive = pending?.opts.variant === "destructive";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog.Root
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[91] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-5 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                close(true);
              }
            }}
          >
            <div className="flex items-start gap-3">
              {destructive && (
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-base font-semibold">
                  {pending?.opts.title}
                </Dialog.Title>
                {pending?.opts.description && (
                  <Dialog.Description className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                    {pending.opts.description}
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close
                onClick={() => close(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                autoFocus
              >
                {pending?.opts.cancelText || "Cancel"}
              </button>
              <button
                onClick={() => close(true)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  destructive
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {pending?.opts.confirmText ||
                  (destructive ? "Delete" : "Confirm")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
