"use client";

import { useState } from "react";
import type { WebhookEventRecord } from "@/types";

type Props = {
    initialEvents: WebhookEventRecord[];
    canReplay: boolean;
    focusedEventId?: string | null;
    onSelectEvent?: (eventId: string) => void;
};

function formatTimestamp(value: number | null | undefined) {
    if (!value) return "Never";
    return new Date(value).toLocaleString();
}

export function AdminStripeWebhookPanel({ initialEvents, canReplay, focusedEventId, onSelectEvent }: Props) {
    const [events, setEvents] = useState(initialEvents);
    const [query, setQuery] = useState("");
    const [eventName, setEventName] = useState("");
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [busyEventId, setBusyEventId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

    const refresh = async () => {
        setIsRefreshing(true);
        setFeedback(null);
        try {
            const params = new URLSearchParams();
            if (query.trim()) params.set("query", query.trim());
            if (eventName.trim()) params.set("eventName", eventName.trim());
            params.set("limit", "12");
            const res = await fetch(`/api/admin/webhooks/stripe?${params.toString()}`, {
                cache: "no-store"
            });
            const payload = (await res.json()) as { events?: WebhookEventRecord[]; error?: string };
            if (!res.ok || !Array.isArray(payload.events)) {
                throw new Error(payload.error || "Failed to load webhook events.");
            }
            setEvents(payload.events);
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to load webhook events."
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const replay = async (eventId: string) => {
        if (!canReplay) return;

        setBusyEventId(eventId);
        setFeedback(null);
        try {
            const res = await fetch("/api/admin/webhooks/stripe/replay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventId })
            });
            const payload = (await res.json()) as {
                ok?: boolean;
                error?: string;
                result?: { type?: string; status?: string };
            };
            if (!res.ok || payload.ok !== true) {
                throw new Error(payload.error || "Failed to replay webhook.");
            }
            setFeedback({
                tone: "success",
                message: `Webhook ${eventId} replayed successfully.`
            });
            await refresh();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to replay webhook."
            });
        } finally {
            setBusyEventId(null);
        }
    };

    const toneClass = feedback?.tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";

    return (
        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stripe Webhooks</h2>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={isRefreshing}
                    className="fc-button-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                >
                    {isRefreshing ? "Refreshing..." : "Apply filters"}
                </button>
            </div>

            <div className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by event id, type, or payload"
                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                    value={eventName}
                    onChange={(event) => setEventName(event.target.value)}
                    placeholder="Filter exact event type, e.g. checkout.session.completed"
                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                />
                <p className="text-xs text-slate-500 dark:text-slate-300">
                    {canReplay ? "Replay capability is enabled for this account." : "Replay capability is disabled for this role."}
                </p>
            </div>

            {feedback ? (
                <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>
                    {feedback.message}
                </div>
            ) : null}

            <div className="mt-4 space-y-3">
                {events.length > 0 ? events.map((event) => (
                    <div
                        key={event.eventId}
                        className={`rounded-2xl border p-4 text-sm dark:bg-slate-900/60 ${focusedEventId === event.eventId ? "border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/20" : "border-[color:var(--border)] bg-white/70"}`}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-slate-100">{event.eventName}</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{event.eventId}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => onSelectEvent?.(event.eventId)}
                                    className="fc-button-secondary px-4 py-2 text-sm font-semibold"
                                >
                                    {focusedEventId === event.eventId ? "Hide detail" : "Open detail"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void replay(event.eventId)}
                                    disabled={!canReplay || busyEventId === event.eventId}
                                    className="fc-button-secondary px-4 py-2 text-sm font-semibold disabled:opacity-60"
                                >
                                    {busyEventId === event.eventId ? "Replaying..." : "Replay"}
                                </button>
                            </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                            Processed {formatTimestamp(event.processedAt)} | Replays {event.replayCount || 0}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                            Last replay: {formatTimestamp(event.lastReplayedAt)} | Status {event.lastReplayStatus || "n/a"}
                        </p>
                        {event.lastReplayError ? (
                            <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{event.lastReplayError}</p>
                        ) : null}
                    </div>
                )) : (
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No Stripe webhook events available.</p>
                )}
            </div>
        </article>
    );
}
