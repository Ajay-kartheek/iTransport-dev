import { useQuery } from "@tanstack/react-query";
import { BatteryCharging, Bus, ChevronRight, MapPinned, Smartphone, Sunrise, Sunset } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";

import { AppHeader } from "../../components/AppHeader";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, EmptyState, LiveDot, Skeleton } from "../../components/ui/Feedback";
import { PageTransition } from "../../components/ui/Motion";
import { Segmented } from "../../components/ui/Segmented";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { clock, directionLabel, firstName, longDay } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import type { Direction, DriverBus, DriverHome as Home } from "../../lib/types";

export function DriverHome() {
  const { user } = useAuth();
  const now = useNow(30_000);
  const home = useQuery({
    queryKey: ["driver", "home"],
    queryFn: () => api.get<Home>("/api/driver/home"),
    refetchInterval: 20_000,
  });
  const [picked, setPicked] = useState<Direction | null>(null);
  const direction = picked ?? home.data?.defaultDirection ?? "AM";
  const active = home.data?.activeTrip;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <PageTransition className="mx-auto max-w-2xl px-4 pb-16 pt-5 sm:pt-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          Hi {firstName(user?.name ?? "")}
        </h1>
        <p className="mt-1 text-sm font-medium text-slate-500">{longDay(now)}</p>

        {home.isError && <Banner tone="error" className="mt-4">{errorMessage(home.error)}</Banner>}

        {active && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
            <Link
              to={`/driver/trip/${active.id}`}
              className="group flex items-center gap-4 rounded-4xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 text-white shadow-[0_18px_40px_-18px_rgb(5_150_105/0.7)] transition active:scale-[0.99]"
            >
              <span className="relative flex size-14 items-center justify-center rounded-3xl bg-white/15">
                <span className="absolute inset-0 rounded-3xl bg-white/20 animate-pulse-ring" />
                <Bus className="relative size-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold uppercase tracking-wider text-emerald-100">Trip running</span>
                <span className="block text-lg font-extrabold">
                  Bus {active.busNumber} · {directionLabel(active.direction)}
                </span>
                <span className="block text-sm text-emerald-50">Started {clock(active.startedAt)} · tap to open</span>
              </span>
              <ChevronRight className="size-6 transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        )}

        <div className="mt-6">
          <Segmented
            size="lg"
            label="Trip"
            value={direction}
            onChange={setPicked}
            options={[
              { value: "AM", label: "Morning pickup", icon: <Sunrise className="size-5" /> },
              { value: "PM", label: "Afternoon drop", icon: <Sunset className="size-5" /> },
            ]}
          />
        </div>

        <h2 className="mb-3 mt-7 text-sm font-bold uppercase tracking-wider text-slate-400">Choose your bus</h2>
        {home.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-4xl" />
            <Skeleton className="h-24 rounded-4xl" />
          </div>
        ) : !home.data?.buses.length ? (
          <Card>
            <EmptyState
              icon={<Bus className="size-6" />}
              title="No buses assigned to you"
              body="Ask the transport office to assign you to a bus."
            />
          </Card>
        ) : (
          <motion.ul variants={stagger} initial="hidden" animate="show" className="space-y-3">
            {home.data.buses.map((bus) => (
              <motion.li key={bus.id} variants={listItem}>
                <BusRow bus={bus} direction={direction} />
              </motion.li>
            ))}
          </motion.ul>
        )}

        <Card className="mt-8 p-5">
          <p className="text-sm font-bold text-slate-800">Before you drive</p>
          <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
            <li className="flex items-center gap-3">
              <Smartphone className="size-4 text-brand-600" /> Put the phone in a mount — no tapping while driving.
            </li>
            <li className="flex items-center gap-3">
              <BatteryCharging className="size-4 text-brand-600" /> Keep it on a charger; the screen stays on during trips.
            </li>
            <li className="flex items-center gap-3">
              <MapPinned className="size-4 text-brand-600" /> Allow location when asked, so parents can see the bus.
            </li>
          </ul>
        </Card>
      </PageTransition>
    </div>
  );
}

function BusRow({ bus, direction }: { bus: DriverBus; direction: Direction }) {
  const trip = bus.trips[direction];
  return (
    <Link
      to={`/driver/bus/${bus.id}?direction=${direction}`}
      className="group flex items-center gap-4 rounded-4xl border border-slate-200/70 bg-white p-4 shadow-card transition hover:border-brand-200 hover:shadow-float active:scale-[0.99]"
    >
      <span className="flex size-16 shrink-0 flex-col items-center justify-center rounded-3xl bg-bus-400 text-slate-900 shadow-[inset_0_-3px_0_rgb(0_0_0/0.08)]">
        <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-70">Bus</span>
        <span className="-mt-0.5 text-2xl font-extrabold leading-none">{bus.number}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold text-slate-900">{bus.routeName ?? "No route yet"}</span>
        <span className="mt-0.5 block text-sm text-slate-500">
          {bus.stopCount} stops{bus.plate && ` · ${bus.plate}`}
        </span>
        <span className="mt-2 block">
          {trip.status === "in_progress" ? (
            <Badge tone="green" className="gap-2">
              <LiveDot className="size-2" /> {trip.mine ? "You're driving" : `Running · ${trip.driverName ?? "another driver"}`}
            </Badge>
          ) : trip.status === "completed" ? (
            <Badge tone="slate">Completed today</Badge>
          ) : (
            <Badge tone="brand">Ready to start</Badge>
          )}
        </span>
      </span>
      <ChevronRight className="size-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-500" />
    </Link>
  );
}
