import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bus,
  ChevronRight,
  CircleCheck,
  Copy,
  KeyRound,
  Phone,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { Avatar } from "../../components/Brand";
import { Button, IconButton } from "../../components/ui/Button";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, EmptyState, Skeleton } from "../../components/ui/Feedback";
import { Chip, Field, Input, Switch } from "../../components/ui/Form";
import { Segmented, type SegmentOption } from "../../components/ui/Segmented";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, firstName, plural } from "../../lib/format";
import { cn, useNow } from "../../lib/hooks";
import type { AdminBus, AdminUser, Role } from "../../lib/types";
import { AdminPage } from "./AdminLayout";

type Filter = "ALL" | Role;
type Mode = "form" | "reset" | "done";

interface UserForm {
  name: string;
  username: string;
  usernameEdited: boolean;
  role: Role;
  mobile: string;
  active: boolean;
  busIds: string[];
}

interface Credentials {
  name: string;
  username: string;
  password: string;
}

const ROLES: Record<Role, { label: string; many: string; tone: "brand" | "bus" | "slate"; icon: ReactNode }> = {
  PARENT: { label: "Parent", many: "Parents", tone: "brand", icon: <Users className="size-3.5" /> },
  DRIVER: { label: "Driver", many: "Drivers", tone: "bus", icon: <Bus className="size-3.5" /> },
  ADMIN: { label: "Admin", many: "Admins", tone: "slate", icon: <ShieldCheck className="size-3.5" /> },
};

const COLUMNS =
  "sm:grid sm:grid-cols-[minmax(0,1.3fr)_6.5rem_minmax(0,1.2fr)_minmax(0,1fr)] sm:items-center sm:gap-4";

const slide = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -14 },
  transition: { duration: 0.18 },
};

function suggestUsername(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 32);
}

function cleanUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
}

function toForm(user: AdminUser | null): UserForm {
  return user
    ? {
        name: user.name,
        username: user.username,
        usernameEdited: true,
        role: user.role,
        mobile: user.mobile,
        active: user.active,
        busIds: user.busIds,
      }
    : { name: "", username: "", usernameEdited: false, role: "PARENT", mobile: "", active: true, busIds: [] };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AdminUsers() {
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const buses = useQuery({
    queryKey: ["admin", "buses"],
    queryFn: () => api.get<{ buses: AdminBus[] }>("/api/admin/buses"),
  });
  const { user: me } = useAuth();
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<{ open: boolean; user: AdminUser | null; key: number }>({
    open: false,
    user: null,
    key: 0,
  });

  const openSheet = (user: AdminUser | null) => setSheet((s) => ({ open: true, user, key: s.key + 1 }));

  const list = users.data?.users ?? [];
  const busList = useMemo(() => buses.data?.buses ?? [], [buses.data]);
  const busNumbers = useMemo(() => new Map(busList.map((b) => [b.id, b.number])), [busList]);
  const count = (role: Role) => list.filter((u) => u.role === role).length;

  const query = search.trim().toLowerCase();
  const filtered = list.filter(
    (u) =>
      (filter === "ALL" || u.role === filter) &&
      (!query ||
        [u.name, u.username, u.mobile, ...u.children.map((c) => c.name)]
          .join(" ")
          .toLowerCase()
          .includes(query)),
  );

  const filterOptions: SegmentOption<Filter>[] = [
    { value: "ALL", label: <FilterLabel text="All" count={list.length} /> },
    { value: "PARENT", label: <FilterLabel text="Parents" count={count("PARENT")} /> },
    { value: "DRIVER", label: <FilterLabel text="Drivers" count={count("DRIVER")} /> },
    { value: "ADMIN", label: <FilterLabel text="Admins" count={count("ADMIN")} /> },
  ];

  return (
    <AdminPage
      title="People & logins"
      subtitle="Parents, drivers and transport office staff who can sign in"
      actions={
        <Button icon={<UserPlus className="size-4" />} onClick={() => openSheet(null)}>
          Add person
        </Button>
      }
    >
      {users.isError ? (
        <Banner
          tone="error"
          title="Couldn't load people"
          action={
            <Button size="sm" variant="secondary" onClick={() => void users.refetch()}>
              Retry
            </Button>
          }
        >
          {errorMessage(users.error)}
        </Banner>
      ) : users.isPending ? (
        <ListSkeleton />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <Segmented
              label="Show"
              size="sm"
              value={filter}
              options={filterOptions}
              onChange={setFilter}
              className="w-full lg:w-[28rem]"
            />
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                aria-label="Search people"
                placeholder="Search by name, username, mobile or child"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-11"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <Card>
              {list.length === 0 ? (
                <EmptyState
                  icon={<Users className="size-7" />}
                  title="No one here yet"
                  body="Create logins for parents and drivers. Each gets a temporary password to change on first sign-in."
                  action={
                    <Button icon={<UserPlus className="size-4" />} onClick={() => openSheet(null)}>
                      Add person
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Search className="size-7" />}
                  title="No one matches"
                  body="Try a different name or show everyone."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch("");
                        setFilter("ALL");
                      }}
                    >
                      Show everyone
                    </Button>
                  }
                />
              )}
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="hidden items-center gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400 sm:flex">
                <span className="w-10 shrink-0" />
                <div className={cn("flex-1", COLUMNS)}>
                  <span>Person</span>
                  <span>Role</span>
                  <span>Children / buses</span>
                  <span>Status</span>
                </div>
                <span className="w-5 shrink-0" />
              </div>
              <motion.ul variants={stagger} initial="hidden" animate="show" className="divide-y divide-slate-100">
                <AnimatePresence>
                  {filtered.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      isMe={user.id === me?.id}
                      busNumbers={busNumbers}
                      now={now}
                      onOpen={() => openSheet(user)}
                    />
                  ))}
                </AnimatePresence>
              </motion.ul>
            </Card>
          )}
        </>
      )}

      <UserSheet
        key={sheet.key}
        open={sheet.open}
        user={sheet.user}
        isMe={sheet.user?.id === me?.id}
        buses={busList}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />
    </AdminPage>
  );
}

function FilterLabel({ text, count }: { text: string; count: number }) {
  return (
    <>
      {text}
      <span className="tabular text-xs font-bold text-slate-400">{count}</span>
    </>
  );
}

function relationText(user: AdminUser, busNumbers: Map<string, string>): { text: string; warn: boolean } {
  if (user.role === "PARENT") {
    return user.children.length
      ? { text: user.children.map((c) => c.name).join(", "), warn: false }
      : { text: "No children linked", warn: true };
  }
  if (user.role === "DRIVER") {
    if (!user.busIds.length) return { text: "Any bus", warn: false };
    const known = user.busIds.flatMap((id) => {
      const number = busNumbers.get(id);
      return number ? [`Bus ${number}`] : [];
    });
    return known.length ? { text: known.join(", "), warn: false } : { text: "Assigned bus was removed", warn: true };
  }
  return { text: "Full access", warn: false };
}

function UserRow({
  user,
  isMe,
  busNumbers,
  now,
  onOpen,
}: {
  user: AdminUser;
  isMe: boolean;
  busNumbers: Map<string, string>;
  now: number;
  onOpen: () => void;
}) {
  const role = ROLES[user.role];
  const relation = relationText(user, busNumbers);
  const seen = user.lastLoginAt ? `signed in ${ago(user.lastLoginAt, now)}` : "never signed in";
  return (
    <motion.li variants={listItem} layout="position" exit={{ opacity: 0, x: -16 }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Edit ${user.name}`}
        className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-slate-50/80 sm:px-5"
      >
        <Avatar name={user.name} className={cn(!user.active && "grayscale opacity-60")} />
        <div className={cn("min-w-0 flex-1", COLUMNS)}>
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <span className="truncate font-bold text-slate-900">{user.name}</span>
              {isMe && <span className="shrink-0 text-xs font-bold text-brand-600">You</span>}
            </p>
            <p className="truncate text-sm text-slate-500">
              @{user.username} · {seen}
            </p>
          </div>
          <div className="mt-2 sm:mt-0">
            <Badge tone={role.tone}>
              {role.icon}
              {role.label}
            </Badge>
          </div>
          <div className="mt-2 min-w-0 space-y-0.5 text-sm sm:mt-0">
            <p className={cn("truncate", relation.warn ? "font-semibold text-amber-700" : "text-slate-700")}>
              {relation.text}
            </p>
            {user.mobile && (
              <p className="flex items-center gap-1.5 truncate text-slate-500">
                <Phone className="size-3.5 shrink-0 text-slate-400" />
                {user.mobile}
              </p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-0">
            {!user.active && <Badge tone="slate">Off</Badge>}
            {user.locked && <Badge tone="red">Locked</Badge>}
            {user.active && user.mustChangePassword && <Badge tone="amber">Must set password</Badge>}
            {user.active && !user.locked && !user.mustChangePassword && (
              <Badge tone="green" dot>
                Active
              </Badge>
            )}
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
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="size-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
        </div>
      ))}
    </Card>
  );
}

function UserSheet({
  open,
  user,
  isMe,
  buses,
  onClose,
}: {
  open: boolean;
  user: AdminUser | null;
  isMe: boolean;
  buses: AdminBus[];
  onClose: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<UserForm>(() => toForm(user));
  const [mode, setMode] = useState<Mode>("form");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "buses"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "students"] }),
    ]);

  const create = useMutation({
    mutationFn: (body: { name: string; username: string; role: Role; mobile: string; busIds: string[] }) =>
      api.post<{ id: string; username: string; tempPassword: string }>("/api/admin/users", body),
    onSuccess: async (data, body) => {
      setCredentials({ name: body.name, username: data.username, password: data.tempPassword });
      setMode("done");
      await refresh();
    },
  });

  const update = useMutation({
    mutationFn: async (body: { name: string; mobile: string; active: boolean; busIds: string[] }) => {
      if (user) await api.put(`/api/admin/users/${user.id}`, body);
    },
    onSuccess: async (_, body) => {
      await refresh();
      toast({ title: `${body.name} updated` });
      onClose();
    },
  });

  const reset = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Pick someone first.");
      return api.post<{ id: string; tempPassword: string }>(`/api/admin/users/${user.id}/reset-password`);
    },
    onSuccess: async (data) => {
      if (user) setCredentials({ name: user.name, username: user.username, password: data.tempPassword });
      setMode("done");
      await refresh();
    },
  });

  const isDriver = form.role === "DRIVER";
  const selectableBuses = buses.filter((b) => b.active || form.busIds.includes(b.id));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setProblem("Enter the person's name.");
      return;
    }
    const busIds = isDriver ? form.busIds : [];
    if (user) {
      setProblem(null);
      update.mutate({ name, mobile: form.mobile.trim(), active: form.active, busIds });
      return;
    }
    if (form.username.length < 3) {
      setProblem("Usernames need at least 3 letters or numbers.");
      return;
    }
    setProblem(null);
    create.mutate({ name, username: form.username, role: form.role, mobile: form.mobile.trim(), busIds });
  };

  const addAnother = () => {
    setForm(toForm(null));
    setCredentials(null);
    setProblem(null);
    create.reset();
    setMode("form");
  };

  const toggleBus = (id: string) =>
    setForm((f) => ({
      ...f,
      busIds: f.busIds.includes(id) ? f.busIds.filter((b) => b !== id) : [...f.busIds, id],
    }));

  const saveError = create.error ?? update.error;
  const formError = problem ?? (saveError ? errorMessage(saveError) : null);
  const first = firstName(user?.name ?? credentials?.name ?? "");

  const titles: Record<Mode, string> = {
    form: user ? user.name : "Add a person",
    reset: `Reset ${first}'s password?`,
    done: user ? "Password reset" : "Login created",
  };
  const descriptions: Record<Mode, string> = {
    form: user
      ? `@${user.username} · ${ROLES[user.role].label}`
      : "Create a login for a parent, driver or someone in the transport office.",
    reset: "Their current password stops working straight away.",
    done: "Copy these details now. The password won't be shown again.",
  };

  const footer: Record<Mode, ReactNode> = {
    form: (
      <>
        <Button variant="secondary" onClick={onClose} className="ml-auto">
          Cancel
        </Button>
        <Button
          type="submit"
          form={formId}
          loading={create.isPending || update.isPending}
          className="flex-1 sm:flex-none"
        >
          {user ? "Save changes" : "Create login"}
        </Button>
      </>
    ),
    reset: (
      <>
        <Button variant="secondary" onClick={() => setMode("form")} className="ml-auto">
          Back
        </Button>
        <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
          Reset password
        </Button>
      </>
    ),
    done: (
      <>
        {!user && (
          <Button variant="secondary" onClick={addAnother} className="ml-auto" icon={<UserPlus className="size-4" />}>
            Add another
          </Button>
        )}
        <Button onClick={onClose} className={cn(user && "ml-auto", "flex-1 sm:flex-none")}>
          Done
        </Button>
      </>
    ),
  };

  return (
    <Sheet open={open} onClose={onClose} title={titles[mode]} description={descriptions[mode]} footer={footer[mode]}>
      <AnimatePresence mode="wait" initial={false}>
        {mode === "form" && (
          <motion.div key="form" {...slide}>
            <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Full name">
                {(id) => (
                  <Input
                    id={id}
                    value={form.name}
                    maxLength={80}
                    placeholder="Priya Kumar"
                    autoComplete="off"
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((f) => ({
                        ...f,
                        name,
                        username: f.usernameEdited ? f.username : suggestUsername(name),
                      }));
                    }}
                  />
                )}
              </Field>

              {!user && (
                <>
                  <Field label="Username" hint="Lowercase letters, numbers, dots, dashes and underscores.">
                    {(id) => (
                      <div className="relative">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-slate-400">
                          @
                        </span>
                        <Input
                          id={id}
                          value={form.username}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          autoComplete="off"
                          placeholder="priya.kumar"
                          className="pl-9"
                          onChange={(e) =>
                            setForm((f) => ({ ...f, username: cleanUsername(e.target.value), usernameEdited: true }))
                          }
                        />
                      </div>
                    )}
                  </Field>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-slate-700">Role</p>
                    <Segmented<Role>
                      label="Role"
                      value={form.role}
                      onChange={(role) => setForm((f) => ({ ...f, role }))}
                      options={(["PARENT", "DRIVER", "ADMIN"] as const).map((role) => ({
                        value: role,
                        label: ROLES[role].label,
                        icon: ROLES[role].icon,
                      }))}
                    />
                  </div>
                </>
              )}

              <Field label="Mobile" hint="Optional. Shown to the transport office only.">
                {(id) => (
                  <Input
                    id={id}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={form.mobile}
                    maxLength={20}
                    placeholder="+91 98765 43210"
                    onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
                  />
                )}
              </Field>

              <AnimatePresence initial={false}>
                {isDriver && (
                  <motion.div
                    key="buses"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 pt-1">
                      <p className="text-sm font-semibold text-slate-700">Buses they drive</p>
                      {selectableBuses.length ? (
                        <div className="flex flex-wrap gap-2">
                          {selectableBuses.map((bus) => (
                            <Chip key={bus.id} selected={form.busIds.includes(bus.id)} onClick={() => toggleBus(bus.id)}>
                              Bus {bus.number}
                            </Chip>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No buses yet. Add them under Buses.</p>
                      )}
                      <p className="text-sm text-slate-500">
                        {form.busIds.length
                          ? `Can start trips on ${plural(form.busIds.length, "bus", "buses")} only.`
                          : "None picked: this driver may run any bus."}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!user && form.role === "ADMIN" && (
                <Banner tone="info">Admins can change everything here, including other people's logins.</Banner>
              )}

              {user && (
                <div className="flex items-center justify-between gap-4 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Can sign in</p>
                    <p className="text-sm text-slate-500">
                      {isMe ? "You can't turn off your own account." : "Turning this off signs them out everywhere."}
                    </p>
                  </div>
                  <Switch
                    checked={form.active}
                    disabled={isMe}
                    onChange={(active) => setForm((f) => ({ ...f, active }))}
                    label="Can sign in"
                  />
                </div>
              )}

              {user?.role === "PARENT" && (
                <div className="rounded-3xl border border-slate-200/80 p-4">
                  <p className="text-sm font-semibold text-slate-800">Children</p>
                  {user.children.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {user.children.map((child) => (
                        <span
                          key={child.id}
                          className="inline-flex h-8 items-center rounded-full bg-brand-50 px-3 text-sm font-semibold text-brand-700"
                        >
                          {child.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">None linked yet.</p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">Link or unlink children from the Students page.</p>
                </div>
              )}

              {user && (
                <div className="flex flex-col gap-3 rounded-3xl border border-slate-200/80 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">Password</p>
                    <p className="text-sm text-slate-500">
                      {user.locked
                        ? "Locked after too many wrong passwords. A reset unlocks it."
                        : `Forgotten? Give ${firstName(user.name)} a new temporary password.`}
                    </p>
                  </div>
                  <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setMode("reset")}>
                    Reset password
                  </Button>
                </div>
              )}

              <AnimatePresence>{formError && <Banner tone="error">{formError}</Banner>}</AnimatePresence>
            </form>
          </motion.div>
        )}

        {mode === "reset" && user && (
          <motion.div key="reset" {...slide} className="space-y-4">
            <Banner tone="warning" title={`${first} will need the new password`}>
              You'll get a temporary password to share with them. They'll choose their own the next time
              they sign in.
            </Banner>
            <AnimatePresence>
              {reset.error && <Banner tone="error">{errorMessage(reset.error)}</Banner>}
            </AnimatePresence>
          </motion.div>
        )}

        {mode === "done" && credentials && (
          <motion.div key="done" {...slide}>
            <CredentialsCard credentials={credentials} reset={Boolean(user)} />
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function CredentialsCard({ credentials, reset }: { credentials: Credentials; reset: boolean }) {
  const toast = useToast();
  const first = firstName(credentials.name) || "them";
  const message = [
    "Your iTransport sign-in",
    `Open: ${window.location.origin}`,
    `Username: ${credentials.username}`,
    `Temporary password: ${credentials.password}`,
  ].join("\n");

  const copy = async (text: string, what: string) => {
    toast(
      (await copyText(text))
        ? { title: `${what} copied` }
        : { title: "Couldn't copy", body: "Select the text and copy it manually.", tone: "error" },
    );
  };

  return (
    <div className="text-center">
      <motion.span
        initial={{ scale: 0, rotate: -40 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 14, delay: 0.05 }}
        className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600"
      >
        <CircleCheck className="size-8" />
      </motion.span>
      <h3 className="mt-4 text-lg font-bold text-slate-900">
        {reset ? `New password for ${first}` : `${first} can sign in now`}
      </h3>
      <dl className="mt-5 space-y-3 text-left">
        <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Username</dt>
          <dd className="mt-1 font-mono text-base font-bold text-slate-900">{credentials.username}</dd>
        </div>
        <div className="rounded-3xl bg-brand-50/60 p-4 ring-1 ring-brand-100">
          <dt className="text-xs font-bold uppercase tracking-wide text-brand-700/70">Temporary password</dt>
          <dd className="mt-1 flex items-center gap-2">
            <span className="min-w-0 flex-1 select-all break-all font-mono text-2xl font-bold tracking-wide text-slate-900">
              {credentials.password}
            </span>
            <IconButton label="Copy password" onClick={() => void copy(credentials.password, "Password")}>
              <Copy className="size-4" />
            </IconButton>
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-slate-500">
        Share this with {first}. They'll choose their own password the first time they sign in.
      </p>
      <Button
        variant="soft"
        block
        className="mt-4"
        icon={<Copy className="size-4" />}
        onClick={() => void copy(message, "Sign-in details")}
      >
        Copy sign-in details
      </Button>
    </div>
  );
}
