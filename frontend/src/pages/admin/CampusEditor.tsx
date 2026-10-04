import { MapPinned, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { MapCanvas } from "../../components/map/MapCanvas";
import { StopMarker } from "../../components/map/Overlays";
import { PlaceSearch } from "../../components/map/PlaceSearch";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Feedback";
import { cn } from "../../lib/hooks";
import type { Campus, LatLng } from "../../lib/types";

export const MAX_CAMPUSES = 4;

/** A campus being edited; new ones have no id (or location) yet. */
export interface CampusDraft {
  key: string;
  id?: string;
  name: string;
  address: string;
  location: LatLng | null;
}

let draftSeq = 0;
export const newCampusDraft = (): CampusDraft => ({
  key: `new-${++draftSeq}`,
  name: "",
  address: "",
  location: null,
});

export function campusDrafts(campuses: Campus[]): CampusDraft[] {
  const drafts = campuses.map((c) => ({ key: c.id, id: c.id, name: c.name, address: c.address, location: c.location }));
  return drafts.length ? drafts : [newCampusDraft()];
}

/** Campuses to save. Untouched blank rows are left out; call `campusProblem` first. */
export function campusesToSave(drafts: CampusDraft[]): (Omit<Campus, "id"> & { id?: string })[] {
  return drafts
    .filter((c): c is CampusDraft & { location: LatLng } => !!c.location)
    .map(({ id, name, address, location }) => ({
      id,
      name: name.trim(),
      address: address.trim(),
      location: { lat: location.lat, lng: location.lng },
    }));
}

export function campusProblem(drafts: CampusDraft[]): string | null {
  for (const c of drafts) {
    if (!c.name.trim() && !c.location) continue;
    if (!c.name.trim()) return "Give every campus a name.";
    if (!c.location) return `Set where ${c.name.trim()} is: search for it, or click the map.`;
  }
  return null;
}

export function CampusEditor({
  campuses,
  onChange,
}: {
  campuses: CampusDraft[];
  onChange: (campuses: CampusDraft[]) => void;
}) {
  const [selectedKey, setSelectedKey] = useState(campuses[0]?.key);
  const selected = campuses.find((c) => c.key === selectedKey) ?? campuses[0];
  const placed = campuses.filter((c) => c.location);
  // Re-frame the map on load, on picking a campus or a search result; not on every click.
  const [view, setView] = useState(() => ({ key: 0, points: placed.map((c) => c.location!) }));
  const frame = (points: LatLng[]) => setView((v) => ({ key: v.key + 1, points }));

  const update = (key: string, patch: Partial<CampusDraft>) =>
    onChange(campuses.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const select = (campus: CampusDraft) => {
    if (campus.key === selected?.key) return;
    setSelectedKey(campus.key);
    if (campus.location) frame([campus.location]);
  };

  const add = () => {
    const draft = newCampusDraft();
    onChange([...campuses, draft]);
    setSelectedKey(draft.key);
  };

  const remove = (campus: CampusDraft) => {
    const rest = campuses.filter((c) => c.key !== campus.key);
    onChange(rest.length ? rest : [newCampusDraft()]);
    if (campus.key === selected?.key) setSelectedKey(rest[0]?.key);
  };

  const count = placed.length;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<MapPinned className="size-5" />}
        title="Campuses"
        subtitle="Morning trips end at a campus; afternoon trips start there. Pick a campus, then search or click the map."
        action={
          count ? (
            <Badge tone="green">
              {count} {count === 1 ? "campus" : "campuses"}
            </Badge>
          ) : (
            <Badge tone="amber">Needed</Badge>
          )
        }
      />
      <div className="space-y-3 p-5">
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {campuses.map((campus, i) => {
              const active = campus.key === selected?.key;
              return (
                <motion.li
                  key={campus.key}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  onClick={() => select(campus)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-2xl p-3 ring-1 transition-colors",
                    active ? "bg-brand-50/60 ring-brand-300" : "bg-white ring-slate-200 hover:ring-slate-300",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 flex size-7 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold",
                      active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <input
                      value={campus.name}
                      onFocus={() => select(campus)}
                      onChange={(e) => update(campus.key, { name: e.target.value })}
                      placeholder={i === 0 ? "e.g. Main campus" : "e.g. Junior campus"}
                      aria-label={`Campus ${i + 1} name`}
                      className="w-full rounded-lg bg-transparent px-1 py-1 text-[15px] font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
                    />
                    <input
                      value={campus.address}
                      onFocus={() => select(campus)}
                      onChange={(e) => update(campus.key, { address: e.target.value })}
                      placeholder="Address"
                      aria-label={`Campus ${i + 1} address`}
                      className="w-full rounded-lg bg-transparent px-1 py-0.5 text-sm text-slate-500 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
                    />
                    <p className={cn("tabular px-1 pt-0.5 text-xs", campus.location ? "text-slate-400" : "font-semibold text-amber-700")}>
                      {campus.location
                        ? `${campus.location.lat.toFixed(5)}, ${campus.location.lng.toFixed(5)}`
                        : "Not on the map yet"}
                    </p>
                  </div>
                  {(campuses.length > 1 || campus.location || campus.name) && (
                    <button
                      type="button"
                      aria-label={`Remove ${campus.name || `campus ${i + 1}`}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(campus);
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
        {campuses.length < MAX_CAMPUSES && (
          <Button variant="soft" size="sm" icon={<Plus className="size-4" />} onClick={add}>
            Add campus
          </Button>
        )}

        {selected && (
          <PlaceSearch
            key={selected.key}
            near={selected.location ?? placed[0]?.location}
            placeholder={`Search for ${selected.name.trim() || `campus ${campuses.indexOf(selected) + 1}`}`}
            onPick={(place) => {
              update(selected.key, {
                location: { lat: place.lat, lng: place.lng },
                name: selected.name || place.name,
                address: selected.address || place.address,
              });
              frame([{ lat: place.lat, lng: place.lng }]);
            }}
          />
        )}
        <MapCanvas
          className="h-80"
          center={view.points[0] ?? null}
          zoom={view.points.length ? 15 : 11}
          fit={view.points.length ? view.points : undefined}
          fitKey={String(view.key)}
          onClick={(point) => selected && update(selected.key, { location: point })}
        >
          {placed.map((campus) => (
            <StopMarker
              key={campus.key}
              position={campus.location!}
              school
              label={campus.name || "Campus"}
              onClick={() => select(campus)}
            />
          ))}
        </MapCanvas>
      </div>
    </Card>
  );
}
