import { Loader2, MapPin, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

import { useConfig } from "../../lib/auth";
import { cn } from "../../lib/hooks";
import { loadMaps, type MapsApi } from "../../lib/maps";
import type { LatLng } from "../../lib/types";

export interface PickedPlace extends LatLng {
  name: string;
  address: string;
}

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  prediction: google.maps.places.PlacePrediction | null;
  point?: LatLng;
}

const COORDINATES = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** "13.0850, 80.2101" (as copied from Google Maps) → a point, if it's valid. */
function parseCoordinates(text: string): LatLng | null {
  const match = COORDINATES.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Address search backed by Places API (New) autocomplete, biased to India. */
export function PlaceSearch({
  onPick,
  placeholder = "Search a place or address",
  near,
  className,
}: {
  onPick: (place: PickedPlace) => void;
  placeholder?: string;
  near?: LatLng | null;
  className?: string;
}) {
  const config = useConfig();
  const listId = useId();
  const [api, setApi] = useState<MapsApi | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const session = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const key = config.data?.mapsKey;
    if (config.data && !key) setUnavailable(true);
    if (!key) return;
    loadMaps(key).then(setApi, () => setUnavailable(true));
  }, [config.data]);

  useEffect(() => {
    const point = parseCoordinates(query);
    if (point) {
      requestId.current++;
      setItems([
        {
          id: "coordinates",
          main: `Use ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
          secondary: "Pasted coordinates",
          prediction: null,
          point,
        },
      ]);
      setActive(0);
      setOpen(true);
      return;
    }
    if (!api || query.trim().length < 3) {
      setItems([]);
      return;
    }
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        session.current ??= new api.places.AutocompleteSessionToken();
        const { suggestions } = await api.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query.trim(),
          sessionToken: session.current,
          includedRegionCodes: ["in"],
          language: "en",
          ...(near ? { locationBias: { center: near, radius: 40_000 } } : {}),
        });
        if (id !== requestId.current) return;
        setItems(
          suggestions
            .map((s) => s.placePrediction)
            .filter((p): p is google.maps.places.PlacePrediction => !!p)
            .map((p) => ({
              id: p.placeId,
              main: p.mainText?.text ?? p.text.text,
              secondary: p.secondaryText?.text ?? "",
              prediction: p,
            })),
        );
        setActive(0);
        setOpen(true);
      } catch {
        if (id === requestId.current) setItems([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [api, query, near]);

  const choose = async (item: Suggestion) => {
    setOpen(false);
    if (item.point) {
      onPick({ name: "", address: "", ...item.point });
      setQuery("");
      setItems([]);
      return;
    }
    if (!item.prediction) return;
    setLoading(true);
    try {
      const place = item.prediction.toPlace();
      await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
      const location = place.location;
      if (!location) return;
      onPick({
        name: place.displayName ?? item.main,
        address: place.formattedAddress ?? item.secondary,
        lat: location.lat(),
        lng: location.lng(),
      });
      setQuery("");
      setItems([]);
    } finally {
      session.current = null; // a session ends when a place is picked
      setLoading(false);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + items.length) % items.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            void choose(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={unavailable ? "Paste coordinates, e.g. 13.0850, 80.2101" : placeholder}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-10 text-[15px] outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50"
      />
      {loading && <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-brand-500" />}
      <AnimatePresence>
        {open && items.length > 0 && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-1.5 shadow-float"
          >
            {items.map((item, i) => (
              <li key={item.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void choose(item)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                    i === active ? "bg-brand-50" : "hover:bg-slate-50",
                  )}
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand-500" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-slate-800">{item.main}</span>
                    {item.secondary && <span className="block truncate text-xs text-slate-500">{item.secondary}</span>}
                  </span>
                </button>
              </li>
            ))}
            {items.some((item) => item.prediction) && (
              <li className="px-3 pb-1 pt-2 text-right text-[10px] font-medium text-slate-400">Powered by Google</li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
