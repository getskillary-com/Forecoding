"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AuditEvent } from "@/types";

type Props = {
    initialEvents: AuditEvent[];
};

type OperationLink = {
    href: string;
    label: string;
};

type TimeWindowKey = "all" | "15m" | "1h" | "24h" | "7d";

function formatTimestamp(value: number) {
    return new Date(value).toLocaleString();
}

function resolveTimeWindowCutoff(windowKey: TimeWindowKey) {
    const now = Date.now();
    if (windowKey === "15m") return now - 15 * 60 * 1000;
    if (windowKey === "1h") return now - 60 * 60 * 1000;
    if (windowKey === "24h") return now - 24 * 60 * 60 * 1000;
    if (windowKey === "7d") return now - 7 * 24 * 60 * 60 * 1000;
    return null;
}

function toneClass(event: AuditEvent) {
    if (event.eventType.startsWith("workspace.release_")) {
        return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300";
    }
    if (event.eventType.startsWith("stripe.webhook_")) {
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    }
    if (event.eventType.startsWith("generation.job_")) {
        return event.severity === "warning" || event.severity === "critical"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    }
    return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function compactMetadata(event: AuditEvent) {
    if (!event.metadata) return [];
    return Object.entries(event.metadata).slice(0, 3);
}

function resolveOperationLinks(event: AuditEvent): OperationLink[] {
    const resourceId = event.resourceId?.trim() || "";
    if (!resourceId || resourceId === "unknown") return [];

    if (event.resourceType === "generationJob" || event.eventType.startsWith("generation.job_")) {
        return [
            {
                href: `/admin/jobs/${encodeURIComponent(resourceId)}`,
                label: "Open job detail"
            },
            {
                href: `/admin?job=${encodeURIComponent(resourceId)}`,
                label: "Open focused console"
            }
        ];
    }

    if (event.resourceType === "releaseTag" || event.eventType.startsWith("workspace.release_")) {
        return [
            {
                href: `/admin/releases/${encodeURIComponent(resourceId)}`,
                label: "Open release detail"
            },
            {
                href: `/admin?release=${encodeURIComponent(resourceId)}`,
                label: "Open focused console"
            }
        ];
    }

    if (event.resourceType === "webhookEvent" || event.eventType.startsWith("stripe.webhook_")) {
        const provider = (event.metadata?.provider || "stripe").toLowerCase();
        if (provider === "stripe") {
            return [
                {
                    href: `/admin/webhooks/stripe/${encodeURIComponent(resourceId)}`,
                    label: "Open webhook detail"
                },
                {
                    href: `/admin?webhook=${encodeURIComponent(resourceId)}`,
                    label: "Open focused console"
                }
            ];
        }
    }

    return [];
}

export function AdminOperationsPanel({ initialEvents }: Props) {
    const [query, setQuery] = useState("");
    const [eventTypeFilter, setEventTypeFilter] = useState("");
    const [resourceTypeFilter, setResourceTypeFilter] = useState("");
    const [severityFilter, setSeverityFilter] = useState<"" | AuditEvent["severity"]>("");
    const [timeWindowFilter, setTimeWindowFilter] = useState<TimeWindowKey>("all");

    const eventTypeOptions = useMemo(
        () => Array.from(new Set(initialEvents.map((event) => event.eventType))).sort((left, right) => left.localeCompare(right)),
        [initialEvents]
    );
    const resourceTypeOptions = useMemo(
        () => Array.from(new Set(initialEvents.map((event) => event.resourceType))).sort((left, right) => left.localeCompare(right)),
        [initialEvents]
    );
    const filteredEvents = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const cutoff = resolveTimeWindowCutoff(timeWindowFilter);
        return initialEvents.filter((event) => {
            if (cutoff !== null && event.createdAt < cutoff) return false;
            if (eventTypeFilter && event.eventType !== eventTypeFilter) return false;
            if (resourceTypeFilter && event.resourceType !== resourceTypeFilter) return false;
            if (severityFilter && event.severity !== severityFilter) return false;
            if (!normalizedQuery) return true;

            const haystack = [
                event.eventType,
                event.resourceType,
                event.resourceId,
                event.summary,
                event.actorEmail || "",
                JSON.stringify(event.metadata || {})
            ].join(" ").toLowerCase();
            return haystack.includes(normalizedQuery);
        });
    }, [eventTypeFilter, initialEvents, query, resourceTypeFilter, severityFilter, timeWindowFilter]);

    return (
        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Operations Feed</h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        Recent release, webhook replay, and generation outcome events.
                    </p>
                </div>
            </div>

            <div className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search summary, resource id, actor, or metadata"
                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                />
                <div className="grid gap-3 sm:grid-cols-5">
                    <select
                        value={eventTypeFilter}
                        onChange={(event) => setEventTypeFilter(event.target.value)}
                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                    >
                        <option value="">All event types</option>
                        {eventTypeOptions.map((eventType) => (
                            <option key={eventType} value={eventType}>
                                {eventType}
                            </option>
                        ))}
                    </select>
                    <select
                        value={resourceTypeFilter}
                        onChange={(event) => setResourceTypeFilter(event.target.value)}
                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                    >
                        <option value="">All resource types</option>
                        {resourceTypeOptions.map((resourceType) => (
                            <option key={resourceType} value={resourceType}>
                                {resourceType}
                            </option>
                        ))}
                    </select>
                    <select
                        value={severityFilter}
                        onChange={(event) => setSeverityFilter(event.target.value as "" | AuditEvent["severity"])}
                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                    >
                        <option value="">All severities</option>
                        <option value="info">info</option>
                        <option value="warning">warning</option>
                        <option value="critical">critical</option>
                    </select>
                    <select
                        value={timeWindowFilter}
                        onChange={(event) => setTimeWindowFilter(event.target.value as TimeWindowKey)}
                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                    >
                        <option value="all">All time</option>
                        <option value="15m">Last 15 minutes</option>
                        <option value="1h">Last 1 hour</option>
                        <option value="24h">Last 24 hours</option>
                        <option value="7d">Last 7 days</option>
                    </select>
                    <button
                        type="button"
                        onClick={() => {
                            setQuery("");
                            setEventTypeFilter("");
                            setResourceTypeFilter("");
                            setSeverityFilter("");
                            setTimeWindowFilter("all");
                        }}
                        className="fc-button-secondary px-3 py-2 text-sm font-semibold"
                    >
                        Clear filters
                    </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-300">
                    Showing {filteredEvents.length} of {initialEvents.length} events. Window: {timeWindowFilter}.
                </p>
            </div>

            <div className="mt-4 space-y-3">
                {filteredEvents.length > 0 ? filteredEvents.map((event) => {
                    const operationLinks = resolveOperationLinks(event);
                    const metadataEntries = compactMetadata(event);

                    return (
                        <div key={event.id} className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass(event)}`}>
                                            {event.eventType}
                                        </span>
                                        <span className="text-xs text-slate-500 dark:text-slate-300">{event.resourceType}</span>
                                    </div>
                                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{event.summary}</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{event.resourceId}</p>
                                    {event.actorEmail ? (
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Actor: {event.actorEmail}</p>
                                    ) : null}
                                    {metadataEntries.length > 0 ? (
                                        <div className="mt-2 space-y-1">
                                            {metadataEntries.map(([key, value]) => (
                                                <p key={`${event.id}-${key}`} className="text-xs text-slate-500 dark:text-slate-300">
                                                    {key}: {value}
                                                </p>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="flex flex-col items-start gap-2 sm:items-end">
                                    <span className="text-xs text-slate-500 dark:text-slate-300">{formatTimestamp(event.createdAt)}</span>
                                    {operationLinks.length > 0 ? operationLinks.map((operationLink) => (
                                        <Link
                                            key={`${event.id}-${operationLink.href}`}
                                            href={operationLink.href}
                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                        >
                                            {operationLink.label}
                                        </Link>
                                    )) : null}
                                </div>
                            </div>
                        </div>
                    );
                }) : (
                    <p className="text-sm text-slate-500 dark:text-slate-300">No operations match the current filters.</p>
                )}
            </div>
        </article>
    );
}
