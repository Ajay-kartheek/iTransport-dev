import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  GraduationCap,
  MapPin,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { Avatar } from "../../components/Brand";
import { Button } from "../../components/ui/Button";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, EmptyState, Skeleton } from "../../components/ui/Feedback";
import { Field, Input, Select, Switch } from "../../components/ui/Form";
import { Segmented } from "../../components/ui/Segmented";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { firstName, initials, plural } from "../../lib/format";
import { cn } from "../../lib/hooks";
import type { AdminRoute, AdminStudent, AdminUser, Campus, SchoolSettings } from "../../lib/types";
import { AdminPage } from "./AdminLayout";

interface StudentBody {
  name: string;
  grade: string;
  routeId: string | null;
  stopId: string | null;
  campusId: string | null;
  parentIds: string[];
  active: boolean;
}

interface StudentForm {
  name: string;
  grade: string;
  routeId: string;
  stopId: string;
  campusId: string;
  parentIds: string[];
  active: boolean;
}

const MAX_PARENTS = 4;

const COLUMNS =
  "sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_4.5rem] sm:items-center sm:gap-4";

const slide = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -14 },
  transition: { duration: 0.18 },
};

function toForm(student: AdminStudent | null): StudentForm {
  return student
    ? {
        name: student.name,
        grade: student.grade,
        routeId: student.routeId ?? "",
        stopId: student.stopId ?? "",
        campusId: student.campusId ?? "",
        parentIds: student.parentIds,
        active: student.active,
      }
    : { name: "", grade: "", routeId: "", stopId: "", campusId: "", parentIds: [], active: true };
}

function matches(student: AdminStudent, query: string): boolean {
  if (!query) return true;
  const haystack = [
    student.name,
    student.grade,
    student.routeName ?? "",
    student.stopName ?? "",
    student.campusName ?? "",
    ...student.parents.map((p) => p.name),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function AdminStudents() {
  const students = useQuery({
    queryKey: ["admin", "students"],
    queryFn: () => api.get<{ students: AdminStudent[] }>("/api/admin/students"),
  });
  const routes = useQuery({
    queryKey: ["admin", "routes"],
    queryFn: () => api.get<{ routes: AdminRoute[] }>("/api/admin/routes"),
  });
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => (await api.get<{ settings: SchoolSettings }>("/api/admin/settings")).settings,
  });
  const campuses = settings.data?.campuses ?? [];

  const [search, setSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState("all");
  const [sheet, setSheet] = useState<{ open: boolean; student: AdminStudent | null; key: number }>({
    open: false,
    student: null,
    key: 0,
  });

  const openSheet = (student: AdminStudent | null) =>
    setSheet((s) => ({ open: true, student, key: s.key + 1 }));

  const list = students.data?.students ?? [];
  const routeList = routes.data?.routes ?? [];
  const parents = useMemo(
    () => (users.data?.users ?? []).filter((u) => u.role === "PARENT"),
    [users.data],
  );
  const query = search.trim().toLowerCase();
  const filtered = list.filter(
    (s) =>
      (routeFilter === "all" ||
        (routeFilter === "none" ? !s.routeId : s.routeId === routeFilter)) &&
      matches(s, query),
  );
  const filtering = Boolean(query) || routeFilter !== "all";

  return (
    <AdminPage
      title="Students"
      subtitle={
        students.data
          ? `${plural(list.length, "student")} · ${list.filter((s) => s.routeId).length} on a bus route`
          : "Who rides which route, from which stop"
      }
      actions={
        <Button icon={<Plus className="size-4" />} onClick={() => openSheet(null)}>
          Add student
        </Button>
      }
    >
      {students.isError ? (
        <Banner
          tone="error"
          title="Couldn't load students"
          action={
            <Button size="sm" variant="secondary" onClick={() => void students.refetch()}>
              Retry
            </Button>
          }
        >
          {errorMessage(students.error)}
        </Banner>
      ) : students.isPending ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GraduationCap className="size-7" />}
            title="No students yet"
            body="Add students, pick their route and stop, and link their parents so they can follow the bus."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => openSheet(null)}>
                Add student
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                aria-label="Search students"
                placeholder="Search by name, grade, stop or parent"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-11"
              />
            </div>
            <div className="sm:w-64">
              <Select
                aria-label="Filter by route"
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
              >
                <option value="all">All routes</option>
                {routeList.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
                <option value="none">Not on a route</option>
              </Select>
            </div>
          </div>

          {filtering && (
            <p className="mb-3 text-sm text-slate-500">
              Showing {filtered.length} of {plural(list.length, "student")}
            </p>
          )}

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Search className="size-7" />}
                title="No students match"
                body="Try a different name, or clear the filters."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setRouteFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="hidden items-center gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400 sm:flex">
                <span className="w-10 shrink-0" />
                <div className={cn("flex-1", COLUMNS)}>
                  <span>Student</span>
                  <span>Route & stop</span>
                  <span>Parents</span>
                  <span className="justify-self-end">Status</span>
                </div>
                <span className="w-5 shrink-0" />
              </div>
              <motion.ul variants={stagger} initial="hidden" animate="show" className="divide-y divide-slate-100">
                <AnimatePresence>
                  {filtered.map((student) => (
                    <StudentRow
                      key={student.id}
                      student={student}
                      showCampus={campuses.length > 1}
                      onOpen={() => openSheet(student)}
                    />
                  ))}
                </AnimatePresence>
              </motion.ul>
            </Card>
          )}
        </>
      )}

      <StudentSheet
        key={sheet.key}
        open={sheet.open}
        student={sheet.student}
        routes={routeList}
        campuses={campuses}
        parents={parents}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />
    </AdminPage>
  );
}

function StudentRow({
  student,
  showCampus,
  onOpen,
}: {
  student: AdminStudent;
  showCampus: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.li variants={listItem} layout="position" exit={{ opacity: 0, x: -16 }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Edit ${student.name}`}
        className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-slate-50/80 sm:px-5"
      >
        <Avatar name={student.name} className={cn(!student.active && "grayscale opacity-60")} />
        <div className={cn("min-w-0 flex-1", COLUMNS)}>
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-bold text-slate-900">{student.name}</p>
            {student.grade && (
              <span className="shrink-0 rounded-lg bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-500">
                {student.grade}
              </span>
            )}
            {showCampus && student.campusName && (
              <span className="truncate rounded-lg bg-brand-50 px-1.5 py-0.5 text-xs font-bold text-brand-700">
                {student.campusName}
              </span>
            )}
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm sm:mt-0">
            <MapPin className="size-4 shrink-0 text-slate-400" />
            {student.routeName ? (
              <span className="truncate text-slate-700">
                <span className="font-medium">{student.routeName}</span>
                <span className="text-slate-400"> · </span>
                {student.stopName ?? <span className="font-semibold text-amber-700">No stop</span>}
              </span>
            ) : (
              <span className="font-semibold text-amber-700">Not on a bus route</span>
            )}
          </p>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-500 sm:mt-0">
            <Users className="size-4 shrink-0 text-slate-400" />
            {student.parents.length ? (
              <span className="truncate">{student.parents.map((p) => p.name).join(", ")}</span>
            ) : (
              <span className="font-semibold text-amber-700">No parent linked</span>
            )}
          </p>
          <div className="mt-2 sm:mt-0 sm:justify-self-end">
            {!student.active && <Badge tone="slate">Off</Badge>}
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </button>
    </motion.li>
  );
}

function ListSkeleton() {
  return (
    <Card className="space-y-4 p-5">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="size-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </Card>
  );
}

function StudentSheet({
  open,
  student,
  routes,
  campuses,
  parents,
  onClose,
}: {
  open: boolean;
  student: AdminStudent | null;
  routes: AdminRoute[];
  campuses: Campus[];
  parents: AdminUser[];
  onClose: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<StudentForm>(() => toForm(student));
  const [mode, setMode] = useState<"form" | "delete">("form");
  const [problem, setProblem] = useState<string | null>(null);

  const route = routes.find((r) => r.id === form.routeId) ?? null;
  // The campuses this route's bus drops at; a student attends one of them.
  const routeCampuses = (route?.campusIds ?? []).flatMap((id) => campuses.filter((c) => c.id === id));
  const campusId = routeCampuses.some((c) => c.id === form.campusId) ? form.campusId : (routeCampuses[0]?.id ?? "");

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "students"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "routes"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
    ]);

  const save = useMutation({
    mutationFn: (body: StudentBody) =>
      student
        ? api.put(`/api/admin/students/${student.id}`, body)
        : api.post("/api/admin/students", body),
    onSuccess: async (_, body) => {
      await refresh();
      toast({ title: student ? `${body.name} updated` : `${body.name} added` });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (student) await api.del(`/api/admin/students/${student.id}`);
    },
    onSuccess: async () => {
      await refresh();
      toast({ title: `${student?.name ?? "Student"} removed` });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setProblem("Enter the student's name.");
      return;
    }
    if (route && route.stops.length > 0 && !form.stopId) {
      setProblem("Pick the stop where they get on the bus.");
      return;
    }
    setProblem(null);
    save.mutate({
      name,
      grade: form.grade.trim(),
      routeId: form.routeId || null,
      stopId: form.routeId ? form.stopId || null : null,
      campusId: form.routeId ? campusId || null : null,
      parentIds: form.parentIds,
      active: form.active,
    });
  };

  const formError = problem ?? (save.error ? errorMessage(save.error) : null);
  const first = firstName(student?.name ?? "");

  const footer: ReactNode =
    mode === "form" ? (
      <>
        {student && (
          <button
            type="button"
            onClick={() => setMode("delete")}
            aria-label="Remove student"
            className="mr-auto inline-flex h-11 items-center gap-2 rounded-2xl px-3 text-[15px] font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 active:scale-[0.97]"
          >
            <Trash2 className="size-4" />
            <span className="hidden sm:inline">Remove</span>
          </button>
        )}
        <Button variant="secondary" onClick={onClose} className={cn(!student && "ml-auto")}>
          Cancel
        </Button>
        <Button type="submit" form={formId} loading={save.isPending} className="flex-1 sm:flex-none">
          {student ? "Save changes" : "Add student"}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={() => setMode("form")} className="ml-auto">
          Back
        </Button>
        <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
          Remove student
        </Button>
      </>
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide={mode === "form"}
      title={mode === "delete" ? `Remove ${student?.name ?? "student"}?` : student ? student.name : "Add a student"}
      description={
        mode === "delete"
          ? "This can't be undone."
          : student
            ? "Update their route, stop and parents."
            : "Pick their route and stop, and link their parents."
      }
      footer={footer}
    >
      <AnimatePresence mode="wait" initial={false}>
        {mode === "form" ? (
          <motion.form key="form" {...slide} id={formId} onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Field label="Full name">
                {(id) => (
                  <Input
                    id={id}
                    value={form.name}
                    maxLength={80}
                    placeholder="Aarav Kumar"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Grade" hint="Optional">
                {(id) => (
                  <Input
                    id={id}
                    value={form.grade}
                    maxLength={20}
                    placeholder="4B"
                    onChange={(e) => setForm({ ...form, grade: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Route">
                {(id) => (
                  <Select
                    id={id}
                    value={form.routeId}
                    onChange={(e) => setForm({ ...form, routeId: e.target.value, stopId: "" })}
                  >
                    <option value="">Not on a bus route</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.bus ? ` · Bus ${r.bus.number}` : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Stop"
                hint={
                  route && route.stops.length === 0
                    ? "This route has no stops yet. Add them under Routes & stops."
                    : undefined
                }
              >
                {(id) => (
                  <Select
                    id={id}
                    value={form.stopId}
                    disabled={!route || route.stops.length === 0}
                    onChange={(e) => setForm({ ...form, stopId: e.target.value })}
                  >
                    <option value="">{route ? "Choose a stop" : "Choose a route first"}</option>
                    {route?.stops.map((stop, index) => (
                      <option key={stop.id} value={stop.id}>
                        {index + 1}. {stop.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {campuses.length > 1 && route && routeCampuses.length > 0 && (
              <Field
                label="Campus"
                hint={
                  routeCampuses.length === 1
                    ? `This route's bus only goes to ${routeCampuses[0].name}.`
                    : "Where they get off in the morning and on in the afternoon."
                }
              >
                {() => (
                  <Segmented
                    label="Campus"
                    value={campusId}
                    disabled={routeCampuses.length === 1}
                    options={routeCampuses.map((c) => ({ value: c.id, label: c.name }))}
                    onChange={(value) => setForm({ ...form, campusId: value })}
                  />
                )}
              </Field>
            )}
            <Field
              label="Parents"
              hint="Parent logins are created under People & logins."
            >
              {(id) => (
                <ParentPicker
                  inputId={id}
                  parents={parents}
                  value={form.parentIds}
                  onChange={(parentIds) => setForm({ ...form, parentIds })}
                />
              )}
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
              <div>
                <p className="text-sm font-semibold text-slate-800">Uses the school bus</p>
                <p className="text-sm text-slate-500">Turn off for students who have left. They drop off rosters.</p>
              </div>
              <Switch
                checked={form.active}
                onChange={(active) => setForm({ ...form, active })}
                label="Uses the school bus"
              />
            </div>
            <AnimatePresence>{formError && <Banner tone="error">{formError}</Banner>}</AnimatePresence>
          </motion.form>
        ) : (
          <motion.div key="delete" {...slide} className="space-y-4">
            <Banner tone="warning" title={`${first || "They"} will come off the roster`}>
              Drivers won't see them any more, and their parents will no longer see a bus for them.
              To pause them instead, turn off “Uses the school bus”.
            </Banner>
            <AnimatePresence>
              {remove.error && <Banner tone="error">{errorMessage(remove.error)}</Banner>}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function ParentPicker({
  inputId,
  parents,
  value,
  onChange,
}: {
  inputId: string;
  parents: AdminUser[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = parents.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.username.includes(q) ||
      p.mobile.replace(/\s/g, "").includes(q.replace(/\s/g, "")),
  );
  const full = value.length >= MAX_PARENTS;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <div className="relative border-b border-slate-100">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={parents.length ? "Search parents by name, username or mobile" : "No parent logins yet"}
          className="h-11 w-full bg-transparent pl-10 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>
      {parents.length === 0 ? (
        <p className="px-4 py-5 text-sm text-slate-500">
          Create parent logins under <strong className="font-semibold text-slate-700">People & logins</strong>,
          then link them here.
        </p>
      ) : visible.length === 0 ? (
        <p className="px-4 py-5 text-sm text-slate-500">No parents match “{query}”.</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto py-1">
          {visible.map((parent) => {
            const selected = value.includes(parent.id);
            const disabled = !selected && full;
            return (
              <li key={parent.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => toggle(parent.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 text-xs font-extrabold text-brand-800">
                    {initials(parent.name) || "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{parent.name}</span>
                      {!parent.active && <Badge tone="slate">Off</Badge>}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      @{parent.username}
                      {parent.mobile ? ` · ${parent.mobile}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors",
                      selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white",
                    )}
                  >
                    <AnimatePresence>
                      {selected && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          transition={{ type: "spring", stiffness: 600, damping: 30 }}
                        >
                          <Check className="size-3.5" strokeWidth={3} />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-xs font-semibold text-slate-500">
        <span>{value.length ? `${plural(value.length, "parent")} linked` : "No parents linked"}</span>
        {full && <span>Up to {MAX_PARENTS} parents</span>}
      </div>
    </div>
  );
}
