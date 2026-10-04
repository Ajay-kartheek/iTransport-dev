import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleHelp, MapPin, RefreshCw, School, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { BottomBar } from "../../components/ui/BottomBar";
import { Button } from "../../components/ui/Button";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, Skeleton } from "../../components/ui/Feedback";
import { AnimatedNumber, PageTransition, SlideToConfirm } from "../../components/ui/Motion";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { clock, directionLabel } from "../../lib/format";
import { cn } from "../../lib/hooks";
import type { Direction, DriverRoster as RosterData, RosterStatus, RosterStop } from "../../lib/types";

function askForLocation(): Promise<"ok" | "denied" | "unavailable"> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve("unavailable");
    navigator.geolocation.getCurrentPosition(
      () => resolve("ok"),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : "ok"),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

export function DriverRoster() {
  const { busId = "" } = useParams();
  const [params] = useSearchParams();
  const direction: Direction = params.get("direction") === "PM" ? "PM" : "AM";
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [locationProblem, setLocationProblem] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: ["driver", "roster", busId, direction],
    queryFn: () => api.get<RosterData>(`/api/driver/buses/${busId}/roster?direction=${direction}`),
    refetchInterval: 10_000,
  });

  const start = useMutation({
    mutationFn: async () => {
      const permission = await askForLocation();
      if (permission === "denied") {
        throw new Error("Location is blocked. Allow location for this site in your phone's settings, then try again.");
      }
      if (permission === "unavailable") throw new Error("This phone can't share its location.");
      return api.post<{ tripId: string }>("/api/driver/trips/start", { busId, direction });
    },
    onSuccess: ({ tripId }) => {
      setLocationProblem(null);
      void queryClient.invalidateQueries({ queryKey: ["driver"] });
      toast({ title: "Trip started", body: "Parents can now see the bus. Drive safe!" });
      navigate(`/driver/trip/${tripId}`);
    },
    onError: (error) => setLocationProblem(errorMessage(error)),
  });

  const data = roster.data;
  const trip = data?.trip;

  return (
    <PageTransition className="min-h-dvh pb-40">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4">
          <Link
            to="/driver"
            className="flex size-10 items-center justify-center rounded-2xl text-slate-600 transition hover:bg-white active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold text-slate-900">
              {data ? `Bus ${data.bus.number}` : "Bus"} · {directionLabel(direction)}
            </p>
            <p className="truncate text-xs font-medium text-slate-500">{data?.route.name ?? " "}</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
            <RefreshCw className={cn("size-3.5", roster.isFetching && "animate-spin text-brand-500")} />
            {roster.dataUpdatedAt ? clock(roster.dataUpdatedAt) : ""}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-5">
        {roster.isError && <Banner tone="error">{errorMessage(roster.error)}</Banner>}
        {roster.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-4xl" />
            <Skeleton className="h-40 rounded-4xl" />
            <Skeleton className="h-40 rounded-4xl" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Tally label="Riding" value={data.roster.totals.riding} tone="green" />
              <Tally label="Absent" value={data.roster.totals.absent} tone="red" />
              <Tally label="No reply" value={data.roster.totals.none} tone="slate" />
            </div>

            {data.roster.unassigned.length > 0 && (
              <Banner tone="warning" className="mt-4" title="Students without a stop">
                {data.roster.unassigned.map((s) => s.name).join(", ")} — ask the office to set their stop.
              </Banner>
            )}

            <motion.ol variants={stagger} initial="hidden" animate="show" className="mt-5 space-y-3">
              {data.roster.stops.map((stop, i) => (
                <motion.li key={stop.id} variants={listItem}>
                  <StopCard
                    stop={stop}
                    number={data.roster.stops.slice(0, i + 1).filter((s) => s.kind === "stop").length}
                    showCampusCounts={data.roster.stops.filter((s) => s.kind === "school").length > 1}
                  />
                </motion.li>
              ))}
            </motion.ol>
          </>
        ) : null}
      </main>

      {trip && (
        <BottomBar>
            {locationProblem && <Banner tone="error">{locationProblem}</Banner>}
            {trip.status === "scheduled" ? (
              <SlideToConfirm
                label="Slide to start trip"
                busy={start.isPending}
                onConfirm={async () => {
                  await start.mutateAsync().catch(() => undefined);
                }}
              />
            ) : trip.status === "in_progress" && data?.mine ? (
              <Button size="xl" block variant="success" onClick={() => navigate(`/driver/trip/${trip.id}`)}>
                Back to the running trip <ArrowRight className="size-5" />
              </Button>
            ) : trip.status === "in_progress" ? (
              <Banner tone="info" title="Another driver is on this trip">
                {trip.driverName ?? "A driver"} started it at {clock(trip.startedAt)}.
              </Banner>
            ) : (
              <Banner tone="success" title="Trip completed">
                Ended at {clock(trip.endedAt)}
                {trip.driverName && ` by ${trip.driverName}`}.
              </Banner>
            )}
        </BottomBar>
      )}
    </PageTransition>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone: "green" | "red" | "slate" }) {
  const styles = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-white text-slate-700 ring-slate-200/70",
  }[tone];
  return (
    <div className={cn("rounded-3xl p-4 text-center ring-1", styles)}>
      <AnimatedNumber value={value} className="block text-3xl font-extrabold" />
      <span className="mt-0.5 block text-xs font-bold uppercase tracking-wider opacity-80">{label}</span>
    </div>
  );
}

const statusStyle: Record<RosterStatus, { label: string; icon: typeof Check; className: string }> = {
  riding: { label: "Riding", icon: Check, className: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  absent: { label: "Absent", icon: X, className: "bg-rose-50 text-rose-600 ring-rose-100" },
  none: { label: "No reply", icon: CircleHelp, className: "bg-slate-100 text-slate-500 ring-slate-200/70" },
};

function StopCard({
  stop,
  number,
  showCampusCounts,
}: {
  stop: RosterStop;
  number: number;
  showCampusCounts: boolean;
}) {
  const school = stop.kind === "school";
  if (school) {
    return (
      <div className="flex items-center gap-3 rounded-4xl border border-dashed border-brand-200 bg-brand-50/50 px-4 py-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white">
          <School className="size-5" />
        </span>
        <p className="min-w-0 flex-1 truncate font-bold text-brand-800">{stop.name}</p>
        {showCampusCounts && (
          <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <Badge tone="green">{stop.counts.riding} riding</Badge>
            {stop.counts.none > 0 && <Badge tone="slate">{stop.counts.none} no reply</Badge>}
          </span>
        )}
      </div>
    );
  }
  const waiting = stop.counts.riding + stop.counts.none;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-4">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold",
            waiting ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400",
          )}
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-slate-900">{stop.name}</p>
          {stop.address && (
            <p className="truncate text-xs text-slate-500">
              <MapPin className="-mt-0.5 mr-0.5 inline size-3" />
              {stop.address}
            </p>
          )}
        </div>
        {stop.students.length > 0 && !waiting && <Badge tone="slate">All absent</Badge>}
      </div>
      {stop.students.length ? (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {stop.students.map((student) => {
            const style = statusStyle[student.status];
            const Icon = style.icon;
            return (
              <li key={student.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[15px] font-semibold",
                    student.status === "absent" ? "text-slate-400 line-through decoration-slate-300" : "text-slate-800",
                  )}
                >
                  {student.name}
                  {student.grade && <span className="ml-2 text-xs font-medium text-slate-400 no-underline">{student.grade}</span>}
                </span>
                <span className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-bold ring-1", style.className)}>
                  <Icon className="size-3.5" strokeWidth={3} />
                  {style.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 pb-4 pt-2 text-sm text-slate-400">No students at this stop.</p>
      )}
    </Card>
  );
}
