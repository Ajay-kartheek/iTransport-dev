import { motion } from "motion/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Action bar pinned to the bottom of the screen. Rendered into <body> so the
 * page's enter/exit transforms can't turn `position: fixed` into "relative to
 * the page" while a transition runs.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return createPortal(
    <motion.div
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 360, damping: 32, delay: 0.1 }}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/90 backdrop-blur-xl"
    >
      <div className="safe-bottom mx-auto max-w-2xl space-y-3 px-4 pt-4">{children}</div>
    </motion.div>,
    document.body,
  );
}
