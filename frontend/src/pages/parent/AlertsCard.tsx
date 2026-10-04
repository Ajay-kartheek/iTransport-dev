import { BellOff, BellRing, Share, SquarePlus } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useToast } from "../../components/ui/Toast";
import { errorMessage } from "../../lib/api";
import { useConfig } from "../../lib/auth";
import { disablePush, enablePush, getPushState, type PushState, sendTestPush } from "../../lib/push";

export function AlertsCard({ approachMinutes }: { approachMinutes: number }) {
  const config = useConfig();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  const vapid = config.data?.vapidPublicKey;
  if (!vapid || state === null || state === "unsupported") return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await enablePush(vapid);
      setState(next);
      if (next === "on") toast({ title: "Alerts are on", body: "We'll let you know when the bus is close." });
    } catch (error) {
      toast({ tone: "error", title: "Couldn't turn on alerts", body: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      {state === "on" ? (
        <div className="flex items-start gap-4">
          <motion.span
            initial={{ rotate: -20 }}
            animate={{ rotate: [-20, 14, -8, 4, 0] }}
            transition={{ duration: 0.9 }}
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"
          >
            <BellRing className="size-5" />
          </motion.span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900">Alerts are on</p>
            <p className="mt-0.5 text-sm text-slate-500">
              We'll tell you when the bus starts and when it's about {approachMinutes} minutes from your stop.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const delivered = await sendTestPush().catch(() => 0);
                  toast(
                    delivered
                      ? { title: "Test sent", body: "You should see a notification now." }
                      : { tone: "error", title: "Test didn't arrive", body: "Try turning alerts off and on again." },
                  );
                }}
              >
                Send a test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await disablePush();
                  setState("off");
                }}
              >
                Turn off
              </Button>
            </div>
          </div>
        </div>
      ) : state === "needs-install" ? (
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <SquarePlus className="size-5" />
          </span>
          <div>
            <p className="font-bold text-slate-900">Get alerts on your iPhone</p>
            <ol className="mt-2 space-y-1.5 text-sm text-slate-600">
              <li className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold">1</span>
                Tap <Share className="inline size-4 text-brand-600" /> Share in Safari
              </li>
              <li className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold">2</span>
                Choose “Add to Home Screen”
              </li>
              <li className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold">3</span>
                Open iTransport from your Home Screen
              </li>
            </ol>
          </div>
        </div>
      ) : state === "denied" ? (
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <BellOff className="size-5" />
          </span>
          <div>
            <p className="font-bold text-slate-900">Notifications are blocked</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Allow notifications for this site in your browser settings to get bus alerts.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <BellRing className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900">Know when the bus is close</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Get a notification when the trip starts and about {approachMinutes} minutes before the bus reaches you.
            </p>
            <Button className="mt-3" size="sm" onClick={turnOn} loading={busy}>
              Turn on alerts
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
