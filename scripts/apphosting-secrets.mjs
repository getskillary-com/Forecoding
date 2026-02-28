#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_LOCATION = "us-central1";

const RECOMMENDED_SECRET_KEYS = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "GEMINI_API_KEY",
    "EMAIL_SERVER",
    "EMAIL_FROM",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "FORECODING_ADMIN_EMAILS"
];

function firebaseBin() {
    return "firebase";
}

function gcloudBin() {
    return "gcloud";
}

function printHelp() {
    console.log("Firebase App Hosting secrets helper");
    console.log("");
    console.log("Usage:");
    console.log("  node scripts/apphosting-secrets.mjs");
    console.log("");
    console.log("Features:");
    console.log("  - Add / update secrets");
    console.log("  - Delete secrets");
    console.log("  - View secret values");
    console.log("  - Batch paste KEY=VALUE");
    console.log("");
    console.log("Shortcuts for value input:");
    console.log("  - /env  Use same key value from local .env");
    console.log("  - /gen  Generate random 64-hex string");
}

function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, "\n");
}

function parseEnvContent(content) {
    const env = new Map();
    const lines = normalizeLineEndings(content).split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        if (!/^[A-Z0-9_]+$/.test(key)) continue;
        let value = trimmed.slice(idx + 1);
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        env.set(key, value);
    }
    return env;
}

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return new Map();
    return parseEnvContent(fs.readFileSync(filePath, "utf8"));
}

function loadDefaultProjectId(projectRoot) {
    try {
        const file = path.join(projectRoot, ".firebaserc");
        if (!fs.existsSync(file)) return "";
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return parsed?.projects?.default || "";
    } catch {
        return "";
    }
}

function loadDefaultBackendId(projectRoot) {
    try {
        const file = path.join(projectRoot, "firebase.json");
        if (!fs.existsSync(file)) return "";
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return parsed?.apphosting?.backendId || "";
    } catch {
        return "";
    }
}

async function askText(rl, prompt, defaultValue = "") {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const raw = await rl.question(`${prompt}${suffix}: `);
    const value = raw.trim();
    return value || defaultValue;
}

async function askYesNo(rl, prompt, defaultYes = true) {
    const suffix = defaultYes ? " [Y/n]" : " [y/N]";
    const raw = (await rl.question(`${prompt}${suffix}: `)).trim().toLowerCase();
    if (!raw) return defaultYes;
    if (["y", "yes"].includes(raw)) return true;
    if (["n", "no"].includes(raw)) return false;
    return defaultYes;
}

function splitSecretNames(inputValue) {
    return inputValue
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .filter((v) => /^[A-Z0-9_]+$/.test(v));
}

function parseSecretAssignment(line) {
    const idx = line.indexOf("=");
    if (idx <= 0) return null;
    const key = line.slice(0, idx).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) return null;
    let value = line.slice(idx + 1);
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    return { key, value };
}

function toEnvLiteral(value) {
    if (value === "") return '""';
    const needsQuote = /[\s#"'`]/.test(value);
    if (!needsQuote) return value;
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
}

function upsertEnvFile(envPath, updates) {
    const current = fs.existsSync(envPath) ? normalizeLineEndings(fs.readFileSync(envPath, "utf8")) : "";
    const lines = current ? current.split("\n") : [];
    const lineByKey = new Map();

    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].match(/^([A-Z0-9_]+)=/);
        if (match) {
            lineByKey.set(match[1], i);
        }
    }

    for (const update of updates) {
        const line = `${update.key}=${toEnvLiteral(update.value)}`;
        if (lineByKey.has(update.key)) {
            lines[lineByKey.get(update.key)] = line;
        } else {
            lines.push(line);
        }
    }

    fs.writeFileSync(envPath, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function removeEnvKeys(envPath, keys) {
    if (!fs.existsSync(envPath)) return;
    const keySet = new Set(keys);
    const current = normalizeLineEndings(fs.readFileSync(envPath, "utf8"));
    const lines = current.split("\n");
    const next = lines.filter((line) => {
        const match = line.match(/^([A-Z0-9_]+)=/);
        if (!match) return true;
        return !keySet.has(match[1]);
    });
    fs.writeFileSync(envPath, `${next.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function quoteForCmdArg(value) {
    if (!value) return '""';
    const escaped = value.replace(/"/g, '""');
    if (/[ \t&()^<>|]/.test(value)) return `"${escaped}"`;
    return escaped;
}

function spawnPortable(command, args, stdio) {
    if (process.platform === "win32") {
        const commandLine = [command, ...args.map((arg) => quoteForCmdArg(String(arg)))].join(" ");
        return spawn("cmd.exe", ["/d", "/s", "/c", commandLine], {
            stdio,
            windowsHide: true
        });
    }
    return spawn(command, args, { stdio });
}

function runCommandWithInput(command, args, inputValue = "") {
    return new Promise((resolve, reject) => {
        const child = spawnPortable(command, args, ["pipe", "inherit", "inherit"]);
        child.on("error", reject);
        if (inputValue) child.stdin.write(inputValue);
        child.stdin.end();
        child.on("close", (code) => {
            if (code === 0) return resolve();
            reject(new Error(`${command} exited with code ${code}`));
        });
    });
}

function runCommandCapture(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawnPortable(command, args, ["ignore", "pipe", "pipe"]);
        let stdoutText = "";
        let stderrText = "";

        child.on("error", reject);
        child.stdout.on("data", (chunk) => {
            stdoutText += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderrText += chunk.toString();
        });
        child.on("close", (code) => {
            resolve({
                code: typeof code === "number" ? code : 1,
                stdout: stdoutText,
                stderr: stderrText
            });
        });
    });
}

async function commandExists(command, versionArg = "--version") {
    const result = await runCommandCapture(command, [versionArg]);
    return result.code === 0;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFirebaseSecretSet({ key, value, projectId }) {
    await runCommandWithInput(
        firebaseBin(),
        [
            "--non-interactive",
            "apphosting:secrets:set",
            key,
            "--project",
            projectId,
            "--data-file",
            "-",
            "--force"
        ],
        value
    );
}

async function runFirebaseSecretGrantAccess({ key, projectId, backendId, location }) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const args = [
            "--non-interactive",
            "apphosting:secrets:grantaccess",
            key,
            "--project",
            projectId,
            "--backend",
            backendId
        ];
        if (location) args.push("--location", location);

        const result = await runCommandCapture(firebaseBin(), args);
        if (result.code === 0) return;

        const message = (result.stderr || result.stdout || `Grant access failed: ${key}`).trim();
        const retryable = /cannot find secret/i.test(message);
        if (!retryable || attempt >= maxAttempts) {
            throw new Error(message);
        }
        await sleep(700 * attempt);
    }
}

async function secretExists({ key, projectId }) {
    const result = await runCommandCapture(firebaseBin(), [
        "apphosting:secrets:describe",
        key,
        "--project",
        projectId
    ]);
    return result.code === 0;
}

async function runGcloudSecretCreate({ key, projectId, location }) {
    const args = ["secrets", "create", key, "--project", projectId, "--quiet"];
    if (location) {
        args.push("--replication-policy=user-managed", "--locations", location);
    } else {
        args.push("--replication-policy=automatic");
    }

    const result = await runCommandCapture(gcloudBin(), args);
    if (result.code === 0) return true;

    const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
    if (output.includes("already exists")) return false;
    throw new Error((result.stderr || result.stdout || `Create failed: ${key}`).trim());
}

async function runGcloudSecretDelete({ key, projectId }) {
    const result = await runCommandCapture(gcloudBin(), [
        "secrets",
        "delete",
        key,
        "--project",
        projectId,
        "--quiet"
    ]);
    if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || `Delete failed: ${key}`).trim());
    }
}

async function runFirebaseSecretAccess({ key, projectId }) {
    const result = await runCommandCapture(firebaseBin(), [
        "apphosting:secrets:access",
        key,
        "--project",
        projectId
    ]);
    if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || `Access failed: ${key}`).trim());
    }
    return result.stdout.trim();
}

function ensureSecretValue({ inputValue, envValue, key }) {
    if (inputValue === "/env") {
        if (!envValue) return null;
        return envValue;
    }
    if (inputValue === "/gen") {
        const generated = crypto.randomBytes(32).toString("hex");
        console.log(`  generated ${key}: ${generated}`);
        return generated;
    }
    return inputValue;
}

function normalizeUpdates(updates) {
    const dedup = new Map();
    for (const item of updates) {
        dedup.set(item.key, item.value);
    }
    return Array.from(dedup.entries()).map(([key, value]) => ({ key, value }));
}

async function chooseKeys(rl, envMap) {
    console.log("");
    console.log("Choose key scope:");
    console.log("  1) Recommended keys (FIREBASE_*, NEXT_PUBLIC_FIREBASE_*, EMAIL_*, STRIPE_*)");
    console.log("  2) Custom key list (comma separated)");
    console.log("  3) All keys found in local .env");
    const mode = await askText(rl, "Scope mode", "1");

    if (mode === "2") {
        const custom = await askText(rl, "Secret names", "");
        return splitSecretNames(custom);
    }
    if (mode === "3") {
        return Array.from(envMap.keys());
    }
    return [...RECOMMENDED_SECRET_KEYS];
}

async function collectBatchUpdates(rl, envMap) {
    console.log("");
    console.log("Paste KEY=VALUE lines, then type END on a single line.");
    console.log("Supported value shortcuts: /env, /gen");
    console.log("Example:");
    console.log("FIREBASE_PROJECT_ID=your-project-id");
    console.log("FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project-id.iam.gserviceaccount.com");
    console.log("FIREBASE_PRIVATE_KEY=/env");
    console.log("NEXT_PUBLIC_FIREBASE_API_KEY=/env");
    console.log("EMAIL_FROM=/env");
    console.log("END");
    console.log("");

    const updates = [];
    while (true) {
        const line = await rl.question("> ");
        const trimmed = line.trim();
        if (trimmed === "END") break;
        if (!trimmed || trimmed.startsWith("#")) continue;

        const parsed = parseSecretAssignment(line);
        if (!parsed) {
            console.log(`  skipped invalid line: ${line}`);
            continue;
        }

        const envValue = envMap.get(parsed.key) || "";
        const nextValue = ensureSecretValue({
            inputValue: parsed.value.trim(),
            envValue,
            key: parsed.key
        });

        if (nextValue === null || nextValue === undefined || nextValue === "") {
            console.log(`  ${parsed.key} has no resolved value; skipped`);
            continue;
        }

        updates.push({ key: parsed.key, value: nextValue });
        console.log(`  staged ${parsed.key}`);
    }

    return normalizeUpdates(updates);
}

async function collectSingleUpdates(rl, keys, envMap) {
    const updates = [];
    console.log("");
    console.log("Input values one by one:");
    console.log("  - Enter empty value to skip");
    console.log("  - /env to use local .env value");
    console.log("  - /gen to auto-generate a value");
    console.log("");

    for (const key of keys) {
        const hasLocal = envMap.has(key);
        console.log(`[${key}] local .env: ${hasLocal ? "yes" : "no"}`);
        const typed = await rl.question("value> ");
        const raw = typed.trim();
        if (!raw) {
            console.log("  skipped");
            continue;
        }

        const nextValue = ensureSecretValue({
            inputValue: raw,
            envValue: hasLocal ? envMap.get(key) : "",
            key
        });

        if (nextValue === null || nextValue === undefined || nextValue === "") {
            console.log("  no resolved value, skipped");
            continue;
        }

        updates.push({ key, value: nextValue });
        console.log("  staged");
    }

    return normalizeUpdates(updates);
}

async function handleUpsert({ rl, envPath, envMap, projectId, location, defaultBackendId }) {
    console.log("");
    console.log("Input mode:");
    console.log("  1) Batch paste KEY=VALUE (recommended)");
    console.log("  2) One by one");
    const inputMode = await askText(rl, "Input mode", "1");

    let updates = [];
    if (inputMode === "2") {
        const keys = await chooseKeys(rl, envMap);
        if (keys.length === 0) {
            console.log("No keys selected.");
            return;
        }
        updates = await collectSingleUpdates(rl, keys, envMap);
    } else {
        updates = await collectBatchUpdates(rl, envMap);
    }

    if (updates.length === 0) {
        console.log("");
        console.log("No updates to apply.");
        return;
    }

    const syncEnv = await askYesNo(rl, "Sync these values back to local .env", false);
    const backendId = await askText(
        rl,
        "Backend ID (for grant access on newly created secrets, empty to skip)",
        defaultBackendId || ""
    );

    console.log("");
    console.log("Will set/update these keys:");
    for (const item of updates) {
        console.log(`  - ${item.key}`);
    }

    const confirmed = await askYesNo(rl, "Continue", true);
    if (!confirmed) {
        console.log("Canceled.");
        return;
    }

    const gcloudOk = await commandExists(gcloudBin());

    console.log("");
    for (const item of updates) {
        let created = false;
        const exists = await secretExists({ key: item.key, projectId });

        if (!exists) {
            if (!gcloudOk) {
                throw new Error(
                    `New secret detected (${item.key}) but gcloud CLI is missing, cannot create it non-interactively.`
                );
            }
            console.log(`creating secret ${item.key} ...`);
            created = await runGcloudSecretCreate({
                key: item.key,
                projectId,
                location
            });
            if (created) {
                console.log(`created ${item.key}`);
            }
        }

        console.log(`setting ${item.key} ...`);
        await runFirebaseSecretSet({
            key: item.key,
            value: item.value,
            projectId
        });
        console.log(`done ${item.key}`);

        if (created && backendId) {
            console.log(`granting backend ${backendId} access to ${item.key} ...`);
            await runFirebaseSecretGrantAccess({
                key: item.key,
                projectId,
                backendId,
                location
            });
            console.log(`grant done ${item.key}`);
        } else if (created && !backendId) {
            console.log(`notice: ${item.key} is new and backend access was not granted automatically.`);
        }
    }

    if (syncEnv) {
        upsertEnvFile(envPath, updates);
        console.log("Local .env updated.");
    }
}

async function handleDelete({ rl, envPath, envMap, projectId }) {
    const gcloudOk = await commandExists(gcloudBin());
    if (!gcloudOk) {
        console.log("Delete requires gcloud CLI.");
        console.log("Install Google Cloud SDK first.");
        return;
    }

    const keys = await chooseKeys(rl, envMap);
    if (keys.length === 0) {
        console.log("No keys selected.");
        return;
    }

    console.log("");
    console.log("Will DELETE these secrets from Google Secret Manager:");
    for (const key of keys) {
        console.log(`  - ${key}`);
    }
    console.log("Warning: if apphosting.yaml still references deleted secrets, deployment will fail.");

    const confirmed = await askYesNo(rl, "Confirm delete", false);
    if (!confirmed) {
        console.log("Canceled.");
        return;
    }

    const finalCode = await askText(rl, "Type DELETE to continue", "");
    if (finalCode !== "DELETE") {
        console.log("Canceled.");
        return;
    }

    console.log("");
    for (const key of keys) {
        console.log(`deleting ${key} ...`);
        await runGcloudSecretDelete({ key, projectId });
        console.log(`done ${key}`);
    }

    const removeLocal = await askYesNo(rl, "Also remove these keys from local .env", false);
    if (removeLocal) {
        removeEnvKeys(envPath, keys);
        console.log("Local .env cleaned.");
    }
}

async function handleView({ rl, envMap, projectId }) {
    const keys = await chooseKeys(rl, envMap);
    if (keys.length === 0) {
        console.log("No keys selected.");
        return;
    }

    const confirmed = await askYesNo(rl, "Values will be shown in plain text, continue", false);
    if (!confirmed) {
        console.log("Canceled.");
        return;
    }

    console.log("");
    for (const key of keys) {
        try {
            const value = await runFirebaseSecretAccess({ key, projectId });
            console.log(`${key}=${value}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`${key}=<read failed: ${message}>`);
        }
    }
}

async function main() {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        printHelp();
        return;
    }

    const projectRoot = process.cwd();
    const envPath = path.join(projectRoot, ".env");
    const envMap = loadEnvFile(envPath);
    const defaultProjectId = loadDefaultProjectId(projectRoot);
    const defaultBackendId = loadDefaultBackendId(projectRoot);

    const rl = readline.createInterface({ input, output });
    try {
        console.log("==============================================");
        console.log(" Firebase App Hosting local secrets helper");
        console.log("==============================================");
        console.log("Input is visible in terminal.");
        console.log("");

        const projectId = await askText(rl, "Firebase project ID", defaultProjectId || "");
        if (!projectId) {
            console.log("Project ID cannot be empty.");
            return;
        }

        console.log("");
        console.log("Choose action:");
        console.log("  1) Add / update secrets");
        console.log("  2) Delete secrets");
        console.log("  3) View secret values");
        const action = await askText(rl, "Action", "1");

        if (action === "2") {
            await handleDelete({ rl, envPath, envMap, projectId });
            console.log("");
            console.log("Done.");
            return;
        }

        if (action === "3") {
            await handleView({ rl, envMap, projectId });
            console.log("");
            console.log("Done.");
            return;
        }

        const location = await askText(rl, "Secret location", DEFAULT_LOCATION);
        await handleUpsert({ rl, envPath, envMap, projectId, location, defaultBackendId });
        console.log("");
        console.log("Done.");
    } finally {
        rl.close();
    }
}

main().catch((error) => {
    console.error("");
    console.error("Failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
