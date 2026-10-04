import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GraduationCap, MapPin, Plus, Route as RouteIcon } from "lucide-react";
import { motion } from "motion/react";
import { Link, useNavigate } from "react-router";

import { Button } from "../../components/ui/Button";
import { Card, listItem, stagger } from "../../components/ui/Card";
import { Badge, Banner, EmptyState, Skeleton } from "../../components/ui/Feedback";
import { api, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import type { AdminRoute } from "../../lib/types";
import { AdminPage } from "./AdminLayout";

export function AdminRoutes() {
  const navigate = useNavigate();
  const routes = useQuery({
    queryKey: ["admin", "routes"],
    queryFn: async () => (await api.get<{ routes: AdminRoute[] }>("/api/admin/routes")).routes,
  });

  return (
    <AdminPage
      title="Routes & stops"
      subtitle="Each route is an ordered list of stops. Assign a route to a bus, and students to stops."
      actions={
        <Button icon={<Plus className="size-4" />} onClick={() => navigate("/admin/routes/new")}>
          New route
        </Button>
      }
    >
      {routes.isError && <Banner tone="error">{errorMessage(routes.error)}</Banner>}
      {routes.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-4xl" />
          ))}
        </div>
      ) : !routes.data?.length ? (
        <Card>
          <EmptyState
            icon={<RouteIcon className="size-6" />}
            title="No routes yet"
            body="Create a route, add its stops in order, then assign it to a bus."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => navigate("/admin/routes/new")}>
                Create the first route
              </Button>
            }
          />
        </Card>
      ) : (
        <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4 md:grid-cols-2">
          {routes.data.map((route) => (
            <motion.div key={route.id} variants={listItem}>
              <Link
                to={`/admin/routes/${route.id}`}
                className="group block h-full rounded-4xl border border-slate-200/70 bg-white p-5 shadow-card transition hover:border-brand-200 hover:shadow-float"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-extrabold tracking-tight text-slate-900">{route.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" /> {plural(route.stops.length, "stop")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <GraduationCap className="size-3.5" /> {plural(route.studentCount, "student")}
                      </span>
                    </p>
                  </div>
                  {route.bus ? <Badge tone="bus">Bus {route.bus.number}</Badge> : <Badge tone="amber">No bus</Badge>}
                </div>
                <div className="mt-4 flex items-center gap-1.5 overflow-hidden">
                  {route.stops.slice(0, 6).map((stop, i) => (
                    <span key={stop.id} className="flex min-w-0 items-center gap-1.5">
                      {i > 0 && <span className="h-0.5 w-3 shrink-0 rounded-full bg-slate-200" />}
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-extrabold text-brand-700 ring-1 ring-brand-100">
                        {i + 1}
                      </span>
                    </span>
                  ))}
                  {route.stops.length > 6 && (
                    <span className="text-xs font-bold text-slate-400">+{route.stops.length - 6}</span>
                  )}
                  {!route.stops.length && <span className="text-sm text-slate-400">No stops yet</span>}
                </div>
                <p className="mt-3 truncate text-xs text-slate-400">
                  {route.stops.map((s) => s.name).join(" → ")}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-brand-700">
                  Edit route <ChevronRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}
    </AdminPage>
  );
}
