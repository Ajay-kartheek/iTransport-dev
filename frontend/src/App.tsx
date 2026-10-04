import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig } from "motion/react";
import { lazy, type ReactNode, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";

import { FullPageSpinner } from "./components/ui/Feedback";
import { ToastProvider } from "./components/ui/Toast";
import { ApiError } from "./lib/api";
import { AuthProvider, homePath, useAuth } from "./lib/auth";
import type { Role } from "./lib/types";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DriverHome } from "./pages/driver/DriverHome";
import { DriverRoster } from "./pages/driver/DriverRoster";
import { DriverTrip } from "./pages/driver/DriverTrip";
import { LoginPage } from "./pages/LoginPage";
import { NotFound } from "./pages/NotFound";
import { ParentHome } from "./pages/parent/ParentHome";

// The transport office screens are only downloaded by admins.
const admin = () => import("./pages/admin/AdminScreens");
const AdminLayout = lazy(() => admin().then((m) => ({ default: m.AdminLayout })));
const AdminOverview = lazy(() => admin().then((m) => ({ default: m.AdminOverview })));
const AdminTrips = lazy(() => admin().then((m) => ({ default: m.AdminTrips })));
const AdminBuses = lazy(() => admin().then((m) => ({ default: m.AdminBuses })));
const AdminRoutes = lazy(() => admin().then((m) => ({ default: m.AdminRoutes })));
const RouteEditor = lazy(() => admin().then((m) => ({ default: m.RouteEditor })));
const AdminStudents = lazy(() => admin().then((m) => ({ default: m.AdminStudents })));
const AdminUsers = lazy(() => admin().then((m) => ({ default: m.AdminUsers })));
const AdminSettings = lazy(() => admin().then((m) => ({ default: m.AdminSettings })));
const AdminActivity = lazy(() => admin().then((m) => ({ default: m.AdminActivity })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4_000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

function transitionKey(pathname: string): string {
  return pathname.startsWith("/admin") ? "/admin" : pathname;
}

function AppRoutes() {
  const location = useLocation();
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={transitionKey(location.pathname)}>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/change-password"
          element={
            <Guard>
              <ChangePasswordPage />
            </Guard>
          }
        />
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/parent" element={<Guard role="PARENT"><ParentHome /></Guard>} />
        <Route path="/driver" element={<Guard role="DRIVER"><DriverHome /></Guard>} />
        <Route path="/driver/bus/:busId" element={<Guard role="DRIVER"><DriverRoster /></Guard>} />
        <Route path="/driver/trip/:tripId" element={<Guard role="DRIVER"><DriverTrip /></Guard>} />
        <Route path="/admin" element={<Guard role="ADMIN"><AdminLayout /></Guard>}>
          <Route index element={<AdminOverview />} />
          <Route path="trips" element={<AdminTrips />} />
          <Route path="buses" element={<AdminBuses />} />
          <Route path="routes" element={<AdminRoutes />} />
          <Route path="routes/:routeId" element={<RouteEditor />} />
          <Route path="students" element={<AdminStudents />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="activity" element={<AdminActivity />} />
        </Route>
        <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

function Guard({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  if (role && user.role !== role) return <Navigate to={homePath(user.role)} replace />;
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.mustChangePassword ? "/change-password" : homePath(user.role)} replace />;
}
