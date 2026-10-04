import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { Avatar } from "../../components/Brand";
import { Card } from "../../components/ui/Card";
import { Banner, EmptyState, Skeleton } from "../../components/ui/Feedback";
import { PageTransition } from "../../components/ui/Motion";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage, serverNow } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { firstName, greeting, longDay, minutesUntil } from "../../lib/format";
import { cn, useNow } from "../../lib/hooks";
import type { Direction, ParentHome as Home, ParentLive } from "../../lib/types";
import { AlertsCard } from "./AlertsCard";
import { LiveCard } from "./LiveCard";
import { RideCard } from "./RideCard";

const CHILD_KEY = "itransport.child";

export function ParentHome() {
  const { user } = useAuth();
  const now = useNow(1000);
  const home = useQuery({
    queryKey: ["parent", "home"],
    queryFn: () => api.get<Home>("/api/parent/home"),
    refetchInterval: 60_000,
  });
  const children = home.data?.children ?? [];
  const [childId, setChildId] = useState<string | null>(() => localStorage.getItem(CHILD_KEY));
  const child = children.find((c) => c.id === childId) ?? children[0] ?? null;
  const [chosenDirection, setChosenDirection] = useState<Direction | null>(null);

  const live = useQuery({
    queryKey: ["parent", "live", child?.id, chosenDirection],
    queryFn: () =>
      api.get<ParentLive>(
        `/api/parent/children/${child!.id}/live${chosenDirection ? `?direction=${chosenDirection}` : ""}`,
      ),
    enabled: !!child,
    refetchInterval: (query) => (query.state.data?.trip?.status === "in_progress" ? 5_000 : 30_000),
  });

  useTripToasts(live.data, home.data?.school.approachMinutes ?? 10);

  const direction: Direction =
    live.data?.trip?.direction ?? chosenDirection ?? home.data?.defaultDirection ?? "AM";

  const selectChild = (id: string) => {
    setChildId(id);
    setChosenDirection(null);
    localStorage.setItem(CHILD_KEY, id);
  };

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <PageTransition className="mx-auto max-w-5xl px-4 pb-20 pt-5 sm:pt-8">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            {greeting(now)}, {firstName(user?.name ?? "")}
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">{longDay(now)}</p>
        </div>

        {home.isError && <Banner tone="error" className="mb-4">{errorMessage(home.error)}</Banner>}

        {home.isPending ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Skeleton className="h-[30rem] rounded-4xl" />
            <Skeleton className="h-80 rounded-4xl" />
          </div>
        ) : !child ? (
          <Card>
            <EmptyState
              icon={<Users className="size-6" />}
              title="No children linked yet"
              body="Ask your school's transport office to link your child to your account. Then you'll see their bus here."
            />
          </Card>
        ) : (
          <>
            {children.length > 1 && (
              <div className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4" role="tablist">
                {children.map((c) => {
                  const active = c.id === child.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => selectChild(c.id)}
                      className={cn(
                        "relative flex shrink-0 items-center gap-2.5 rounded-2xl py-1.5 pl-1.5 pr-4 text-sm font-bold transition-colors",
                        active ? "text-slate-900" : "text-slate-500 hover:text-slate-800",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="child-tab"
                          className="absolute inset-0 rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70"
                          transition={{ type: "spring", stiffness: 480, damping: 36 }}
                        />
                      )}
                      <Avatar name={c.name} className="relative size-8 rounded-xl text-xs" />
                      <span className="relative">{firstName(c.name)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <motion.div layout className="min-w-0">
                <LiveCard
                  child={child}
                  live={live.data}
                  loading={live.isPending}
                  now={now}
                  direction={direction}
                  onDirection={setChosenDirection}
                />
              </motion.div>
              <div className="min-w-0 space-y-5">
                {home.data && <RideCard key={child.id} child={child} home={home.data} now={now} />}
                <AlertsCard approachMinutes={home.data?.school.approachMinutes ?? 10} />
              </div>
            </div>
          </>
        )}
      </PageTransition>
    </div>
  );
}

/** In-app heads-up while the page is open (push covers the rest). */
function useTripToasts(live: ParentLive | undefined, approachMinutes: number) {
  const toast = useToast();
  const lastStatus = useRef<{ id: string; status: string } | null>(null);
  const announced = useRef(new Set<string>());

  useEffect(() => {
    const trip = live?.trip;
    if (!trip) return;
    const previous = lastStatus.current;
    if (previous?.id === trip.id && previous.status === "scheduled" && trip.status === "in_progress") {
      toast({ tone: "info", title: `Bus ${trip.busNumber} has started`, body: "Follow it live below." });
    }
    lastStatus.current = { id: trip.id, status: trip.status };

    const mine = trip.stops.find((s) => s.id === live.myStopId);
    if (trip.status !== "in_progress" || trip.stale || !mine?.eta || mine.state !== "pending") return;
    const minutes = minutesUntil(mine.eta, serverNow());
    const key = `${trip.id}:near`;
    if (minutes <= approachMinutes && !announced.current.has(key)) {
      announced.current.add(key);
      toast({
        tone: "info",
        title: minutes <= 1 ? `Bus ${trip.busNumber} is almost here` : `Bus ${trip.busNumber} is ${minutes} min away`,
        body: `Time to head to ${mine.name}.`,
      });
    }
  }, [live, approachMinutes, toast]);
}
