import { ArrowRight, BellRing, MapPinned, ShieldCheck } from "lucide-react";
import { motion, useAnimate } from "motion/react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router";

import { BusArt, SchoolEmblem } from "../components/Brand";
import { Button } from "../components/ui/Button";
import { Banner } from "../components/ui/Feedback";
import { Field, Input, PasswordInput } from "../components/ui/Form";
import { errorMessage } from "../lib/api";
import { homePath, useAuth, useConfig } from "../lib/auth";

const perks = [
  { icon: MapPinned, text: "See the bus moving live, with honest arrival times" },
  { icon: BellRing, text: "Get a heads-up when the bus is close to your stop" },
  { icon: ShieldCheck, text: "Only you see your child's details" },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const config = useConfig();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, animate] = useAnimate();

  // Signing in updates `user`, and this redirect takes it from there.
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    const target = user.mustChangePassword
      ? "/change-password"
      : from && from !== "/login"
        ? from
        : homePath(user.role);
    return <Navigate to={target} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      void animate(scope.current, { x: [0, -10, 10, -6, 6, 0] }, { duration: 0.4 });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      void animate(scope.current, { x: [0, -10, 10, -6, 6, 0] }, { duration: 0.4 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 pb-16 pt-[max(2rem,env(safe-area-inset-top))] text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-bus-400/20 blur-3xl" />
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative leading-tight"
        >
          <p className="text-lg font-extrabold tracking-tight">iTransport</p>
          <p className="text-xs font-medium text-brand-100">{config.data?.schoolName ?? "School transport"}</p>
        </motion.div>

        <div className="relative mx-auto mt-10 w-full max-w-md lg:mt-0">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl"
          >
            Know where the school bus is.
            <span className="block text-bus-300">Every trip.</span>
          </motion.h1>
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 120, damping: 18 }}
            className="mt-8 max-w-xs sm:max-w-sm"
          >
            <BusArt />
          </motion.div>
          <ul className="mt-10 hidden space-y-3 lg:block">
            {perks.map(({ icon: Icon, text }, i) => (
              <motion.li
                key={text}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.07 }}
                className="flex items-center gap-3 text-sm font-medium text-brand-50"
              >
                <span className="flex size-8 items-center justify-center rounded-xl bg-white/10">
                  <Icon className="size-4" />
                </span>
                {text}
              </motion.li>
            ))}
          </ul>
        </div>
        <p className="relative hidden text-xs text-brand-200 lg:block">
          Locations are shared only while a trip is running.
        </p>
      </aside>

      <main className="relative -mt-8 flex flex-1 items-start justify-center px-4 pb-10 lg:mt-0 lg:items-center lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.08 }}
          className="w-full max-w-md"
        >
          <div ref={scope} className="rounded-4xl border border-slate-200/70 bg-white p-6 shadow-float sm:p-8">
            <SchoolEmblem className="mx-auto mb-5 h-20 sm:h-24" />
            <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900">Welcome back</h2>
            <p className="mt-1 text-center text-sm text-slate-500">Sign in with the details from your school.</p>
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field label="Username">
                {(id) => (
                  <Input
                    id={id}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. priya.k"
                  />
                )}
              </Field>
              <Field label="Password">
                {(id) => (
                  <PasswordInput
                    id={id}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                  />
                )}
              </Field>
              {error && <Banner tone="error">{error}</Banner>}
              <Button type="submit" size="lg" block loading={busy} className="mt-6!">
                Sign in
                {!busy && <ArrowRight className="size-5" />}
              </Button>
            </form>
          </div>
          <p className="mt-5 text-center text-sm text-slate-500">
            Trouble signing in? Contact your school's transport office.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
