import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { normalizeProjects } from "@/lib/project-language";
import { executeTaskDag } from "@/lib/task-dag";
import { getWorkspaceByUserId, updateProjectVersionInWorkspaceByUserId } from "@/lib/data/workspaces";
import type { Project, TaskDefinition, TaskRun } from "@/types";

export const runtime = "nodejs";

const ReplayTaskRunsSchema = z.object({
    ownerUserId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    versionId: z.string().trim().min(1),
    mode: z.enum(["strict", "retry_failed"]).default("retry_failed")
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

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "tasks_manage" });
    if (admin.error) return admin.error;

    const payload = ReplayTaskRunsSchema.parse(await req.json());
    const workspace = await getWorkspaceByUserId(payload.ownerUserId);
    const projects = parseProjects(workspace?.projects);
    const resolved = resolveProjectVersion(projects, payload.projectId, payload.versionId);
    if (!resolved) {
        return NextResponse.json(
            { error: "Project version not found for this workspace." },
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

    const runByTask = new Map<string, TaskRun>();
    execution.runs.forEach((run) => {
        runByTask.set(run.taskId, run);
    });

    const persistedEnvelope = await updateProjectVersionInWorkspaceByUserId({
        userId: payload.ownerUserId,
        tenantId: workspace?.tenantId ?? null,
        projectId: payload.projectId,
        versionId: payload.versionId,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null,
        summary: `Admin replayed task DAG (${payload.mode}) for ${payload.projectId}/${payload.versionId}.`,
        kind: "admin",
        mutateVersion: (currentVersion) => {
            const currentTaskRuns = Array.isArray(currentVersion.data.taskRuns) ? currentVersion.data.taskRuns : [];
            const nextTaskRuns = [...currentTaskRuns, ...execution.runs].slice(-500);
            const currentTaskDefinitions = Array.isArray(currentVersion.data.taskDefinitions)
                ? currentVersion.data.taskDefinitions
                : [];

            return {
                ...currentVersion,
                data: {
                    ...currentVersion.data,
                    taskRuns: nextTaskRuns,
                    taskDefinitions: currentTaskDefinitions.map((task) => ({
                        ...task,
                        status: deriveTaskStatusFromRun(runByTask.get(task.id), task.status)
                    }))
                }
            };
        }
    });

    return NextResponse.json({
        ok: true,
        summary: execution.summary,
        counts: execution.counts,
        hasCycle: execution.hasCycle,
        issues: execution.issues,
        runCount: execution.runs.length,
        latestRunByTask: getLatestRunsByTask(execution.runs),
        revision: persistedEnvelope?.revision ?? null,
        role: admin.role
    });
}
