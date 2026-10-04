import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Banner, Skeleton } from "../../components/ui/Feedback";
import { api, errorMessage } from "../../lib/api";
import { clock } from "../../lib/format";
import type { DaySummary } from "../../lib/types";

interface SummaryResponse {
  summary: DaySummary | null;
  enabled: boolean;
}

/** The AI-written summary of one school day (written on request, and each evening). */
export function DaySummaryCard({ day, isToday }: { day: string; isToday: boolean }) {
  const queryClient = useQueryClient();
  const key = ["admin", "summary", day];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<SummaryResponse>(`/api/admin/summaries/${day}`),
  });
  const write = useMutation({
    mutationFn: () => api.post<SummaryResponse>(`/api/admin/summaries/${day}`),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  const summary = query.data?.summary ?? null;
  const canRefresh = summary && (isToday || summary.partial);

  return (
    <Card className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-brand-100/60 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold tracking-tight text-slate-900">Day summary</h2>
          <p className="text-xs text-slate-500">
            {!summary
              ? "Written by AI from the day's records"
              : !summary.partial
                ? `Written ${clock(summary.generatedAt)}`
                : isToday
                  ? `So far · written ${clock(summary.generatedAt)}`
                  : `Written ${clock(summary.generatedAt)}, before the day ended`}
          </p>
        </div>
        {canRefresh && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={write.isPending ? "size-4 animate-spin" : "size-4"} />}
            disabled={write.isPending}
            onClick={() => write.mutate()}
          >
            Refresh
          </Button>
        )}
      </div>

      <div className="relative mt-4">
        {query.isPending ? (
          <Lines />
        ) : query.isError ? (
          <Banner tone="error">{errorMessage(query.error)}</Banner>
        ) : !query.data.enabled ? (
          <p className="text-sm text-slate-500">AI summaries aren't switched on for this school yet.</p>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {write.isPending && !summary ? (
              <motion.div key="writing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Lines />
                <p className="mt-3 text-xs font-semibold text-brand-600">Reading the day's records…</p>
              </motion.div>
            ) : summary ? (
              <motion.div
                key={summary.generatedAt}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: write.isPending ? 0.5 : 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <SummaryBody summary={summary} />
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-sm text-slate-500">
                  {isToday
                    ? "Get a quick read of today so far: trips, campus arrivals, riding numbers and anything to follow up. The full summary is written automatically at 8 PM."
                    : "No summary was written for this day."}
                </p>
                <Button className="mt-4" size="sm" icon={<Sparkles className="size-4" />} onClick={() => write.mutate()}>
                  {isToday ? "Summarize today so far" : "Write summary"}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        {write.isError && (
          <Banner tone="error" className="mt-3">
            {errorMessage(write.error)}
          </Banner>
        )}
      </div>
    </Card>
  );
}

function SummaryBody({ summary }: { summary: DaySummary }) {
  return (
    <div>
      <p className="text-[15px] font-bold leading-snug text-slate-900">{summary.headline}</p>
      {summary.highlights.length > 0 && (
        <ul className="mt-3 space-y-2">
          {summary.highlights.map((line) => (
            <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-slate-600">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand-400" />
              {line}
            </li>
          ))}
        </ul>
      )}
      {summary.attention.length > 0 && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200/70">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800">
            <AlertTriangle className="size-3.5" /> Worth a look
          </p>
          <ul className="mt-2 space-y-1.5">
            {summary.attention.map((line) => (
              <li key={line} className="text-sm leading-relaxed text-amber-900">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-slate-400">AI-written from this day's records. Check the log for details.</p>
    </div>
  );
}

function Lines() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}
