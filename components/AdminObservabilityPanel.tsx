"use client";

import Link from "next/link";
import { useState } from "react";
import type { ObservabilitySnapshot, PlatformAlert, SloMetric } from "@/types";

type Props = {
    initialSnapshot: ObservabilitySnapshot;
};

function formatTimestamp(value: number) {
    return new Date(value).toLocaleString();
}

function metricToneClass(status: SloMetric["status"]) {
    if (status === "critical") {
        return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300";
    }
    if (status === "warning") {
        return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
    }
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
}

function alertToneClass(alert: PlatformAlert) {
    if (alert.severity === "critical") {
        return "border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/40";
    }
    return "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40";
}

function formatMetricValue(metric: SloMetric) {
    if (metric.unit === "percent") {
        return `${metric.value.toFixed(1)}%`;
    }
    return String(metric.value);
}

export function AdminObservabilityPanel({ initialSnapshot }: Props) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshSnapshot = async () => {
        setIsRefreshing(true);
        setError(null);
        try {
            const response = await fetch("/api/admin/observability", {
                cache: "no-store"
            });
            const payload = (await response.json()) as {
                snapshot?: ObservabilitySnapshot;
                error?: string;
            };
            if (!response.ok || !payload.snapshot) {
                throw new Error(payload.error || "Failed to refresh observability snapshot.");
            }
            setSnapshot(payload.snapshot);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : "Failed to refresh observability snapshot.");
        } finally {
            setIsRefreshing(false);
        }
    };

    return (
        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Observability</h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        SLO snapshot and active platform alerts for the last {Math.round(snapshot.windowMs / (60 * 60 * 1000))}h.
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                        Updated {formatTimestamp(snapshot.generatedAt)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void refreshSnapshot()}
                    disabled={isRefreshing}
                    className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                >
                    {isRefreshing ? "Refreshing..." : "Refresh snapshot"}
                </button>
            </div>

            {error ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {snapshot.metrics.map((metric) => (
                    <article
                        key={metric.key}
                        className={`rounded-2xl border px-4 py-3 ${metricToneClass(metric.status)}`}
                    >
                        <p className="text-xs font-semibold uppercase tracking-[0.12em]">{metric.label}</p>
                        <p className="mt-2 text-2xl font-semibold">{formatMetricValue(metric)}</p>
                        <p className="mt-1 text-xs">Target {metric.target} | Samples {metric.sampleSize}</p>
                        <p className="mt-1 text-xs">{metric.description}</p>
                    </article>
                ))}
            </div>

            <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Active Alerts</p>
                    <p className="text-xs text-slate-500 dark:text-slate-300">{snapshot.alerts.length} alerts</p>
                </div>
                {snapshot.alerts.length > 0 ? snapshot.alerts.map((alert) => (
                    <article
                        key={alert.id}
                        className={`rounded-2xl border p-4 ${alertToneClass(alert)}`}
                    >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{alert.title}</p>
                                <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{alert.message}</p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                    {alert.source} | {alert.eventType || "event"} | {formatTimestamp(alert.createdAt)}
                                </p>
                            </div>
                            {alert.actionHref ? (
                                <Link
                                    href={alert.actionHref}
                                    className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                >
                                    Open detail
                                </Link>
                            ) : null}
                        </div>
                    </article>
                )) : (
                    <p className="text-sm text-slate-500 dark:text-slate-300">No active alerts in the selected window.</p>
                )}
            </div>
        </article>
    );
}
