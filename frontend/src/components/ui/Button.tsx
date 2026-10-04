import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/hooks";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerSoft" | "soft" | "success";
type Size = "sm" | "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-glow hover:bg-brand-700 disabled:bg-brand-300 disabled:shadow-none",
  secondary:
    "bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300 disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  dangerSoft:
    "bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 hover:ring-rose-300 disabled:text-rose-300",
  soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:text-brand-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-xl",
  md: "h-11 px-4 text-[15px] gap-2 rounded-2xl",
  lg: "h-13 px-5 text-base gap-2 rounded-2xl",
  xl: "h-16 px-6 text-lg gap-3 rounded-3xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  block,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex select-none items-center justify-center font-semibold transition-[transform,background-color,box-shadow,color] duration-150 active:scale-[0.97] disabled:active:scale-100",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-[1.1em] animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 active:scale-95 disabled:pointer-events-none disabled:opacity-35",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
