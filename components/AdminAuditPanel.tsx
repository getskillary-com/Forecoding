"use client";

import { useState } from "react";
import type { AuditEvent } from "@/types";

type Props = {
    initialEvents: AuditEvent[];
};

function formatTimestamp(value: number) {
    return new Date(value).toLocaleString();
}

export function AdminAuditPanel({ initialEvents }: Props) {
    const [events, setEvents] = useState(initialEvents);
    const [query, setQuery] = useState("");
    const [severity, setSeverity] = useState<"" | "info" | "warning" | "critical">("");
    const [resourceType, setResourceType] = useState("");
    const [eventType, setEventType] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (query.trim()) params.set("query", query.trim());
            if (severity) params.set("severity", severity);
            if (resourceType.trim()) params.set("resourceType", resourceType.trim());
            if (eventType.trim()) params.set("eventType", eventType.trim());
            params.set("limit", "12");

            const res = await fetch(`/api/admin/audit?${params.toString()}`, {
                cache: "no-store"
            });
            const payload = (await res.json()) as { events?: AuditEvent[]; error?: string };
            if (!res.ok || !Array.isArray(payload.events)) {
                throw new Error(payload.error || "Failed to load audit events.");
            }
            setEvents(payload.events);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : "Failed to load audit events.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Audit Events</h2>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={isLoading}
                    className="fc-button-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                >
                    {isLoading ? "Refreshing..." : "Apply filters"}
                </button>
            </div>

            <div className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by event, resource, actor, or metadata"
                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                />
                <select
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as "" | "info" | "warning" | "critical")}
                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                >
                    <option value="">All severities</option>
                    <option value="info">info</option>
                    <option value="warning">warning</option>
                    <option value="critical">critical</option>
                </select>
                <div className="grid gap-3 sm:grid-cols-2">
                    <input
                        value={resourceType}
                        onChange={(event) => setResourceType(event.target.value)}
                        placeholder="Resource type, e.g. releaseTag"
                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                    />
                    <input
                        value={eventType}
                        onChange={(event) => setEventType(event.target.value)}
                        placeholder="Event type, e.g. workspace.release_rolled_back"
                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                    />
                </div>
            </div>

            {error ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            <div className="mt-4 space-y-3">
                {events.length > 0 ? events.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{event.eventType}</p>
                            <span className="text-xs text-slate-500 dark:text-slate-300">{formatTimestamp(event.createdAt)}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{event.summary}</p>
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                            {event.resourceType}: {event.resourceId}
                        </p>
                        {event.actorEmail ? (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Actor: {event.actorEmail}</p>
                        ) : null}
                        {event.metadata && Object.keys(event.metadata).length > 0 ? (
                            <div className="mt-2 rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-xs text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">
                                {Object.entries(event.metadata).slice(0, 4).map(([key, value]) => (
                                    <p key={`${event.id}-${key}`}>{key}: {value}</p>
                                ))}
                            </div>
                        ) : null}
                    </div>
                )) : (
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No audit events matched the current filters.</p>
                )}
            </div>
        </article>
    );
}
