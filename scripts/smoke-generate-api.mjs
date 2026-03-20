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
        port: 4040,
        timeoutMs: 90_000
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

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
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
            const response = await fetchWithTimeout(url, {
                method: "GET",
                headers: {
                    accept: "application/json"
                }
            }, 5_000);

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
        }, 3_000);
    });
}

async function main() {
    const args = parseArgs(process.argv);
    const port = args.port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const generateUrl = `${baseUrl}/api/generate`;
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
        await waitForServer(generateUrl, args.timeoutMs, () => output.read(), () => exitState);

        const response = await fetchWithTimeout(generateUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json"
            },
            body: JSON.stringify({
                projectId: "smoke-project",
                versionId: "smoke-version",
                outputMode: "virtual_spec",
                templateKindHint: "react_vite"
            })
        }, 30_000);

        const contentType = response.headers.get("content-type") || "";
        let payload = null;

        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (response.status !== 401) {
            throw new Error(
                `Expected /api/generate to return 401 for an unauthenticated request, received ${response.status}.\n\nPayload: ${JSON.stringify(payload)}\n\nRecent logs:\n${output.read() || "(no output)"}`
            );
        }

        if (!contentType.includes("application/json")) {
            throw new Error(
                `Expected JSON response from /api/generate, received content-type "${contentType}".`
            );
        }

        if (!payload || payload.error !== "Unauthorized") {
            throw new Error(
                `Expected unauthorized JSON payload, received: ${JSON.stringify(payload)}`
            );
        }

        process.stdout.write(
            `PASS /api/generate smoke test - unauthenticated POST returned 401 on ${generateUrl}\n`
        );
    } finally {
        await terminateProcess(child);
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
