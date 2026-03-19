import { listAuditEvents } from "./audit-events";
import { listGenerationJobs } from "./generation-jobs";
import type { AuditEvent, ObservabilitySnapshot, PlatformAlert, SloMetric } from "@/types";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ALERTS_FALLBACK = 12;

function safeRatioPct(numerator: number, denominator: number) {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 1000) / 10;
}

function resolveOperationHref(event: Pick<AuditEvent, "resourceType" | "resourceId" | "metadata" | "eventType">) {
    const resourceId = (event.resourceId || "").trim();
    if (!resourceId || resourceId === "unknown") return undefined;

    if (event.resourceType === "generationJob" || event.eventType.startsWith("generation.job_")) {
        return `/admin/jobs/${encodeURIComponent(resourceId)}`;
    }
    if (event.resourceType === "releaseTag" || event.eventType.startsWith("workspace.release_")) {
        return `/admin/releases/${encodeURIComponent(resourceId)}`;
    }
    if (event.resourceType === "webhookEvent" || event.eventType.startsWith("stripe.webhook_")) {
        const provider = (event.metadata?.provider || "stripe").toLowerCase();
        if (provider === "stripe") {
            return `/admin/webhooks/stripe/${encodeURIComponent(resourceId)}`;
        }
    }

    return undefined;
}

function buildCriticalAuditAlerts(events: AuditEvent[]): PlatformAlert[] {
    return events
        .filter((event) => event.severity === "critical")
        .map((event) => ({
            id: `alert_audit_${event.id}`,
            severity: "critical",
            title: `Critical audit event: ${event.eventType}`,
            message: event.summary,
            source: "audit",
            createdAt: event.createdAt,
            eventType: event.eventType,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            actionHref: resolveOperationHref(event)
        }));
}

export async function buildObservabilitySnapshot(input?: {
    windowMs?: number;
    maxAlerts?: number;
}): Promise<ObservabilitySnapshot> {
    const generatedAt = Date.now();
    const windowMs = Math.max(60_000, input?.windowMs ?? DEFAULT_WINDOW_MS);
    const cutoff = generatedAt - windowMs;
    const maxAlerts = Math.max(1, Math.min(50, input?.maxAlerts ?? MAX_ALERTS_FALLBACK));

    const [auditEventsRaw, generationJobsRaw] = await Promise.all([
        listAuditEvents(400),
        listGenerationJobs(240)
    ]);

    const auditEvents = auditEventsRaw.filter((event) => event.createdAt >= cutoff);
    const generationJobs = generationJobsRaw.filter((job) => job.updatedAt >= cutoff);
    const completedJobs = generationJobs.filter((job) => job.status === "succeeded" || job.status === "failed");
    const succeededJobs = completedJobs.filter((job) => job.status === "succeeded");
    const failedJobs = completedJobs.filter((job) => job.status === "failed");
    const successRatePct = safeRatioPct(succeededJobs.length, completedJobs.length);

    const webhookReplaySuccess = auditEvents.filter((event) => event.eventType === "stripe.webhook_replayed");
    const webhookReplayFailed = auditEvents.filter((event) => event.eventType === "stripe.webhook_replay_failed");
    const webhookReplayAttempts = webhookReplaySuccess.length + webhookReplayFailed.length;
    const webhookReplayFailurePct = safeRatioPct(webhookReplayFailed.length, webhookReplayAttempts);

    const rollbackEvents = auditEvents.filter((event) => event.eventType === "workspace.release_rolled_back");
    const criticalEvents = auditEvents.filter((event) => event.severity === "critical");

    const metrics: SloMetric[] = [
        {
            key: "generation_success_rate",
            label: "Generation Success Rate",
            value: successRatePct,
            unit: "percent",
            target: ">= 95%",
            status: completedJobs.length === 0
                ? "warning"
                : successRatePct >= 95
                ? "ok"
                : successRatePct >= 85
                ? "warning"
                : "critical",
            sampleSize: completedJobs.length,
            windowMs,
            description: "Succeeded generation jobs divided by completed generation jobs."
        },
        {
            key: "generation_failures",
            label: "Generation Failures",
            value: failedJobs.length,
            unit: "count",
            target: "<= 2",
            status: failedJobs.length <= 2
                ? "ok"
                : failedJobs.length <= 5
                ? "warning"
                : "critical",
            sampleSize: completedJobs.length,
            windowMs,
            description: "Failed generation jobs in the selected time window."
        },
        {
            key: "webhook_replay_failure_rate",
            label: "Webhook Replay Failure Rate",
            value: webhookReplayFailurePct,
            unit: "percent",
            target: "<= 5%",
            status: webhookReplayAttempts === 0
                ? "ok"
                : webhookReplayFailurePct <= 5
                ? "ok"
                : webhookReplayFailurePct <= 20
                ? "warning"
                : "critical",
            sampleSize: webhookReplayAttempts,
            windowMs,
            description: "Failed Stripe webhook replay attempts divided by total replay attempts."
        },
        {
            key: "critical_events",
            label: "Critical Events",
            value: criticalEvents.length,
            unit: "count",
            target: "0",
            status: criticalEvents.length === 0 ? "ok" : "critical",
            sampleSize: auditEvents.length,
            windowMs,
            description: "Audit events with critical severity in the selected time window."
        },
        {
            key: "release_rollbacks",
            label: "Release Rollbacks",
            value: rollbackEvents.length,
            unit: "count",
            target: "<= 1",
            status: rollbackEvents.length <= 1
                ? "ok"
                : rollbackEvents.length <= 3
                ? "warning"
                : "critical",
            sampleSize: auditEvents.length,
            windowMs,
            description: "Release rollback operations in the selected time window."
        }
    ];

    const alerts: PlatformAlert[] = [
        ...buildCriticalAuditAlerts(auditEvents),
        ...failedJobs.slice(0, 4).map((job) => ({
            id: `alert_generation_failed_${job.id}`,
            severity: "warning" as const,
            title: "Generation job failed",
            message: `${job.id} failed${job.errorCode ? ` with ${job.errorCode}` : ""}.`,
            source: "generation" as const,
            createdAt: job.updatedAt,
            eventType: "generation.job_failed",
            resourceType: "generationJob",
            resourceId: job.id,
            actionHref: `/admin/jobs/${encodeURIComponent(job.id)}`
        })),
        ...webhookReplayFailed.slice(0, 4).map((event) => ({
            id: `alert_webhook_replay_failed_${event.id}`,
            severity: event.severity === "critical"
                ? ("critical" as const)
                : ("warning" as const),
            title: "Stripe webhook replay failed",
            message: event.summary,
            source: "webhook" as const,
            createdAt: event.createdAt,
            eventType: event.eventType,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            actionHref: resolveOperationHref(event)
        })),
        ...(rollbackEvents.length > 3
            ? [{
                id: `alert_release_rollback_burst_${generatedAt}`,
                severity: "warning" as const,
                title: "Release rollback spike",
                message: `${rollbackEvents.length} rollback events occurred in this window.`,
                source: "release" as const,
                createdAt: rollbackEvents[0]?.createdAt || generatedAt,
                eventType: "workspace.release_rolled_back",
                resourceType: "releaseTag",
                resourceId: rollbackEvents[0]?.resourceId || ""
            }]
            : [])
    ]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, maxAlerts);

    return {
        generatedAt,
        windowMs,
        metrics,
        alerts
    };
}
