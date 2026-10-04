import { motion } from "motion/react";
import { type ReactNode, useId } from "react";

import { cn } from "../../lib/hooks";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  activeClass?: string;
}

/** A pill toggle whose highlight glides between options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  disabled,
  className,
  label,
}: {
  value: T | null;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  label: string;
}) {
  const layoutId = useId();
  const height = size === "sm" ? "h-9 text-[13px]" : size === "lg" ? "h-14 text-base" : "h-11 text-sm";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative flex rounded-2xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/60",
        disabled && "opacity-60",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(option.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 font-semibold transition-colors duration-200",
              height,
              active ? (option.activeClass ?? "text-slate-900") : "text-slate-500 hover:text-slate-800",
              disabled && "cursor-not-allowed",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className={cn(
                  "absolute inset-0 rounded-xl bg-white shadow-[0_1px_3px_rgb(16_24_40/0.12),0_1px_2px_rgb(16_24_40/0.06)]",
                )}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
