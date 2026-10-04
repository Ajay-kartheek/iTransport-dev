import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, School, Square, UserRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Button, IconButton } from "../../components/ui/Button";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, EmptyState, LiveDot, Skeleton } from "../../components/ui/Feedback";
import { AnimatedNumber } from "../../components/ui/Motion";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage, serverNow } from "../../lib/api";
import {
  clock,
  dateFromIso,
  directionLabel,
  duration,
  plural,
  shortDay,
  shortDirection,
} from "../../lib/format";
import { cn, useNow } from "../../lib/hooks";
import type { AdminTripRow, TripStatus } from "../../lib/types";
import { AdminPage } from "./AdminLayout";

const schoolDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date (YYYY-MM-DD) in school time, using the server-corrected clock. */
function schoolToday(): string {
  const parts = Object.fromEntries(
    schoolDateParts.formatToParts(serverNow()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function AdminTrips() {
  const now = useNow(30_000);
  const today = schoolToday();
  const [date, setDate] = useState(schoolToday);
  const isToday = date === today;
  const trips = useQuery({
    queryKey: ["admin", "trips", date],
    queryFn: () => api.get<{ date: string; trips: AdminTripRow[] }>(`/api/admin/trips?date=${date}`),
    refetchInterval: isToday ? 15_000 : false,
  });
  const [ending, setEnding] = useState<{ open: boolean; trip: AdminTripRow | null; key: number }>({
    open: false,
    trip: null,
    key: 0,
  });

  const list = trips.data?.trips ?? [];
  const running = list.filter((t) => t.status === "in_progress").length;
  const completed = list.filter((t) => t.status === "completed").length;
  const dayLabel = `${isToday ? "Today · " : ""}${shortDay(dateFromIso(date))}`;

  return (
    <AdminPage
      title="Trips"
      subtitle="Every run, who drove it and how far it got"
      actions={
        <>
          {!isToday && (
            <Button variant="soft" size="sm" onClick={() => setDate(today)}>
              Back to today
            </Button>
          )}
          <div className="flex items-center gap-1 rounded-2xl bg-white p-1 shadow-card ring-1 ring-slate-200/70">
            <IconButton label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <input
              type="date"
              aria-label="Trip date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-10 rounded-xl px-2 text-sm font-semibold text-slate-800 outline-none transition focus:bg-slate-50 focus:ring-2 focus:ring-brand-200"
            />
            <IconButton
              label="Next day"
              disabled={date >= today}
              className="disabled:pointer-events-none disabled:opacity-30"
              onClick={() => setDate(shiftDate(date, 1))}
            >
              <ChevronRight className="size-5" />
            </IconButton>
          </div>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Trips" value={list.length} />
        <Stat label="Running now" value={running} live={running > 0} />
        <Stat label="Completed" value={completed} />
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{dayLabel}</h2>

      {trips.isError ? (
        <Banner
          tone="error"
          title="Couldn't load trips"
          action={
            <Button size="sm" variant="secondary" onClick={() => void trips.refetch()}>
              Retry
            </Button>
          }
        >
          {errorMessage(trips.error)}
        </Banner>
      ) : trips.isPending ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock className="size-7" />}
            title="No trips on this day"
            body={
              isToday
                ? "Trips show up here as soon as a driver starts one."
                : "No bus ran on this day."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <motion.ul
            key={date}
            variants={stagger}
            initial="hidden"
            animate="show"
            className="divide-y divide-slate-100"
          >
            <AnimatePresence>
              {list.map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  now={now}
                  onEnd={() => setEnding((s) => ({ open: true, trip, key: s.key + 1 }))}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        </Card>
      )}

      <EndTripSheet
        key={ending.key}
        open={ending.open}
        trip={ending.trip}
        onClose={() => setEnding((s) => ({ ...s, open: false }))}
      />
    </AdminPage>
  );
}

function Stat({ label, value, live }: { label: string; value: number; live?: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 sm:text-xs">
        {live && <LiveDot />}
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
        <AnimatedNumber value={value} />
      </p>
    </Card>
  );
}

function StatusBadge({ status }: { status: TripStatus }) {
  if (status === "in_progress") {
    return (
      <Badge tone="green">
        <LiveDot />
        Running
      </Badge>
    );
  }
  if (status === "completed") return <Badge tone="brand">Completed</Badge>;
  return <Badge tone="slate">Scheduled</Badge>;
}

function TripRow({ trip, now, onEnd }: { trip: AdminTripRow; now: number; onEnd: () => void }) {
  const running = trip.status === "in_progress";
  const pct = trip.stopsTotal ? Math.round((trip.stopsDone / trip.stopsTotal) * 100) : 0;
  const endedByOther = trip.endedBy && trip.endedBy !== trip.driverName;

  return (
    <motion.li variants={listItem} layout="position" exit={{ opacity: 0, x: -16 }} className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl px-1 font-extrabold tracking-tight shadow-sm ring-1",
            trip.busNumber.length > 3 ? "text-xs" : "text-lg",
            running ? "bg-bus-400 text-slate-900 ring-bus-500/40" : "bg-slate-100 text-slate-500 ring-slate-200",
          )}
        >
          {trip.busNumber}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-bold text-slate-900">Bus {trip.busNumber}</p>
            <span className="text-sm font-medium text-slate-500">{directionLabel(trip.direction)}</span>
            <StatusBadge status={trip.status} />
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
            <UserRound className="size-4 shrink-0 text-slate-400" />
            <span className="truncate">
              {trip.driverName ?? "No driver"}
              {trip.routeName ? ` · ${trip.routeName}` : ""}
            </span>
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4 text-slate-400" />
              {clock(trip.startedAt)} → {trip.endedAt ? clock(trip.endedAt) : running ? "now" : "—"}
            </span>
            {trip.startedAt && (
              <span className="tabular font-semibold text-slate-700">
                {duration(trip.startedAt, trip.endedAt ?? now)}
              </span>
            )}
            {trip.direction === "AM" && trip.schoolReachedAt && (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <School className="size-4" />
                Reached school {clock(trip.schoolReachedAt)}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <motion.div
                className={cn("h-full rounded-full", running ? "bg-brand-500" : "bg-emerald-500")}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 90, damping: 20 }}
              />
            </div>
            <span className="tabular shrink-0 text-xs font-semibold text-slate-500">
              {trip.stopsDone}/{trip.stopsTotal} stops
            </span>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            {plural(trip.pointCount, "location update")}
            {endedByOther ? ` · Ended by ${trip.endedBy}` : ""}
          </p>
        </div>

        {running && (
          <Button size="sm" variant="secondary" icon={<Square className="size-3.5" />} onClick={onEnd}>
            <span className="hidden sm:inline">End trip</span>
            <span className="sm:hidden">End</span>
          </Button>
        )}
      </div>
    </motion.li>
  );
}

function ListSkeleton() {
  return (
    <Card className="space-y-5 p-5">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-start gap-4">
          <Skeleton className="size-12" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </Card>
  );
}

function EndTripSheet({
  open,
  trip,
  onClose,
}: {
  open: boolean;
  trip: AdminTripRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const end = useMutation({
    mutationFn: async () => {
      if (trip) await api.post(`/api/admin/trips/${trip.id}/end`);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "trips"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "live"] }),
      ]);
      toast({ title: `Bus ${trip?.busNumber ?? ""} trip ended` });
      onClose();
    },
  });

  const what = trip ? `${shortDirection(trip.direction).toLowerCase()} trip` : "trip";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={trip ? `End Bus ${trip.busNumber}'s ${what}?` : "End trip?"}
      description="Use this only if the driver forgot to end it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="ml-auto">
            Cancel
          </Button>
          <Button variant="danger" loading={end.isPending} onClick={() => end.mutate()}>
            End trip
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Banner tone="warning" title="Parents will stop seeing the bus live">
          {trip?.driverName ?? "The driver"}'s phone stops sharing its location for this trip, and the
          trip moves to Completed.
        </Banner>
        <AnimatePresence>{end.error && <Banner tone="error">{errorMessage(end.error)}</Banner>}</AnimatePresence>
      </div>
    </Sheet>
  );
}
