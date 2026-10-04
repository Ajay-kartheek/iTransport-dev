import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarX2, Clock, Plus, Save, School, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Badge, Banner, Skeleton } from "../../components/ui/Feedback";
import { Chip, Field, Input } from "../../components/ui/Form";
import { useToast } from "../../components/ui/Toast";
import { api, errorMessage } from "../../lib/api";
import { useConfig } from "../../lib/auth";
import { dateFromIso, shortDay } from "../../lib/format";
import type { SchoolSettings } from "../../lib/types";
import { AdminPage } from "./AdminLayout";
import { type CampusDraft, CampusEditor, campusDrafts, campusesToSave, campusProblem } from "./CampusEditor";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type SettingsForm = Omit<SchoolSettings, "campuses"> & { campuses: CampusDraft[] };

const toForm = (s: SchoolSettings): SettingsForm => ({ ...s, campuses: campusDrafts(s.campuses) });

/** Exactly the fields the server accepts. */
const toBody = (f: SettingsForm) => ({
  name: f.name,
  address: f.address,
  campuses: campusesToSave(f.campuses),
  amCutoff: f.amCutoff,
  pmCutoff: f.pmCutoff,
  approachMinutes: f.approachMinutes,
  arrivalRadiusM: f.arrivalRadiusM,
  serviceDays: f.serviceDays,
  holidays: f.holidays,
});

export function AdminSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const config = useConfig();
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => (await api.get<{ settings: SchoolSettings }>("/api/admin/settings")).settings,
  });
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [holiday, setHoliday] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && !form) setForm(toForm(settings.data));
  }, [settings.data, form]);
  const savedBody = useMemo(
    () => (settings.data ? JSON.stringify(toBody(toForm(settings.data))) : ""),
    [settings.data],
  );

  const save = useMutation({
    mutationFn: (values: SettingsForm) =>
      api.put<{ settings: SchoolSettings }>("/api/admin/settings", toBody(values)),
    onSuccess: ({ settings: saved }) => {
      setError(null);
      // Keep the rows (and the selected one) as they are; only adopt new campus ids.
      setForm((f) => (f ? { ...toForm(saved), campuses: withSavedIds(f.campuses, saved) } : toForm(saved)));
      queryClient.setQueryData(["admin", "settings"], saved);
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Settings saved" });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (settings.isPending || !form) {
    return (
      <AdminPage title="School settings">
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-4xl" />
          <Skeleton className="h-96 rounded-4xl" />
        </div>
      </AdminPage>
    );
  }

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setError(null);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };
  // A named campus that isn't on the map yet is a change too (saving explains what's missing).
  const dirty =
    JSON.stringify(toBody(form)) !== savedBody || form.campuses.some((c) => !c.location && c.name.trim());

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const problem = campusProblem(form.campuses);
    if (problem) {
      setError(problem);
      return;
    }
    save.mutate(form);
  };

  return (
    <AdminPage
      title="School settings"
      subtitle="Campuses, when plans close, and when parents get alerts."
      actions={
        <Button icon={<Save className="size-4" />} onClick={() => submit()} loading={save.isPending} disabled={!dirty}>
          Save changes
        </Button>
      }
    >
      <form onSubmit={submit} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {error && <Banner tone="error">{error}</Banner>}
          <Card className="pb-5">
            <CardHeader icon={<School className="size-5" />} title="School" subtitle="Shown to parents and drivers." />
            <div className="mt-4 space-y-4 px-5">
              <Field label="School name">
                {(id) => <Input id={id} value={form.name} onChange={(e) => set("name", e.target.value)} />}
              </Field>
            </div>
          </Card>

          <Card className="pb-5">
            <CardHeader
              icon={<Clock className="size-5" />}
              title="Plan cutoffs"
              subtitle="After these times, parents can't change Riding/Absent for that trip."
            />
            <div className="mt-4 grid grid-cols-2 gap-4 px-5">
              <Field label="Morning trip">
                {(id) => (
                  <Input id={id} type="time" value={form.amCutoff} onChange={(e) => set("amCutoff", e.target.value)} />
                )}
              </Field>
              <Field label="Afternoon trip">
                {(id) => (
                  <Input id={id} type="time" value={form.pmCutoff} onChange={(e) => set("pmCutoff", e.target.value)} />
                )}
              </Field>
            </div>
          </Card>

          <Card className="pb-5">
            <CardHeader
              icon={<BellRing className="size-5" />}
              title="Arrival alerts"
              subtitle="Parents get a heads-up when the bus is this close to their stop."
            />
            <div className="mt-5 space-y-6 px-5">
              <Slider
                label="Alert parents"
                value={form.approachMinutes}
                min={2}
                max={30}
                step={1}
                format={(v) => `${v} min before`}
                onChange={(v) => set("approachMinutes", v)}
              />
              <Slider
                label="Counts as “at the stop” within"
                value={form.arrivalRadiusM}
                min={50}
                max={300}
                step={10}
                format={(v) => `${v} m`}
                onChange={(v) => set("arrivalRadiusM", v)}
              />
            </div>
          </Card>

          <Card className="pb-5">
            <CardHeader
              icon={<CalendarX2 className="size-5" />}
              title="School days & holidays"
              subtitle="Reminders and plans only cover days with bus service."
            />
            <div className="mt-4 space-y-4 px-5">
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day, i) => {
                  const iso = i + 1;
                  const on = form.serviceDays.includes(iso);
                  return (
                    <Chip
                      key={day}
                      selected={on}
                      onClick={() =>
                        set(
                          "serviceDays",
                          on ? form.serviceDays.filter((d) => d !== iso) : [...form.serviceDays, iso].sort(),
                        )
                      }
                    >
                      {day}
                    </Chip>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className="flex-1" />
                <Button
                  variant="secondary"
                  icon={<Plus className="size-4" />}
                  disabled={!holiday || form.holidays.includes(holiday)}
                  onClick={() => {
                    set("holidays", [...form.holidays, holiday].sort());
                    setHoliday("");
                  }}
                >
                  Add holiday
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <AnimatePresence initial={false}>
                  {form.holidays.map((d) => (
                    <motion.span
                      key={d}
                      layout
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-amber-50 pl-3 pr-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200/70"
                    >
                      {shortDay(dateFromIso(d))}
                      <button
                        type="button"
                        aria-label={`Remove ${d}`}
                        onClick={() => set("holidays", form.holidays.filter((h) => h !== d))}
                        className="flex size-6 items-center justify-center rounded-full hover:bg-amber-100"
                      >
                        <X className="size-3.5" />
                      </button>
                    </motion.span>
                  ))}
                </AnimatePresence>
                {!form.holidays.length && <p className="text-sm text-slate-400">No holidays added.</p>}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5 lg:sticky lg:top-6">
          <CampusEditor campuses={form.campuses} onChange={(campuses) => set("campuses", campuses)} />

          <Card className="p-5">
            <p className="text-sm font-bold text-slate-800">Integrations</p>
            <div className="mt-3 space-y-2.5 text-sm">
              <Status ok={!!config.data?.mapsKey} label="Google Maps (map, search, arrival times)" />
              <Status ok={!!config.data?.vapidPublicKey} label="Push notifications" />
            </div>
          </Card>
        </div>
      </form>
    </AdminPage>
  );
}

/** After saving, new rows get the ids the server gave them (matched by position). */
function withSavedIds(drafts: CampusDraft[], saved: SchoolSettings): CampusDraft[] {
  const placed = drafts.filter((c) => c.location);
  return drafts.map((c) => {
    const match = saved.campuses[placed.indexOf(c)];
    return c.location && match ? { ...c, id: match.id, name: match.name, address: match.address } : c;
  });
}

function Status({ ok, label }: { ok: boolean; label: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-600">{label}</span>
      {ok ? <Badge tone="green" dot>Connected</Badge> : <Badge tone="amber" dot>Not set up</Badge>}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="tabular rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700">
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full accent-brand-600"
        style={{
          background: `linear-gradient(90deg, var(--color-brand-500) ${pct}%, var(--color-slate-200) ${pct}%)`,
        }}
      />
    </label>
  );
}
