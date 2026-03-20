#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
    const args = {
        baseUrl: process.env.ADMIN_SMOKE_BASE_URL || "http://127.0.0.1:3000",
        cookie: process.env.ADMIN_SMOKE_COOKIE || "",
        timeoutMs: Number.parseInt(process.env.ADMIN_SMOKE_TIMEOUT_MS || "10000", 10),
        spawnDevServer: process.env.ADMIN_SMOKE_SPAWN_DEV_SERVER === "1",
        port: Number.parseInt(process.env.ADMIN_SMOKE_PORT || "4040", 10),
        allowMutations: process.env.ADMIN_SMOKE_ALLOW_MUTATIONS === "1",
        replayEventId: process.env.ADMIN_SMOKE_REPLAY_EVENT_ID || "",
        rollbackOwnerUserId: process.env.ADMIN_SMOKE_ROLLBACK_OWNER_USER_ID || "",
        rollbackReleaseTagId: process.env.ADMIN_SMOKE_ROLLBACK_RELEASE_TAG_ID || "",
        explicitJobId: process.env.ADMIN_SMOKE_JOB_ID || "",
        explicitReleaseId: process.env.ADMIN_SMOKE_RELEASE_ID || "",
        explicitWebhookId: process.env.ADMIN_SMOKE_WEBHOOK_EVENT_ID || "",
        help: false
    };

    for (let index = 2; index < argv.length; index += 1) {
        const current = argv[index];
        const next = argv[index + 1];

        if (current === "--help" || current === "-h") {
            args.help = true;
            continue;
        }
        if (current === "--base-url" && next) {
            args.baseUrl = next;
            index += 1;
            continue;
        }
        if (current === "--cookie" && next) {
            args.cookie = next;
            index += 1;
            continue;
        }
        if (current === "--timeout-ms" && next) {
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed >= 1000) {
                args.timeoutMs = parsed;
            }
            index += 1;
            continue;
        }
        if (current === "--spawn-dev-server") {
            args.spawnDevServer = true;
            continue;
        }
        if (current === "--port" && next) {
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                args.port = parsed;
            }
            index += 1;
            continue;
        }
        if (current === "--allow-mutations") {
            args.allowMutations = true;
            continue;
        }
        if (current === "--replay-event-id" && next) {
            args.replayEventId = next;
            index += 1;
            continue;
        }
        if (current === "--rollback-owner-user-id" && next) {
            args.rollbackOwnerUserId = next;
            index += 1;
            continue;
        }
        if (current === "--rollback-release-tag-id" && next) {
            args.rollbackReleaseTagId = next;
            index += 1;
            continue;
        }
        if (current === "--job-id" && next) {
            args.explicitJobId = next;
            index += 1;
            continue;
        }
        if (current === "--release-id" && next) {
            args.explicitReleaseId = next;
            index += 1;
            continue;
        }
        if (current === "--webhook-event-id" && next) {
            args.explicitWebhookId = next;
            index += 1;
            continue;
        }
    }

    return args;
}

function printHelp() {
    process.stdout.write(
        [
            "Usage: node scripts/smoke-admin-api.mjs [options]",
            "",
            "Options:",
            "  --base-url <url>                Base URL for API checks (default: ADMIN_SMOKE_BASE_URL or http://127.0.0.1:3000)",
            "  --cookie <cookie-header>        Admin session cookie. If omitted, script runs unauthenticated smoke checks.",
            "  --timeout-ms <ms>               Per-request timeout in milliseconds (default: 10000)",
            "  --spawn-dev-server              Start next dev server automatically before running checks",
            "  --port <port>                   Dev server port when using --spawn-dev-server (default: 4040)",
            "  --job-id <id>                   Optional explicit job id for detail check",
            "  --release-id <id>               Optional explicit release id for detail check",
            "  --webhook-event-id <id>         Optional explicit Stripe webhook event id for detail check",
            "  --allow-mutations               Enable mutation checks (replay/rollback) when inputs are present",
            "  --replay-event-id <id>          Stripe event id for /api/admin/webhooks/stripe/replay",
            "  --rollback-owner-user-id <uid>  Workspace owner user id for /api/admin/releases/rollback",
            "  --rollback-release-tag-id <id>  Release tag id for /api/admin/releases/rollback",
            "  --help                          Show this message",
            "",
            "Environment variable equivalents:",
            "  ADMIN_SMOKE_BASE_URL, ADMIN_SMOKE_COOKIE, ADMIN_SMOKE_TIMEOUT_MS",
            "  ADMIN_SMOKE_SPAWN_DEV_SERVER=1, ADMIN_SMOKE_PORT",
            "  ADMIN_SMOKE_JOB_ID, ADMIN_SMOKE_RELEASE_ID, ADMIN_SMOKE_WEBHOOK_EVENT_ID",
            "  ADMIN_SMOKE_ALLOW_MUTATIONS=1, ADMIN_SMOKE_REPLAY_EVENT_ID",
            "  ADMIN_SMOKE_ROLLBACK_OWNER_USER_ID, ADMIN_SMOKE_ROLLBACK_RELEASE_TAG_ID",
            ""
        ].join("\n")
    );
}

function normalizeBaseUrl(baseUrl) {
    const trimmed = String(baseUrl || "").trim();
    if (!trimmed) {
        throw new Error("Base URL cannot be empty.");
    }
    return trimmed.replace(/\/+$/, "");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimOutput(text, maxChars = 6000) {
    const normalized = String(text || "").trim();
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return normalized.slice(normalized.length - maxChars);
}

function createOutputCollector() {
    const buffer = [];
    return {
        push(chunk) {
            const text = String(chunk || "");
            if (!text) return;
            buffer.push(text);
            if (buffer.length > 400) {
                buffer.splice(0, buffer.length - 400);
            }
        },
        read() {
            return trimOutput(buffer.join(""));
        }
    };
}

function quoteForCmdArg(value) {
    if (!value) return '""';
    const escaped = String(value).replace(/"/g, '""');
    if (/[ \t&()^<>|]/.test(String(value))) {
        return `"${escaped}"`;
    }
    return escaped;
}

function killProcessTree(child, signal) {
    if (!child || typeof child.pid !== "number" || child.pid <= 0) {
        return false;
    }

    if (process.platform !== "win32") {
        try {
            process.kill(-child.pid, signal);
            return true;
        } catch {
            // Fall back to direct process signal when group signaling fails.
        }
    }

    try {
        process.kill(child.pid, signal);
        return true;
    } catch {
        return false;
    }
}

function spawnDevServer(port) {
    const child = process.platform === "win32"
        ? spawn(
            "cmd.exe",
            [
                "/d",
                "/s",
                "/c",
                [
                    "npm",
                    "run",
                    "dev",
                    "--",
                    "--port",
                    String(port),
                    "--hostname",
                    "127.0.0.1"
                ].map((part) => quoteForCmdArg(part)).join(" ")
            ],
            {
                cwd: projectRoot,
                env: {
                    ...process.env,
                    NEXT_TELEMETRY_DISABLED: "1"
                },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true
            }
        )
        : spawn(
            "npm",
            ["run", "dev", "--", "--port", String(port), "--hostname", "127.0.0.1"],
            {
                cwd: projectRoot,
                env: {
                    ...process.env,
                    NEXT_TELEMETRY_DISABLED: "1"
                },
                stdio: ["ignore", "pipe", "pipe"],
                detached: true,
                windowsHide: true
            }
        );

    const output = createOutputCollector();
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));

    return { child, output };
}

async function waitForServer(url, timeoutMs, readLogs, getExitState) {
    const start = Date.now();
    let lastError = "";

    while (Date.now() - start < timeoutMs) {
        const exitState = getExitState();
        if (exitState.exited) {
            const logs = readLogs();
            throw new Error(
                `Dev server exited before becoming ready (exitCode=${String(exitState.code)} signal=${String(exitState.signal)}).\n\nRecent logs:\n${logs || "(no output)"}`
            );
        }

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: { accept: "application/json" }
            });

            if (response.status >= 200 && response.status < 500) {
                return;
            }

            lastError = `Unexpected readiness status: ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }

        await sleep(1000);
    }

    const logs = readLogs();
    throw new Error(
        `Timed out waiting for dev server at ${url}. Last error: ${lastError || "unknown"}\n\nRecent logs:\n${logs || "(no output)"}`
    );
}

function terminateProcess(child) {
    if (!child || child.exitCode !== null) {
        return Promise.resolve();
    }

    if (process.platform === "win32") {
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
                stdio: "ignore",
                windowsHide: true
            });
            const timeout = setTimeout(finish, 10_000);
            killer.on("close", () => {
                clearTimeout(timeout);
                finish();
            });
            killer.on("error", () => {
                clearTimeout(timeout);
                finish();
            });
        });
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            child.stdout?.destroy();
            child.stderr?.destroy();
            resolve();
        };
        const hardTimeout = setTimeout(() => {
            if (child.exitCode === null) {
                killProcessTree(child, "SIGKILL");
            }
            finish();
        }, 10_000);

        child.once("close", () => {
            clearTimeout(hardTimeout);
            finish();
        });
        try {
            killProcessTree(child, "SIGTERM");
        } catch {
            clearTimeout(hardTimeout);
            finish();
            return;
        }
        setTimeout(() => {
            if (child.exitCode === null) {
                killProcessTree(child, "SIGKILL");
            }
        }, 3000);
    });
}

function formatPayload(payload) {
    if (payload === null || payload === undefined) return "(empty)";
    try {
        const serialized = JSON.stringify(payload);
        return serialized.length > 1200 ? `${serialized.slice(0, 1200)}...` : serialized;
    } catch {
        return String(payload);
    }
}

async function requestJson(baseUrl, path, options) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${baseUrl}${path}`, {
            method: options.method || "GET",
            headers: options.headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal
        });

        const raw = await response.text();
        let payload = null;
        try {
            payload = raw ? JSON.parse(raw) : null;
        } catch {
            payload = null;
        }

        return {
            status: response.status,
            ok: response.ok,
            payload,
            raw
        };
    } finally {
        clearTimeout(timer);
    }
}

function assertJsonObject(value, context) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${context} must return a JSON object.`);
    }
}

function assertStatus(result, expectedStatuses, context) {
    if (!expectedStatuses.includes(result.status)) {
        throw new Error(
            `${context} returned status ${result.status}, expected ${expectedStatuses.join(" or ")}.\nPayload: ${formatPayload(result.payload)}`
        );
    }
}

function assertString(value, context) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${context} must be a non-empty string.`);
    }
}

function assertFiniteNumber(value, context) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${context} must be a finite number.`);
    }
}

function assertStringArray(value, context) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`${context} must be an array of strings.`);
    }
}

function assertDiffList(value, context) {
    assertJsonObject(value, context);
    assertStringArray(value.added, `${context}.added`);
    assertStringArray(value.removed, `${context}.removed`);
    assertStringArray(value.changed, `${context}.changed`);
}

function assertStatusDiffList(value, context) {
    assertDiffList(value, context);
    assertStringArray(value.statusChanged, `${context}.statusChanged`);
}

function assertRuntimePreflightShape(value, context) {
    assertJsonObject(value, context);
    assertFiniteNumber(value.checkedAt, `${context}.checkedAt`);
    if (typeof value.pass !== "boolean") {
        throw new Error(`${context}.pass must be a boolean.`);
    }
    if (!Array.isArray(value.issues)) {
        throw new Error(`${context}.issues must be an array.`);
    }
    value.issues.forEach((issue, index) => {
        assertJsonObject(issue, `${context}.issues[${index}]`);
        assertString(issue.code, `${context}.issues[${index}].code`);
        assertString(issue.message, `${context}.issues[${index}].message`);
        if (issue.severity !== "error" && issue.severity !== "warning") {
            throw new Error(`${context}.issues[${index}].severity must be "error" or "warning".`);
        }
        if (issue.envKey !== undefined && issue.envKey !== null && typeof issue.envKey !== "string") {
            throw new Error(`${context}.issues[${index}].envKey must be a string when provided.`);
        }
    });
}

function assertWorkspaceRevisionShape(value, context) {
    assertJsonObject(value, context);
    assertString(value.revisionId, `${context}.revisionId`);
    assertFiniteNumber(value.revisionNumber, `${context}.revisionNumber`);
    assertString(value.snapshotId, `${context}.snapshotId`);
    assertFiniteNumber(value.createdAt, `${context}.createdAt`);
    assertString(value.summary, `${context}.summary`);
    assertString(value.kind, `${context}.kind`);
    assertFiniteNumber(value.projectCount, `${context}.projectCount`);
    assertFiniteNumber(value.activeVersionCount, `${context}.activeVersionCount`);
    if (typeof value.hasSnapshotPayload !== "boolean") {
        throw new Error(`${context}.hasSnapshotPayload must be a boolean.`);
    }
}

function assertWorkspaceOverviewShape(value, context) {
    assertJsonObject(value, context);
    assertString(value.ownerUserId, `${context}.ownerUserId`);
    if (value.tenantId !== null && value.tenantId !== undefined && typeof value.tenantId !== "string") {
        throw new Error(`${context}.tenantId must be null or string.`);
    }
    assertFiniteNumber(value.revision, `${context}.revision`);
    assertFiniteNumber(value.projectCount, `${context}.projectCount`);
    assertFiniteNumber(value.updatedAt, `${context}.updatedAt`);
    if (!Array.isArray(value.revisions)) {
        throw new Error(`${context}.revisions must be an array.`);
    }
    value.revisions.forEach((revision, index) => {
        assertWorkspaceRevisionShape(revision, `${context}.revisions[${index}]`);
    });
}

function assertWorkspaceDiffShape(value, context) {
    assertJsonObject(value, context);
    assertString(value.ownerUserId, `${context}.ownerUserId`);
    if (value.tenantId !== null && value.tenantId !== undefined && typeof value.tenantId !== "string") {
        throw new Error(`${context}.tenantId must be null or string.`);
    }
    assertWorkspaceRevisionShape(value.source, `${context}.source`);
    assertWorkspaceRevisionShape(value.target, `${context}.target`);
    assertJsonObject(value.impact, `${context}.impact`);

    assertDiffList(value.impact.projectIds, `${context}.impact.projectIds`);
    assertDiffList(value.impact.activeVersionIds, `${context}.impact.activeVersionIds`);
    assertDiffList(value.impact.modules, `${context}.impact.modules`);
    assertDiffList(value.impact.routes, `${context}.impact.routes`);
    assertDiffList(value.impact.contracts, `${context}.impact.contracts`);
    assertDiffList(value.impact.tests, `${context}.impact.tests`);
    assertStatusDiffList(value.impact.requirements, `${context}.impact.requirements`);
    assertStatusDiffList(value.impact.assumptions, `${context}.impact.assumptions`);
    assertStatusDiffList(value.impact.acceptanceCases, `${context}.impact.acceptanceCases`);
    assertStatusDiffList(value.impact.taskDefinitions, `${context}.impact.taskDefinitions`);

    assertJsonObject(value.impact.taskRuns, `${context}.impact.taskRuns`);
    assertFiniteNumber(value.impact.taskRuns.sourceCount, `${context}.impact.taskRuns.sourceCount`);
    assertFiniteNumber(value.impact.taskRuns.targetCount, `${context}.impact.taskRuns.targetCount`);
    assertJsonObject(value.impact.taskRuns.statusDelta, `${context}.impact.taskRuns.statusDelta`);
    ["queued", "running", "succeeded", "failed", "blocked"].forEach((statusKey) => {
        assertFiniteNumber(
            value.impact.taskRuns.statusDelta[statusKey],
            `${context}.impact.taskRuns.statusDelta.${statusKey}`
        );
    });

    assertJsonObject(value.impact.billing, `${context}.impact.billing`);
    assertFiniteNumber(value.impact.billing.sourceEventCount, `${context}.impact.billing.sourceEventCount`);
    assertFiniteNumber(value.impact.billing.targetEventCount, `${context}.impact.billing.targetEventCount`);
    assertStringArray(value.impact.billing.addedEvents, `${context}.impact.billing.addedEvents`);
    assertStringArray(value.impact.billing.removedEvents, `${context}.impact.billing.removedEvents`);
    if (!Array.isArray(value.impact.billing.paymentStatusChanged)) {
        throw new Error(`${context}.impact.billing.paymentStatusChanged must be an array.`);
    }
    value.impact.billing.paymentStatusChanged.forEach((item, index) => {
        assertJsonObject(item, `${context}.impact.billing.paymentStatusChanged[${index}]`);
        assertString(item.projectId, `${context}.impact.billing.paymentStatusChanged[${index}].projectId`);
        if (!["paid", "unpaid", "unknown"].includes(item.sourceStatus)) {
            throw new Error(`${context}.impact.billing.paymentStatusChanged[${index}].sourceStatus must be paid|unpaid|unknown.`);
        }
        if (!["paid", "unpaid", "unknown"].includes(item.targetStatus)) {
            throw new Error(`${context}.impact.billing.paymentStatusChanged[${index}].targetStatus must be paid|unpaid|unknown.`);
        }
    });
}

function logPass(message) {
    process.stdout.write(`PASS ${message}\n`);
}

function logSkip(message) {
    process.stdout.write(`SKIP ${message}\n`);
}

async function runUnauthenticatedChecks(baseUrl, timeoutMs) {
    const protectedPaths = [
        "/api/admin/status",
        "/api/admin/jobs?limit=1",
        "/api/admin/orgs",
        "/api/admin/users?limit=1",
        "/api/admin/workspaces/smoke-owner",
        "/api/admin/workspaces/smoke-owner/diff",
        "/api/admin/tasks/runs?limit=1",
        "/api/admin/billing/events?limit=1",
        "/api/admin/billing/purchases?limit=1",
        "/api/admin/releases",
        "/api/admin/webhooks/stripe?limit=1",
        "/api/admin/audit?limit=1"
    ];

    for (const path of protectedPaths) {
        const result = await requestJson(baseUrl, path, {
            timeoutMs,
            headers: {
                accept: "application/json"
            }
        });
        assertStatus(result, [401], `Unauthenticated GET ${path}`);
        assertJsonObject(result.payload, `Unauthenticated GET ${path}`);
        if (result.payload.error !== "Unauthorized") {
            throw new Error(`Unauthenticated GET ${path} expected error "Unauthorized", received ${formatPayload(result.payload)}.`);
        }
        logPass(`Unauthenticated GET ${path} returned 401 as expected.`);
    }

    const protectedMutations = [
        {
            path: "/api/admin/releases/approve",
            body: {
                ownerUserId: "smoke-owner",
                releaseTagId: "smoke-release",
                decision: "approved"
            }
        },
        {
            path: "/api/admin/releases/rollback",
            body: {
                ownerUserId: "smoke-owner",
                releaseTagId: "smoke-release"
            }
        },
        {
            path: "/api/admin/webhooks/stripe/replay",
            body: {
                eventId: "evt_smoke"
            }
        },
        {
            path: "/api/admin/tasks/runs/replay",
            body: {
                ownerUserId: "smoke-owner",
                projectId: "smoke-project",
                versionId: "smoke-version",
                mode: "retry_failed"
            }
        }
    ];

    for (const mutation of protectedMutations) {
        const result = await requestJson(baseUrl, mutation.path, {
            timeoutMs,
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/json"
            },
            body: mutation.body
        });
        assertStatus(result, [401], `Unauthenticated POST ${mutation.path}`);
        assertJsonObject(result.payload, `Unauthenticated POST ${mutation.path}`);
        if (result.payload.error !== "Unauthorized") {
            throw new Error(`Unauthenticated POST ${mutation.path} expected error "Unauthorized", received ${formatPayload(result.payload)}.`);
        }
        logPass(`Unauthenticated POST ${mutation.path} returned 401 as expected.`);
    }
}

async function runAuthenticatedChecks(baseUrl, timeoutMs, cookie, options) {
    const headers = {
        accept: "application/json",
        cookie
    };

    const status = await requestJson(baseUrl, "/api/admin/status", { timeoutMs, headers });
    assertStatus(status, [200], "GET /api/admin/status");
    assertJsonObject(status.payload, "GET /api/admin/status");
    if (!status.payload.ok) {
        throw new Error(`GET /api/admin/status expected ok=true, received ${formatPayload(status.payload)}.`);
    }
    if (!Array.isArray(status.payload.capabilities)) {
        throw new Error(`GET /api/admin/status expected capabilities array, received ${formatPayload(status.payload)}.`);
    }
    assertRuntimePreflightShape(status.payload.runtimePreflight, "GET /api/admin/status runtimePreflight");
    logPass(`Authenticated GET /api/admin/status returned role=${status.payload.adminRole || "unknown"}.`);

    const jobsResult = await requestJson(baseUrl, "/api/admin/jobs?limit=5", { timeoutMs, headers });
    assertStatus(jobsResult, [200], "GET /api/admin/jobs");
    assertJsonObject(jobsResult.payload, "GET /api/admin/jobs");
    if (!Array.isArray(jobsResult.payload.jobs)) {
        throw new Error(`GET /api/admin/jobs expected jobs array, received ${formatPayload(jobsResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/jobs returned ${jobsResult.payload.jobs.length} jobs.`);

    const releasesResult = await requestJson(baseUrl, "/api/admin/releases", { timeoutMs, headers });
    assertStatus(releasesResult, [200], "GET /api/admin/releases");
    assertJsonObject(releasesResult.payload, "GET /api/admin/releases");
    if (!Array.isArray(releasesResult.payload.releases)) {
        throw new Error(`GET /api/admin/releases expected releases array, received ${formatPayload(releasesResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/releases returned ${releasesResult.payload.releases.length} releases.`);

    const orgsResult = await requestJson(baseUrl, "/api/admin/orgs", { timeoutMs, headers });
    assertStatus(orgsResult, [200], "GET /api/admin/orgs");
    assertJsonObject(orgsResult.payload, "GET /api/admin/orgs");
    if (!Array.isArray(orgsResult.payload.orgs)) {
        throw new Error(`GET /api/admin/orgs expected orgs array, received ${formatPayload(orgsResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/orgs returned ${orgsResult.payload.orgs.length} organizations.`);

    const usersResult = await requestJson(baseUrl, "/api/admin/users?limit=5", { timeoutMs, headers });
    assertStatus(usersResult, [200], "GET /api/admin/users");
    assertJsonObject(usersResult.payload, "GET /api/admin/users");
    if (!Array.isArray(usersResult.payload.users)) {
        throw new Error(`GET /api/admin/users expected users array, received ${formatPayload(usersResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/users returned ${usersResult.payload.users.length} users.`);

    const workspaceOwnerUserId = releasesResult.payload.releases[0]?.ownerUserId || usersResult.payload.users[0]?.uid || "";
    if (workspaceOwnerUserId) {
        const workspaceOverview = await requestJson(
            baseUrl,
            `/api/admin/workspaces/${encodeURIComponent(workspaceOwnerUserId)}`,
            { timeoutMs, headers }
        );
        assertStatus(workspaceOverview, [200, 404], `GET /api/admin/workspaces/${workspaceOwnerUserId}`);
        if (workspaceOverview.status === 404) {
            logSkip(`Workspace overview not found for ${workspaceOwnerUserId}, skipped workspace diff checks.`);
        } else {
            assertJsonObject(workspaceOverview.payload, `GET /api/admin/workspaces/${workspaceOwnerUserId}`);
            if (!workspaceOverview.payload.workspace) {
                throw new Error(`GET /api/admin/workspaces/${workspaceOwnerUserId} expected workspace.revisions array, received ${formatPayload(workspaceOverview.payload)}.`);
            }
            assertWorkspaceOverviewShape(
                workspaceOverview.payload.workspace,
                `GET /api/admin/workspaces/${workspaceOwnerUserId} workspace`
            );
            logPass(`Authenticated workspace overview check succeeded for ${workspaceOwnerUserId}.`);

            const revisions = workspaceOverview.payload.workspace.revisions;
            if (revisions.length >= 2) {
                const toRevisionId = revisions[0]?.revisionId || "";
                const fromRevisionId = revisions[1]?.revisionId || "";
                if (toRevisionId && fromRevisionId) {
                    const workspaceDiff = await requestJson(
                        baseUrl,
                        `/api/admin/workspaces/${encodeURIComponent(workspaceOwnerUserId)}/diff?fromRevisionId=${encodeURIComponent(fromRevisionId)}&toRevisionId=${encodeURIComponent(toRevisionId)}`,
                        { timeoutMs, headers }
                    );
                    assertStatus(workspaceDiff, [200], `GET /api/admin/workspaces/${workspaceOwnerUserId}/diff`);
                    assertJsonObject(workspaceDiff.payload, `GET /api/admin/workspaces/${workspaceOwnerUserId}/diff`);
                    if (!workspaceDiff.payload.diff) {
                        throw new Error(`GET /api/admin/workspaces/${workspaceOwnerUserId}/diff expected diff payload, received ${formatPayload(workspaceDiff.payload)}.`);
                    }
                    assertWorkspaceDiffShape(
                        workspaceDiff.payload.diff,
                        `GET /api/admin/workspaces/${workspaceOwnerUserId}/diff diff`
                    );
                    logPass(`Authenticated workspace diff check succeeded for ${workspaceOwnerUserId}.`);
                } else {
                    logSkip(`Workspace ${workspaceOwnerUserId} revision ids were incomplete, skipped diff check.`);
                }
            } else {
                logSkip(`Workspace ${workspaceOwnerUserId} has fewer than 2 revisions, skipped diff check.`);
            }
        }
    } else {
        logSkip("No workspace owner was discoverable, skipped workspace overview/diff checks.");
    }

    const taskRunsResult = await requestJson(baseUrl, "/api/admin/tasks/runs?limit=5", { timeoutMs, headers });
    assertStatus(taskRunsResult, [200], "GET /api/admin/tasks/runs");
    assertJsonObject(taskRunsResult.payload, "GET /api/admin/tasks/runs");
    if (!Array.isArray(taskRunsResult.payload.taskRuns)) {
        throw new Error(`GET /api/admin/tasks/runs expected taskRuns array, received ${formatPayload(taskRunsResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/tasks/runs returned ${taskRunsResult.payload.taskRuns.length} task runs.`);

    const billingEventsResult = await requestJson(baseUrl, "/api/admin/billing/events?limit=5", { timeoutMs, headers });
    assertStatus(billingEventsResult, [200], "GET /api/admin/billing/events");
    assertJsonObject(billingEventsResult.payload, "GET /api/admin/billing/events");
    if (!Array.isArray(billingEventsResult.payload.events)) {
        throw new Error(`GET /api/admin/billing/events expected events array, received ${formatPayload(billingEventsResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/billing/events returned ${billingEventsResult.payload.events.length} events.`);

    const purchasesResult = await requestJson(baseUrl, "/api/admin/billing/purchases?limit=5", { timeoutMs, headers });
    assertStatus(purchasesResult, [200], "GET /api/admin/billing/purchases");
    assertJsonObject(purchasesResult.payload, "GET /api/admin/billing/purchases");
    if (!Array.isArray(purchasesResult.payload.purchases)) {
        throw new Error(`GET /api/admin/billing/purchases expected purchases array, received ${formatPayload(purchasesResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/billing/purchases returned ${purchasesResult.payload.purchases.length} purchases.`);

    const webhooksResult = await requestJson(baseUrl, "/api/admin/webhooks/stripe?limit=5", { timeoutMs, headers });
    assertStatus(webhooksResult, [200], "GET /api/admin/webhooks/stripe");
    assertJsonObject(webhooksResult.payload, "GET /api/admin/webhooks/stripe");
    if (!Array.isArray(webhooksResult.payload.events)) {
        throw new Error(`GET /api/admin/webhooks/stripe expected events array, received ${formatPayload(webhooksResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/webhooks/stripe returned ${webhooksResult.payload.events.length} events.`);

    const auditResult = await requestJson(baseUrl, "/api/admin/audit?limit=5", { timeoutMs, headers });
    assertStatus(auditResult, [200], "GET /api/admin/audit");
    assertJsonObject(auditResult.payload, "GET /api/admin/audit");
    if (!Array.isArray(auditResult.payload.events)) {
        throw new Error(`GET /api/admin/audit expected events array, received ${formatPayload(auditResult.payload)}.`);
    }
    logPass(`Authenticated GET /api/admin/audit returned ${auditResult.payload.events.length} events.`);

    const jobId = options.explicitJobId || jobsResult.payload.jobs[0]?.id || "";
    if (jobId) {
        const jobDetail = await requestJson(baseUrl, `/api/admin/jobs/${encodeURIComponent(jobId)}`, { timeoutMs, headers });
        assertStatus(jobDetail, [200], `GET /api/admin/jobs/${jobId}`);
        assertJsonObject(jobDetail.payload, `GET /api/admin/jobs/${jobId}`);
        if (!jobDetail.payload.job || jobDetail.payload.job.id !== jobId) {
            throw new Error(`GET /api/admin/jobs/${jobId} returned unexpected payload: ${formatPayload(jobDetail.payload)}.`);
        }
        logPass(`Authenticated job detail check succeeded for ${jobId}.`);
    } else {
        logSkip("No job id was provided or discovered, skipped /api/admin/jobs/[jobId] detail check.");
    }

    const releaseId = options.explicitReleaseId || releasesResult.payload.releases[0]?.id || "";
    if (releaseId) {
        const releaseDetail = await requestJson(baseUrl, `/api/admin/releases/${encodeURIComponent(releaseId)}`, { timeoutMs, headers });
        assertStatus(releaseDetail, [200], `GET /api/admin/releases/${releaseId}`);
        assertJsonObject(releaseDetail.payload, `GET /api/admin/releases/${releaseId}`);
        if (!releaseDetail.payload.release || releaseDetail.payload.release.id !== releaseId) {
            throw new Error(`GET /api/admin/releases/${releaseId} returned unexpected payload: ${formatPayload(releaseDetail.payload)}.`);
        }
        logPass(`Authenticated release detail check succeeded for ${releaseId}.`);
    } else {
        logSkip("No release id was provided or discovered, skipped /api/admin/releases/[releaseId] detail check.");
    }

    const webhookId = options.explicitWebhookId || webhooksResult.payload.events[0]?.eventId || "";
    if (webhookId) {
        const webhookDetail = await requestJson(baseUrl, `/api/admin/webhooks/stripe/${encodeURIComponent(webhookId)}`, { timeoutMs, headers });
        assertStatus(webhookDetail, [200], `GET /api/admin/webhooks/stripe/${webhookId}`);
        assertJsonObject(webhookDetail.payload, `GET /api/admin/webhooks/stripe/${webhookId}`);
        if (!webhookDetail.payload.event || webhookDetail.payload.event.eventId !== webhookId) {
            throw new Error(`GET /api/admin/webhooks/stripe/${webhookId} returned unexpected payload: ${formatPayload(webhookDetail.payload)}.`);
        }
        logPass(`Authenticated webhook detail check succeeded for ${webhookId}.`);
    } else {
        logSkip("No webhook event id was provided or discovered, skipped /api/admin/webhooks/stripe/[eventId] detail check.");
    }

    if (!options.allowMutations) {
        logSkip("Mutation checks disabled. Re-run with --allow-mutations to test replay/rollback.");
        return;
    }

    const replayEventId = options.replayEventId || webhookId;
    if (replayEventId) {
        const replay = await requestJson(baseUrl, "/api/admin/webhooks/stripe/replay", {
            timeoutMs,
            method: "POST",
            headers: {
                ...headers,
                "content-type": "application/json"
            },
            body: { eventId: replayEventId }
        });
        assertStatus(replay, [200], "POST /api/admin/webhooks/stripe/replay");
        assertJsonObject(replay.payload, "POST /api/admin/webhooks/stripe/replay");
        if (!replay.payload.ok) {
            throw new Error(`POST /api/admin/webhooks/stripe/replay expected ok=true, received ${formatPayload(replay.payload)}.`);
        }
        logPass(`Webhook replay check succeeded for event ${replayEventId}.`);
    } else {
        logSkip("No replay event id was provided or discovered, skipped webhook replay mutation check.");
    }

    const ownerUserId = options.rollbackOwnerUserId;
    const rollbackReleaseTagId = options.rollbackReleaseTagId;
    if (ownerUserId && rollbackReleaseTagId) {
        const rollback = await requestJson(baseUrl, "/api/admin/releases/rollback", {
            timeoutMs,
            method: "POST",
            headers: {
                ...headers,
                "content-type": "application/json"
            },
            body: {
                ownerUserId,
                releaseTagId: rollbackReleaseTagId
            }
        });
        assertStatus(rollback, [200], "POST /api/admin/releases/rollback");
        assertJsonObject(rollback.payload, "POST /api/admin/releases/rollback");
        if (!rollback.payload.ok || !rollback.payload.result) {
            throw new Error(`POST /api/admin/releases/rollback expected ok=true with result, received ${formatPayload(rollback.payload)}.`);
        }
        logPass(`Release rollback check succeeded for ${rollbackReleaseTagId}.`);
    } else {
        logSkip("Rollback mutation check skipped. Provide --rollback-owner-user-id and --rollback-release-tag-id to enable it.");
    }
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        printHelp();
        return;
    }

    const timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs >= 1000
        ? args.timeoutMs
        : 10000;
    const fallbackBaseUrl = normalizeBaseUrl(args.baseUrl);

    let baseUrl = fallbackBaseUrl;
    let devServer = null;
    const exitState = {
        exited: false,
        code: null,
        signal: null
    };

    if (args.spawnDevServer) {
        const port = Number.isFinite(args.port) && args.port > 0 ? args.port : 4040;
        baseUrl = `http://127.0.0.1:${port}`;
        process.stdout.write(`Spawning local dev server on ${baseUrl}\n`);
        devServer = spawnDevServer(port);
        devServer.child.on("error", (error) => {
            devServer.output.push(`\n[spawn-error] ${error instanceof Error ? error.message : String(error)}\n`);
        });
        devServer.child.on("exit", (code, signal) => {
            exitState.exited = true;
            exitState.code = code;
            exitState.signal = signal;
        });

        await waitForServer(
            `${baseUrl}/api/admin/status`,
            Math.max(timeoutMs, 90_000),
            () => devServer.output.read(),
            () => exitState
        );
    }

    try {
        process.stdout.write(`Running admin API smoke checks against ${baseUrl}\n`);

        if (!args.cookie) {
            process.stdout.write("Mode: unauthenticated (no ADMIN_SMOKE_COOKIE provided)\n");
            await runUnauthenticatedChecks(baseUrl, timeoutMs);
            process.stdout.write("PASS Admin API smoke checks completed in unauthenticated mode.\n");
            return;
        }

        process.stdout.write("Mode: authenticated (ADMIN_SMOKE_COOKIE provided)\n");
        await runAuthenticatedChecks(baseUrl, timeoutMs, args.cookie, args);
        process.stdout.write("PASS Admin API smoke checks completed in authenticated mode.\n");
    } finally {
        if (devServer) {
            await terminateProcess(devServer.child);
        }
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
