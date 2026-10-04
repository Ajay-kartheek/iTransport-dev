import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleCheck,
  CloudOff,
  Flag,
  MapPin,
  MonitorSmartphone,
  Satellite,
  School,
  UploadCloud,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { JourneyTimeline } from "../../components/JourneyTimeline";
import { BottomBar } from "../../components/ui/BottomBar";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Banner, LiveDot, Skeleton } from "../../components/ui/Feedback";
import { PageTransition, SlideToConfirm } from "../../components/ui/Motion";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { clock, directionLabel, duration, minutesUntil, plural } from "../../lib/format";
import { cn, useNow, useOnline } from "../../lib/hooks";
import { discardQueue, type TripTrackerHandle, useTripTracker } from "../../lib/tracker";
import type { Counts, DriverTripState, TripStop, TripView } from "../../lib/types";

export function DriverTrip() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow(1000);
  const online = useOnline();

  const state = useQuery({
    queryKey: ["driver", "trip", tripId],
    queryFn: () => api.get<DriverTripState>(`/api/driver/trips/${tripId}`),
    refetchInterval: 8_000,
  });
  const trip = state.data?.trip;
  const running = trip?.status === "in_progress";
  const tracker = useTripTracker(tripId, running);

  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const refetch = state.refetch;
  useEffect(() => {
    if (tracker?.ended) void refetch();
  }, [tracker?.ended, refetch]);

  const counts = useMemo(() => {
    const map: Record<string, Counts> = {};
    state.data?.roster.stops.forEach((s) => {
      map[s.id] = s.counts;
    });
    return map;
  }, [state.data]);

  const end = useMutation({
    mutationFn: async () => {
      await tracker?.drain();
      return api.post(`/api/driver/trips/${tripId}/end`);
    },
    onSuccess: () => {
      discardQueue(tripId);
      void queryClient.invalidateQueries({ queryKey: ["driver"] });
      toast({ title: "Trip ended", body: "Location sharing has stopped. Thank you!" });
      navigate("/driver", { replace: true });
    },
    onError: (error) => toast({ tone: "error", title: "Couldn't end the trip", body: errorMessage(error) }),
  });

  if (state.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-8">
        <Skeleton className="h-16" />
        <Skeleton className="h-48 rounded-4xl" />
        <Skeleton className="h-64 rounded-4xl" />
      </div>
    );
  }

  if (state.isError || !trip) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-8">
        <Banner tone="error" title="Couldn't open this trip">
          {errorMessage(state.error)}
        </Banner>
        <Link to="/driver" className="mt-4 inline-flex text-sm font-bold text-brand-700">
          ← Back to buses
        </Link>
      </div>
    );
  }

  return (
    <PageTransition className="min-h-dvh pb-40">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4">
          {!running && (
            <Link
              to="/driver"
              className="flex size-10 items-center justify-center rounded-2xl text-slate-600 hover:bg-white"
              aria-label="Back"
            >
              <ArrowLeft className="size-5" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold text-slate-900">
              Bus {trip.busNumber} · {directionLabel(trip.direction)}
            </p>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              {running ? (
                <>
                  <LiveDot className="size-2" /> Running {duration(trip.startedAt ?? now, now)}
                </>
              ) : (
                <>Ended {clock(trip.endedAt)}</>
              )}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {running && tracker && <StatusStrip tracker={tracker} online={online} now={now} />}

        <AnimatePresence>
          {running && tracker?.gps === "denied" && (
            <Banner tone="error" title="Location is blocked">
              Parents can't see the bus. Allow location for this site in your phone settings, then reopen this page.
            </Banner>
          )}
          {running && tracker && tracker.wake === "off" && (
            <Banner tone="warning" title="Keep this screen open">
              Sharing pauses if the phone locks or you switch apps.
            </Banner>
          )}
          {running && tracker && (!online || tracker.queued > 3) && (
            <Banner tone="info" title="Weak signal">
              {plural(tracker.queued, "location update")} saved on this phone — they'll send automatically.
            </Banner>
          )}
          {running && tracker && rejectionReason(tracker) && (
            <Banner tone="error" title="Location isn't reaching parents">
              {rejectionReason(tracker)}
            </Banner>
          )}
          {tracker?.ended && <Banner tone="info">The transport office ended this trip.</Banner>}
        </AnimatePresence>

        {running ? (
          <NextStop trip={trip} counts={counts} now={now} />
        ) : (
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CircleCheck className="size-6" />
              </span>
              <div>
                <p className="text-lg font-extrabold text-slate-900">Trip completed</p>
                <p className="text-sm text-slate-500">
                  {clock(trip.startedAt)} – {clock(trip.endedAt)} ·{" "}
                  {duration(trip.startedAt ?? 0, trip.endedAt ?? 0)}
                </p>
              </div>
            </div>
            <Button className="mt-5" block variant="secondary" onClick={() => navigate("/driver")}>
              Back to buses
            </Button>
          </Card>
        )}

        <Card className="p-5">
          <p className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-400">Route</p>
          <JourneyTimeline trip={trip} counts={counts} />
        </Card>
      </main>

      {running && (
        <BottomBar>
          <SlideToConfirm
            label="Slide to end trip"
            tone="red"
            busy={end.isPending}
            onConfirm={async () => {
              await end.mutateAsync().catch(() => undefined);
            }}
          />
        </BottomBar>
      )}
    </PageTransition>
  );
}

/** Why the server turned down the last batch of positions, in words a driver can act on. */
function rejectionReason(tracker: TripTrackerHandle): string | null {
  const result = tracker.lastResult;
  if (!result || result.accepted > 0) return null;
  const reasons = Object.keys(result.rejected);
  if (reasons.some((r) => r === "future" || r === "before_start" || r === "out_of_order")) {
    return "Your phone's clock looks wrong. Turn on automatic date & time in the phone's settings.";
  }
  if (reasons.includes("inaccurate")) {
    return "The GPS signal is too weak. Keep the phone near the windscreen with a clear view of the sky.";
  }
  if (reasons.includes("jump")) return "GPS readings are jumping around — waiting for a steady signal.";
  return null;
}

function StatusStrip({ tracker, online, now }: { tracker: TripTrackerHandle; online: boolean; now: number }) {
  const gps =
    tracker.gps === "good"
      ? { tone: "green", text: `GPS ±${tracker.accuracy ?? "?"} m` }
      : tracker.gps === "weak"
        ? { tone: "amber", text: tracker.accuracy ? `Weak GPS ±${tracker.accuracy} m` : "Weak GPS" }
        : tracker.gps === "starting"
          ? { tone: "slate", text: "Finding GPS…" }
          : { tone: "red", text: tracker.gps === "denied" ? "Location blocked" : "No GPS" };
  const acceptedAgo = tracker.lastAcceptedAt ? Math.round((now - tracker.lastAcceptedAt) / 1000) : null;
  const sharing =
    !online
      ? { tone: "amber", text: "Offline", icon: <CloudOff className="size-4" /> }
      : acceptedAgo !== null && acceptedAgo < 90
        ? { tone: "green", text: "Sharing live", icon: <UploadCloud className="size-4" /> }
        : rejectionReason(tracker)
          ? { tone: "red", text: "Not accepted", icon: <UploadCloud className="size-4" /> }
          : { tone: "slate", text: "Connecting…", icon: <UploadCloud className="size-4" /> };
  const wake =
    tracker.wake === "on"
      ? { tone: "green", text: "Screen on" }
      : tracker.wake === "unsupported"
        ? { tone: "slate", text: "Keep screen on" }
        : { tone: "amber", text: "Screen may sleep" };

  return (
    <div className="grid grid-cols-3 gap-2">
      <Pill tone={gps.tone} icon={<Satellite className="size-4" />} text={gps.text} />
      <Pill tone={sharing.tone} icon={sharing.icon} text={sharing.text} />
      <Pill tone={wake.tone} icon={<MonitorSmartphone className="size-4" />} text={wake.text} />
    </div>
  );
}

function Pill({ tone, icon, text }: { tone: string; icon: ReactNode; text: string }) {
  const styles: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-200/70",
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-white text-slate-600 ring-slate-200/70",
  };
  return (
    <motion.div
      layout
      className={cn(
        "flex h-11 items-center justify-center gap-1.5 rounded-2xl px-2 text-[12px] font-bold ring-1 transition-colors",
        styles[tone],
      )}
    >
      {icon}
      <span className="truncate">{text}</span>
    </motion.div>
  );
}

function NextStop({ trip, counts, now }: { trip: TripView; counts: Record<string, Counts>; now: number }) {
  const atStop = trip.currentStopId ? trip.stops.find((s) => s.id === trip.currentStopId) : null;
  const next = trip.nextStopId ? trip.stops.find((s) => s.id === trip.nextStopId) : null;
  const focus: TripStop | null | undefined = atStop ?? next;

  if (!focus) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <span className="flex size-14 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600">
            <Flag className="size-7" />
          </span>
          <div>
            <p className="text-xl font-extrabold text-slate-900">All stops done</p>
            <p className="text-sm text-slate-500">When everyone is off the bus, slide to end the trip.</p>
          </div>
        </div>
      </Card>
    );
  }

  const school = focus.kind === "school";
  // At a campus, the count only helps when the bus drops at more than one.
  const campusCount = trip.stops.filter((s) => s.kind === "school").length;
  const tally = school && campusCount < 2 ? undefined : counts[focus.id];
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${focus.id}:${atStop ? "at" : "next"}`}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -14, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className={cn(
          "overflow-hidden rounded-4xl p-6 text-white shadow-float",
          atStop
            ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
            : "bg-gradient-to-br from-brand-500 to-brand-800",
        )}
      >
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/75">
          {school ? <School className="size-4" /> : <MapPin className="size-4" />}
          {atStop ? "At stop" : "Next stop"}
        </p>
        <p className="mt-2 text-3xl font-extrabold leading-tight tracking-tight">{focus.name}</p>
        {!atStop && focus.eta && !trip.stale && (
          <p className="mt-2 text-lg font-semibold text-white/90">
            in {minutesUntil(focus.eta, now)} min · {clock(focus.eta)}
          </p>
        )}
        {tally && (
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-2xl bg-white/15 px-3.5 py-2 text-base font-extrabold">
              {tally.riding} riding
            </span>
            {tally.none > 0 && (
              <span className="rounded-2xl bg-white/10 px-3.5 py-2 text-base font-bold text-white/85">
                {tally.none} no reply
              </span>
            )}
            {tally.absent > 0 && (
              <span className="rounded-2xl bg-white/10 px-3.5 py-2 text-base font-bold text-white/70">
                {tally.absent} absent
              </span>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
