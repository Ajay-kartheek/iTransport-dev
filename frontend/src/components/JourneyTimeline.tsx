import { Check, Minus, School } from "lucide-react";
import { motion } from "motion/react";

import { clock } from "../lib/format";
import { cn } from "../lib/hooks";
import type { Counts, TripStop, TripView } from "../lib/types";
import { Badge } from "./ui/Feedback";

type NodeKind = "done" | "skipped" | "current" | "next" | "pending";

function nodeKind(trip: TripView, stop: TripStop): NodeKind {
  if (trip.status === "in_progress" && trip.currentStopId === stop.id) return "current";
  if (stop.state === "skipped") return "skipped";
  if (stop.state === "arrived" || stop.state === "departed") return "done";
  if (trip.status === "in_progress" && trip.nextStopId === stop.id) return "next";
  return "pending";
}

/** Stops in travel order with the bus's progress drawn down the rail. */
export function JourneyTimeline({
  trip,
  myStopId,
  counts,
  className,
}: {
  trip: TripView;
  myStopId?: string | null;
  counts?: Record<string, Counts>;
  className?: string;
}) {
  let stopNumber = 0;
  const estimated = trip.etaSource === "estimate";
  return (
    <ol className={cn("relative", className)}>
      {trip.stops.map((stop, i) => {
        const kind = nodeKind(trip, stop);
        const isSchool = stop.kind === "school";
        if (!isSchool) stopNumber += 1;
        const mine = stop.id === myStopId;
        const last = i === trip.stops.length - 1;
        const nextKind = last ? null : nodeKind(trip, trip.stops[i + 1]);
        const fill = railFill(kind, nextKind, trip.status === "in_progress");
        const tally = counts?.[stop.id];

        let time: string | null = null;
        if (kind === "done" || kind === "current") time = clock(stop.arrivedAt);
        else if (kind === "skipped") time = "Passed";
        else if (stop.eta && trip.status === "in_progress" && !trip.stale) {
          time = `${estimated ? "≈ " : ""}${clock(stop.eta)}`;
        }

        return (
          <motion.li
            key={stop.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.035, 0.4) }}
            className="relative flex gap-3.5 pb-5 last:pb-0"
          >
            {!last && (
              <span className="absolute left-[15px] top-8 bottom-0 w-[3px] overflow-hidden rounded-full bg-slate-200/80">
                <motion.span
                  className="absolute inset-x-0 top-0 h-full origin-top rounded-full bg-emerald-400"
                  initial={false}
                  animate={{ scaleY: fill }}
                  transition={{ type: "spring", stiffness: 120, damping: 22 }}
                />
              </span>
            )}
            <Node kind={kind} school={isSchool} mine={mine} number={stopNumber} />
            <div className={cn("min-w-0 flex-1 pt-1", kind === "skipped" && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-[15px] font-bold",
                      kind === "current" || kind === "next" ? "text-slate-900" : "text-slate-700",
                    )}
                  >
                    {stop.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {mine && <Badge tone="brand">Your stop</Badge>}
                    {kind === "current" && <Badge tone="green" dot>Bus is here</Badge>}
                    {kind === "next" && !mine && <Badge tone="bus">Next stop</Badge>}
                    {tally && (
                      <>
                        {tally.riding > 0 && <Badge tone="green">{tally.riding} riding</Badge>}
                        {tally.none > 0 && <Badge tone="slate">{tally.none} no reply</Badge>}
                        {tally.absent > 0 && <Badge tone="red">{tally.absent} absent</Badge>}
                      </>
                    )}
                    {!mine && !tally && kind !== "current" && stop.address && (
                      <span className="truncate text-xs text-slate-400">{stop.address}</span>
                    )}
                  </div>
                </div>
                {time && (
                  <span
                    className={cn(
                      "tabular shrink-0 pt-0.5 text-sm font-semibold",
                      kind === "done" || kind === "current" ? "text-emerald-600" : "text-slate-500",
                      kind === "skipped" && "text-slate-400",
                    )}
                  >
                    {time}
                  </span>
                )}
              </div>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

/** How much of the rail below a stop is filled: full once the next stop is reached. */
function railFill(kind: NodeKind, nextKind: NodeKind | null, running: boolean): number {
  if (nextKind === null) return 0;
  if (kind === "done" || kind === "skipped") {
    if (nextKind === "done" || nextKind === "skipped" || nextKind === "current") return 1;
    return running ? 0.5 : 0;
  }
  return kind === "current" ? 0.12 : 0;
}

function Node({
  kind,
  school,
  mine,
  number,
}: {
  kind: NodeKind;
  school: boolean;
  mine: boolean;
  number: number;
}) {
  const base = "relative z-10 flex size-[33px] shrink-0 items-center justify-center rounded-full text-xs font-extrabold";
  if (kind === "current") {
    return (
      <span className={cn(base, "bg-emerald-500 text-white shadow-[0_0_0_4px_rgb(16_185_129/0.18)]")}>
        <span className="absolute inset-0 rounded-full bg-emerald-400 animate-pulse-ring" />
        {school ? <School className="relative size-4" /> : <span className="relative">{number}</span>}
      </span>
    );
  }
  if (kind === "done") {
    return (
      <motion.span
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 20 }}
        className={cn(base, "bg-emerald-500 text-white")}
      >
        <Check className="size-4" strokeWidth={3} />
      </motion.span>
    );
  }
  if (kind === "skipped") {
    return (
      <span className={cn(base, "bg-slate-200 text-slate-500")}>
        <Minus className="size-4" strokeWidth={3} />
      </span>
    );
  }
  if (school) {
    return (
      <span className={cn(base, kind === "next" ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-600 ring-2 ring-brand-200")}>
        <School className="size-4" />
      </span>
    );
  }
  if (kind === "next") {
    return (
      <span className={cn(base, "bg-white text-brand-700 ring-[3px] ring-brand-500", mine && "bg-brand-600 text-white")}>
        {number}
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        mine ? "bg-brand-50 text-brand-700 ring-[3px] ring-brand-400" : "bg-white text-slate-500 ring-2 ring-slate-200",
      )}
    >
      {number}
    </span>
  );
}
