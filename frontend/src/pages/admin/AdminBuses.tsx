import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bus,
  ChevronRight,
  Copy,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Satellite,
  Trash2,
  UserRound,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { Button, IconButton } from "../../components/ui/Button";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, EmptyState, Skeleton } from "../../components/ui/Feedback";
import { Field, Input, Select, Switch } from "../../components/ui/Form";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import { cn } from "../../lib/hooks";
import type { AdminBus, AdminRoute } from "../../lib/types";
import { AdminPage } from "./AdminLayout";

interface BusBody {
  number: string;
  plate: string;
  capacity: number | null;
  routeId: string | null;
  active: boolean;
}

interface BusForm {
  number: string;
  plate: string;
  capacity: string;
  routeId: string;
  active: boolean;
}

type SheetMode = "form" | "delete" | "rotate";

const COLUMNS =
  "sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_7.5rem] sm:items-center sm:gap-4";

const slide = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -14 },
  transition: { duration: 0.18 },
};

function toForm(bus: AdminBus | null): BusForm {
  return bus
    ? {
        number: bus.number,
        plate: bus.plate,
        capacity: bus.capacity ? String(bus.capacity) : "",
        routeId: bus.routeId ?? "",
        active: bus.active,
      }
    : { number: "", plate: "", capacity: "", routeId: "", active: true };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AdminBuses() {
  const buses = useQuery({
    queryKey: ["admin", "buses"],
    queryFn: () => api.get<{ buses: AdminBus[] }>("/api/admin/buses"),
  });
  const routes = useQuery({
    queryKey: ["admin", "routes"],
    queryFn: () => api.get<{ routes: AdminRoute[] }>("/api/admin/routes"),
  });
  const [sheet, setSheet] = useState<{ open: boolean; bus: AdminBus | null; key: number }>({
    open: false,
    bus: null,
    key: 0,
  });

  const openSheet = (bus: AdminBus | null) => setSheet((s) => ({ open: true, bus, key: s.key + 1 }));
  const list = buses.data?.buses ?? [];
  const inService = list.filter((b) => b.active).length;

  return (
    <AdminPage
      title="Buses"
      subtitle={
        buses.data
          ? `${plural(list.length, "bus", "buses")} · ${inService} in service`
          : "Your fleet, its routes and drivers"
      }
      actions={
        <Button icon={<Plus className="size-4" />} onClick={() => openSheet(null)}>
          Add bus
        </Button>
      }
    >
      {buses.isError ? (
        <Banner
          tone="error"
          title="Couldn't load buses"
          action={
            <Button size="sm" variant="secondary" onClick={() => void buses.refetch()}>
              Retry
            </Button>
          }
        >
          {errorMessage(buses.error)}
        </Banner>
      ) : buses.isPending ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bus className="size-7" />}
            title="No buses yet"
            body="Add your first bus, then give it a route so drivers can start trips."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => openSheet(null)}>
                Add bus
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden items-center gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400 sm:flex">
            <span className="w-12 shrink-0" />
            <div className={cn("flex-1", COLUMNS)}>
              <span>Bus</span>
              <span>Route</span>
              <span>Drivers</span>
              <span className="justify-self-end">Status</span>
            </div>
            <span className="w-5 shrink-0" />
          </div>
          <motion.ul variants={stagger} initial="hidden" animate="show" className="divide-y divide-slate-100">
            <AnimatePresence>
              {list.map((bus) => (
                <BusRow key={bus.id} bus={bus} onOpen={() => openSheet(bus)} />
              ))}
            </AnimatePresence>
          </motion.ul>
        </Card>
      )}

      <BusSheet
        key={sheet.key}
        open={sheet.open}
        bus={sheet.bus}
        routes={routes.data?.routes ?? []}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />
    </AdminPage>
  );
}

function BusNumber({ number, active }: { number: string; active: boolean }) {
  return (
    <span
      className={cn(
        "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl px-1 font-extrabold tracking-tight shadow-sm ring-1",
        number.length > 3 ? "text-xs" : "text-lg",
        active ? "bg-bus-400 text-slate-900 ring-bus-500/40" : "bg-slate-100 text-slate-400 ring-slate-200",
      )}
    >
      {number}
    </span>
  );
}

function BusRow({ bus, onOpen }: { bus: AdminBus; onOpen: () => void }) {
  const details = [bus.plate || "No plate", bus.capacity ? `${bus.capacity} seats` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <motion.li variants={listItem} layout="position" exit={{ opacity: 0, x: -16 }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Edit Bus ${bus.number}`}
        className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-slate-50/80 sm:px-5"
      >
        <BusNumber number={bus.number} active={bus.active} />
        <div className={cn("min-w-0 flex-1", COLUMNS)}>
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">Bus {bus.number}</p>
            <p className="truncate text-sm text-slate-500">{details}</p>
          </div>
          <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-sm sm:mt-0">
            <RouteIcon className="size-4 shrink-0 text-slate-400" />
            {bus.routeName ? (
              <span className="truncate font-medium text-slate-700">{bus.routeName}</span>
            ) : (
              <span className="font-semibold text-amber-700">No route</span>
            )}
          </p>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-500 sm:mt-0">
            <UserRound className="size-4 shrink-0 text-slate-400" />
            <span className="truncate">
              {bus.drivers.length ? bus.drivers.map((d) => d.name).join(", ") : "Any driver"}
            </span>
          </p>
          <div className="mt-2.5 sm:mt-0 sm:justify-self-end">
            {bus.active ? (
              <Badge tone="green" dot>
                In service
              </Badge>
            ) : (
              <Badge tone="slate">Off</Badge>
            )}
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </button>
    </motion.li>
  );
}

function ListSkeleton() {
  return (
    <Card className="space-y-4 p-5">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="size-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </Card>
  );
}

function routeLabel(route: AdminRoute, bus: AdminBus | null): string {
  const stops = plural(route.stops.length, "stop");
  if (route.bus && route.bus.id !== bus?.id) return `${route.name} — on Bus ${route.bus.number}`;
  return `${route.name} (${stops})`;
}

function BusSheet({
  open,
  bus,
  routes,
  onClose,
}: {
  open: boolean;
  bus: AdminBus | null;
  routes: AdminRoute[];
  onClose: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<BusForm>(() => toForm(bus));
  const [mode, setMode] = useState<SheetMode>("form");
  const [trackerKey, setTrackerKey] = useState(bus?.trackerKey ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "buses"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "routes"] }),
    ]);

  const save = useMutation({
    mutationFn: (body: BusBody) =>
      bus ? api.put(`/api/admin/buses/${bus.id}`, body) : api.post("/api/admin/buses", body),
    onSuccess: async (_, body) => {
      await refresh();
      toast({ title: bus ? `Bus ${body.number} updated` : `Bus ${body.number} added` });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (bus) await api.del(`/api/admin/buses/${bus.id}`);
    },
    onSuccess: async () => {
      await refresh();
      toast({ title: `Bus ${bus?.number ?? ""} deleted` });
      onClose();
    },
  });

  const rotate = useMutation({
    mutationFn: async () => {
      if (!bus) throw new Error("Save the bus first.");
      return api.post<{ trackerKey: string }>(`/api/admin/buses/${bus.id}/tracker-key`);
    },
    onSuccess: async (data) => {
      setTrackerKey(data.trackerKey);
      setMode("form");
      await refresh();
      toast({ title: "New tracker key ready", body: "Enter it in the Traccar Client app on the bus phone." });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const number = form.number.trim();
    if (!number) {
      setProblem("Enter the bus number painted on the bus.");
      return;
    }
    const capacity = form.capacity.trim() ? Number(form.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 120)) {
      setProblem("Seats should be a whole number between 1 and 120.");
      return;
    }
    setProblem(null);
    save.mutate({
      number,
      plate: form.plate.trim(),
      capacity,
      routeId: form.routeId || null,
      active: form.active,
    });
  };

  const formError = problem ?? (save.error ? errorMessage(save.error) : null);
  const titles: Record<SheetMode, string> = {
    form: bus ? `Bus ${bus.number}` : "Add a bus",
    delete: `Delete Bus ${bus?.number ?? ""}?`,
    rotate: "Create a new tracker key?",
  };
  const descriptions: Record<SheetMode, string> = {
    form: bus
      ? "Update the details, route and backup tracker."
      : "A bus needs a route before drivers can start trips with it.",
    delete: "This removes the bus from the drivers' list.",
    rotate: "The old key stops working straight away.",
  };

  const footer: Record<SheetMode, ReactNode> = {
    form: (
      <>
        {bus && <DeleteButton label="Delete" onClick={() => setMode("delete")} />}
        <Button variant="secondary" onClick={onClose} className={cn(!bus && "ml-auto")}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={save.isPending} className="flex-1 sm:flex-none">
          {bus ? "Save changes" : "Add bus"}
        </Button>
      </>
    ),
    delete: (
      <>
        <Button variant="secondary" onClick={() => setMode("form")} className="ml-auto">
          Back
        </Button>
        <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
          Delete bus
        </Button>
      </>
    ),
    rotate: (
      <>
        <Button variant="secondary" onClick={() => setMode("form")} className="ml-auto">
          Back
        </Button>
        <Button loading={rotate.isPending} onClick={() => rotate.mutate()}>
          Create new key
        </Button>
      </>
    ),
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={titles[mode]}
      description={descriptions[mode]}
      footer={footer[mode]}
    >
      <AnimatePresence mode="wait" initial={false}>
        {mode === "form" && (
          <motion.div key="form" {...slide}>
            <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bus number">
                  {(id) => (
                    <Input
                      id={id}
                      value={form.number}
                      maxLength={12}
                      placeholder="12"
                      onChange={(e) => setForm({ ...form, number: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Seats" hint="Optional">
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="numeric"
                      value={form.capacity}
                      placeholder="40"
                      onChange={(e) => setForm({ ...form, capacity: e.target.value.replace(/\D/g, "") })}
                    />
                  )}
                </Field>
              </div>
              <Field label="Number plate">
                {(id) => (
                  <Input
                    id={id}
                    value={form.plate}
                    maxLength={20}
                    placeholder="TN 01 AB 1234"
                    autoCapitalize="characters"
                    onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })}
                  />
                )}
              </Field>
              <Field
                label="Route"
                hint={form.routeId ? undefined : "Drivers can't start a trip until the bus has a route."}
              >
                {(id) => (
                  <Select
                    id={id}
                    value={form.routeId}
                    onChange={(e) => setForm({ ...form, routeId: e.target.value })}
                  >
                    <option value="">No route yet</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {routeLabel(route, bus)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="flex items-center justify-between gap-4 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
                <div>
                  <p className="text-sm font-semibold text-slate-800">In service</p>
                  <p className="text-sm text-slate-500">Buses that are off don't appear for drivers.</p>
                </div>
                <Switch
                  checked={form.active}
                  onChange={(active) => setForm({ ...form, active })}
                  label="In service"
                />
              </div>
              <AnimatePresence>{formError && <Banner tone="error">{formError}</Banner>}</AnimatePresence>
            </form>
            {bus && <TrackerSection trackerKey={trackerKey} onRotate={() => setMode("rotate")} />}
          </motion.div>
        )}

        {mode === "delete" && bus && (
          <motion.div key="delete" {...slide} className="space-y-4">
            <Banner tone="warning" title={`Drivers won't see Bus ${bus.number} any more`}>
              Past trips stay in the trip history. Students on its route keep their stops, but no bus
              will run that route until you assign another one.
            </Banner>
            <AnimatePresence>
              {remove.error && <Banner tone="error">{errorMessage(remove.error)}</Banner>}
            </AnimatePresence>
          </motion.div>
        )}

        {mode === "rotate" && bus && (
          <motion.div key="rotate" {...slide} className="space-y-4">
            <Banner tone="warning" title="The bus phone needs the new key">
              If Traccar Client is set up on Bus {bus.number}'s phone, it will stop updating until you
              enter the new key as its Device identifier.
            </Banner>
            <AnimatePresence>
              {rotate.error && <Banner tone="error">{errorMessage(rotate.error)}</Banner>}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function TrackerSection({ trackerKey, onRotate }: { trackerKey: string; onRotate: () => void }) {
  const toast = useToast();
  const serverUrl = `${window.location.origin}/api/ingest/osmand`;

  const copy = async (text: string, what: string) => {
    toast(
      (await copyText(text))
        ? { title: `${what} copied` }
        : { title: "Couldn't copy", body: "Select the text and copy it manually.", tone: "error" },
    );
  };

  return (
    <section className="mt-6 rounded-3xl border border-slate-200/80 p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-bus-100 text-bus-700">
          <Satellite className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Backup tracker (Traccar Client app)</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            For phones where the browser can't keep sharing location.
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-2xl bg-slate-100 px-3 py-2.5 font-mono text-sm text-slate-800">
          {trackerKey}
        </code>
        <IconButton label="Copy tracker key" onClick={() => void copy(trackerKey, "Tracker key")}>
          <Copy className="size-4" />
        </IconButton>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={onRotate}>
          New key
        </Button>
      </div>
      <ol className="mt-4 space-y-3 text-sm text-slate-600">
        <Step n={1}>
          Install the free <strong className="font-semibold text-slate-800">Traccar Client</strong> app
          on the bus phone.
        </Step>
        <Step n={2}>
          <span>
            Set <strong className="font-semibold text-slate-800">Server URL</strong> to
          </span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-slate-100 px-2.5 py-1.5 font-mono text-xs text-slate-700">
              {serverUrl}
            </code>
            <button
              type="button"
              aria-label="Copy server URL"
              title="Copy server URL"
              onClick={() => void copy(serverUrl, "Server URL")}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 active:scale-95"
            >
              <Copy className="size-3.5" />
            </button>
          </span>
        </Step>
        <Step n={3}>
          Set <strong className="font-semibold text-slate-800">Device identifier</strong> to the key
          above.
        </Step>
      </ol>
      <p className="mt-4 text-xs text-slate-500">
        Locations are only used while this bus has a trip running.
      </p>
    </section>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="mr-auto inline-flex h-11 items-center gap-2 rounded-2xl px-3 text-[15px] font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 active:scale-[0.97]"
    >
      <Trash2 className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
        {n}
      </span>
      <span className="min-w-0 flex-1 pt-0.5 leading-relaxed">{children}</span>
    </li>
  );
}
