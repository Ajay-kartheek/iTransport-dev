import { ChevronDown, CircleCheck, Clock3, MapPin, Navigation, School, SignalLow } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { BusArt } from "../../components/Brand";
import { JourneyTimeline } from "../../components/JourneyTimeline";
import { TripMap } from "../../components/TripMap";
import { Card } from "../../components/ui/Card";
import { Badge, LiveDot, Skeleton } from "../../components/ui/Feedback";
import { AnimatedNumber } from "../../components/ui/Motion";
import { Segmented } from "../../components/ui/Segmented";
import { ago, clock, minutesUntil, plural, shortDirection } from "../../lib/format";
import type { Direction, ParentChild, ParentLive, TripStop, TripView } from "../../lib/types";

export function LiveCard({
  child,
  live,
  loading,
  now,
  direction,
  onDirection,
}: {
  child: ParentChild;
  live: ParentLive | undefined;
  loading: boolean;
  now: number;
  direction: Direction;
  onDirection: (direction: Direction) => void;
}) {
  const trip = live?.trip ?? null;
  // Name the campus only when this bus drops at more than one.
  const campusCount = trip?.stops.filter((s) => s.kind === "school").length ?? 0;
  return (
    <Card className="overflow-hidden" layout>
      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {child.bus ? `Bus ${child.bus.number}` : "School bus"}
            {child.route && <span className="font-semibold normal-case tracking-normal"> · {child.route.name}</span>}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-600">
            {child.stop ? (
              <>
                <MapPin className="-mt-0.5 mr-1 inline size-3.5 text-brand-500" />
                {child.stop.name}
                {campusCount > 1 && child.campus && <span className="text-slate-400"> → {child.campus.name}</span>}
              </>
            ) : (
              "No stop assigned"
            )}
          </p>
        </div>
        {child.bus && (
          <Segmented
            size="sm"
            label="Trip"
            value={direction}
            onChange={onDirection}
            className="w-[11.5rem] shrink-0"
            options={[
              { value: "AM", label: "Morning" },
              { value: "PM", label: "Afternoon" },
            ]}
          />
        )}
      </div>

      {loading && !live ? (
        <div className="space-y-3 px-5 pb-5">
          <Skeleton className="h-60 w-full rounded-3xl" />
          <Skeleton className="h-16 w-2/3" />
        </div>
      ) : !child.bus || !trip ? (
        <NoBus />
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${trip.id}:${trip.status}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {trip.status === "in_progress" ? (
              <Running trip={trip} myStopId={live?.myStopId ?? null} campusStopId={live?.myCampusStopId ?? null} now={now} />
            ) : trip.status === "completed" ? (
              <Completed trip={trip} campus={campusOf(trip, live?.myCampusStopId)} />
            ) : (
              <NotStarted trip={trip} />
            )}
            <details className="group border-t border-slate-100" open={trip.status === "in_progress"}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50/70">
                <span>Stops on this trip</span>
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  {plural(trip.stops.filter((s) => s.kind === "stop").length, "stop")}
                  <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" />
                </span>
              </summary>
              <div className="px-5 pb-5">
                <JourneyTimeline trip={trip} myStopId={live?.myStopId} />
              </div>
            </details>
          </motion.div>
        </AnimatePresence>
      )}
    </Card>
  );
}

/** The campus stop this child attends (the bus's first campus if unknown). */
function campusOf(trip: TripView, campusStopId: string | null | undefined): TripStop | null {
  const campuses = trip.stops.filter((s) => s.kind === "school");
  return campuses.find((s) => s.id === campusStopId) ?? campuses[0] ?? null;
}

function Running({
  trip,
  myStopId,
  campusStopId,
  now,
}: {
  trip: TripView;
  myStopId: string | null;
  campusStopId: string | null;
  now: number;
}) {
  const mine = trip.stops.find((s) => s.id === myStopId) ?? null;
  return (
    <>
      <div className="px-3">
        <TripMap
          trip={trip}
          myStopId={myStopId}
          className="h-64 sm:h-80"
          overlay={<Freshness trip={trip} now={now} />}
        />
      </div>
      <div className="px-5 pb-5 pt-5">
        <Headline trip={trip} mine={mine} campus={campusOf(trip, campusStopId)} now={now} />
      </div>
    </>
  );
}

function Freshness({ trip, now }: { trip: TripView; now: number }) {
  return (
    <div className="absolute left-3 top-3 z-20">
      <motion.div
        layout
        className="flex h-9 items-center gap-2 rounded-2xl bg-white/95 px-3 text-xs font-bold shadow-float ring-1 ring-slate-200/70 backdrop-blur"
      >
        {trip.stale ? (
          <>
            <SignalLow className="size-4 text-amber-500" />
            <span className="text-amber-700">Signal lost · {clock(trip.positionAt)}</span>
          </>
        ) : trip.position ? (
          <>
            <LiveDot />
            <span className="text-slate-700">Live · {ago(trip.positionAt, now)}</span>
          </>
        ) : (
          <>
            <LiveDot tone="amber" />
            <span className="text-slate-700">Waiting for the bus's location…</span>
          </>
        )}
      </motion.div>
    </div>
  );
}

function Headline({
  trip,
  mine,
  campus,
  now,
}: {
  trip: TripView;
  mine: TripStop | null;
  campus: TripStop | null;
  now: number;
}) {
  const estimated = trip.etaSource === "estimate";
  const campusName = campus?.name || "school";

  if (trip.stale) {
    return (
      <Status
        icon={<SignalLow className="size-6" />}
        tone="amber"
        title="Location paused"
        body={`We last heard from the bus at ${clock(trip.positionAt)}. It may be in a low-signal area — this updates as soon as it reconnects.`}
      />
    );
  }

  if (!mine) {
    return <Status icon={<Navigation className="size-6" />} tone="brand" title={`Bus ${trip.busNumber} is on the move`} />;
  }

  if (trip.currentStopId === mine.id) {
    return (
      <Status
        icon={<MapPin className="size-6" />}
        tone="green"
        title="The bus is at your stop"
        body={`Arrived at ${clock(mine.arrivedAt)}.`}
        pulse
      />
    );
  }

  if (mine.state !== "pending") {
    const passed = mine.state === "skipped";
    if (trip.direction === "AM") {
      if (campus?.arrivedAt) {
        return (
          <Status
            icon={<School className="size-6" />}
            tone="green"
            title={`Reached ${campusName} at ${clock(campus.arrivedAt)}`}
            body={passed ? "The bus passed your stop on the way." : `Picked up at ${clock(mine.arrivedAt)}.`}
          />
        );
      }
      const campusEta = campus?.state === "pending" ? campus.eta : null;
      return (
        <Status
          icon={<School className="size-6" />}
          tone="brand"
          title={passed ? "The bus has passed your stop" : `Picked up at ${clock(mine.arrivedAt)}`}
          body={
            campusEta
              ? `Heading to ${campusName} · arriving around ${estimated ? "≈ " : ""}${clock(campusEta)}`
              : `Heading to ${campusName}.`
          }
        />
      );
    }
    return (
      <Status
        icon={<CircleCheck className="size-6" />}
        tone="green"
        title={passed ? "The bus has passed your stop" : `Dropped off at ${clock(mine.arrivedAt)}`}
      />
    );
  }

  if (!mine.eta) {
    return <Status icon={<Clock3 className="size-6" />} tone="brand" title="Working out the arrival time…" />;
  }

  const minutes = minutesUntil(mine.eta, now);
  const index = trip.stops.findIndex((s) => s.id === mine.id);
  const away = trip.stops.slice(0, index).filter((s) => s.state === "pending" && s.kind === "stop").length;
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-500">
          {trip.direction === "AM" ? "Arriving at your stop in" : "Reaching your stop in"}
        </p>
        <p className="mt-1 flex items-baseline gap-2 text-slate-900">
          {estimated && <span className="text-3xl font-bold text-slate-400">≈</span>}
          <AnimatedNumber value={minutes} className="text-6xl font-extrabold tracking-tight" />
          <span className="text-xl font-bold text-slate-500">min</span>
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Around <span className="font-bold text-slate-700">{clock(mine.eta)}</span>
          {away > 0 && <> · {plural(away, "stop")} before yours</>}
          {away === 0 && <> · next stop</>}
        </p>
      </div>
      {estimated && <Badge tone="slate">Estimate</Badge>}
    </div>
  );
}

function Status({
  icon,
  title,
  body,
  tone,
  pulse,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  tone: "brand" | "green" | "amber";
  pulse?: boolean;
}) {
  const color = {
    brand: "bg-brand-50 text-brand-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  }[tone];
  return (
    <div className="flex items-start gap-4">
      <span className={`relative flex size-12 shrink-0 items-center justify-center rounded-2xl ${color}`}>
        {pulse && <span className="absolute inset-0 rounded-2xl bg-emerald-400/40 animate-pulse-ring" />}
        <span className="relative">{icon}</span>
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-lg font-extrabold tracking-tight text-slate-900">{title}</p>
        {body && <p className="mt-1 text-sm leading-relaxed text-slate-500">{body}</p>}
      </div>
    </div>
  );
}

function NotStarted({ trip }: { trip: TripView }) {
  return (
    <div className="flex flex-col items-center px-6 pb-6 pt-2 text-center">
      <BusArt className="w-44" moving={false} />
      <p className="mt-6 text-lg font-extrabold tracking-tight text-slate-900">
        {shortDirection(trip.direction)} trip hasn't started
      </p>
      <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500">
        You'll see Bus {trip.busNumber} here the moment the driver starts. We'll send you a notification too.
      </p>
    </div>
  );
}

function Completed({ trip, campus }: { trip: TripView; campus: TripStop | null }) {
  const am = trip.direction === "AM";
  const reachedAt = campus ? campus.arrivedAt : trip.schoolReachedAt;
  return (
    <div className="flex items-start gap-4 px-5 pb-6 pt-1">
      <motion.span
        initial={{ scale: 0.5, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 14 }}
        className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"
      >
        <CircleCheck className="size-7" />
      </motion.span>
      <div>
        <p className="text-lg font-extrabold tracking-tight text-slate-900">
          {am
            ? reachedAt
              ? `Reached ${campus?.name || "school"} at ${clock(reachedAt)}`
              : "Morning trip completed"
            : "Afternoon drop completed"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Trip ended at {clock(trip.endedAt)}
          {trip.driverName && <> · Driver {trip.driverName}</>}
        </p>
      </div>
    </div>
  );
}

function NoBus() {
  return (
    <div className="flex flex-col items-center px-6 pb-8 pt-2 text-center">
      <BusArt className="w-40" moving={false} />
      <p className="mt-6 text-base font-extrabold text-slate-900">Not on a bus route yet</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        The school hasn't assigned a bus to your child. Please contact the transport office.
      </p>
    </div>
  );
}
