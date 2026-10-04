import { motion } from "motion/react";

import { initials } from "../lib/format";
import { cn } from "../lib/hooks";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white p-1 ring-1 ring-slate-200/80",
        className,
      )}
      aria-hidden
    >
      <img src="/school-mark.png" alt="" className="size-full object-contain" draggable={false} />
    </span>
  );
}

/** The school's full emblem, with its name under the tree. */
export function SchoolEmblem({ className }: { className?: string }) {
  return <img src="/school-logo.png" alt="" className={cn("h-20 w-auto", className)} draggable={false} />;
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <p className="text-[17px] font-extrabold tracking-tight text-slate-900">
          i<span className="text-brand-600">Transport</span>
        </p>
        {subtitle && <p className="max-w-[16rem] truncate text-xs font-medium text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

/** The friendly school bus used on the sign-in and empty screens. */
export function BusArt({ className, moving = true }: { className?: string; moving?: boolean }) {
  const wheel = (cx: number) => (
    <motion.g
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      animate={moving ? { rotate: 360 } : undefined}
      transition={{ repeat: Infinity, ease: "linear", duration: 1.1 }}
    >
      <circle cx={cx} cy="96" r="13" fill="#1e293b" />
      <circle cx={cx} cy="96" r="6" fill="#cbd5e1" />
      <rect x={cx - 1.2} y="84" width="2.4" height="24" rx="1.2" fill="#475569" />
    </motion.g>
  );
  return (
    <div className={cn("relative", className)}>
      <motion.svg
        viewBox="0 0 250 120"
        className="relative z-10 w-full"
        animate={moving ? { y: [0, -2.5, 0] } : undefined}
        transition={{ repeat: Infinity, duration: 0.55, ease: "easeInOut" }}
        aria-hidden
      >
        <rect x="26" y="24" width="182" height="72" rx="16" fill="#ffc21f" />
        <rect x="26" y="24" width="182" height="15" rx="7.5" fill="#ffd15c" />
        <path d="M208 42h10a9 9 0 0 1 9 9v36a9 9 0 0 1-9 9h-10z" fill="#f5a800" />
        {[38, 74, 110].map((x) => (
          <rect key={x} x={x} y="42" width="28" height="22" rx="6" fill="#dce8ff" />
        ))}
        <rect x="146" y="42" width="22" height="44" rx="5" fill="#ffd15c" stroke="#d98f00" strokeWidth="2" />
        <rect x="149" y="45" width="16" height="16" rx="3" fill="#dce8ff" />
        <rect x="184" y="42" width="18" height="26" rx="5" fill="#dce8ff" />
        <rect x="26" y="70" width="182" height="5" fill="#1d347a" opacity="0.85" />
        <circle cx="219" cy="80" r="3.5" fill="#fff8e6" />
        <rect x="216" y="56" width="10" height="5" rx="2.5" fill="#1d347a" opacity="0.8" />
        <text
          x="88"
          y="88"
          textAnchor="middle"
          fontSize="9"
          fontWeight="800"
          letterSpacing="1.5"
          fill="#1d347a"
          fontFamily="inherit"
        >
          SCHOOL BUS
        </text>
        {wheel(70)}
        {wheel(176)}
      </motion.svg>
      <div className="absolute inset-x-2 bottom-[3px] h-1.5 rounded-full bg-slate-900/8 blur-[2px]" />
      <div
        className={cn("absolute inset-x-0 -bottom-2 h-[3px] rounded-full opacity-70", moving && "animate-road")}
        style={{
          backgroundImage: "repeating-linear-gradient(90deg, #cbd5e1 0 24px, transparent 24px 48px)",
          backgroundSize: "48px 3px",
        }}
      />
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 text-sm font-extrabold text-brand-800",
        className,
      )}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}
