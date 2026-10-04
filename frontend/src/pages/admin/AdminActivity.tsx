import { useQuery } from "@tanstack/react-query";
import {
  Bus,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  History,
  KeyRound,
  Play,
  Route as RouteIcon,
  Settings,
  Square,
  UserRound,
} from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Banner, EmptyState, Skeleton } from "../../components/ui/Feedback";
import { api, errorMessage, serverNow } from "../../lib/api";
import { clock, dateFromIso, longDay, plural, shortDay, shortDirection } from "../../lib/format";
import { cn } from "../../lib/hooks";
import type { AdminStudent, AuditEntry } from "../../lib/types";
import { AdminPage } from "./AdminLayout";
import { DaySummaryCard } from "./DaySummaryCard";

const schoolDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

function describe(entry: AuditEntry, studentName: (id: string) => string): { icon: ReactNode; text: string } {
  const d = entry.details as Record<string, string | undefined>;
  const who = entry.actorName;
  switch (entry.action) {
    case "declaration.set": {
      const when = d.date ? `${longDay(dateFromIso(d.date))} · ${shortDirection(d.direction === "PM" ? "PM" : "AM")}` : "";
      return {
        icon: <CalendarCheck className="size-4" />,
        text: `${who} marked ${studentName(entry.targetId)} ${d.status === "riding" ? "Riding" : "Absent"} — ${when}`,
      };
    }
    case "trip.started":
      return { icon: <Play className="size-4" />, text: `${who} started Bus ${d.bus ?? ""}`.trim() };
    case "trip.ended":
      return { icon: <Square className="size-4" />, text: `${who} ended a trip` };
    case "trip.ended_by_admin":
      return { icon: <Square className="size-4" />, text: `${who} ended a trip from the office` };
    case "user.created":
      return { icon: <UserRound className="size-4" />, text: `${who} added @${d.username} (${(d.role ?? "").toLowerCase()})` };
    case "user.updated":
      return { icon: <UserRound className="size-4" />, text: `${who} updated a login` };
    case "user.password_reset":
      return { icon: <KeyRound className="size-4" />, text: `${who} reset a password` };
    case "password.changed":
      return { icon: <KeyRound className="size-4" />, text: `${who} changed their password` };
    case "bus.created":
    case "bus.updated":
    case "bus.deleted":
      return {
        icon: <Bus className="size-4" />,
        text: `${who} ${entry.action.split(".")[1]} Bus ${d.number ?? ""}`.trim(),
      };
    case "bus.tracker_key_rotated":
      return { icon: <Bus className="size-4" />, text: `${who} issued a new tracker key` };
    case "route.created":
    case "route.updated":
    case "route.deleted":
      return {
        icon: <RouteIcon className="size-4" />,
        text: `${who} ${entry.action.split(".")[1]} ${d.name ? `“${d.name}”` : "a route"}`,
      };
    case "student.created":
    case "student.updated":
    case "student.deleted":
      return {
        icon: <GraduationCap className="size-4" />,
        text: `${who} ${entry.action.split(".")[1]} ${d.name ?? studentName(entry.targetId)}`,
      };
    case "settings.updated":
      return { icon: <Settings className="size-4" />, text: `${who} updated school settings` };
    default:
      return { icon: <History className="size-4" />, text: `${who}: ${entry.action}` };
  }
}

type Kind = "all" | "trips" | "plans" | "office";

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trips", label: "Trips" },
  { value: "plans", label: "Parent plans" },
  { value: "office", label: "Office" },
];

function kindOf(entry: AuditEntry): Exclude<Kind, "all"> {
  if (entry.action.startsWith("trip.")) return "trips";
  if (entry.action === "declaration.set") return "plans";
  return "office";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const hourLabel = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric" });

export function AdminActivity() {
  const today = schoolDate.format(serverNow());
  const [params, setParams] = useSearchParams();
  const asked = params.get("date") ?? "";
  const day = ISO_DATE.test(asked) && asked <= today ? asked : today;
  const isToday = day === today;
  const [kind, setKind] = useState<Kind>("all");

  const goTo = (next: string) => {
    setKind("all");
    setParams(next === today ? {} : { date: next }, { replace: true });
  };

  const log = useQuery({
    queryKey: ["admin", "audit", day],
    queryFn: async () => (await api.get<{ entries: AuditEntry[] }>(`/api/admin/audit?date=${day}`)).entries,
    refetchInterval: isToday ? 30_000 : false,
  });
  const students = useQuery({
    queryKey: ["admin", "students"],
    queryFn: async () => (await api.get<{ students: AdminStudent[] }>("/api/admin/students")).students,
  });
  const names = new Map((students.data ?? []).map((s) => [s.id, s.name]));
  const studentName = (id: string) => names.get(id) ?? "a student";

  const entries = log.data ?? [];
  const counts = { all: entries.length, trips: 0, plans: 0, office: 0 };
  for (const entry of entries) counts[kindOf(entry)] += 1;
  const shown = kind === "all" ? entries : entries.filter((e) => kindOf(e) === kind);

  // Group by hour so a long day is easy to scan.
  const hours: { label: string; entries: AuditEntry[] }[] = [];
  for (const entry of shown) {
    const label = hourLabel.format(entry.at);
    const group = hours.at(-1);
    if (group?.label === label) group.entries.push(entry);
    else hours.push({ label, entries: [entry] });
  }

  const dayName = isToday ? "Today" : day === shiftDay(today, -1) ? "Yesterday" : longDay(dateFromIso(day));

  return (
    <AdminPage
      wide
      title="Activity"
      subtitle="Who did what, one school day at a time."
      actions={<DayPicker day={day} today={today} label={dayName} onChange={goTo} />}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="lg:sticky lg:top-6 lg:order-2">
          <DaySummaryCard key={day} day={day} isToday={isToday} />
        </div>

        <Card className="overflow-hidden lg:order-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-slate-900">{dayName}</h2>
              <p className="text-xs text-slate-500">
                {log.data ? plural(entries.length, "entry", "entries") : "Loading…"}
                {isToday && log.data && " · updates every 30 s"}
              </p>
            </div>
            {entries.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
                {KINDS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    disabled={value !== "all" && !counts[value]}
                    onClick={() => setKind(value)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold ring-1 transition active:scale-95 disabled:opacity-40",
                      kind === value
                        ? "bg-slate-900 text-white ring-slate-900"
                        : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300",
                    )}
                  >
                    {label}
                    <span className={cn("tabular", kind === value ? "text-white/60" : "text-slate-400")}>
                      {counts[value]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {log.isError ? (
            <div className="p-5">
              <Banner tone="error">{errorMessage(log.error)}</Banner>
            </div>
          ) : log.isPending ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-12 rounded-2xl" />
              <Skeleton className="h-12 rounded-2xl" />
              <Skeleton className="h-12 rounded-2xl" />
            </div>
          ) : !entries.length ? (
            <EmptyState
              icon={<History className="size-6" />}
              title={isToday ? "Nothing yet today" : "A quiet day"}
              body={isToday ? "Changes and trips will show up here as they happen." : "Nothing was recorded on this day."}
            />
          ) : (
            <motion.div
              key={`${day}:${kind}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="max-h-[min(68vh,46rem)] overflow-y-auto overscroll-contain"
            >
              {hours.map((group) => (
                <section key={group.label}>
                  <h3 className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur">
                    {group.label}
                  </h3>
                  <ul className="divide-y divide-slate-100">
                    {group.entries.map((entry) => {
                      const { icon, text } = describe(entry, studentName);
                      return (
                        <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                            {icon}
                          </span>
                          <span className="min-w-0 flex-1 text-sm text-slate-700">{text}</span>
                          <span className="tabular shrink-0 text-xs font-semibold text-slate-400">{clock(entry.at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </motion.div>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}

function DayPicker({
  day,
  today,
  label,
  onChange,
}: {
  day: string;
  today: string;
  label: string;
  onChange: (day: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-white p-1 shadow-card ring-1 ring-slate-200/70">
      <IconButton label="Previous day" onClick={() => onChange(shiftDay(day, -1))}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <label className="relative flex h-10 min-w-[10.5rem] cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50">
        <CalendarDays className="size-4 text-brand-600" />
        {label === "Today" || label === "Yesterday" ? `${label} · ${shortDay(dateFromIso(day))}` : shortDay(dateFromIso(day))}
        <input
          ref={inputRef}
          type="date"
          aria-label="Pick a day"
          value={day}
          max={today}
          onClick={() => {
            try {
              inputRef.current?.showPicker();
            } catch {
              // Older browsers open their own picker on tap.
            }
          }}
          onChange={(e) => e.target.value && onChange(e.target.value > today ? today : e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <IconButton label="Next day" disabled={day >= today} onClick={() => onChange(shiftDay(day, 1))}>
        <ChevronRight className="size-5" />
      </IconButton>
      {day !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="h-10 rounded-xl px-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50"
        >
          Today
        </button>
      )}
    </div>
  );
}
