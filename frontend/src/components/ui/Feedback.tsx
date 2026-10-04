import { AlertTriangle, CircleCheck, Info, Loader2, XCircle } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "../../lib/hooks";

type Tone = "brand" | "green" | "red" | "amber" | "slate" | "bus";

const tones: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  red: "bg-rose-50 text-rose-700 ring-rose-100",
  amber: "bg-amber-50 text-amber-800 ring-amber-100",
  slate: "bg-slate-100 text-slate-600 ring-slate-200/70",
  bus: "bg-bus-100 text-bus-700 ring-bus-200",
};

export function Badge({
  tone = "slate",
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-bold ring-1",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function LiveDot({ tone = "green", className }: { tone?: "green" | "amber" | "slate"; className?: string }) {
  const color =
    tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-slate-400";
  return (
    <span className={cn("relative inline-flex size-2.5", className)}>
      {tone !== "slate" && (
        <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", color)} />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-brand-600", className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-2xl", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col items-center px-6 py-10 text-center", className)}
    >
      {icon && (
        <div className="mb-4 flex size-14 items-center justify-center rounded-3xl bg-brand-50 text-brand-600">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

const bannerIcons = {
  info: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  error: XCircle,
};

const bannerTones = {
  info: "bg-brand-50 text-brand-800 ring-brand-100",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-100",
  warning: "bg-amber-50 text-amber-900 ring-amber-200/70",
  error: "bg-rose-50 text-rose-800 ring-rose-100",
};

export function Banner({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: keyof typeof bannerTones;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const Icon = bannerIcons[tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={cn("flex items-start gap-3 rounded-3xl p-4 text-sm ring-1", bannerTones[tone], className)}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cn(title ? "mt-0.5" : "", "leading-relaxed opacity-90")}>{children}</div>}
      </div>
      {action}
    </motion.div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15 }}
        className="flex flex-col items-center gap-3"
      >
        <Spinner className="size-7" />
        <p className="text-sm font-medium text-slate-500">Loading…</p>
      </motion.div>
    </div>
  );
}
