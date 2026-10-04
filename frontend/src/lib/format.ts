import type { Direction } from "./types";

const SCHOOL_TZ = "Asia/Kolkata";

const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHOOL_TZ,
  hour: "numeric",
  minute: "2-digit",
});

const dayFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: SCHOOL_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const shortDayFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: SCHOOL_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const hourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHOOL_TZ,
  hour: "numeric",
  hourCycle: "h23",
});

/** "7:42 AM" in school time. */
export function clock(ms: number | null | undefined): string {
  return ms ? clockFormat.format(ms) : "—";
}

export function longDay(ms: number): string {
  return dayFormat.format(ms);
}

export function shortDay(ms: number): string {
  return shortDayFormat.format(ms);
}

export function dateFromIso(date: string): number {
  return Date.parse(`${date}T12:00:00+05:30`);
}

export function schoolHour(ms: number): number {
  return Number(hourFormat.format(ms)) % 24;
}

export function greeting(ms: number): string {
  const hour = schoolHour(ms);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "just now", "12s ago", "4 min ago", "1 hr ago". */
export function ago(ms: number | null | undefined, now: number): string {
  if (!ms) return "never";
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

/** Whole minutes until a time (never negative). */
export function minutesUntil(ms: number, now: number): number {
  return Math.max(0, Math.round((ms - now) / 60_000));
}

export function duration(fromMs: number, toMs: number): string {
  const minutes = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function directionLabel(direction: Direction): string {
  return direction === "AM" ? "Morning pickup" : "Afternoon drop";
}

export function shortDirection(direction: Direction): string {
  return direction === "AM" ? "Morning" : "Afternoon";
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
