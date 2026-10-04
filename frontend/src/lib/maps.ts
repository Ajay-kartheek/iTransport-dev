import type { LatLng } from "./types";

export interface MapsApi {
  Map: typeof google.maps.Map;
  OverlayView: typeof google.maps.OverlayView;
  Polyline: typeof google.maps.Polyline;
  LatLng: typeof google.maps.LatLng;
  LatLngBounds: typeof google.maps.LatLngBounds;
  event: typeof google.maps.event;
  decodePath: (encoded: string) => google.maps.LatLng[];
  places: google.maps.PlacesLibrary;
}

let loading: Promise<MapsApi> | null = null;
let authFailed = false;
const failureListeners = new Set<() => void>();

export function mapsAuthFailed(): boolean {
  return authFailed;
}

export function onMapsAuthFailure(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

function injectScript(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof google !== "undefined" && typeof google.maps?.importLibrary === "function") {
      resolve();
      return;
    }
    window.__itMapsReady = () => resolve();
    window.gm_authFailure = () => {
      authFailed = true;
      failureListeners.forEach((listener) => listener());
    };
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      region: "IN",
      language: "en",
      callback: "__itMapsReady",
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error("Couldn't load Google Maps."));
    document.head.appendChild(script);
  });
}

/** Load the Maps JavaScript API once and return the classes we use. */
export function loadMaps(key: string): Promise<MapsApi> {
  if (!loading) {
    loading = injectScript(key)
      .then(async () => {
        const [maps, core, geometry, places] = await Promise.all([
          google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
          google.maps.importLibrary("core") as Promise<google.maps.CoreLibrary>,
          google.maps.importLibrary("geometry") as Promise<google.maps.GeometryLibrary>,
          google.maps.importLibrary("places") as Promise<google.maps.PlacesLibrary>,
        ]);
        return {
          Map: maps.Map,
          OverlayView: maps.OverlayView,
          Polyline: maps.Polyline,
          LatLng: core.LatLng,
          LatLngBounds: core.LatLngBounds,
          event: core.event,
          decodePath: (encoded: string) => geometry.encoding.decodePath(encoded),
          places,
        };
      })
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

/** A calm, light basemap so buses and stops stand out. */
export const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f4f6f9" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b7383" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8fafc" }, { weight: 3 }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#9aa3b2" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#eef1f5" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#eef3ee" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#e1f0e3" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e6e9ef" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#7b8494" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#fdebc0" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#f3d58e" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#a0a8b6" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#d4e5f6" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#8ba5c2" }] },
];

/** Default view when nothing else is known: Chennai. */
export const FALLBACK_CENTER: LatLng = { lat: 13.0827, lng: 80.2707 };

export function boundsOf(api: MapsApi, points: LatLng[]): google.maps.LatLngBounds | null {
  if (!points.length) return null;
  const bounds = new api.LatLngBounds();
  points.forEach((p) => bounds.extend(p));
  return bounds;
}

export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
