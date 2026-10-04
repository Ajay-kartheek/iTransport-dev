import { MapPinOff } from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
} from "react";

import { useConfig } from "../../lib/auth";
import { cn } from "../../lib/hooks";
import {
  boundsOf,
  FALLBACK_CENTER,
  LIGHT_MAP_STYLE,
  loadMaps,
  type MapsApi,
  mapsAuthFailed,
  onMapsAuthFailure,
} from "../../lib/maps";
import type { LatLng } from "../../lib/types";

interface MapContextValue {
  map: google.maps.Map;
  api: MapsApi;
}

const MapContext = createContext<MapContextValue | null>(null);

export function useMap(): MapContextValue {
  const value = use(MapContext);
  if (!value) throw new Error("useMap must be used inside MapCanvas");
  return value;
}

type Failure = "nokey" | "auth" | "load";

export function MapCanvas({
  className,
  center,
  zoom = 13,
  fit,
  fitKey,
  fitPadding = 72,
  gestures = "greedy",
  onClick,
  children,
  overlay,
  rounded = true,
}: {
  className?: string;
  center?: LatLng | null;
  zoom?: number;
  /** Points to frame; re-framed whenever `fitKey` changes. */
  fit?: LatLng[];
  fitKey?: string;
  fitPadding?: number;
  gestures?: "greedy" | "cooperative" | "none";
  onClick?: (point: LatLng) => void;
  children?: ReactNode;
  overlay?: ReactNode;
  rounded?: boolean;
}) {
  const config = useConfig();
  const divRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<MapContextValue | null>(null);
  const [failure, setFailure] = useState<Failure | null>(mapsAuthFailed() ? "auth" : null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => onMapsAuthFailure(() => setFailure("auth")), []);

  useEffect(() => {
    if (!config.data) return;
    const key = config.data.mapsKey;
    if (!key) {
      setFailure("nokey");
      return;
    }
    let cancelled = false;
    loadMaps(key)
      .then((api) => {
        if (cancelled || !divRef.current) return;
        const map = new api.Map(divRef.current, {
          center: center ?? fit?.[0] ?? FALLBACK_CENTER,
          zoom,
          styles: LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: gestures !== "none",
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
          gestureHandling: gestures,
          clickableIcons: false,
          keyboardShortcuts: false,
          backgroundColor: "#eef1f5",
          isFractionalZoomEnabled: true,
        });
        setCtx({ map, api });
      })
      .catch(() => !cancelled && setFailure("load"));
    return () => {
      cancelled = true;
    };
    // The map is created once; later prop changes are applied by the effects below.
  }, [config.data]);

  useEffect(() => {
    if (!ctx) return;
    const listener = ctx.map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) clickRef.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
    return () => listener.remove();
  }, [ctx]);

  useEffect(() => {
    if (!ctx || !fit?.length) return;
    if (fit.length === 1) {
      ctx.map.panTo(fit[0]);
      ctx.map.setZoom(Math.max(ctx.map.getZoom() ?? 15, 15));
      return;
    }
    const bounds = boundsOf(ctx.api, fit);
    if (bounds) ctx.map.fitBounds(bounds, fitPadding);
    // Re-frame only when the caller says the framing changed.
  }, [ctx, fitKey]);

  return (
    <div className={cn("relative isolate overflow-hidden bg-[#eef1f5]", rounded && "rounded-3xl", className)}>
      <div ref={divRef} className="absolute inset-0" />
      {!ctx && !failure && <div className="skeleton absolute inset-0 rounded-none" />}
      {failure && <MapFallback reason={failure} />}
      {ctx && !failure && <MapContext value={ctx}>{children}</MapContext>}
      {overlay}
    </div>
  );
}

function MapFallback({ reason }: { reason: Failure }) {
  const copy: Record<Failure, [string, string]> = {
    nokey: ["Map not set up yet", "Add a Google Maps key to show the live map. Stop-by-stop progress still works."],
    auth: ["Google Maps is unavailable", "The Maps API key or billing needs attention. Stop-by-stop progress still works."],
    load: ["Couldn't load the map", "Check your connection. Stop-by-stop progress still works."],
  };
  const [title, body] = copy[reason];
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#f1f4f8] p-6 text-center"
      style={{
        backgroundImage:
          "linear-gradient(#e3e8ef 1px, transparent 1px), linear-gradient(90deg, #e3e8ef 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-card">
        <MapPinOff className="size-6" />
      </div>
      <p className="mt-3 text-sm font-bold text-slate-700">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}
