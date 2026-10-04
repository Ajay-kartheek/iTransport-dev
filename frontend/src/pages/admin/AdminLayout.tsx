import {
  Bus,
  CalendarClock,
  GraduationCap,
  History,
  LayoutDashboard,
  Menu,
  Route as RouteIcon,
  Settings,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

import { Logo } from "../../components/Brand";
import { UserMenu } from "../../components/AppHeader";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/hooks";

const nav = [
  { to: "/admin", label: "Live overview", icon: LayoutDashboard, end: true },
  { to: "/admin/trips", label: "Trips", icon: CalendarClock },
  { to: "/admin/buses", label: "Buses", icon: Bus },
  { to: "/admin/routes", label: "Routes & stops", icon: RouteIcon },
  { to: "/admin/students", label: "Students", icon: GraduationCap },
  { to: "/admin/users", label: "People & logins", icon: Users },
  { to: "/admin/settings", label: "School settings", icon: Settings },
  { to: "/admin/activity", label: "Activity", icon: History },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate} className="block">
          {({ isActive }) => (
            <span
              className={cn(
                "relative flex h-11 items-center gap-3 rounded-2xl px-3.5 text-sm font-semibold transition-colors",
                isActive ? "text-brand-700" : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="admin-nav"
                  className="absolute inset-0 rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70"
                  transition={{ type: "spring", stiffness: 480, damping: 38 }}
                />
              )}
              <Icon className="relative size-[18px]" />
              <span className="relative">{label}</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AdminLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-slate-200/60 bg-slate-50/60 px-4 py-6 lg:flex">
        <Logo subtitle={user?.schoolName} className="px-2" />
        <div className="mt-8 flex-1">
          <NavItems />
        </div>
        <div className="rounded-3xl border border-slate-200/70 bg-white p-2 shadow-card">
          <UserMenu />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/60 bg-canvas/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="flex size-10 items-center justify-center rounded-2xl text-slate-600 hover:bg-white"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <Logo />
        <UserMenu compact />
      </header>

      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-canvas px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] shadow-float"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              <div className="flex items-center justify-between">
                <Logo subtitle={user?.schoolName} />
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  className="flex size-10 items-center justify-center rounded-2xl text-slate-500 hover:bg-white"
                  aria-label="Close menu"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="mt-8">
                <NavItems onNavigate={() => setDrawer(false)} />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <main className="min-w-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

/** Standard admin page frame: title row with actions, then content. */
export function AdminPage({
  title,
  subtitle,
  actions,
  children,
  wide,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8", wide ? "max-w-[1400px]" : "max-w-6xl")}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
