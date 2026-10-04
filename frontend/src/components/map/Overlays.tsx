import { Bus, Check, School } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/hooks";
import { distanceM, lerp, type MapsApi } from "../../lib/maps";
import type { LatLng } from "../../lib/types";
import { useMap } from "./MapCanvas";

export interface OverlayHandle {
  setPosition: (point: LatLng) => void;
}

interface HtmlOverlay extends google.maps.OverlayView {
  setPosition(point: LatLng): void;
}

const overlayClasses = new WeakMap<MapsApi, new (el: HTMLElement, at: LatLng) => HtmlOverlay>();

function overlayClass(api: MapsApi) {
  let cls = overlayClasses.get(api);
  if (!cls) {
    cls = class extends api.OverlayView implements HtmlOverlay {
      private point: google.maps.LatLng;
      constructor(
        private readonly el: HTMLElement,
        at: LatLng,
      ) {
        super();
        this.point = new api.LatLng(at.lat, at.lng);
      }
      override onAdd() {
        api.OverlayView.preventMapHitsAndGesturesFrom(this.el);
        this.getPanes()?.overlayMouseTarget.appendChild(this.el);
      }
      override draw() {
        const pixel = this.getProjection()?.fromLatLngToDivPixel(this.point);
        if (pixel) {
          this.el.style.left = `${pixel.x}px`;
          this.el.style.top = `${pixel.y}px`;
        }
      }
      override onRemove() {
        this.el.remove();
      }
      setPosition(at: LatLng) {
        this.point = new api.LatLng(at.lat, at.lng);
        this.draw();
      }
    };
    overlayClasses.set(api, cls);
  }
  return cls;
}

/** Renders React children at a map coordinate. */
export function MapOverlay({
  position,
  zIndex = 1,
  anchor = "center",
  controlRef,
  children,
}: {
  position: LatLng;
  zIndex?: number;
  anchor?: "center" | "bottom";
  controlRef?: RefObject<OverlayHandle | null>;
  children: ReactNode;
}) {
  const { map, api } = useMap();
  const [container] = useState(() => {
    const el = document.createElement("div");
    el.style.position = "absolute";
    return el;
  });
  const overlayRef = useRef<HtmlOverlay | null>(null);

  useEffect(() => {
    const Overlay = overlayClass(api);
    const overlay = new Overlay(container, position);
    overlay.setMap(map);
    overlayRef.current = overlay;
    if (controlRef) controlRef.current = { setPosition: (p) => overlay.setPosition(p) };
    return () => {
      overlay.setMap(null);
      overlayRef.current = null;
    };
    // Position updates are applied below without re-creating the overlay.
  }, [map, api, container]);

  useEffect(() => {
    if (!controlRef) overlayRef.current?.setPosition(position);
  }, [controlRef, position.lat, position.lng]);

  useEffect(() => {
    container.style.zIndex = String(zIndex);
  }, [container, zIndex]);

  return createPortal(
    <div
      style={{
        position: "absolute",
        transform: anchor === "center" ? "translate(-50%, -50%)" : "translate(-50%, -100%)",
      }}
    >
      {children}
    </div>,
    container,
  );
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The bus: glides between updates instead of jumping. */
export function BusMarker({
  position,
  heading,
  label,
  stale,
  selected,
  onClick,
  follow,
}: {
  position: LatLng;
  heading?: number | null;
  label?: string;
  stale?: boolean;
  selected?: boolean;
  onClick?: () => void;
  follow?: boolean;
}) {
  const { map } = useMap();
  const handle = useRef<OverlayHandle | null>(null);
  const shown = useRef<LatLng>(position);
  const userMovedAt = useRef(0);

  useEffect(() => {
    const listener = map.addListener("dragstart", () => {
      userMovedAt.current = Date.now();
    });
    return () => listener.remove();
  }, [map]);

  useEffect(() => {
    const from = shown.current;
    const to = position;
    const meters = distanceM(from, to);
    let frame = 0;
    const keepVisible = () => {
      if (!follow || Date.now() - userMovedAt.current < 20_000) return;
      const bounds = map.getBounds();
      if (bounds && !bounds.contains(to)) map.panTo(to);
    };
    if (meters < 0.5 || meters > 5_000) {
      shown.current = to;
      handle.current?.setPosition(to);
      keepVisible();
      return;
    }
    const duration = Math.min(2_400, 500 + meters * 6);
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const point = lerp(from, to, easeInOut(k));
      shown.current = point;
      handle.current?.setPosition(point);
      if (k < 1) frame = requestAnimationFrame(step);
      else keepVisible();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [position.lat, position.lng]);

  return (
    <MapOverlay position={shown.current} controlRef={handle} zIndex={selected ? 40 : 30}>
      <button
        type="button"
        onClick={onClick}
        className="group relative flex flex-col items-center outline-none"
        aria-label={label ? `Bus ${label}` : "Bus"}
      >
        <span className="relative flex size-14 items-center justify-center">
          {!stale && <span className="absolute inset-1 rounded-full bg-bus-400/40 animate-pulse-ring" />}
          {heading != null && !stale && (
            <span
              className="absolute inset-0 transition-transform duration-700 ease-out"
              style={{ transform: `rotate(${heading}deg)` }}
            >
              <span className="absolute left-1/2 top-[-3px] h-0 w-0 -translate-x-1/2 border-x-[7px] border-b-[10px] border-x-transparent border-b-brand-600" />
            </span>
          )}
          <span
            className={cn(
              "relative flex size-11 items-center justify-center rounded-2xl border-[3px] border-white shadow-float transition-colors",
              stale ? "bg-slate-300 text-slate-600" : "bg-bus-400 text-slate-900",
              selected && "ring-4 ring-brand-300",
            )}
          >
            <Bus className="size-5" strokeWidth={2.4} />
          </span>
        </span>
        {label && (
          <span
            className={cn(
              "-mt-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-extrabold shadow-md",
              stale ? "bg-slate-500 text-white" : "bg-slate-900 text-white",
            )}
          >
            {label}
          </span>
        )}
      </button>
    </MapOverlay>
  );
}

export function StopMarker({
  position,
  index,
  done,
  skipped,
  mine,
  school,
  selected,
  label,
  onClick,
}: {
  position: LatLng;
  index?: number;
  done?: boolean;
  skipped?: boolean;
  mine?: boolean;
  school?: boolean;
  selected?: boolean;
  label?: string;
  onClick?: () => void;
}) {
  const body = school ? (
    <span className="flex size-9 items-center justify-center rounded-2xl border-[3px] border-white bg-brand-600 text-white shadow-lg">
      <School className="size-[18px]" />
    </span>
  ) : mine ? (
    <span className="relative flex size-10 items-center justify-center">
      <span className="absolute inset-0 rounded-full bg-brand-500/30 animate-pulse-ring" />
      <span className="relative flex size-8 items-center justify-center rounded-full border-[3px] border-white bg-brand-600 text-[12px] font-extrabold text-white shadow-lg">
        {done ? <Check className="size-4" strokeWidth={3} /> : (index ?? "")}
      </span>
    </span>
  ) : (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-full border-[2.5px] text-[11px] font-extrabold shadow-md transition-colors",
        done
          ? "border-white bg-emerald-500 text-white"
          : skipped
            ? "border-white bg-slate-300 text-slate-600"
            : "border-brand-500 bg-white text-brand-700",
        selected && "scale-125 ring-4 ring-brand-200",
      )}
    >
      {done ? <Check className="size-3.5" strokeWidth={3} /> : (index ?? "")}
    </span>
  );
  return (
    <MapOverlay position={position} zIndex={school ? 12 : mine ? 20 : selected ? 25 : 10}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="flex flex-col items-center disabled:cursor-default"
        aria-label={label ?? "Stop"}
      >
        {body}
        {label && (mine || school || selected) && (
          <span className="mt-1 whitespace-nowrap rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-md ring-1 ring-slate-200">
            {label}
          </span>
        )}
      </button>
    </MapOverlay>
  );
}

export function RouteLine({
  encoded,
  path,
  color = "#3366ff",
  dashed,
}: {
  encoded?: string | null;
  path?: LatLng[];
  color?: string;
  dashed?: boolean;
}) {
  const { map, api } = useMap();
  const pathKey = path ? path.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|") : "";

  useEffect(() => {
    const points = encoded
      ? api.decodePath(encoded)
      : (path ?? []).map((p) => new api.LatLng(p.lat, p.lng));
    if (points.length < 2) return;
    const casing = new api.Polyline({
      map,
      path: points,
      strokeColor: "#ffffff",
      strokeOpacity: dashed ? 0 : 1,
      strokeWeight: 9,
      zIndex: 1,
      clickable: false,
    });
    const line = new api.Polyline({
      map,
      path: points,
      strokeColor: color,
      strokeOpacity: dashed ? 0 : 0.95,
      strokeWeight: 5,
      zIndex: 2,
      clickable: false,
      icons: dashed
        ? [
            {
              icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: color, scale: 3 },
              offset: "0",
              repeat: "14px",
            },
          ]
        : undefined,
    });
    return () => {
      casing.setMap(null);
      line.setMap(null);
    };
    // pathKey captures `path` content changes.
  }, [map, api, encoded, pathKey, color, dashed]);

  return null;
}
