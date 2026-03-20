import { adminDb } from "@/lib/firebase-admin";
import { normalizeWorkspaceEnvelope } from "@/lib/workspace-envelope";
import type { TaskDefinition, TaskRun, WorkspaceEnvelope } from "@/types";

export type AdminTaskRunRecord = {
    id: string;
    ownerUserId: string;
    tenantId: string | null;
    projectId: string;
    projectName: string;
    versionId: string;
    versionName: string;
    taskId: string;
    taskTitle: string;
    taskOwner: string;
    taskDefinitionStatus: TaskDefinition["status"] | null;
    runStatus: TaskRun["status"];
    attempt: number | null;
    startedAt: number | null;
    finishedAt: number | null;
    resultSummary: string | null;
    remediationHint: string | null;
    rollbackExecuted: boolean;
    updatedAt: number;
};

function workspacesCollection() {
    return adminDb.collection("workspaces");
}

function normalizeRunStatus(value: unknown): TaskRun["status"] {
    if (
        value === "running" ||
        value === "succeeded" ||
        value === "failed" ||
        value === "blocked"
    ) {
        return value;
    }
    return "queued";
}

function getTaskDefinitionMap(value: unknown) {
    const map = new Map<string, TaskDefinition>();
    if (!Array.isArray(value)) return map;

    value.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const task = item as TaskDefinition;
        if (!task.id || typeof task.id !== "string") return;
        map.set(task.id, task);
    });
    return map;
}

function extractTaskRunsFromEnvelope(envelope: WorkspaceEnvelope): AdminTaskRunRecord[] {
    const records: AdminTaskRunRecord[] = [];

    envelope.projects.forEach((project) => {
        project.versions.forEach((version) => {
            const taskRunsRaw = version.data?.taskRuns;
            if (!Array.isArray(taskRunsRaw) || taskRunsRaw.length === 0) return;

            const taskDefinitionMap = getTaskDefinitionMap(version.data?.taskDefinitions);
            taskRunsRaw.forEach((item, index) => {
                if (!item || typeof item !== "object") return;
                const run = item as TaskRun;
                const taskId = typeof run.taskId === "string" ? run.taskId.trim() : "";
                if (!taskId) return;

                const runId = typeof run.id === "string" && run.id.trim()
                    ? run.id.trim()
                    : `${version.id}_${taskId}_${index}`;
                const taskDefinition = taskDefinitionMap.get(taskId);
                const startedAt = typeof run.startedAt === "number" ? run.startedAt : null;
                const finishedAt = typeof run.finishedAt === "number" ? run.finishedAt : null;
                const updatedAt = finishedAt || startedAt || version.createdAt || project.updatedAt || envelope.updatedAt;

                records.push({
                    id: `${envelope.ownerUserId}:${project.id}:${version.id}:${runId}`,
                    ownerUserId: envelope.ownerUserId,
                    tenantId: envelope.tenantId ?? null,
                    projectId: project.id,
                    projectName: project.name || project.id,
                    versionId: version.id,
                    versionName: version.name || version.id,
                    taskId,
                    taskTitle: taskDefinition?.title || taskId,
                    taskOwner: taskDefinition?.owner || "unknown",
                    taskDefinitionStatus: taskDefinition?.status || null,
                    runStatus: normalizeRunStatus(run.status),
                    attempt: typeof run.attempt === "number" ? run.attempt : null,
                    startedAt,
                    finishedAt,
                    resultSummary: typeof run.resultSummary === "string" ? run.resultSummary : null,
                    remediationHint: typeof run.remediationHint === "string" ? run.remediationHint : null,
                    rollbackExecuted: run.rollbackExecuted === true,
                    updatedAt
                });
            });
        });
    });

    return records;
}

export async function searchAdminTaskRuns(input?: {
    limit?: number;
    status?: TaskRun["status"] | "";
    ownerUserId?: string;
    tenantId?: string;
    query?: string;
}): Promise<AdminTaskRunRecord[]> {
    const status = (input?.status || "").trim().toLowerCase();
    const ownerUserId = (input?.ownerUserId || "").trim();
    const tenantId = (input?.tenantId || "").trim();
    const query = (input?.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, input?.limit ?? 40));
    const scanLimit = Math.max(40, Math.min(240, limit * 8));

    const snap = await workspacesCollection()
        .orderBy("updatedAt", "desc")
        .limit(scanLimit)
        .get();

    return snap.docs
        .flatMap((doc) => {
            const envelope = normalizeWorkspaceEnvelope(doc.data() || {}, doc.id);
            return extractTaskRunsFromEnvelope(envelope);
        })
        .filter((record) => {
            if (status && record.runStatus.toLowerCase() !== status) return false;
            if (ownerUserId && record.ownerUserId !== ownerUserId) return false;
            if (tenantId && (record.tenantId || "") !== tenantId) return false;
            if (query) {
                const haystack = [
                    record.id,
                    record.ownerUserId,
                    record.tenantId || "",
                    record.projectId,
                    record.projectName,
                    record.versionId,
                    record.versionName,
                    record.taskId,
                    record.taskTitle,
                    record.taskOwner,
                    record.taskDefinitionStatus || "",
                    record.runStatus,
                    record.resultSummary || "",
                    record.remediationHint || ""
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        })
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, limit);
}
