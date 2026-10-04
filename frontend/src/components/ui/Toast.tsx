import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/hooks";

type Tone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
}

type Notify = (toast: { title: string; body?: string; tone?: Tone }) => void;

const ToastContext = createContext<Notify | null>(null);

const icons = { success: CircleCheck, error: TriangleAlert, info: Info };
const accents = {
  success: "text-emerald-600 bg-emerald-50",
  error: "text-rose-600 bg-rose-50",
  info: "text-brand-600 bg-brand-50",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    ({ title, body, tone = "success" }) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { id, title, body, tone }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3600);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {items.map((toast) => {
            const Icon = icons[toast.tone];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: -24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 520, damping: 36 }}
                className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-3xl border border-slate-200/70 bg-white/95 p-3.5 pr-2 shadow-float backdrop-blur"
              >
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-2xl", accents[toast.tone])}>
                  <Icon className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-bold text-slate-900">{toast.title}</p>
                  {toast.body && <p className="mt-0.5 text-sm leading-snug text-slate-500">{toast.body}</p>}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(toast.id)}
                  className="flex size-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext>
  );
}

export function useToast(): Notify {
  const notify = use(ToastContext);
  if (!notify) throw new Error("useToast must be used inside ToastProvider");
  return notify;
}
