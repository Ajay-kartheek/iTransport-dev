import { X } from "lucide-react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { cn, useMediaQuery } from "../../lib/hooks";

/** A dialog: a bottom sheet on phones, a centred card on larger screens. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const desktop = useMediaQuery("(min-width: 640px)");
  const drag = useDragControls();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("input:not([disabled]), select, textarea, button[data-autofocus]")
        ?.focus();
    }, 120);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-slate-900/35 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            className={cn(
              "relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-float",
              "rounded-t-4xl sm:rounded-4xl",
              wide ? "sm:max-w-2xl" : "sm:max-w-lg",
            )}
            initial={desktop ? { opacity: 0, scale: 0.96, y: 12 } : { y: "100%" }}
            animate={desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={desktop ? { opacity: 0, scale: 0.97, y: 8 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            drag={desktop ? false : "y"}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 700) onClose();
            }}
          >
            {!desktop && (
              <div
                className="flex touch-none justify-center pb-1 pt-3"
                onPointerDown={(event) => drag.start(event)}
              >
                <span className="h-1.5 w-11 rounded-full bg-slate-200" />
              </div>
            )}
            <div className="flex items-start gap-3 px-6 pb-2 pt-3 sm:pt-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
                {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 flex size-10 items-center justify-center rounded-2xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">{children}</div>
            {footer && (
              <div className="safe-bottom flex gap-3 border-t border-slate-100 bg-slate-50/60 px-6 pt-4 sm:pb-4">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
