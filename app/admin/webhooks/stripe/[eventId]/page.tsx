import { notFound } from "next/navigation";
import { AdminDetailSection, AdminDetailShell, formatAdminTimestamp } from "@/components/AdminDetailShell";
import { resolveAdminRole } from "@/lib/admin";
import { getWebhookEvent } from "@/lib/data/webhook-events";
import { getServerSessionIdentity } from "@/lib/server-auth";

export default async function AdminStripeWebhookDetailPage({
    params
}: {
    params: Promise<{ eventId: string }>;
}) {
    const { eventId } = await params;
    const [user, event] = await Promise.all([
        getServerSessionIdentity(),
        getWebhookEvent("stripe", eventId)
    ]);

    if (!event) {
        notFound();
    }

    const email = user?.email || "admin";
    const role = resolveAdminRole({ email: user?.email });
    const focusedHref = `/admin?webhook=${encodeURIComponent(event.eventId)}`;

    return (
        <AdminDetailShell
            eyebrow="Admin Detail"
            title={`Webhook ${event.eventName}`}
            description="Standalone Stripe webhook detail view with replay history, last replay outcome, and the stored payload preview."
            email={email}
            role={role}
            actions={[
                { href: focusedHref, label: "Open replay console", tone: "primary" },
                { href: "/admin", label: "Admin home", tone: "secondary" }
            ]}
        >
            <AdminDetailSection
                title="Overview"
                description="Provider identity and replay safety signals for this stored webhook."
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Event</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{event.eventName}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{event.eventId}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Provider</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{event.provider}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Processed: {formatAdminTimestamp(event.processedAt)}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Replay Count</p>
                        <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">{event.replayCount || 0}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            Last replay: {event.lastReplayedAt ? formatAdminTimestamp(event.lastReplayedAt) : "Never"}
                        </p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Last Status</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {event.lastReplayStatus || "n/a"}
                        </p>
                        {event.lastReplayError ? (
                            <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{event.lastReplayError}</p>
                        ) : (
                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">No replay error recorded.</p>
                        )}
                    </article>
                </div>
            </AdminDetailSection>

            <div className="grid gap-6 xl:grid-cols-[0.8fr,1.2fr]">
                <AdminDetailSection
                    title="Replay Guidance"
                    description="How to act on this event from the governance console."
                >
                    <div className="space-y-3">
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recommended path</p>
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                Use the focused console view to replay this event, inspect the updated replay counters, and correlate the result with audit history.
                            </p>
                        </article>
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Stored payload size</p>
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                {event.payload.length} characters
                            </p>
                        </article>
                    </div>
                </AdminDetailSection>

                <AdminDetailSection
                    title="Payload Preview"
                    description="Stored webhook JSON body truncated for safe viewing."
                >
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                        {event.payload.slice(0, 4000) || "No payload stored."}
                    </pre>
                </AdminDetailSection>
            </div>
        </AdminDetailShell>
    );
}
