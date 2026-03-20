import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerUser } from "@/lib/server-auth";
import { normalizeProjects } from "@/lib/project-language";
import { executeTaskDag } from "@/lib/task-dag";
import {
    appendProgressEvents,
    createProgressEvent,
    isProgressTemplateEnabled,
    resolveProgressCursor
} from "@/lib/progress-template";
import {
    getWorkspaceByUserId,
    updateProjectVersionInWorkspaceByUserId,
    WorkspaceRevisionConflictError
} from "@/lib/data/workspaces";
import type { Project, TaskDefinition, TaskRun } from "@/types";

export const runtime = "nodejs";

const RunTasksSchema = z.object({
    projectId: z.string().trim().min(1),
    versionId: z.string().trim().min(1),
    mode: z.enum(["strict", "retry_failed"]).default("strict"),
    persist: z.boolean().default(true),
    workspaceSnapshotId: z.string().trim().min(1).max(220).optional(),
    expectedRevision: z.number().int().min(0).optional()
});

function parseProjects(raw: unknown): Project[] {
    return normalizeProjects(raw);
}

function resolveProjectVersion(projects: Project[], projectId: string, versionId: string) {
    for (const project of projects) {
        if (project.id !== projectId) continue;
        const version = project.versions.find((candidate) => candidate.id === versionId) || null;
        if (version) {
            return { project, version };
        }
    }
    return null;
}

function getLatestRunsByTask(taskRuns: TaskRun[]) {
    const latest = new Map<string, TaskRun>();
    taskRuns.forEach((run) => {
        const current = latest.get(run.taskId);
        if (!current || (run.finishedAt || 0) >= (current.finishedAt || 0)) {
            latest.set(run.taskId, run);
        }
    });
    return Object.fromEntries(latest.entries());
}

function deriveTaskStatusFromRun(run: TaskRun | undefined, fallback: TaskDefinition["status"]) {
    if (!run) return fallback;
    if (run.status === "succeeded") return "ready" as const;
    if (run.status === "failed" || run.status === "blocked") return "blocked" as const;
    return "pending" as const;
}

function resolveWorkspaceSnapshotForTaskRun(input: {
    requestedSnapshotId?: string;
    snapshotList: Array<{ id: string; projectIds?: string[]; activeVersionIds?: string[] }>;
    projectId: string;
}) {
    const requestedSnapshotId = (input.requestedSnapshotId || "").trim();
    const snapshots = input.snapshotList;
    const preferredSnapshot = requestedSnapshotId
        ? snapshots.find((snapshot) => snapshot.id === requestedSnapshotId) || null
        : null;
    if (requestedSnapshotId && !preferredSnapshot) {
        return {
            ok: false as const,
            error: "Requested workspaceSnapshotId was not found in the current workspace envelope.",
            status: 409
        };
    }

    const selectedSnapshot = preferredSnapshot || snapshots[0] || null;
    if (!selectedSnapshot) {
        return {
            ok: true as const,
            snapshotId: null,
            versionInSnapshot: null
        };
    }

    if (Array.isArray(selectedSnapshot.projectIds) && selectedSnapshot.projectIds.length > 0) {
        if (!selectedSnapshot.projectIds.includes(input.projectId)) {
            return {
                ok: false as const,
                error: "Requested task run project is not part of the selected workspace snapshot.",
                status: 409
            };
        }
    }

    return {
        ok: true as const,
        snapshotId: selectedSnapshot.id,
        versionInSnapshot:
            Array.isArray(selectedSnapshot.activeVersionIds) && selectedSnapshot.activeVersionIds.length > 0
                ? selectedSnapshot.activeVersionIds
                : null
    };
}

export async function GET(req: Request) {
    try {
        const user = await getServerUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const projectId = (url.searchParams.get("projectId") || "").trim();
        const versionId = (url.searchParams.get("versionId") || "").trim();
        if (!projectId || !versionId) {
            return NextResponse.json(
                { error: "projectId and versionId are required." },
                { status: 400 }
            );
        }

        const workspace = await getWorkspaceByUserId(user.uid);
        const projects = parseProjects(workspace?.projects);
        const resolved = resolveProjectVersion(projects, projectId, versionId);
        if (!resolved) {
            return NextResponse.json(
                { error: "Project version not found." },
                { status: 404 }
            );
        }

        const taskDefinitions = Array.isArray(resolved.version.data.taskDefinitions)
            ? resolved.version.data.taskDefinitions
            : [];
        const taskRuns = Array.isArray(resolved.version.data.taskRuns)
            ? resolved.version.data.taskRuns
            : [];

        return NextResponse.json({
            ok: true,
            projectId,
            versionId,
            taskDefinitions,
            taskRuns,
            latestRunByTask: getLatestRunsByTask(taskRuns)
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load workspace tasks.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const payload = RunTasksSchema.parse(await req.json());
        const workspace = await getWorkspaceByUserId(user.uid);
        const currentRevision = workspace?.revision ?? null;
        if (typeof payload.expectedRevision === "number" && currentRevision !== payload.expectedRevision) {
            return NextResponse.json(
                {
                    error: "Workspace revision conflict.",
                    code: "WORKSPACE_REVISION_CONFLICT",
                    revision: currentRevision
                },
                { status: 409 }
            );
        }
        const snapshotResolution = resolveWorkspaceSnapshotForTaskRun({
            requestedSnapshotId: payload.workspaceSnapshotId,
            snapshotList: workspace?.envelope?.snapshots || [],
            projectId: payload.projectId
        });
        if (!snapshotResolution.ok) {
            return NextResponse.json(
                {
                    error: snapshotResolution.error,
                    code: "WORKSPACE_SNAPSHOT_MISMATCH",
                    revision: currentRevision
                },
                { status: snapshotResolution.status }
            );
        }
        const projects = parseProjects(workspace?.projects);
        const resolved = resolveProjectVersion(projects, payload.projectId, payload.versionId);
        if (!resolved) {
            return NextResponse.json(
                { error: "Project version not found." },
                { status: 404 }
            );
        }

        const taskDefinitions = Array.isArray(resolved.version.data.taskDefinitions)
            ? resolved.version.data.taskDefinitions
            : [];
        const previousRuns = Array.isArray(resolved.version.data.taskRuns)
            ? resolved.version.data.taskRuns
            : [];
        const execution = executeTaskDag({
            taskDefinitions,
            previousRuns,
            mode: payload.mode
        });

        if (!payload.persist) {
            return NextResponse.json({
                ok: true,
                persisted: false,
                ...execution,
                latestRunByTask: getLatestRunsByTask(execution.runs),
                workspaceSnapshotId: snapshotResolution.snapshotId,
                revision: currentRevision
            });
        }

        const runByTask = new Map<string, TaskRun>();
        execution.runs.forEach((run) => {
            runByTask.set(run.taskId, run);
        });

        const persistedEnvelope = await updateProjectVersionInWorkspaceByUserId({
            userId: user.uid,
            tenantId: user.tenantId ?? null,
            projectId: payload.projectId,
            versionId: payload.versionId,
            expectedRevision: payload.expectedRevision,
            actorId: user.uid,
            actorEmail: user.email,
            summary: `Executed task DAG (${payload.mode}) for ${payload.projectId}/${payload.versionId} on snapshot ${snapshotResolution.snapshotId || "n/a"}.`,
            kind: "project_update",
            mutateVersion: (currentVersion) => {
                const currentTaskRuns = Array.isArray(currentVersion.data.taskRuns) ? currentVersion.data.taskRuns : [];
                const nextTaskRuns = [...currentTaskRuns, ...execution.runs].slice(-500);
                const currentTaskDefinitions = Array.isArray(currentVersion.data.taskDefinitions)
                    ? currentVersion.data.taskDefinitions
                    : [];
                const progressEvents = isProgressTemplateEnabled(currentVersion.data.progressTemplateVersion)
                    ? appendProgressEvents(
                        currentVersion.data.progressEvents || [],
                        [
                            createProgressEvent({
                                type: "task.run.updated",
                                projectId: payload.projectId,
                                versionId: payload.versionId,
                                summary: execution.summary,
                                metadata: {
                                    succeeded: String(execution.counts.succeeded),
                                    failed: String(execution.counts.failed),
                                    blocked: String(execution.counts.blocked)
                                }
                            })
                        ]
                    )
                    : currentVersion.data.progressEvents;

                return {
                    ...currentVersion,
                    data: {
                        ...currentVersion.data,
                        taskRuns: nextTaskRuns,
                        taskDefinitions: currentTaskDefinitions.map((task) => ({
                            ...task,
                            status: deriveTaskStatusFromRun(runByTask.get(task.id), task.status)
                        })),
                        progressEvents,
                        progressCursor:
                            isProgressTemplateEnabled(currentVersion.data.progressTemplateVersion)
                                ? resolveProgressCursor(progressEvents || [])
                                : currentVersion.data.progressCursor
                    }
                };
            }
        });

        return NextResponse.json({
            ok: true,
            persisted: Boolean(persistedEnvelope),
            summary: execution.summary,
            counts: execution.counts,
            hasCycle: execution.hasCycle,
            issues: execution.issues,
            runCount: execution.runs.length,
            latestRunByTask: getLatestRunsByTask(execution.runs),
            workspaceSnapshotId: snapshotResolution.snapshotId,
            revision: persistedEnvelope?.revision ?? null
        });
    } catch (error) {
        if (error instanceof WorkspaceRevisionConflictError) {
            return NextResponse.json(
                {
                    error: "Workspace revision conflict.",
                    code: "WORKSPACE_REVISION_CONFLICT",
                    revision: error.currentEnvelope.revision,
                    workspace: error.currentEnvelope
                },
                { status: 409 }
            );
        }
        const message = error instanceof Error ? error.message : "Failed to execute workspace task DAG.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
