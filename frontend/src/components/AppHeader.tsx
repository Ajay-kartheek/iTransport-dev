import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../lib/auth";
import { cn } from "../lib/hooks";
import { Avatar, Logo } from "./Brand";

const roleNames = { ADMIN: "Transport office", DRIVER: "Driver", PARENT: "Parent" } as const;

export function AppHeader({ left, className }: { left?: ReactNode; className?: string }) {
  const { user } = useAuth();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-slate-200/60 bg-canvas/80 backdrop-blur-xl",
        "pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4">
        {left ?? <Logo subtitle={user?.schoolName} />}
        <UserMenu />
      </div>
    </header>
  );
}

export function UserMenu({ compact }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-2xl p-1 pr-2 transition hover:bg-white hover:shadow-card active:scale-[0.98]"
      >
        <Avatar name={user.name} className="size-9" />
        {!compact && (
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-bold text-slate-800">{user.name}</span>
            <span className="block text-xs text-slate-500">{roleNames[user.role]}</span>
          </span>
        )}
        <ChevronDown className={cn("size-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            className="absolute right-0 top-full z-40 mt-2 w-60 origin-top-right overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-1.5 shadow-float"
          >
            <div className="px-3 py-2.5">
              <p className="truncate text-sm font-bold text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">
                @{user.username} · {roleNames[user.role]}
              </p>
            </div>
            <div className="my-1 h-px bg-slate-100" />
            <MenuItem
              icon={<KeyRound className="size-4" />}
              onClick={() => {
                setOpen(false);
                navigate("/change-password");
              }}
            >
              Change password
            </MenuItem>
            <MenuItem
              icon={<LogOut className="size-4" />}
              danger
              onClick={async () => {
                setOpen(false);
                await logout();
                navigate("/login", { replace: true });
              }}
            >
              Sign out
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-semibold transition",
        danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
