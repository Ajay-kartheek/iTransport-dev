import { Link } from "react-router";

import { BusArt } from "../components/Brand";
import { PageTransition } from "../components/ui/Motion";

export function NotFound() {
  return (
    <PageTransition className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <BusArt className="w-56" moving={false} />
      <h1 className="mt-10 text-2xl font-extrabold tracking-tight text-slate-900">Wrong stop</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">This page doesn't exist. Let's get you back on route.</p>
      <Link
        to="/"
        className="mt-6 inline-flex h-11 items-center rounded-2xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-700 active:scale-[0.97]"
      >
        Go home
      </Link>
    </PageTransition>
  );
}
