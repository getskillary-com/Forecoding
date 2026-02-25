#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const RECOMMENDED_SECRET_KEYS = [
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "EMAIL_SERVER",
    "EMAIL_FROM",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET"
];

function firebaseBin() {
    return "firebase";
}

function gcloudBin() {
    return "gcloud";
}

function printHelp() {
    console.log("Firebase App Hosting 密钥工具");
    console.log("");
    console.log("用法:");
    console.log("  node scripts/apphosting-secrets.mjs");
    console.log("");
    console.log("功能:");
    console.log("  - 新增 / 更新密钥");
    console.log("  - 删除密钥");
    console.log("  - 查看密钥明文");
    console.log("  - 批量粘贴 KEY=VALUE");
    console.log("");
    console.log("新增/更新快捷值:");
    console.log("  - /env  使用本地 .env 同名值");
    console.log("  - /gen  自动生成随机密钥");
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
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex <= 0) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        if (!/^[A-Z0-9_]+$/.test(key)) continue;
        let value = trimmed.slice(eqIndex + 1);
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
    const content = fs.readFileSync(filePath, "utf8");
    return parseEnvContent(content);
}

function loadDefaultProjectId(projectRoot) {
    try {
        const firebasercPath = path.join(projectRoot, ".firebaserc");
        if (!fs.existsSync(firebasercPath)) return "";
        const parsed = JSON.parse(fs.readFileSync(firebasercPath, "utf8"));
        return parsed?.projects?.default || "";
    } catch {
        return "";
    }
}

function loadDefaultBackendId(projectRoot) {
    try {
        const firebaseJsonPath = path.join(projectRoot, "firebase.json");
        if (!fs.existsSync(firebaseJsonPath)) return "";
        const parsed = JSON.parse(fs.readFileSync(firebaseJsonPath, "utf8"));
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
    if (["y", "yes", "是", "s"].includes(raw)) return true;
    if (["n", "no", "否", "f"].includes(raw)) return false;
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
    const index = line.indexOf("=");
    if (index <= 0) return null;
    const key = line.slice(0, index).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) return null;
    let value = line.slice(index + 1);
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    return { key, value };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toEnvLiteral(value) {
    if (value === "") return '""';
    const requiresQuote = /[\s#"'`]/.test(value);
    if (!requiresQuote) return value;
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
}

function upsertEnvFile(envPath, updates) {
    const current = fs.existsSync(envPath) ? normalizeLineEndings(fs.readFileSync(envPath, "utf8")) : "";
    const lines = current ? current.split("\n") : [];
    const keyLineMap = new Map();

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const match = line.match(/^([A-Z0-9_]+)=/);
        if (!match) continue;
        keyLineMap.set(match[1], i);
    }

    for (const update of updates) {
        const line = `${update.key}=${toEnvLiteral(update.value)}`;
        if (keyLineMap.has(update.key)) {
            lines[keyLineMap.get(update.key)] = line;
        } else {
            lines.push(line);
        }
    }

    const result = `${lines.join("\n").replace(/\n+$/, "")}\n`;
    fs.writeFileSync(envPath, result, "utf8");
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

    return spawn(command, args, {
        stdio
    });
}

function runCommandWithInput(command, args, inputValue = "") {
    return new Promise((resolve, reject) => {
        const child = spawnPortable(command, args, ["pipe", "inherit", "inherit"]);
        child.on("error", reject);
        if (inputValue) {
            child.stdin.write(inputValue);
        }
        child.stdin.end();
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
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

async function runFirebaseSecretSet({ key, value, location, projectId }) {
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
        if (location) {
            args.push("--location", location);
        }

        const result = await runCommandCapture(firebaseBin(), args);
        if (result.code === 0) {
            return;
        }

        const message = (result.stderr || result.stdout || `授权失败: ${key}`).trim();
        const retryable = /cannot find secret/i.test(message);
        const isLastAttempt = attempt >= maxAttempts;
        if (!retryable || isLastAttempt) {
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
    const args = [
        "secrets",
        "create",
        key,
        "--project",
        projectId,
        "--quiet"
    ];

    if (location) {
        args.push("--replication-policy=user-managed", "--locations", location);
    } else {
        args.push("--replication-policy=automatic");
    }

    const result = await runCommandCapture(gcloudBin(), args);
    if (result.code !== 0) {
        const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
        if (output.includes("already exists")) {
            return false;
        }
        const message = (result.stderr || result.stdout || `创建失败: ${key}`).trim();
        throw new Error(message);
    }
    return true;
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
        const message = (result.stderr || result.stdout || `删除失败: ${key}`).trim();
        throw new Error(message);
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
        const message = (result.stderr || result.stdout || `读取失败: ${key}`).trim();
        throw new Error(message);
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
        console.log(`  已生成 ${key}: ${generated}`);
        return generated;
    }
    return inputValue;
}

async function chooseKeys(rl, envMap) {
    console.log("");
    console.log("选择密钥范围:");
    console.log("  1) 推荐密钥（DATABASE_URL / NEXTAUTH_SECRET / EMAIL_* / STRIPE_*）");
    console.log("  2) 自定义（逗号分隔）");
    console.log("  3) 使用本地 .env 里全部 KEY");
    const mode = await askText(rl, "范围模式", "1");

    if (mode === "2") {
        const custom = await askText(rl, "请输入密钥名（逗号分隔）", "");
        return splitSecretNames(custom);
    }
    if (mode === "3") {
        return Array.from(envMap.keys());
    }
    return [...RECOMMENDED_SECRET_KEYS];
}

function normalizeUpdates(updates) {
    const map = new Map();
    for (const item of updates) {
        map.set(item.key, item.value);
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

async function collectBatchUpdates(rl, envMap) {
    console.log("");
    console.log("请批量粘贴多行 KEY=VALUE");
    console.log("输入 END（单独一行）结束录入。");
    console.log("示例：");
    console.log("DATABASE_URL=postgresql://...");
    console.log("NEXTAUTH_SECRET=/gen");
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
            console.log(`  跳过无效行: ${line}`);
            continue;
        }

        const envValue = envMap.get(parsed.key) || "";
        const nextValue = ensureSecretValue({
            inputValue: parsed.value.trim(),
            envValue,
            key: parsed.key
        });

        if (nextValue === null || nextValue === undefined || nextValue === "") {
            console.log(`  ${parsed.key} 未解析到值，已跳过`);
            continue;
        }

        updates.push({ key: parsed.key, value: nextValue });
        console.log(`  已记录 ${parsed.key}`);
    }

    return normalizeUpdates(updates);
}

async function collectSingleUpdates(rl, keys, envMap) {
    const updates = [];
    console.log("");
    console.log("逐个输入密钥值：");
    console.log("  - 回车跳过");
    console.log("  - /env 使用本地 .env 同名值");
    console.log("  - /gen 自动生成随机值");
    console.log("");

    for (const key of keys) {
        const hasLocal = envMap.has(key);
        console.log(`[${key}] 本地 .env: ${hasLocal ? "有值" : "无值"}`);
        const typed = await rl.question("值: ");
        const raw = typed.trim();
        if (!raw) {
            console.log("  已跳过");
            continue;
        }
        const nextValue = ensureSecretValue({
            inputValue: raw,
            envValue: hasLocal ? envMap.get(key) : "",
            key
        });
        if (nextValue === null || nextValue === undefined || nextValue === "") {
            console.log("  未解析到值，已跳过");
            continue;
        }
        updates.push({ key, value: nextValue });
        console.log("  已记录");
    }

    return normalizeUpdates(updates);
}

async function handleUpsert({ rl, envPath, envMap, projectId, location, defaultBackendId }) {
    console.log("");
    console.log("新增 / 更新录入方式：");
    console.log("  1) 批量粘贴 KEY=VALUE（推荐）");
    console.log("  2) 逐个输入");
    const inputMode = await askText(rl, "录入方式", "1");

    let updates = [];
    if (inputMode === "2") {
        const keys = await chooseKeys(rl, envMap);
        if (keys.length === 0) {
            console.log("没有可用密钥。");
            return;
        }
        updates = await collectSingleUpdates(rl, keys, envMap);
    } else {
        updates = await collectBatchUpdates(rl, envMap);
    }

    if (updates.length === 0) {
        console.log("");
        console.log("没有需要更新的密钥。");
        return;
    }

    const syncEnv = await askYesNo(rl, "是否同步写回本地 .env", false);
    const backendId = await askText(rl, "后端 ID（新密钥自动授权，留空跳过）", defaultBackendId || "");

    console.log("");
    console.log("将新增/更新以下密钥：");
    for (const item of updates) {
        console.log(`  - ${item.key}`);
    }

    const confirmed = await askYesNo(rl, "确认继续", true);
    if (!confirmed) {
        console.log("已取消。");
        return;
    }

    const gcloudOk = await commandExists(gcloudBin());

    console.log("");
    for (const item of updates) {
        let created = false;
        const exists = await secretExists({ key: item.key, projectId });

        if (!exists) {
            if (!gcloudOk) {
                throw new Error(`检测到新密钥 ${item.key}，但当前环境无 gcloud CLI，无法无交互创建。`);
            }
            console.log(`密钥 ${item.key} 不存在，正在创建 ...`);
            created = await runGcloudSecretCreate({
                key: item.key,
                projectId,
                location
            });
            if (created) {
                console.log(`已创建 ${item.key}`);
            }
        }

        console.log(`正在设置 ${item.key} ...`);
        await runFirebaseSecretSet({
            key: item.key,
            value: item.value,
            location,
            projectId
        });
        console.log(`完成: ${item.key}`);

        if (created && backendId) {
            console.log(`正在授权后端 ${backendId} 访问 ${item.key} ...`);
            await runFirebaseSecretGrantAccess({
                key: item.key,
                projectId,
                backendId,
                location
            });
            console.log(`授权完成: ${item.key}`);
        } else if (created && !backendId) {
            console.log(`提示: ${item.key} 是新密钥，未自动授权后端（你留空了 backendId）。`);
        }
    }

    if (syncEnv) {
        upsertEnvFile(envPath, updates);
        console.log("本地 .env 已同步。");
    }
}

async function handleDelete({ rl, envPath, envMap, projectId }) {
    const gcloudOk = await commandExists(gcloudBin());
    if (!gcloudOk) {
        console.log("删除功能需要 gcloud CLI。");
        console.log("请先安装 Google Cloud SDK。");
        return;
    }

    const keys = await chooseKeys(rl, envMap);
    if (keys.length === 0) {
        console.log("没有可用密钥。");
        return;
    }

    console.log("");
    console.log("将删除以下密钥（Google Secret Manager）：");
    for (const key of keys) {
        console.log(`  - ${key}`);
    }
    console.log("注意：若 apphosting.yaml 仍引用已删密钥，部署会失败。");

    const confirmed = await askYesNo(rl, "确认删除", false);
    if (!confirmed) {
        console.log("已取消。");
        return;
    }

    const finalCode = await askText(rl, "请输入 DELETE 继续", "");
    if (finalCode !== "DELETE") {
        console.log("已取消删除。");
        return;
    }

    console.log("");
    for (const key of keys) {
        console.log(`正在删除 ${key} ...`);
        await runGcloudSecretDelete({ key, projectId });
        console.log(`完成: ${key}`);
    }

    const removeLocal = await askYesNo(rl, "是否同时从本地 .env 删除这些键", false);
    if (removeLocal) {
        removeEnvKeys(envPath, keys);
        console.log("本地 .env 已清理。");
    }
}

async function handleView({ rl, envMap, projectId }) {
    const keys = await chooseKeys(rl, envMap);
    if (keys.length === 0) {
        console.log("没有可用密钥。");
        return;
    }

    const confirmed = await askYesNo(rl, "将以明文显示密钥值，是否继续", false);
    if (!confirmed) {
        console.log("已取消。");
        return;
    }

    console.log("");
    for (const key of keys) {
        try {
            const value = await runFirebaseSecretAccess({ key, projectId });
            console.log(`${key}=${value}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`${key}=<读取失败: ${message}>`);
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
        console.log(" Firebase App Hosting 本地密钥工具");
        console.log("==============================================");
        console.log("提示：输入是可见的。");
        console.log("");

        const projectId = await askText(rl, "Firebase 项目 ID", defaultProjectId || "");
        if (!projectId) {
            console.log("项目 ID 不能为空。");
            return;
        }

        console.log("");
        console.log("请选择操作：");
        console.log("  1) 新增 / 更新密钥");
        console.log("  2) 删除密钥");
        console.log("  3) 查看密钥明文");
        const action = await askText(rl, "操作", "1");

        if (action === "2") {
            await handleDelete({ rl, envPath, envMap, projectId });
            console.log("");
            console.log("执行完成。");
            return;
        }

        if (action === "3") {
            await handleView({ rl, envMap, projectId });
            console.log("");
            console.log("执行完成。");
            return;
        }

        const location = await askText(rl, "Secret 区域", "us-central1");
        await handleUpsert({ rl, envPath, envMap, projectId, location, defaultBackendId });
        console.log("");
        console.log("执行完成。");
    } finally {
        rl.close();
    }
}

main().catch((error) => {
    console.error("");
    console.error("执行失败:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
