import { AdminConsoleClient } from "@/components/AdminConsoleClient";
import { getAdminCapabilitiesForRole, resolveAdminRole } from "@/lib/admin";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { listAuditEvents, listGovernanceOperationEvents } from "@/lib/data/audit-events";
import { listFeatureFlags } from "@/lib/data/feature-flags";
import { listGenerationJobs } from "@/lib/data/generation-jobs";
import { buildObservabilitySnapshot } from "@/lib/data/observability";
import { listTenants } from "@/lib/data/tenants";
import { listWebhookEvents } from "@/lib/data/webhook-events";
import { listWorkspaceEnvelopeSummaries, listWorkspaceReleaseTags } from "@/lib/data/workspaces";

export default async function AdminPage() {
    const user = await getServerSessionIdentity();
    const email = user?.email || "admin";
    const role = resolveAdminRole({ email: user?.email });
    const capabilities = getAdminCapabilitiesForRole(role);
    const [auditEvents, operationEvents, observabilitySnapshot, featureFlags, jobs, tenants, releases, workspaces, webhookEvents] = await Promise.all([
        listAuditEvents(8),
        listGovernanceOperationEvents(8),
        buildObservabilitySnapshot({
            windowMs: 24 * 60 * 60 * 1000,
            maxAlerts: 10
        }),
        listFeatureFlags(12),
        listGenerationJobs(12),
        listTenants(8),
        listWorkspaceReleaseTags(12),
        listWorkspaceEnvelopeSummaries(12),
        listWebhookEvents({
            provider: "stripe",
            limit: 12
        })
    ]);

    return (
        <AdminConsoleClient
            email={email}
            role={role}
            capabilities={capabilities}
            auditEvents={auditEvents}
            operationEvents={operationEvents}
            observabilitySnapshot={observabilitySnapshot}
            featureFlags={featureFlags}
            jobs={jobs}
            tenants={tenants}
            releases={releases}
            workspaces={workspaces}
            webhookEvents={webhookEvents}
        />
    );
}
