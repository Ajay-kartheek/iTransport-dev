import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Sunrise, Sunset, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Card, CardHeader } from "../../components/ui/Card";
import { Segmented } from "../../components/ui/Segmented";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { clock, firstName, shortDirection } from "../../lib/format";
import { cn } from "../../lib/hooks";
import type { Direction, Mark, ParentChild, ParentHome, PlanSlot } from "../../lib/types";

interface Change {
  date: string;
  direction: Direction;
  status: Mark;
}

export function RideCard({ child, home, now }: { child: ParentChild; home: ParentHome; now: number }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState(home.days[0]?.date ?? home.today);
  const name = firstName(child.name);
  const day = home.days.find((d) => d.date === selected) ?? home.days[0];
  const plan = child.plan.find((p) => p.date === day?.date);

  const save = useMutation({
    mutationFn: (change: Change) =>
      api.put("/api/parent/declarations", { studentId: child.id, ...change }),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: ["parent", "home"] });
      const previous = queryClient.getQueryData<ParentHome>(["parent", "home"]);
      queryClient.setQueryData<ParentHome>(["parent", "home"], (old) =>
        old
          ? {
              ...old,
              children: old.children.map((c) =>
                c.id !== child.id
                  ? c
                  : {
                      ...c,
                      plan: c.plan.map((p) =>
                        p.date !== change.date
                          ? p
                          : { ...p, [change.direction]: { ...p[change.direction], status: change.status } },
                      ),
                    },
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(["parent", "home"], context.previous);
      toast({ tone: "error", title: "Couldn't save that", body: errorMessage(error) });
    },
    onSuccess: (_data, change) => {
      const label = home.days.find((d) => d.date === change.date)?.label ?? change.date;
      toast({
        title: change.status === "riding" ? `${name} is riding` : `${name} is marked absent`,
        body: `${label} · ${shortDirection(change.direction)} trip. The driver will see this.`,
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["parent", "home"] });
      void queryClient.invalidateQueries({ queryKey: ["parent", "live", child.id] });
    },
  });

  if (!child.bus) return null;

  return (
    <Card>
      <CardHeader
        title={`Will ${name} take the bus?`}
        subtitle="Let the driver know before each trip's cutoff."
      />
      <div className="scrollbar-none -mb-1 mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
        {home.days.map((d) => {
          const p = child.plan.find((x) => x.date === d.date);
          const active = d.date === day?.date;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setSelected(d.date)}
              className={cn(
                "relative flex w-[4.25rem] shrink-0 flex-col items-center rounded-2xl px-2 pb-2 pt-2.5 transition-colors",
                active ? "text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {active && (
                <motion.span
                  layoutId={`ride-day-${child.id}`}
                  className="absolute inset-0 rounded-2xl bg-brand-600 shadow-glow"
                  transition={{ type: "spring", stiffness: 480, damping: 36 }}
                />
              )}
              <span className={cn("relative text-[11px] font-bold uppercase tracking-wide", !active && "text-slate-400")}>
                {d.label === "Today" ? "Today" : d.weekday}
              </span>
              <span className="relative text-lg font-extrabold">{d.dayOfMonth}</span>
              <span className="relative mt-1 flex gap-1">
                <Dot slot={p?.AM} active={active} />
                <Dot slot={p?.PM} active={active} />
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={day?.date}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.18 }}
          className="space-y-3 p-5"
        >
          {plan &&
            (["AM", "PM"] as const).map((direction) => (
              <SlotRow
                key={direction}
                direction={direction}
                slot={plan[direction]}
                today={plan.date === home.today}
                now={now}
                busy={save.isPending && save.variables?.date === plan.date && save.variables?.direction === direction}
                onChange={(status) => save.mutate({ date: plan.date, direction, status })}
              />
            ))}
        </motion.div>
      </AnimatePresence>
    </Card>
  );
}

function Dot({ slot, active }: { slot?: PlanSlot; active: boolean }) {
  const color =
    slot?.status === "riding"
      ? "bg-emerald-400"
      : slot?.status === "absent"
        ? "bg-rose-400"
        : active
          ? "bg-white/40"
          : "bg-slate-200";
  return <span className={cn("size-1.5 rounded-full transition-colors", color)} />;
}

function SlotRow({
  direction,
  slot,
  today,
  now,
  busy,
  onChange,
}: {
  direction: Direction;
  slot: PlanSlot;
  today: boolean;
  now: number;
  busy: boolean;
  onChange: (status: Mark) => void;
}) {
  const Icon = direction === "AM" ? Sunrise : Sunset;
  const closed = now >= slot.cutoffAt;
  let note: string;
  if (slot.locked) note = closed ? `Closed at ${clock(slot.cutoffAt)}` : "Bus has already left";
  else note = today ? `Change until ${clock(slot.cutoffAt)}` : `Change until ${clock(slot.cutoffAt)} that day`;

  return (
    <div className="rounded-3xl bg-slate-50/80 p-3.5 ring-1 ring-slate-100">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-xl",
            direction === "AM" ? "bg-bus-100 text-bus-700" : "bg-brand-100 text-brand-700",
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">
            {direction === "AM" ? "Morning pickup" : "Afternoon drop"}
          </p>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            {slot.locked && <Lock className="size-3" />}
            {note}
          </p>
        </div>
        {!slot.status && !slot.locked && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Not marked</span>
        )}
      </div>
      <Segmented
        label={`${direction === "AM" ? "Morning" : "Afternoon"} plan`}
        value={slot.status}
        disabled={slot.locked || busy}
        onChange={onChange}
        options={[
          {
            value: "riding",
            label: "Riding",
            icon: <Check className="size-4" strokeWidth={3} />,
            activeClass: "text-emerald-700",
          },
          {
            value: "absent",
            label: "Absent",
            icon: <X className="size-4" strokeWidth={3} />,
            activeClass: "text-rose-600",
          },
        ]}
      />
    </div>
  );
}
