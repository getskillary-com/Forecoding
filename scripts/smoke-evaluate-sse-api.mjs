#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const ALLOWED_EVENTS = new Set([
    "analysis.delta",
    "question",
    "conflict",
    "readiness.update",
    "trace",
    "remediation"
]);

function parseArgs(argv) {
    const args = {
        port: 4043,
        timeoutMs: 120_000,
        streamTimeoutMs: 45_000
    };

    for (let index = 2; index < argv.length; index += 1) {
        const current = argv[index];
        const next = argv[index + 1];

        if (current === "--port" && next) {
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                args.port = parsed;
            }
            index += 1;
            continue;
        }

        if (current === "--timeout-ms" && next) {
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed >= 10_000) {
                args.timeoutMs = parsed;
            }
            index += 1;
            continue;
        }

        if (current === "--stream-timeout-ms" && next) {
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed >= 5_000) {
                args.streamTimeoutMs = parsed;
            }
            index += 1;
        }
    }

    return args;
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
    if (!value) return "\"\"";
    const escaped = String(value).replace(/"/g, "\"\"");
    if (/[ \t&()^<>|]/.test(String(value))) {
        return `"${escaped}"`;
    }
    return escaped;
}

function spawnDevServer(port) {
    const devEnv = {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        CLAUDE_API_KEY: "",
        ANTHROPIC_API_KEY: ""
    };

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
                env: devEnv,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true
            }
        )
        : spawn(
            "npm",
            ["run", "dev", "--", "--port", String(port), "--hostname", "127.0.0.1"],
            {
                cwd: projectRoot,
                env: devEnv,
                stdio: ["ignore", "pipe", "pipe"],
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
                headers: {
                    accept: "application/json"
                }
            });

            if (response.status >= 200 && response.status < 500) {
                return;
            }

            lastError = `Unexpected readiness status: ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }

        await sleep(1_000);
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
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
                stdio: "ignore",
                windowsHide: true
            });
            killer.on("close", () => resolve());
            killer.on("error", () => resolve());
        });
    }

    return new Promise((resolve) => {
        child.once("close", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
            if (child.exitCode === null) {
                child.kill("SIGKILL");
            }
        }, 3_000);
    });
}

function parseSseFrame(frame) {
    const normalized = frame.replace(/\r/g, "");
    const lines = normalized.split("\n");
    let event = "";
    const dataLines = [];

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
            event = line.slice("event:".length).trim();
            continue;
        }
        if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trimStart());
        }
    }

    if (!event && dataLines.length === 0) return null;

    let payload = null;
    if (dataLines.length > 0) {
        const dataText = dataLines.join("\n");
        payload = JSON.parse(dataText);
    }

    return { event, payload };
}

function ensureTracePayloadShape(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return false;
    }
    if (!(payload.kind === "start" || payload.kind === "chunk" || payload.kind === "complete")) {
        return false;
    }
    if (typeof payload.requestId !== "string" || payload.requestId.trim().length === 0) {
        return false;
    }
    if ("workspaceRevision" in payload) {
        if (!(typeof payload.workspaceRevision === "number" && Number.isInteger(payload.workspaceRevision) && payload.workspaceRevision >= 0)) {
            return false;
        }
    }
    if ("workspaceSnapshotId" in payload && typeof payload.workspaceSnapshotId !== "string") {
        return false;
    }
    if ("projectId" in payload && typeof payload.projectId !== "string") {
        return false;
    }
    if ("versionId" in payload && typeof payload.versionId !== "string") {
        return false;
    }
    return true;
}

async function readSseEvents(response, streamTimeoutMs) {
    if (!response.body) {
        throw new Error("SSE response body is missing.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    const startedAt = Date.now();
    let buffer = "";
    let sawTraceComplete = false;

    try {
        while (Date.now() - startedAt < streamTimeoutMs) {
            const remainingMs = Math.max(1_000, streamTimeoutMs - (Date.now() - startedAt));
            const readResult = await Promise.race([
                reader.read(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error("Timed out while waiting for SSE chunk.")), Math.min(remainingMs, 5_000));
                })
            ]);

            const { done, value } = readResult;
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });

            let separatorIndex = buffer.indexOf("\n\n");
            while (separatorIndex >= 0) {
                const frame = buffer.slice(0, separatorIndex);
                buffer = buffer.slice(separatorIndex + 2);
                const parsed = parseSseFrame(frame);
                if (!parsed) {
                    separatorIndex = buffer.indexOf("\n\n");
                    continue;
                }
                events.push(parsed);

                if (!ALLOWED_EVENTS.has(parsed.event)) {
                    throw new Error(`Unexpected SSE event name "${parsed.event}".`);
                }
                if (parsed.event === "trace") {
                    if (!ensureTracePayloadShape(parsed.payload)) {
                        throw new Error(`Invalid trace payload shape: ${JSON.stringify(parsed.payload)}`);
                    }
                    if (parsed.payload.kind === "complete") {
                        sawTraceComplete = true;
                        return events;
                    }
                }

                separatorIndex = buffer.indexOf("\n\n");
            }
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // Ignore cancellation errors for smoke execution.
        }
    }

    if (!sawTraceComplete) {
        throw new Error("Did not receive trace.complete event before timeout.");
    }
    return events;
}

async function main() {
    const args = parseArgs(process.argv);
    const port = args.port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const evaluateUrl = `${baseUrl}/api/evaluate`;
    const { child, output } = spawnDevServer(port);
    const exitState = {
        exited: false,
        code: null,
        signal: null
    };

    child.on("error", (error) => {
        output.push(`\n[spawn-error] ${error instanceof Error ? error.message : String(error)}\n`);
    });
    child.on("exit", (code, signal) => {
        exitState.exited = true;
        exitState.code = code;
        exitState.signal = signal;
    });

    try {
        await waitForServer(evaluateUrl, args.timeoutMs, () => output.read(), () => exitState);

        const traceInput = {
            projectId: "smoke-project",
            versionId: "smoke-version",
            workspaceSnapshotId: "smoke-snapshot",
            workspaceRevision: 7
        };

        const response = await fetch(evaluateUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "text/event-stream"
            },
            body: JSON.stringify({
                messages: [
                    { role: "user", content: "Please ask one short clarifying question about target users." }
                ],
                context: "SSE smoke contract check",
                generationReady: false,
                interactionMode: "architecture",
                diagramPolicy: "derived_from_structured_state_v1",
                outputLanguage: "en",
                ...traceInput
            })
        });

        if (!response.ok) {
            const payloadText = await response.text().catch(() => "");
            throw new Error(
                `Expected /api/evaluate to return 200, received ${response.status}.\n\nPayload: ${payloadText}\n\nRecent logs:\n${output.read() || "(no output)"}`
            );
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("text/event-stream")) {
            throw new Error(`Expected SSE content-type, received "${contentType}".`);
        }

        const events = await readSseEvents(response, args.streamTimeoutMs);
        const traceEvents = events.filter((item) => item.event === "trace");
        const nonTraceEvents = events.filter((item) => item.event !== "trace");
        const traceStart = traceEvents.find((item) => item.payload?.kind === "start")?.payload || null;
        const traceComplete = traceEvents.find((item) => item.payload?.kind === "complete")?.payload || null;

        if (!traceStart || !traceComplete) {
            throw new Error(`Expected both trace.start and trace.complete events. Received events: ${events.map((item) => item.event).join(", ")}`);
        }

        const traceContextOk = traceEvents.some((item) => (
            item.payload
            && item.payload.workspaceSnapshotId === traceInput.workspaceSnapshotId
            && item.payload.workspaceRevision === traceInput.workspaceRevision
            && item.payload.projectId === traceInput.projectId
            && item.payload.versionId === traceInput.versionId
        ));
        if (!traceContextOk) {
            throw new Error(`Trace context was not propagated in SSE payloads. Trace sample: ${JSON.stringify(traceStart)}`);
        }

        if (nonTraceEvents.length === 0) {
            throw new Error("Expected at least one non-trace SSE event (question/remediation/analysis/conflict/readiness).");
        }

        const eventCounts = events.reduce((acc, item) => {
            acc[item.event] = (acc[item.event] || 0) + 1;
            return acc;
        }, {});

        process.stdout.write(
            `PASS /api/evaluate SSE smoke - received ${events.length} events (${Object.entries(eventCounts).map(([name, count]) => `${name}=${count}`).join(", ")}) on ${evaluateUrl}\n`
        );
    } finally {
        await terminateProcess(child);
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
