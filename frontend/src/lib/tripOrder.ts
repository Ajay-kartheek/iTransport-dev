import { distanceM } from "./maps";
import type { Direction, LatLng } from "./types";

// Mirrors stops_reversed() in backend/app/services/trips.py; keep the two in step.
const SAME_DISTANCE_M = 300;

/**
 * Whether a trip runs the route's stops against their listed order. The office
 * can choose; otherwise morning trips finish at the end of the route nearest
 * the campus and afternoon trips start there. A loop runs as listed both ways.
 */
export function tripReversed(
  stops: LatLng[],
  campus: LatLng | null,
  direction: Direction,
  chosen: boolean | null | undefined,
): { reversed: boolean; automatic: boolean } {
  if (typeof chosen === "boolean") return { reversed: chosen, automatic: false };
  if (stops.length < 2 || !campus) return { reversed: false, automatic: true };
  const nearFirst = distanceM(stops[0], campus);
  const nearLast = distanceM(stops[stops.length - 1], campus);
  if (Math.abs(nearFirst - nearLast) < Math.max(SAME_DISTANCE_M, 0.2 * Math.max(nearFirst, nearLast))) {
    return { reversed: false, automatic: true };
  }
  const schoolEndListedFirst = nearFirst < nearLast;
  return { reversed: direction === "AM" ? schoolEndListedFirst : !schoolEndListedFirst, automatic: true };
}
