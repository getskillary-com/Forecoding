import { AdminConsoleClient } from "@/components/AdminConsoleClient";
import { getAdminCapabilitiesForRole, resolveAdminRole } from "@/lib/admin";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { listAuditEvents, listGovernanceOperationEvents } from "@/lib/data/audit-events";
import { listFeatureFlags } from "@/lib/data/feature-flags";
import { listGenerationJobs } from "@/lib/data/generation-jobs";
import { buildObservabilitySnapshot } from "@/lib/data/observability";
import { listBillingEvents } from "@/lib/data/billing-events";
import { listOrgs } from "@/lib/data/orgs";
import { listProjectPurchases } from "@/lib/data/purchases";
import { searchAdminTaskRuns } from "@/lib/data/task-runs";
import { listTenants } from "@/lib/data/tenants";
import { listUserProfiles } from "@/lib/data/users";
import { listWebhookEvents } from "@/lib/data/webhook-events";
import { listWorkspaceEnvelopeSummaries, listWorkspaceReleaseTags } from "@/lib/data/workspaces";
import { runRuntimePreflightCheck } from "@/lib/runtime-preflight";

export default async function AdminPage() {
    const user = await getServerSessionIdentity();
    const email = user?.email || "admin";
    const role = resolveAdminRole({ email: user?.email });
    const capabilities = getAdminCapabilitiesForRole(role);
    const runtimePreflight = runRuntimePreflightCheck();
    const [auditEvents, operationEvents, observabilitySnapshot, featureFlags, jobs, taskRuns, billingEvents, purchases, orgs, tenants, users, releases, workspaces, webhookEvents] = await Promise.all([
        listAuditEvents(8),
        listGovernanceOperationEvents(8),
        buildObservabilitySnapshot({
            windowMs: 24 * 60 * 60 * 1000,
            maxAlerts: 10
        }),
        listFeatureFlags(12),
        listGenerationJobs(12),
        searchAdminTaskRuns({ limit: 12 }),
        listBillingEvents({ limit: 12 }),
        listProjectPurchases({ limit: 12 }),
        listOrgs(8),
        listTenants(8),
        listUserProfiles({ limit: 12 }),
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
            runtimePreflight={runtimePreflight}
            auditEvents={auditEvents}
            operationEvents={operationEvents}
            observabilitySnapshot={observabilitySnapshot}
            featureFlags={featureFlags}
            jobs={jobs}
            taskRuns={taskRuns}
            billingEvents={billingEvents}
            purchases={purchases}
            orgs={orgs}
            tenants={tenants}
            users={users.map((item) => ({
                uid: item.uid,
                email: item.email,
                tenantId: item.tenantId ?? null,
                status: item.status,
                statusReason: item.statusReason ?? null,
                name: item.name ?? null,
                sessionVersion: item.sessionVersion,
                statusUpdatedAt: item.statusUpdatedAt?.getTime() ?? null,
                createdAt: item.createdAt?.getTime() ?? null,
                updatedAt: item.updatedAt?.getTime() ?? null
            }))}
            releases={releases}
            workspaces={workspaces}
            webhookEvents={webhookEvents}
        />
    );
}
