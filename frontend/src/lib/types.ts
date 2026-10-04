export type Role = "ADMIN" | "DRIVER" | "PARENT";
export type Direction = "AM" | "PM";
export type TripStatus = "scheduled" | "in_progress" | "completed";
export type Mark = "riding" | "absent";
export type RosterStatus = Mark | "none";
export type StopState = "pending" | "arrived" | "departed" | "skipped";

export interface Me {
  id: string;
  username: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  schoolName: string;
}

export interface AppConfig {
  schoolName: string;
  mapsKey: string | null;
  vapidPublicKey: string | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Campus {
  id: string;
  name: string;
  address: string;
  location: LatLng;
}

export interface Position extends LatLng {
  at: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
}

export interface TripStop extends LatLng {
  id: string;
  name: string;
  address: string;
  kind: "stop" | "school";
  campusId?: string | null;
  state: StopState;
  arrivedAt: number | null;
  departedAt: number | null;
  eta: number | null;
}

export interface TripView {
  id: string;
  status: TripStatus;
  date: string;
  direction: Direction;
  busId: string;
  busNumber: string;
  routeName: string;
  driverName: string | null;
  startedAt: number | null;
  endedAt: number | null;
  schoolReachedAt: number | null;
  position: Position | null;
  positionAt: number | null;
  stale: boolean;
  etaSource: "routes" | "estimate" | null;
  etaAt: number | null;
  polyline: string | null;
  currentStopId: string | null;
  nextStopId: string | null;
  stops: TripStop[];
}

// ---- parent

export interface PlanSlot {
  status: Mark | null;
  cutoffAt: number;
  locked: boolean;
}

export interface PlanDay {
  date: string;
  AM: PlanSlot;
  PM: PlanSlot;
}

export interface ParentChild {
  id: string;
  name: string;
  grade: string;
  bus: { id: string; number: string; plate: string } | null;
  route: { id: string; name: string } | null;
  stop: { id: string; name: string; address: string; lat: number; lng: number } | null;
  campus: { id: string; name: string } | null;
  trips: Record<Direction, { status: TripStatus | "none"; startedAt: number | null; endedAt: number | null }>;
  plan: PlanDay[];
}

export interface ParentHome {
  school: {
    name: string;
    campuses: Campus[];
    amCutoff: string;
    pmCutoff: string;
    approachMinutes: number;
  };
  today: string;
  now: number;
  defaultDirection: Direction;
  days: { date: string; label: string; weekday: string; dayOfMonth: number }[];
  children: ParentChild[];
}

export interface ParentLive {
  trip: TripView | null;
  myStopId: string | null;
  /** The trip stop for the campus this child attends. */
  myCampusStopId: string | null;
  declaration?: Mark | null;
  now: number;
}

// ---- driver

export interface DriverBus {
  id: string;
  number: string;
  plate: string;
  routeName: string | null;
  stopCount: number;
  trips: Record<Direction, { status: TripStatus; driverName: string | null; mine: boolean }>;
}

export interface DriverHome {
  today: string;
  now: number;
  defaultDirection: Direction;
  activeTrip: {
    id: string;
    busId: string;
    busNumber: string;
    direction: Direction;
    startedAt: number;
  } | null;
  buses: DriverBus[];
}

export interface RosterStudent {
  id: string;
  name: string;
  grade: string;
  status: RosterStatus;
}

export interface Counts {
  riding: number;
  absent: number;
  none: number;
}

export interface RosterStop {
  id: string;
  name: string;
  address: string;
  kind: "stop" | "school";
  campusId: string | null;
  students: RosterStudent[];
  counts: Counts;
}

export interface Roster {
  stops: RosterStop[];
  unassigned: RosterStudent[];
  totals: Counts;
}

export interface DriverRoster {
  bus: { id: string; number: string; plate: string };
  route: { id: string; name: string };
  date: string;
  direction: Direction;
  trip: TripView;
  mine: boolean;
  roster: Roster;
  now: number;
}

export interface DriverTripState {
  trip: TripView;
  roster: Roster;
  now: number;
}

// ---- admin

export interface SchoolSettings {
  name: string;
  address: string;
  campuses: Campus[];
  amCutoff: string;
  pmCutoff: string;
  approachMinutes: number;
  arrivalRadiusM: number;
  serviceDays: number[];
  holidays: string[];
}

export interface AdminBus {
  id: string;
  number: string;
  plate: string;
  capacity: number | null;
  routeId: string | null;
  routeName: string | null;
  active: boolean;
  trackerKey: string;
  drivers: { id: string; name: string }[];
}

export interface RouteStop extends LatLng {
  id: string;
  name: string;
  address: string;
  studentCount?: number;
}

export interface AdminRoute {
  id: string;
  name: string;
  /** Campuses the bus visits, in morning order. */
  campusIds: string[];
  bus: { id: string; number: string } | null;
  studentCount: number;
  stops: RouteStop[];
}

export interface AdminStudent {
  id: string;
  name: string;
  grade: string;
  routeId: string | null;
  routeName: string | null;
  stopId: string | null;
  stopName: string | null;
  campusId: string | null;
  campusName: string | null;
  parentIds: string[];
  parents: { id: string; name: string }[];
  active: boolean;
}

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  mobile: string;
  active: boolean;
  mustChangePassword: boolean;
  busIds: string[];
  lastLoginAt: number | null;
  createdAt: number | null;
  children: { id: string; name: string }[];
  locked: boolean;
}

export interface AdminLiveBus {
  id: string;
  number: string;
  plate: string;
  routeName: string | null;
  trips: Record<Direction, TripStatus>;
  trip: TripView;
}

export interface AdminLive {
  now: number;
  today: string;
  school: { name: string; campuses: Campus[] };
  buses: AdminLiveBus[];
}

export interface AdminToday {
  date: string;
  students: number;
  totals: Record<Direction, Counts>;
  buses: ({ busId: string; students: number } & Record<Direction, Counts>)[];
}

export interface AdminTripRow {
  id: string;
  busNumber: string;
  routeName: string;
  direction: Direction;
  status: TripStatus;
  driverName: string | null;
  startedAt: number | null;
  endedAt: number | null;
  endedBy: string | null;
  schoolReachedAt: number | null;
  pointCount: number;
  stopsDone: number;
  stopsTotal: number;
}

export interface AuditEntry {
  id: string;
  at: number;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
}

export interface DaySummary {
  date: string;
  headline: string;
  highlights: string[];
  attention: string[];
  generatedAt: number;
  /** Written while the day was still running. */
  partial: boolean;
  model: string;
}
