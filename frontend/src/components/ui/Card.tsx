import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "../../lib/hooks";

export function Card({ className, children, ...rest }: HTMLMotionProps<"section">) {
  return (
    <motion.section
      className={cn(
        "rounded-4xl border border-slate-200/70 bg-white shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.section>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-5 pt-5", className)}>
      {icon && (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-bold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const listItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 380, damping: 32 } },
} as const;

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
} as const;
