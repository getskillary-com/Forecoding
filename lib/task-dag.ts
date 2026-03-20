import type { TaskDefinition, TaskRun } from "@/types";

type TaskValidationIssue = {
    taskId: string;
    message: string;
};

type TaskGraphValidation = {
    issues: TaskValidationIssue[];
    hasCycle: boolean;
    order: TaskDefinition[];
};

export type TaskDagExecutionResult = {
    runs: TaskRun[];
    summary: string;
    counts: {
        succeeded: number;
        failed: number;
        blocked: number;
        queued: number;
    };
    hasCycle: boolean;
    issues: TaskValidationIssue[];
};

function randomId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeId(value: string) {
    return value.trim();
}

function buildTaskMap(taskDefinitions: TaskDefinition[]) {
    const map = new Map<string, TaskDefinition>();
    taskDefinitions.forEach((task) => {
        const id = normalizeId(task.id);
        if (!id) return;
        if (!map.has(id)) {
            map.set(id, {
                ...task,
                id,
                dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map((dep) => normalizeId(dep)).filter(Boolean) : []
            });
        }
    });
    return map;
}

function validateTaskGraph(taskDefinitions: TaskDefinition[]): TaskGraphValidation {
    const taskMap = buildTaskMap(taskDefinitions);
    const issues: TaskValidationIssue[] = [];
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();

    taskMap.forEach((task, id) => {
        indegree.set(id, 0);
        outgoing.set(id, []);
        task.dependsOn.forEach((dependencyId) => {
            if (!taskMap.has(dependencyId)) {
                issues.push({
                    taskId: id,
                    message: `Dependency ${dependencyId} is not defined.`
                });
                return;
            }
            if (dependencyId === id) {
                issues.push({
                    taskId: id,
                    message: "Task cannot depend on itself."
                });
                return;
            }
            indegree.set(id, (indegree.get(id) || 0) + 1);
            outgoing.set(dependencyId, [...(outgoing.get(dependencyId) || []), id]);
        });
    });

    const queue: string[] = Array.from(indegree.entries())
        .filter(([, degree]) => degree === 0)
        .map(([id]) => id);
    const order: TaskDefinition[] = [];

    while (queue.length > 0) {
        const id = queue.shift() as string;
        const task = taskMap.get(id);
        if (task) {
            order.push(task);
        }
        (outgoing.get(id) || []).forEach((nextId) => {
            const nextDegree = (indegree.get(nextId) || 0) - 1;
            indegree.set(nextId, nextDegree);
            if (nextDegree === 0) {
                queue.push(nextId);
            }
        });
    }

    const hasCycle = order.length !== taskMap.size;
    if (hasCycle) {
        const orderedSet = new Set(order.map((task) => task.id));
        taskMap.forEach((_task, taskId) => {
            if (!orderedSet.has(taskId)) {
                issues.push({
                    taskId,
                    message: "Dependency cycle detected."
                });
            }
        });
    }

    return {
        issues,
        hasCycle,
        order
    };
}

function buildRunId(taskId: string) {
    return randomId(`taskrun_${taskId}`);
}

function collectDefinitionIssues(task: TaskDefinition): string[] {
    const issues: string[] = [];
    if (!task.owner?.trim()) {
        issues.push("owner is missing.");
    }
    if (!task.inputSummary?.trim()) {
        issues.push("inputSummary is missing.");
    }
    if (!task.outputSummary?.trim()) {
        issues.push("outputSummary is missing.");
    }
    return issues;
}

function getLatestRunByTask(taskRuns: TaskRun[] | undefined) {
    const latest = new Map<string, TaskRun>();
    (taskRuns || []).forEach((run) => {
        const current = latest.get(run.taskId);
        if (!current || (run.finishedAt || 0) >= (current.finishedAt || 0)) {
            latest.set(run.taskId, run);
        }
    });
    return latest;
}

export function executeTaskDag(input: {
    taskDefinitions: TaskDefinition[] | undefined;
    previousRuns?: TaskRun[] | undefined;
    mode?: "strict" | "retry_failed";
}): TaskDagExecutionResult {
    const taskDefinitions = Array.isArray(input.taskDefinitions) ? input.taskDefinitions : [];
    if (taskDefinitions.length === 0) {
        return {
            runs: [],
            summary: "No task definitions were available for execution.",
            counts: {
                succeeded: 0,
                failed: 0,
                blocked: 0,
                queued: 0
            },
            hasCycle: false,
            issues: []
        };
    }

    const graph = validateTaskGraph(taskDefinitions);
    const graphIssueByTask = new Map<string, string[]>();
    graph.issues.forEach((issue) => {
        graphIssueByTask.set(issue.taskId, [...(graphIssueByTask.get(issue.taskId) || []), issue.message]);
    });

    const latestPrevious = getLatestRunByTask(input.previousRuns);
    const runByTask = new Map<string, TaskRun>();
    const runs: TaskRun[] = [];
    const now = Date.now();
    const mode = input.mode || "strict";

    graph.order.forEach((task, index) => {
        const startedAt = now + index;
        const finishedAt = startedAt + 1;
        const previous = latestPrevious.get(task.id);
        const shouldSkipBecauseSucceeded = mode === "retry_failed" && previous?.status === "succeeded";

        if (shouldSkipBecauseSucceeded) {
            const run: TaskRun = {
                id: buildRunId(task.id),
                taskId: task.id,
                status: "succeeded",
                startedAt,
                finishedAt,
                resultSummary: "Skipped because latest run already succeeded and retry_failed mode is enabled."
            };
            runByTask.set(task.id, run);
            runs.push(run);
            return;
        }

        const dependencyFailures = task.dependsOn.filter((depId) => {
            const depRun = runByTask.get(depId) || latestPrevious.get(depId);
            return !depRun || depRun.status !== "succeeded";
        });
        const definitionIssues = collectDefinitionIssues(task);
        const graphIssues = graphIssueByTask.get(task.id) || [];

        if (dependencyFailures.length > 0) {
            const run: TaskRun = {
                id: buildRunId(task.id),
                taskId: task.id,
                status: "blocked",
                startedAt,
                finishedAt,
                resultSummary: `Blocked by dependency status: ${dependencyFailures.join(", ")}.`,
                remediationHint: "Resolve dependency task failures first, then retry."
            };
            runByTask.set(task.id, run);
            runs.push(run);
            return;
        }

        const allIssues = [...definitionIssues, ...graphIssues];
        if (allIssues.length > 0) {
            const run: TaskRun = {
                id: buildRunId(task.id),
                taskId: task.id,
                status: "failed",
                startedAt,
                finishedAt,
                resultSummary: "Task validation failed before execution.",
                remediationHint: allIssues.join(" ")
            };
            runByTask.set(task.id, run);
            runs.push(run);
            return;
        }

        const run: TaskRun = {
            id: buildRunId(task.id),
            taskId: task.id,
            status: "succeeded",
            startedAt,
            finishedAt,
            resultSummary: task.verifyCommand?.trim()
                ? `Task contract passed. verifyCommand retained for manual or CI execution: ${task.verifyCommand.trim()}`
                : "Task contract passed structural checks."
        };
        runByTask.set(task.id, run);
        runs.push(run);
    });

    if (graph.hasCycle) {
        const cycleTasks = graph.issues
            .filter((issue) => issue.message.includes("cycle"))
            .map((issue) => issue.taskId);
        const existingIds = new Set(runs.map((run) => run.taskId));
        cycleTasks.forEach((taskId) => {
            if (existingIds.has(taskId)) return;
            runs.push({
                id: buildRunId(taskId),
                taskId,
                status: "failed",
                startedAt: now,
                finishedAt: now + 1,
                resultSummary: "Task graph contains a cycle.",
                remediationHint: "Remove cyclical dependencies and retry."
            });
        });
    }

    const counts = runs.reduce((acc, run) => {
        if (run.status === "succeeded") acc.succeeded += 1;
        else if (run.status === "failed") acc.failed += 1;
        else if (run.status === "blocked") acc.blocked += 1;
        else acc.queued += 1;
        return acc;
    }, { succeeded: 0, failed: 0, blocked: 0, queued: 0 });

    const summary = `Task DAG execution completed. succeeded=${counts.succeeded}, failed=${counts.failed}, blocked=${counts.blocked}, queued=${counts.queued}${graph.hasCycle ? ", cycleDetected=true" : ""}.`;

    return {
        runs,
        summary,
        counts,
        hasCycle: graph.hasCycle,
        issues: graph.issues
    };
}
