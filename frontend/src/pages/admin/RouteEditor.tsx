import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, Crosshair, GripVertical, MapPin, Save, School, Trash2, Users } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { MapCanvas } from "../../components/map/MapCanvas";
import { RouteLine, StopMarker } from "../../components/map/Overlays";
import { PlaceSearch } from "../../components/map/PlaceSearch";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge, Banner, EmptyState, Skeleton } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Form";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/hooks";
import type { AdminRoute, Campus, LatLng, SchoolSettings } from "../../lib/types";

interface DraftStop extends LatLng {
  key: string;
  id: string | null;
  name: string;
  address: string;
  studentCount: number;
}

let keySeq = 0;
const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function RouteEditor() {
  const { routeId = "new" } = useParams();
  const isNew = routeId === "new";
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const routes = useQuery({
    queryKey: ["admin", "routes"],
    queryFn: async () => (await api.get<{ routes: AdminRoute[] }>("/api/admin/routes")).routes,
  });
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => (await api.get<{ settings: SchoolSettings }>("/api/admin/settings")).settings,
  });
  const existing = routes.data?.find((r) => r.id === routeId);

  const [name, setName] = useState("");
  const [stops, setStops] = useState<DraftStop[]>([]);
  // Campuses the bus visits in morning order; null until changed (route's own, or the first campus).
  const [chosenCampusIds, setCampusIds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isNew && loadedFor !== "new") {
      setName("");
      setStops([]);
      setCampusIds(null);
      setLoadedFor("new");
    } else if (existing && loadedFor !== existing.id) {
      setName(existing.name);
      setCampusIds(null);
      setStops(
        existing.stops.map((s) => ({
          key: s.id,
          id: s.id,
          name: s.name,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          studentCount: s.studentCount ?? 0,
        })),
      );
      setLoadedFor(existing.id);
    }
  }, [isNew, existing, loadedFor]);

  const allCampuses = settings.data?.campuses ?? [];
  const savedCampusIds = existing?.campusIds ?? allCampuses.slice(0, 1).map((c) => c.id);
  const campusIds = settings.data
    ? (chosenCampusIds ?? savedCampusIds).filter((id) => allCampuses.some((c) => c.id === id))
    : (chosenCampusIds ?? savedCampusIds);
  const campuses = campusIds.flatMap((id) => allCampuses.filter((c) => c.id === id));
  const campusPoints = campuses.map((c) => c.location);
  const school = campusPoints[0] ?? null;
  const original = useMemo(
    () =>
      JSON.stringify(
        existing
          ? {
              name: existing.name,
              stops: existing.stops.map((s) => [s.id, s.name, s.address, s.lat, s.lng]),
              campusIds: existing.campusIds,
            }
          : { name: "", stops: [], campusIds: savedCampusIds },
      ),
    // savedCampusIds only matters for a new route, before anything is typed.
    [existing, settings.data],
  );
  const current = JSON.stringify({
    name,
    stops: stops.map((s) => [s.id, s.name, s.address, s.lat, s.lng]),
    campusIds,
  });
  const dirty = current !== original;

  const [fitKey, setFitKey] = useState("initial");
  useEffect(() => {
    if (loadedFor) setFitKey(`loaded:${loadedFor}`);
  }, [loadedFor]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        campusIds,
        stops: stops.map((s) => ({ id: s.id, name: s.name.trim(), address: s.address.trim(), lat: s.lat, lng: s.lng })),
      };
      if (isNew) return (await api.post<{ id: string }>("/api/admin/routes", body)).id;
      await api.put(`/api/admin/routes/${routeId}`, body);
      return routeId;
    },
    onSuccess: async (id) => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      setLoadedFor(null);
      toast({ title: isNew ? "Route created" : "Route saved" });
      if (isNew) navigate(`/admin/routes/${id}`, { replace: true });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/admin/routes/${routeId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast({ title: "Route deleted" });
      navigate("/admin/routes", { replace: true });
    },
    onError: (err) => {
      setConfirmDelete(false);
      setError(errorMessage(err));
    },
  });

  const addStop = (point: LatLng, label?: string, address = "") => {
    const stop: DraftStop = {
      key: newKey(),
      id: null,
      name: label ?? `Stop ${stops.length + 1}`,
      address,
      lat: point.lat,
      lng: point.lng,
      studentCount: 0,
    };
    setStops((list) => [...list, stop]);
    setSelected(stop.key);
  };

  const update = (key: string, patch: Partial<DraftStop>) =>
    setStops((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const onMapClick = (point: LatLng) => {
    if (moving) {
      update(moving, point);
      setMoving(null);
      return;
    }
    addStop(point);
  };

  const valid = name.trim().length > 0 && stops.every((s) => s.name.trim());
  const loading = !isNew && (routes.isPending || (!existing && !routes.isError));

  if (!isNew && routes.data && !existing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Card>
          <EmptyState title="Route not found" body="It may have been deleted." action={<Link to="/admin/routes" className="font-bold text-brand-700">Back to routes</Link>} />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          to="/admin/routes"
          className="flex size-10 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-white hover:text-slate-900"
          aria-label="Back to routes"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-slate-900">
            {isNew ? "New route" : name || "Route"}
          </h1>
          <p className="text-sm text-slate-500">
            Search or click the map to add stops. Drag to reorder — morning pickups follow this order.
          </p>
        </div>
        <AnimatePresence>
          {dirty && (
            <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <Badge tone="amber" dot>
                Unsaved changes
              </Badge>
            </motion.span>
          )}
        </AnimatePresence>
        <Button
          icon={<Save className="size-4" />}
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={!dirty || !valid}
        >
          {isNew ? "Create route" : "Save route"}
        </Button>
      </div>

      {error && <Banner tone="error" className="mb-4">{error}</Banner>}

      {loading ? (
        <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
          <Skeleton className="h-[32rem] rounded-4xl" />
          <Skeleton className="h-[32rem] rounded-4xl" />
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
          <div className="order-2 space-y-4 lg:order-1">
            <Card className="space-y-4 p-5">
              <div>
                <label htmlFor="route-name" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Route name
                </label>
                <Input id="route-name" value={name} placeholder="e.g. Route 3 — Anna Nagar" onChange={(e) => setName(e.target.value)} />
              </div>
              <PlaceSearch
                near={stops.at(-1) ?? school}
                placeholder="Add a stop: search a place"
                onPick={(place) => {
                  addStop(place, place.name || undefined, place.address);
                  setFitKey(`add:${Date.now()}`);
                }}
              />
              {allCampuses.length > 1 && (
                <CampusPicker
                  campuses={allCampuses}
                  chosen={campusIds}
                  onChange={(ids) => {
                    setCampusIds(ids);
                    setFitKey(`campus:${ids.join(",")}`);
                  }}
                />
              )}
            </Card>

            <Card className="p-3">
              {stops.length === 0 ? (
                <EmptyState
                  icon={<MapPin className="size-6" />}
                  title="No stops yet"
                  body="Search for a place above, or click anywhere on the map to drop a stop."
                />
              ) : (
                <Reorder.Group axis="y" values={stops} onReorder={setStops} className="space-y-2">
                  {stops.map((stop, i) => (
                    <StopRow
                      key={stop.key}
                      stop={stop}
                      index={i}
                      selected={selected === stop.key}
                      moving={moving === stop.key}
                      onSelect={() => setSelected(stop.key)}
                      onChange={(patch) => update(stop.key, patch)}
                      onMove={() => setMoving((m) => (m === stop.key ? null : stop.key))}
                      onRemove={() => {
                        setStops((list) => list.filter((s) => s.key !== stop.key));
                        if (moving === stop.key) setMoving(null);
                      }}
                    />
                  ))}
                </Reorder.Group>
              )}
            </Card>

            {!isNew && (
              <Card className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-bold text-slate-800">Delete this route</p>
                  <p className="text-xs text-slate-500">Only possible when no bus or student uses it.</p>
                </div>
                <Button variant="dangerSoft" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </Card>
            )}
          </div>

          <div className="order-1 lg:sticky lg:top-6 lg:order-2">
            <MapCanvas
              className={cn("h-80 sm:h-[26rem] lg:h-[calc(100dvh-9rem)]", moving && "ring-4 ring-brand-300")}
              center={school}
              zoom={12}
              fit={[...stops, ...campusPoints]}
              fitKey={fitKey}
              onClick={onMapClick}
              overlay={
                <AnimatePresence>
                  {moving && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-float"
                    >
                      Click the map to place “{stops.find((s) => s.key === moving)?.name}”
                    </motion.div>
                  )}
                </AnimatePresence>
              }
            >
              <RouteLine path={[...stops, ...campusPoints]} dashed />
              {campuses.map((campus) => (
                <StopMarker key={campus.id} position={campus.location} school label={campus.name} />
              ))}
              {stops.map((stop, i) => (
                <StopMarker
                  key={stop.key}
                  position={stop}
                  index={i + 1}
                  selected={selected === stop.key}
                  label={stop.name}
                  onClick={() => setSelected(stop.key)}
                />
              ))}
            </MapCanvas>
            {settings.data && !allCampuses.length && (
              <p className="mt-2 text-xs text-slate-500">
                Tip: add the school's campus in <Link to="/admin/settings" className="font-bold text-brand-700">School settings</Link> so trips can end there.
              </p>
            )}
          </div>
        </div>
      )}

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this route?"
        description="This can't be undone."
        footer={
          <>
            <Button variant="secondary" block onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" block loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete route
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">“{name}” and its {stops.length} stops will be removed.</p>
      </Sheet>
    </div>
  );
}

/** Which campuses the bus drops at, in morning order (afternoons run the other way). */
function CampusPicker({
  campuses,
  chosen,
  onChange,
}: {
  campuses: Campus[];
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (!chosen.includes(id)) onChange([...chosen, id]);
    else if (chosen.length > 1) onChange(chosen.filter((c) => c !== id));
  };
  // Chosen campuses first, in visiting order.
  const ordered = [
    ...chosen.flatMap((id) => campuses.filter((c) => c.id === id)),
    ...campuses.filter((c) => !chosen.includes(c.id)),
  ];
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">Campuses this bus goes to</p>
        {chosen.length > 1 && (
          <button
            type="button"
            onClick={() => onChange([...chosen].reverse())}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-brand-700 transition hover:bg-brand-50"
          >
            <ArrowRightLeft className="size-3.5" /> Swap order
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ordered.map((campus) => {
          const order = chosen.indexOf(campus.id);
          const on = order >= 0;
          return (
            <motion.button
              layout
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
              key={campus.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(campus.id)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full pl-1.5 pr-3.5 text-sm font-semibold ring-1 transition active:scale-95",
                on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[11px] font-extrabold",
                  on ? "bg-white/20" : "bg-slate-100 text-slate-400",
                )}
              >
                {on ? order + 1 : <School className="size-3.5" />}
              </span>
              {campus.name}
            </motion.button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {chosen.length > 1
          ? "Morning trips drop at the campuses in this order; afternoon trips start at the last one."
          : "Tap another campus if this bus drops at both."}
      </p>
    </div>
  );
}

function StopRow({
  stop,
  index,
  selected,
  moving,
  onSelect,
  onChange,
  onMove,
  onRemove,
}: {
  stop: DraftStop;
  index: number;
  selected: boolean;
  moving: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DraftStop>) => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={stop}
      dragListener={false}
      dragControls={controls}
      onFocus={onSelect}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-3xl border bg-white p-2 pr-2.5 transition-colors",
        selected ? "border-brand-300 bg-brand-50/40" : "border-slate-200/70",
      )}
      whileDrag={{ scale: 1.02, boxShadow: "0 18px 40px -16px rgb(16 24 40 / 0.35)" }}
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-5" />
      </button>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <input
          value={stop.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full rounded-xl bg-transparent px-2 py-1 text-sm font-bold text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-brand-200"
          aria-label={`Stop ${index + 1} name`}
        />
        <p className="flex items-center gap-2 truncate px-2 text-xs text-slate-400">
          {stop.studentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-slate-500">
              <Users className="size-3" /> {stop.studentCount}
            </span>
          )}
          <span className="truncate">{stop.address || `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onMove();
        }}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl transition",
          moving ? "bg-brand-600 text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
        )}
        aria-label="Move on map"
        title="Move on map"
      >
        <Crosshair className="size-4" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        disabled={stop.studentCount > 0}
        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
        aria-label="Remove stop"
        title={stop.studentCount > 0 ? "Students use this stop" : "Remove stop"}
      >
        <Trash2 className="size-4" />
      </button>
    </Reorder.Item>
  );
}
