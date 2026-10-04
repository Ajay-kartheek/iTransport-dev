import { useQuery } from "@tanstack/react-query";
import {
  Bus,
  Check,
  ChevronDown,
  CircleHelp,
  GraduationCap,
  MapPinned,
  Route as RouteIcon,
  School,
  SignalLow,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";

import { JourneyTimeline } from "../../components/JourneyTimeline";
import { MapCanvas } from "../../components/map/MapCanvas";
import { BusMarker, RouteLine, StopMarker } from "../../components/map/Overlays";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, LiveDot, Skeleton } from "../../components/ui/Feedback";
import { AnimatedNumber } from "../../components/ui/Motion";
import { Segmented } from "../../components/ui/Segmented";
import { api, errorMessage } from "../../lib/api";
import { ago, clock, minutesUntil } from "../../lib/format";
import { cn, useNow } from "../../lib/hooks";
import type { AdminLive, AdminLiveBus, AdminToday, Counts, Direction, LatLng } from "../../lib/types";
import { AdminPage } from "./AdminLayout";

export function AdminOverview() {
  const now = useNow(1000);
  const live = useQuery({
    queryKey: ["admin", "live"],
    queryFn: () => api.get<AdminLive>("/api/admin/live"),
    refetchInterval: 6_000,
  });
  const today = useQuery({
    queryKey: ["admin", "today"],
    queryFn: () => api.get<AdminToday>("/api/admin/today"),
    refetchInterval: 30_000,
  });
  const [picked, setPicked] = useState<Direction | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const buses = live.data?.buses ?? [];
  const running = buses.filter((b) => b.trip.status === "in_progress");
  const direction: Direction = picked ?? running[0]?.trip.direction ?? buses[0]?.trip.direction ?? "AM";
  const totals = today.data?.totals[direction] ?? { riding: 0, absent: 0, none: 0 };
  const campuses = useMemo(() => live.data?.school.campuses ?? [], [live.data]);
  const school = campuses[0]?.location ?? null;
  const selectedBus = buses.find((b) => b.id === selected) ?? null;

  const focus = useMemo<LatLng[]>(() => {
    if (selectedBus?.trip.position) {
      const next = selectedBus.trip.stops.find((s) => s.state === "pending");
      return next ? [selectedBus.trip.position, next] : [selectedBus.trip.position];
    }
    const points: LatLng[] = running.flatMap((b) => (b.trip.position ? [b.trip.position] : []));
    campuses.forEach((c) => points.push(c.location));
    if (points.length < 2) buses.forEach((b) => b.trip.stops[0] && points.push(b.trip.stops[0]));
    return points;
  }, [selectedBus, running, buses, campuses]);
  const fitKey = `${selected ?? "all"}:${running.length}:${buses.length}:${campuses.length}`;

  const setup = [
    { done: campuses.length > 0, label: "Add the school's campuses", to: "/admin/settings", icon: School },
    { done: (live.data?.buses.length ?? 0) > 0, label: "Add buses and their routes", to: "/admin/buses", icon: Bus },
    { done: (today.data?.students ?? 0) > 0, label: "Add students and link parents", to: "/admin/students", icon: GraduationCap },
  ];
  const needsSetup = live.data && today.data && setup.some((s) => !s.done);

  return (
    <AdminPage
      wide
      title="Live overview"
      subtitle={
        live.data ? (
          <span className="inline-flex items-center gap-2">
            {running.length ? <LiveDot /> : <LiveDot tone="slate" />}
            {running.length ? `${running.length} of ${buses.length} buses on the road` : "No buses on the road right now"}
            <span className="text-slate-300">·</span> updated {ago(live.dataUpdatedAt, now)}
          </span>
        ) : (
          "Loading…"
        )
      }
      actions={
        <Segmented
          size="sm"
          label="Trip"
          value={direction}
          onChange={setPicked}
          className="w-56"
          options={[
            { value: "AM", label: "Morning" },
            { value: "PM", label: "Afternoon" },
          ]}
        />
      }
    >
      {(live.isError || today.isError) && (
        <Banner tone="error" className="mb-4">
          {errorMessage(live.error ?? today.error)}
        </Banner>
      )}

      {needsSetup && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-extrabold text-slate-900">Finish setting up</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {setup.map(({ done, label, to, icon: Icon }) => (
              <Link
                key={label}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-3xl p-3 text-sm font-semibold ring-1 transition",
                  done ? "bg-emerald-50/60 text-emerald-800 ring-emerald-100" : "bg-white text-slate-700 ring-slate-200 hover:ring-brand-300",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-2xl",
                    done ? "bg-emerald-500 text-white" : "bg-brand-50 text-brand-600",
                  )}
                >
                  {done ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
                </span>
                {label}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Bus className="size-5" />} tone="brand" label="On the road" value={running.length} suffix={`/ ${buses.length}`} />
        <Stat icon={<Check className="size-5" />} tone="green" label="Riding" value={totals.riding} />
        <Stat icon={<X className="size-5" />} tone="red" label="Absent" value={totals.absent} />
        <Stat icon={<CircleHelp className="size-5" />} tone="slate" label="No reply yet" value={totals.none} />
      </motion.div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="overflow-hidden p-2">
          <MapCanvas
            className="h-[26rem] lg:h-[36rem]"
            center={school}
            zoom={12}
            fit={focus}
            fitKey={fitKey}
            onClick={() => setSelected(null)}
          >
            {campuses.map((c) => (
              <StopMarker key={c.id} position={c.location} school label={c.name} />
            ))}
            {selectedBus && (
              <>
                {selectedBus.trip.polyline ? (
                  <RouteLine encoded={selectedBus.trip.polyline} />
                ) : (
                  <RouteLine path={selectedBus.trip.stops} dashed />
                )}
                {selectedBus.trip.stops
                  .filter((s) => s.kind === "stop")
                  .map((stop, i) => (
                    <StopMarker
                      key={stop.id}
                      position={stop}
                      index={i + 1}
                      done={stop.state === "arrived" || stop.state === "departed"}
                      skipped={stop.state === "skipped"}
                      label={stop.name}
                    />
                  ))}
              </>
            )}
            {buses.map((bus) =>
              bus.trip.position ? (
                <BusMarker
                  key={bus.id}
                  position={bus.trip.position}
                  heading={bus.trip.position.heading}
                  label={bus.number}
                  stale={bus.trip.stale}
                  selected={bus.id === selected}
                  onClick={() => setSelected(bus.id)}
                />
              ) : null,
            )}
          </MapCanvas>
        </Card>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Buses</h2>
            <Link to="/admin/trips" className="text-sm font-bold text-brand-700 hover:text-brand-800">
              Trip history →
            </Link>
          </div>
          {live.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-28 rounded-4xl" />
              <Skeleton className="h-28 rounded-4xl" />
            </div>
          ) : !buses.length ? (
            <Card className="p-6 text-center">
              <RouteIcon className="mx-auto size-8 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-700">No buses yet</p>
              <Link to="/admin/buses" className="mt-2 inline-block text-sm font-bold text-brand-700">
                Add a bus →
              </Link>
            </Card>
          ) : (
            <motion.ul variants={stagger} initial="hidden" animate="show" className="space-y-3">
              {buses.map((bus) => (
                <motion.li key={bus.id} variants={listItem}>
                  <BusCard
                    bus={bus}
                    counts={today.data?.buses.find((b) => b.busId === bus.id)?.[direction]}
                    now={now}
                    selected={bus.id === selected}
                    onSelect={() => setSelected(bus.id === selected ? null : bus.id)}
                  />
                </motion.li>
              ))}
            </motion.ul>
          )}
        </div>
      </div>
    </AdminPage>
  );
}

function Stat({
  icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  tone: "brand" | "green" | "red" | "slate";
}) {
  const color = {
    brand: "bg-brand-50 text-brand-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-rose-50 text-rose-600",
    slate: "bg-slate-100 text-slate-500",
  }[tone];
  return (
    <motion.div variants={listItem} className="rounded-4xl border border-slate-200/70 bg-white p-4 shadow-card sm:p-5">
      <span className={cn("flex size-10 items-center justify-center rounded-2xl", color)}>{icon}</span>
      <p className="mt-4 flex items-baseline gap-1.5">
        <AnimatedNumber value={value} className="text-3xl font-extrabold tracking-tight text-slate-900" />
        {suffix && <span className="text-sm font-bold text-slate-400">{suffix}</span>}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-slate-500">{label}</p>
    </motion.div>
  );
}

function BusCard({
  bus,
  counts,
  now,
  selected,
  onSelect,
}: {
  bus: AdminLiveBus;
  counts?: Counts;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const trip = bus.trip;
  const next = trip.stops.find((s) => s.id === trip.nextStopId);
  const done = trip.stops.filter((s) => s.state !== "pending").length;
  const progress = trip.stops.length ? done / trip.stops.length : 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-4xl border bg-white shadow-card transition",
        selected ? "border-brand-300 ring-4 ring-brand-100" : "border-slate-200/70",
      )}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-3.5 p-4 text-left">
        <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-bus-400 text-slate-900">
          <span className="text-[9px] font-extrabold uppercase tracking-wider opacity-70">Bus</span>
          <span className="-mt-0.5 text-lg font-extrabold leading-none">{bus.number}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold text-slate-900">{bus.routeName ?? "No route"}</span>
            {trip.status === "in_progress" ? (
              trip.stale ? (
                <Badge tone="amber">
                  <SignalLow className="size-3" /> Signal lost
                </Badge>
              ) : (
                <Badge tone="green" className="gap-1.5">
                  <LiveDot className="size-2" /> Live
                </Badge>
              )
            ) : trip.status === "completed" ? (
              <Badge tone="slate">Done</Badge>
            ) : (
              <Badge tone="brand">Not started</Badge>
            )}
          </span>
          <span className="mt-1 block truncate text-xs text-slate-500">
            {trip.status === "in_progress"
              ? next
                ? `Next: ${next.name}${next.eta && !trip.stale ? ` · ${minutesUntil(next.eta, now)} min` : ""}`
                : "All stops done"
              : trip.status === "completed"
                ? trip.schoolReachedAt
                  ? `Reached school ${clock(trip.schoolReachedAt)}`
                  : `Ended ${clock(trip.endedAt)}`
                : trip.driverName ?? "Waiting for driver"}
            {trip.status === "in_progress" && trip.driverName && ` · ${trip.driverName}`}
          </span>
          {trip.status !== "scheduled" && (
            <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-slate-100">
              <motion.span
                className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                initial={false}
                animate={{ width: `${Math.round(progress * 100)}%` }}
                transition={{ type: "spring", stiffness: 90, damping: 20 }}
              />
            </span>
          )}
          {counts && (
            <span className="mt-2.5 flex flex-wrap gap-1.5">
              <Badge tone="green">{counts.riding} riding</Badge>
              <Badge tone="red">{counts.absent} absent</Badge>
              <Badge tone="slate">{counts.none} no reply</Badge>
            </span>
          )}
        </span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-slate-300 transition-transform", selected && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-100 px-4 pb-4 pt-4">
              {trip.position && (
                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <MapPinned className="size-3.5" /> Position {ago(trip.positionAt, now)}
                  {trip.etaSource === "estimate" && " · ETAs estimated"}
                </p>
              )}
              <JourneyTimeline trip={trip} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
