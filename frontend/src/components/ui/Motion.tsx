import { animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { ChevronsRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/hooks";

/** A number that springs to its new value. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const spring = useSpring(value, { stiffness: 140, damping: 22 });
  const text = useTransform(spring, (v) => Math.round(v).toString());
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  return <motion.span className={cn("tabular", className)}>{text}</motion.span>;
}

/** Page-level enter animation. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const HANDLE = 56;
const PAD = 6;

/**
 * Slide the handle to the end to confirm. Prevents accidental taps for
 * actions like starting or ending a trip. Enter/Space on the handle also works.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  tone = "brand",
  disabled,
  busy,
}: {
  label: string;
  onConfirm: () => void | Promise<void>;
  tone?: "brand" | "red" | "green";
  disabled?: boolean;
  busy?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(240);
  const x = useMotionValue(0);
  const labelOpacity = useTransform(x, [0, max * 0.55], [1, 0]);
  const fillWidth = useTransform(x, (v) => v + HANDLE + PAD * 2);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setMax(Math.max(0, el.clientWidth - HANDLE - PAD * 2));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!busy) void animate(x, 0, { type: "spring", stiffness: 400, damping: 34 });
  }, [busy, x]);

  const confirm = async () => {
    void animate(x, max, { type: "spring", stiffness: 500, damping: 40 });
    if (navigator.vibrate) navigator.vibrate(18);
    await onConfirm();
  };

  const palette =
    tone === "red"
      ? { track: "bg-rose-50 ring-rose-100", fill: "bg-rose-500", handle: "bg-rose-600", text: "text-rose-700" }
      : tone === "green"
        ? { track: "bg-emerald-50 ring-emerald-100", fill: "bg-emerald-500", handle: "bg-emerald-600", text: "text-emerald-800" }
        : { track: "bg-brand-50 ring-brand-100", fill: "bg-brand-500", handle: "bg-brand-600", text: "text-brand-800" };

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-[68px] w-full select-none overflow-hidden rounded-[26px] ring-1",
        palette.track,
        (disabled || busy) && "opacity-70",
      )}
    >
      <motion.div
        className={cn("absolute inset-y-0 left-0 rounded-[26px] opacity-25", palette.fill)}
        style={{ width: fillWidth }}
      />
      <motion.span
        style={{ opacity: labelOpacity }}
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center pl-12 text-base font-bold",
          palette.text,
        )}
      >
        {label}
        <ChevronsRight className="ml-1 size-5 animate-pulse" />
      </motion.span>
      <motion.button
        type="button"
        aria-label={label}
        disabled={disabled || busy}
        drag={disabled || busy ? false : "x"}
        dragConstraints={{ left: 0, right: max }}
        dragElastic={0.02}
        dragMomentum={false}
        style={{ x }}
        onDragEnd={() => {
          if (x.get() > max * 0.82) void confirm();
          else void animate(x, 0, { type: "spring", stiffness: 500, damping: 32 });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void confirm();
          }
        }}
        whileTap={{ scale: 0.96 }}
        className={cn(
          "absolute left-[6px] top-[6px] flex size-14 touch-none items-center justify-center rounded-[20px] text-white shadow-lg",
          palette.handle,
        )}
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <ChevronsRight className="size-7" />}
      </motion.button>
    </div>
  );
}
