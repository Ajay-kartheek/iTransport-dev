import { LocateFixed } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { LatLng, TripView } from "../lib/types";
import { MapCanvas } from "./map/MapCanvas";
import { BusMarker, RouteLine, StopMarker } from "./map/Overlays";

/** One trip on a map: remaining route, numbered stops, your stop, and the bus. */
export function TripMap({
  trip,
  myStopId,
  className,
  gestures = "cooperative",
  overlay,
}: {
  trip: TripView;
  myStopId?: string | null;
  className?: string;
  gestures?: "greedy" | "cooperative" | "none";
  overlay?: ReactNode;
}) {
  const [recenter, setRecenter] = useState(0);
  const position = trip.position;
  const pending = trip.stops.filter((s) => s.state === "pending");
  const mine = trip.stops.find((s) => s.id === myStopId);

  const focus: LatLng[] = [];
  if (position) {
    focus.push(position);
    const target = mine && mine.state === "pending" ? mine : pending[0];
    if (target) focus.push(target);
  } else {
    focus.push(...trip.stops);
  }
  const fitKey = `${trip.id}:${trip.status}:${position ? "live" : "route"}:${recenter}`;

  let number = 0;
  return (
    <MapCanvas
      className={className}
      fit={focus}
      fitKey={fitKey}
      gestures={gestures}
      overlay={
        <>
          {overlay}
          {focus.length > 0 && (
            <button
              type="button"
              onClick={() => setRecenter((n) => n + 1)}
              className="absolute bottom-3 left-3 z-20 flex h-10 items-center gap-1.5 rounded-2xl bg-white/95 px-3 text-xs font-bold text-slate-700 shadow-float ring-1 ring-slate-200/70 backdrop-blur transition hover:bg-white active:scale-95"
            >
              <LocateFixed className="size-4 text-brand-600" />
              Re-center
            </button>
          )}
        </>
      }
    >
      {trip.polyline ? (
        <RouteLine encoded={trip.polyline} />
      ) : position && pending.length ? (
        <RouteLine path={[position, ...pending]} dashed />
      ) : (
        <RouteLine path={trip.stops} dashed color="#94a3b8" />
      )}
      {trip.stops.map((stop) => {
        if (stop.kind === "school") {
          return <StopMarker key={stop.id} position={stop} school label={stop.name} />;
        }
        number += 1;
        return (
          <StopMarker
            key={stop.id}
            position={stop}
            index={number}
            done={stop.state === "arrived" || stop.state === "departed"}
            skipped={stop.state === "skipped"}
            mine={stop.id === myStopId}
            label={stop.id === myStopId ? "Your stop" : stop.name}
          />
        );
      })}
      {position && (
        <BusMarker
          position={position}
          heading={position.heading}
          label={trip.busNumber ? `Bus ${trip.busNumber}` : undefined}
          stale={trip.stale}
          follow
        />
      )}
    </MapCanvas>
  );
}
