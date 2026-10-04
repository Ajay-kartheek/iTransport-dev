import { Eye, EyeOff } from "lucide-react";
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
  useState,
} from "react";

import { cn } from "../../lib/hooks";

const inputBase =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 shadow-[inset_0_1px_2px_rgb(16_24_40/0.04)] outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-sm font-medium text-rose-600">{error}</p>
      ) : (
        hint && <p className="text-sm text-slate-500">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, "h-12", className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(inputBase, "h-12 appearance-none pr-10", className)} {...rest}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path d="M5.25 7.5 10 12.25 14.75 7.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className={cn("pr-12", props.className)} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label={shown ? "Hide password" : "Show password"}
      >
        {shown ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
      </button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-brand-600" : "bg-slate-200",
        disabled && "opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow-md transition-transform duration-200",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "h-9 rounded-full px-3.5 text-sm font-semibold ring-1 transition active:scale-95",
        selected
          ? "bg-brand-600 text-white ring-brand-600"
          : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300",
      )}
    >
      {children}
    </button>
  );
}
