import { useEffect, useRef, useState } from "react";

import { ApiError, api, clockOffsetMs } from "./api";
import { distanceM } from "./maps";

/**
 * Shares the driver's phone location while a trip is running.
 *
 * Positions are queued in localStorage and sent in batches, so short signal
 * drops lose nothing. The screen is kept awake with the Wake Lock API, since
 * browsers pause geolocation when the screen locks.
 */

export type GpsState = "starting" | "good" | "weak" | "denied" | "unavailable";
export type WakeState = "on" | "off" | "unsupported";

export interface IngestResult {
  accepted: number;
  rejected: Record<string, number>;
  currentStopId: string | null;
  nextStopId: string | null;
  nextStopEta: number | null;
}

export interface TrackerSnapshot {
  gps: GpsState;
  accuracy: number | null;
  lastFixAt: number | null;
  lastSentAt: number | null;
  lastAcceptedAt: number | null;
  queued: number;
  wake: WakeState;
  ended: boolean;
  lastResult: IngestResult | null;
}

interface QueuedFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
  speed: number | null;
  heading: number | null;
}

const RECORD_EVERY_MS = 15_000;
const RECORD_MOVED_M = 50;
const MIN_GAP_MS = 4_000;
const MAX_KEEP_ACCURACY_M = 150;
const GOOD_ACCURACY_M = 40;
const FLUSH_EVERY_MS = 5_000;
const BATCH = 60;
const MAX_QUEUE = 1_500;

const storageKey = (tripId: string) => `itransport.queue.${tripId}`;

function loadQueue(tripId: string): QueuedFix[] {
  try {
    const raw = localStorage.getItem(storageKey(tripId));
    return raw ? (JSON.parse(raw) as QueuedFix[]) : [];
  } catch {
    return [];
  }
}

class TripTracker {
  private queue: QueuedFix[];
  private watchId: number | null = null;
  private timer: number | null = null;
  private lock: WakeLockSentinel | null = null;
  private sending = false;
  private lastRecorded: QueuedFix | null = null;
  private stopped = false;
  snapshot: TrackerSnapshot;

  constructor(
    private readonly tripId: string,
    private readonly emit: (snapshot: TrackerSnapshot) => void,
  ) {
    this.queue = loadQueue(tripId);
    this.snapshot = {
      gps: "starting",
      accuracy: null,
      lastFixAt: null,
      lastSentAt: null,
      lastAcceptedAt: null,
      queued: this.queue.length,
      wake: "wakeLock" in navigator ? "off" : "unsupported",
      ended: false,
      lastResult: null,
    };
  }

  start(): void {
    if (!("geolocation" in navigator)) {
      this.update({ gps: "unavailable" });
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(this.onPosition, this.onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30_000,
    });
    void this.requestWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("online", this.onOnline);
    this.timer = window.setInterval(() => void this.flush(), FLUSH_EVERY_MS);
    void this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    if (this.timer !== null) window.clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("online", this.onOnline);
    void this.lock?.release().catch(() => undefined);
    this.lock = null;
  }

  /** Send everything that's queued (used right before ending a trip). */
  async drain(): Promise<void> {
    for (let i = 0; i < 20 && this.queue.length && !this.snapshot.ended; i++) {
      const before = this.queue.length;
      await this.flush();
      if (this.queue.length >= before) break;
    }
  }

  private update(patch: Partial<TrackerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, queued: this.queue.length };
    this.emit(this.snapshot);
  }

  private save(): void {
    try {
      if (this.queue.length) localStorage.setItem(storageKey(this.tripId), JSON.stringify(this.queue));
      else localStorage.removeItem(storageKey(this.tripId));
    } catch {
      // Storage full or blocked: keep the in-memory queue.
    }
  }

  private onPosition = (position: GeolocationPosition): void => {
    const { latitude, longitude, accuracy, speed, heading } = position.coords;
    const fix: QueuedFix = {
      lat: latitude,
      lng: longitude,
      accuracy: Math.max(1, Math.round(accuracy)),
      // Phone clocks drift; send server time so fixes aren't rejected as "future" or "old".
      at: Math.round(position.timestamp + clockOffsetMs()),
      speed: speed !== null && Number.isFinite(speed) && speed >= 0 ? speed : null,
      heading:
        heading !== null && Number.isFinite(heading) && heading >= 0 && heading <= 360 ? heading : null,
    };
    this.update({
      gps: accuracy <= GOOD_ACCURACY_M ? "good" : "weak",
      accuracy: Math.round(accuracy),
      lastFixAt: Date.now(),
    });
    if (accuracy > MAX_KEEP_ACCURACY_M) return;

    const last = this.lastRecorded;
    if (last) {
      const gap = fix.at - last.at;
      const moved = distanceM(last, fix);
      const due = gap >= RECORD_EVERY_MS || (moved >= RECORD_MOVED_M && gap >= MIN_GAP_MS);
      if (!due) return;
    }
    this.lastRecorded = fix;
    this.queue.push(fix);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.save();
    this.update({});
    if (!last || this.queue.length >= 3) void this.flush();
  };

  private onError = (error: GeolocationPositionError): void => {
    if (error.code === error.PERMISSION_DENIED) this.update({ gps: "denied" });
    else if (this.snapshot.gps === "starting") this.update({ gps: "weak" });
  };

  private onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      void this.requestWakeLock();
      void this.flush();
    }
  };

  private onOnline = (): void => void this.flush();

  private async requestWakeLock(): Promise<void> {
    if (!("wakeLock" in navigator) || this.stopped) return;
    try {
      this.lock = await navigator.wakeLock.request("screen");
      this.update({ wake: "on" });
      this.lock.addEventListener("release", () => {
        this.lock = null;
        if (!this.stopped) this.update({ wake: "off" });
      });
    } catch {
      this.update({ wake: "off" });
    }
  }

  private async flush(): Promise<void> {
    if (this.sending || !this.queue.length || !navigator.onLine || this.snapshot.ended) return;
    this.sending = true;
    const batch = this.queue.slice(0, BATCH);
    try {
      const result = await api.post<IngestResult>(`/api/driver/trips/${this.tripId}/locations`, {
        fixes: batch,
      });
      this.queue.splice(0, batch.length);
      this.save();
      this.update({
        lastSentAt: Date.now(),
        lastAcceptedAt: result.accepted > 0 ? Date.now() : this.snapshot.lastAcceptedAt,
        lastResult: result,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "trip_not_active") {
        this.queue = [];
        this.save();
        this.update({ ended: true });
        this.stop();
      } else if (error instanceof ApiError && (error.status === 422 || error.status === 400)) {
        this.queue.splice(0, batch.length); // malformed batch: drop it rather than retry forever
        this.save();
        this.update({});
      }
      // Network or server errors: keep the queue and retry on the next tick.
    } finally {
      this.sending = false;
    }
  }
}

export interface TripTrackerHandle extends TrackerSnapshot {
  drain: () => Promise<void>;
}

export function useTripTracker(tripId: string | null, enabled: boolean): TripTrackerHandle | null {
  const [snapshot, setSnapshot] = useState<TrackerSnapshot | null>(null);
  const trackerRef = useRef<TripTracker | null>(null);

  useEffect(() => {
    if (!tripId || !enabled) return;
    const tracker = new TripTracker(tripId, setSnapshot);
    trackerRef.current = tracker;
    setSnapshot(tracker.snapshot);
    tracker.start();
    return () => {
      tracker.stop();
      trackerRef.current = null;
    };
  }, [tripId, enabled]);

  if (!snapshot) return null;
  return {
    ...snapshot,
    drain: async () => {
      await trackerRef.current?.drain();
    },
  };
}

export function discardQueue(tripId: string): void {
  try {
    localStorage.removeItem(storageKey(tripId));
  } catch {
    // ignore
  }
}
