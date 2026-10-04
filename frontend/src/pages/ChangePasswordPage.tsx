import { ArrowLeft, KeyRound } from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "../components/ui/Button";
import { Banner } from "../components/ui/Feedback";
import { Field, PasswordInput } from "../components/ui/Form";
import { PageTransition } from "../components/ui/Motion";
import { useToast } from "../components/ui/Toast";
import { errorMessage } from "../lib/api";
import { homePath, useAuth } from "../lib/auth";
import { cn } from "../lib/hooks";

function strength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong", "Excellent"];
  return { score, label: labels[score] };
}

export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstTime = user?.mustChangePassword;
  const meter = strength(next);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < 8) return setError("Use at least 8 characters.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const me = await changePassword(current, next);
      toast({ title: "Password updated", body: "Use your new password next time you sign in." });
      navigate(homePath(me.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageTransition className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {!firstTime && user && (
          <button
            type="button"
            onClick={() => navigate(homePath(user.role))}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="size-4" /> Back
          </button>
        )}
        <div className="rounded-4xl border border-slate-200/70 bg-white p-6 shadow-float sm:p-8">
          <motion.div
            initial={{ scale: 0.6, rotate: -20, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="flex size-14 items-center justify-center rounded-3xl bg-brand-50 text-brand-600"
          >
            <KeyRound className="size-7" />
          </motion.div>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">
            {firstTime ? "Set your own password" : "Change password"}
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            {firstTime
              ? `Welcome${user ? `, ${user.name.split(" ")[0]}` : ""}! Replace the temporary password from the school with one only you know.`
              : "Choose a new password for your account."}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Field label={firstTime ? "Temporary password" : "Current password"}>
              {(id) => (
                <PasswordInput
                  id={id}
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              )}
            </Field>
            <Field label="New password" hint="At least 8 characters. A short phrase works well.">
              {(id) => (
                <PasswordInput
                  id={id}
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              )}
            </Field>
            {next && (
              <div className="-mt-1 flex items-center gap-3">
                <div className="flex h-1.5 flex-1 gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.span
                      key={i}
                      className={cn(
                        "h-full flex-1 rounded-full",
                        i < meter.score
                          ? meter.score <= 1
                            ? "bg-rose-400"
                            : meter.score <= 2
                              ? "bg-amber-400"
                              : "bg-emerald-500"
                          : "bg-slate-200",
                      )}
                      initial={false}
                      animate={{ scaleY: i < meter.score ? 1 : 0.7 }}
                    />
                  ))}
                </div>
                <span className="w-20 text-right text-xs font-semibold text-slate-500">{meter.label}</span>
              </div>
            )}
            <Field label="Confirm new password">
              {(id) => (
                <PasswordInput
                  id={id}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
            {error && <Banner tone="error">{error}</Banner>}
            <Button type="submit" size="lg" block loading={busy} className="mt-6!">
              Save password
            </Button>
            {firstTime && (
              <Button
                variant="ghost"
                block
                onClick={async () => {
                  await logout();
                  navigate("/login", { replace: true });
                }}
              >
                Sign out
              </Button>
            )}
          </form>
        </div>
      </div>
    </PageTransition>
  );
}
