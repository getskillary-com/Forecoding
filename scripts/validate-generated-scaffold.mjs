#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HELP_TEXT = `
Usage:
  node scripts/validate-generated-scaffold.mjs --input <generation.json> [options]

Options:
  --input <path>             JSON file containing GenerationResponse or raw projectTree array.
  --report <path>            Optional path to write the JSON report.
  --workdir <path>           Optional output directory for materialized scaffold.
  --keep-dir                 Keep the materialized directory after validation.
  --allow-placeholders       Continue validation even if placeholder/spec files remain.
  --skip-install             Skip npm install.
  --skip-typecheck           Skip type-check validation.
  --skip-lint                Skip lint validation.
  --skip-build               Skip build validation.
  --timeout-ms <number>      Per-command timeout in milliseconds. Default: 600000.
  --help                     Show this help text.
`.trim();

function parseArgs(argv) {
    const result = {
        input: "",
        report: "",
        workdir: "",
        keepDir: false,
        allowPlaceholders: false,
        skipInstall: false,
        skipTypecheck: false,
        skipLint: false,
        skipBuild: false,
        timeoutMs: 600000,
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        switch (token) {
            case "--input":
                result.input = argv[index + 1] || "";
                index += 1;
                break;
            case "--report":
                result.report = argv[index + 1] || "";
                index += 1;
                break;
            case "--workdir":
                result.workdir = argv[index + 1] || "";
                index += 1;
                break;
            case "--timeout-ms":
                result.timeoutMs = Number.parseInt(argv[index + 1] || "", 10) || result.timeoutMs;
                index += 1;
                break;
            case "--keep-dir":
                result.keepDir = true;
                break;
            case "--allow-placeholders":
                result.allowPlaceholders = true;
                break;
            case "--skip-install":
                result.skipInstall = true;
                break;
            case "--skip-typecheck":
                result.skipTypecheck = true;
                break;
            case "--skip-lint":
                result.skipLint = true;
                break;
            case "--skip-build":
                result.skipBuild = true;
                break;
            case "--help":
            case "-h":
                result.help = true;
                break;
            default:
                if (token.startsWith("--")) {
                    throw new Error(`Unknown option: ${token}`);
                }
        }
    }

    return result;
}

function quoteForCmdArg(value) {
    if (!value) return '""';
    const escaped = value.replace(/"/g, '""');
    if (/[ \t&()^<>|]/.test(value)) return `"${escaped}"`;
    return escaped;
}

function spawnPortable(command, args, options = {}) {
    const baseOptions = {
        cwd: options.cwd,
        stdio: options.stdio || ["ignore", "pipe", "pipe"],
        windowsHide: true
    };

    if (process.platform === "win32") {
        const commandLine = [command, ...args.map((arg) => quoteForCmdArg(String(arg)))].join(" ");
        return spawn("cmd.exe", ["/d", "/s", "/c", commandLine], baseOptions);
    }

    return spawn(command, args, baseOptions);
}

function truncate(text, maxChars = 4000) {
    const normalized = (text || "").trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars)}...`;
}

function isCodeFile(filePath) {
    return /\.(ts|tsx|js|jsx|mjs|cjs|css)$/i.test(filePath);
}

const ROOT_DOC_PATHS = new Set([
    "README.md",
    "IMPLEMENTATION_PLAN.md",
    "ONE_CLICK_PROMPT.md",
    "_AI_PROMPT.md"
]);

const ROOT_CONFIG_PATHS = new Set([
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "vite.config.ts",
    "tailwind.config.js",
    "tailwind.config.ts",
    "postcss.config.js",
    "postcss.config.mjs",
    "postcss.config.cjs",
    "turbo.json",
    ".env.example",
    "GENERATION_MANIFEST.json",
    "index.html",
    "apps/web/package.json",
    "apps/backend/package.json",
    "packages/domain/package.json"
]);

function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "");
}

function classifyContentKind(pathValue) {
    const filePath = normalizePath(pathValue);
    if (!filePath) return "placeholder";
    if (/^config\/integrations\/.+\.template\./i.test(filePath)) return "template";
    if (ROOT_DOC_PATHS.has(filePath) || filePath.startsWith("docs/") || filePath.endsWith("/_AI_PROMPT.md")) return "doc";
    if (
        ROOT_CONFIG_PATHS.has(filePath) ||
        /^apps\/[^/]+\/package\.json$/i.test(filePath) ||
        /^apps\/[^/]+\/tsconfig\.json$/i.test(filePath) ||
        /^packages\/[^/]+\/package\.json$/i.test(filePath) ||
        /^packages\/[^/]+\/tsconfig\.json$/i.test(filePath)
    ) {
        return "config";
    }
    return "placeholder";
}

function collectFiles(nodes, prefix = "") {
    const files = [];
    for (const node of nodes || []) {
        if (!node || typeof node !== "object" || typeof node.name !== "string") continue;
        const relativePath = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === "folder") {
            files.push(...collectFiles(node.children || [], relativePath));
            continue;
        }
        files.push({
            path: relativePath,
            content: typeof node.content === "string" ? node.content : ""
        });
    }
    return files;
}

function parseManifestFromTree(nodes) {
    const manifestFile = collectFiles(nodes).find((entry) => normalizePath(entry.path) === "GENERATION_MANIFEST.json");
    if (!manifestFile?.content) return null;
    try {
        return JSON.parse(manifestFile.content);
    } catch {
        return null;
    }
}

function getManifestContentKind(manifest, filePath) {
    const normalized = normalizePath(filePath);
    const fileEntry = Array.isArray(manifest?.files)
        ? manifest.files.find((entry) => normalizePath(entry.path) === normalized)
        : null;
    return fileEntry?.contentKind || classifyContentKind(normalized);
}

function isPlaceholderContent(filePath, content) {
    const source = (content || "").trim();
    if (!source) return false;
    if (!isCodeFile(filePath)) return false;
    return (
        /GENERATION PENDING/i.test(source) ||
        /^#\s+(Page|Component|API|Layout|Module|Type)\s+Spec/i.test(source) ||
        /##\s+Role\s*&\s*Responsibility/i.test(source) ||
        /##\s+Core\s+Interactions/i.test(source) ||
        /##\s+UI\s+Requirements/i.test(source)
    );
}

function getPlaceholderCommentStyle(filePath) {
    const normalized = normalizePath(filePath).toLowerCase();
    if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|prisma)$/i.test(normalized)) return "block";
    if (/\.(html|htm|xml|svg)$/i.test(normalized)) return "html";
    if (/\.(py|rb|sh|bash|zsh|ya?ml|toml|ini|cfg|conf)$/i.test(normalized)) return "line";
    return null;
}

function requiresCommentOnlyPlaceholder(filePath) {
    return getPlaceholderCommentStyle(filePath) !== null;
}

function cleanPlaceholderSpecLines(text) {
    const normalized = String(text || "")
        .replace(/\r\n/g, "\n")
        .replace(/^\/\*+\s*/, "")
        .replace(/\*\/\s*$/, "")
        .replace(/^\s*<!--\s*/, "")
        .replace(/\s*-->\s*$/, "")
        .trim();
    if (!normalized) return "";

    const strippedLines = normalized
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, "").replace(/^\s*(?:\/\/+|#)\s?/, ""))
        .map((line) => line.replace(/^\s*\/\*\s?/, "").replace(/\s*\*\/\s*$/, ""))
        .map((line) => line.trimEnd());

    const filtered = [];
    for (const line of strippedLines) {
        const trimmed = line.trim();
        if (!trimmed && filtered.length === 0) continue;
        if (/^(?:待生成|generation pending)$/i.test(trimmed)) continue;
        if (/^(?:打开|open)\s+.+_AI_PROMPT\.md/i.test(trimmed)) continue;
        if (/^(?:内容提示|content hint|prompt file)[:：]?/i.test(trimmed)) continue;
        filtered.push(line);
    }

    return filtered.join("\n").trim();
}

function hasValidPlaceholderCommentFormat(filePath, content) {
    const source = String(content || "").replace(/\r\n/g, "\n").trim();
    if (!source) return false;
    const style = getPlaceholderCommentStyle(filePath);
    if (!style) return true;

    let inner = "";
    if (style === "block") {
        if (!/^\/\*[\s\S]*\*\/$/.test(source)) return false;
        inner = cleanPlaceholderSpecLines(source.slice(2, -2));
    } else if (style === "html") {
        if (!/^<!--[\s\S]*-->$/.test(source)) return false;
        inner = cleanPlaceholderSpecLines(source.slice(4, -3));
    } else {
        const nonEmptyLines = source.split("\n").filter((line) => line.trim().length > 0);
        if (nonEmptyLines.length === 0 || nonEmptyLines.some((line) => !/^\s*#/.test(line))) {
            return false;
        }
        inner = cleanPlaceholderSpecLines(source);
    }

    return Boolean(inner);
}

function normalizeInputPayload(payload) {
    if (Array.isArray(payload)) {
        const manifest = parseManifestFromTree(payload);
        return {
            outputMode: manifest?.outputMode === "virtual_spec" ? "virtual_spec" : "runnable_scaffold",
            projectTree: payload,
            generationManifest: manifest
        };
    }

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.projectTree)) {
        throw new Error("Input JSON must be a GenerationResponse-like object or a raw projectTree array.");
    }

    return {
        outputMode: payload.outputMode === "virtual_spec" ? "virtual_spec" : "runnable_scaffold",
        projectTree: payload.projectTree,
        generationManifest: payload.generationManifest || parseManifestFromTree(payload.projectTree)
    };
}

async function materializeTree(nodes, rootDir, prefix = "") {
    for (const node of nodes || []) {
        if (!node || typeof node !== "object" || typeof node.name !== "string") continue;
        const relativePath = prefix ? path.join(prefix, node.name) : node.name;
        const targetPath = path.join(rootDir, relativePath);

        if (node.type === "folder") {
            await fsp.mkdir(targetPath, { recursive: true });
            await materializeTree(node.children || [], rootDir, relativePath);
            continue;
        }

        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.writeFile(targetPath, typeof node.content === "string" ? node.content : "", "utf8");
    }
}

function collectPlaceholderFiles(nodes, manifest, prefix = "") {
    if (manifest && Array.isArray(manifest.files)) {
        return manifest.files
            .filter((entry) => entry && entry.contentKind === "placeholder" && typeof entry.path === "string")
            .map((entry) => normalizePath(entry.path))
            .sort((left, right) => left.localeCompare(right));
    }
    const matches = [];
    for (const node of nodes || []) {
        if (!node || typeof node !== "object" || typeof node.name !== "string") continue;
        const relativePath = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === "folder") {
            matches.push(...collectPlaceholderFiles(node.children || [], null, relativePath));
            continue;
        }
        if (node.type === "file" && isPlaceholderContent(relativePath, node.content || "")) {
            matches.push(relativePath);
        }
    }
    return matches.sort((left, right) => left.localeCompare(right));
}

function isStructuredContentContaminated(content) {
    const source = (content || "").trim();
    if (!source) return false;
    return (
        /##\s+Quality Constraints/i.test(source) ||
        /##\s+Template Guidance/i.test(source) ||
        /##\s+Anti-Patterns/i.test(source) ||
        /##\s+Good\s+vs\s+Bad\s+Examples/i.test(source)
    );
}

function collectStructuralIssues(nodes, manifest, outputMode = manifest?.outputMode || "runnable_scaffold") {
    const files = collectFiles(nodes);
    const allPaths = new Set(files.map((entry) => normalizePath(entry.path)));
    const issues = [];
    const dependencyKeys = new Set();

    files
        .filter((entry) => /package\.json$/i.test(normalizePath(entry.path)))
        .forEach((entry) => {
            try {
                const parsed = JSON.parse(entry.content || "{}");
                Object.keys(parsed.dependencies || {}).forEach((key) => dependencyKeys.add(key));
                Object.keys(parsed.devDependencies || {}).forEach((key) => dependencyKeys.add(key));
            } catch {
                // invalid JSON handled below
            }
        });

    const contaminated = files
        .filter((entry) => {
            const kind = getManifestContentKind(manifest, entry.path);
            return kind !== "placeholder" && kind !== "doc" && kind !== "template" && isStructuredContentContaminated(entry.content);
        })
        .map((entry) => normalizePath(entry.path));
    if (contaminated.length > 0) {
        issues.push({
            code: "SPEC_CONTENT_CONTAMINATED",
            message: "Structured config/code files contain markdown-only scaffold guidance.",
            details: contaminated.slice(0, 20).join(", ")
        });
    }

    const invalidPlaceholderFormats = files
        .filter((entry) => getManifestContentKind(manifest, entry.path) === "placeholder")
        .filter((entry) => requiresCommentOnlyPlaceholder(entry.path))
        .filter((entry) => (entry.content || "").trim().length > 0)
        .filter((entry) => !hasValidPlaceholderCommentFormat(entry.path, entry.content))
        .map((entry) => normalizePath(entry.path));
    if (invalidPlaceholderFormats.length > 0) {
        issues.push({
            code: "INVALID_PLACEHOLDER_FORMAT",
            message: "Placeholder source files must be comment-only placeholders.",
            details: invalidPlaceholderFormats.slice(0, 20).join(", ")
        });
    }

    const invalidJson = files
        .filter((entry) => {
            const kind = getManifestContentKind(manifest, entry.path);
            if (kind === "placeholder") return false;
            return /\.json$/i.test(entry.path);
        })
        .filter((entry) => {
            try {
                JSON.parse(entry.content || "");
                return false;
            } catch {
                return true;
            }
        })
        .map((entry) => normalizePath(entry.path));
    if (invalidJson.length > 0) {
        issues.push({
            code: "INVALID_JSON_FILE",
            message: "Structured JSON files must remain parseable.",
            details: invalidJson.slice(0, 20).join(", ")
        });
    }

    const routeMap = files.find((entry) => normalizePath(entry.path) === "docs/ROUTE_MAP.md");
    if (routeMap?.content) {
        const missingRouteRefs = routeMap.content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => /^\|/.test(line))
            .slice(2)
            .map((line) => line.split("|").map((part) => part.trim()).filter(Boolean)[1] || "")
            .filter(Boolean)
            .filter((ref) => !allPaths.has(ref));
        if (missingRouteRefs.length > 0) {
            issues.push({
                code: "ROUTE_MAP_REFERENCE_MISSING",
                message: "Route map references files that do not exist in the final tree.",
                details: missingRouteRefs.slice(0, 20).join(", ")
            });
        }
    }

    const rootPackage = files.find((entry) => normalizePath(entry.path) === "package.json");
    if (!rootPackage) {
        issues.push({
            code: "MISSING_PACKAGE_JSON",
            message: "Materialized scaffold is missing package.json."
        });
        return issues;
    }

    try {
        const parsed = JSON.parse(rootPackage.content);
        if (Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
            if (parsed.workspaces.includes("apps/*")) {
                const appPackages = files.filter((entry) => /^apps\/[^/]+\/package\.json$/i.test(normalizePath(entry.path)));
                if (appPackages.length === 0) {
                    issues.push({
                        code: "WORKSPACE_STRUCTURE_MISMATCH",
                        message: "Workspace config expects apps/* package.json files."
                    });
                }
            }
            if (parsed.workspaces.includes("packages/*")) {
                const packageEntries = files.filter((entry) => /^packages\/[^/]+\/package\.json$/i.test(normalizePath(entry.path)));
                if (packageEntries.length === 0) {
                    issues.push({
                        code: "WORKSPACE_STRUCTURE_MISMATCH",
                        message: "Workspace config expects packages/* package.json files."
                    });
                }
            }
        }
    } catch {
        issues.push({
            code: "INVALID_JSON_FILE",
            message: "Root package.json must remain parseable."
        });
    }

    const readme = (files.find((entry) => normalizePath(entry.path) === "README.md")?.content || "").toLowerCase();
    const envExample = files.find((entry) => normalizePath(entry.path) === ".env.example")?.content || "";
    const profile = manifest?.profile || null;
    const hasTailwindConfig = ["tailwind.config.ts", "tailwind.config.js"]
        .some((filePath) => allPaths.has(filePath));
    const hasPostcssConfig = ["postcss.config.mjs", "postcss.config.js", "postcss.config.cjs"]
        .some((filePath) => allPaths.has(filePath));
    const stackIssues = [];
    const expect = (condition, message) => {
        if (!condition) stackIssues.push(message);
    };
    if (/react\s*\+\s*vite|\bvite\b/.test(readme)) {
        expect(profile?.framework === "react_vite_spa" || dependencyKeys.has("vite"), "README references Vite without matching profile/dependencies.");
    }
    if (/next\.js|app router/.test(readme)) {
        expect(profile?.framework === "next_app_router" || dependencyKeys.has("next"), "README references Next.js/App Router without matching profile/dependencies.");
    }
    if (/firebase|firestore|firebase auth|cloud functions/.test(readme)) {
        expect(dependencyKeys.has("firebase") || dependencyKeys.has("firebase-admin"), "README references Firebase without matching dependencies.");
    }
    if (/prisma|postgresql/.test(readme)) {
        expect(dependencyKeys.has("@prisma/client") || dependencyKeys.has("prisma"), "README references Prisma/PostgreSQL without matching dependencies.");
    }
    if (/vercel ai sdk/.test(readme)) {
        expect(dependencyKeys.has("ai") || dependencyKeys.has("@ai-sdk/openai"), "README references Vercel AI SDK without matching dependencies.");
    }
    if (/\bopenai\b|responses api/.test(readme)) {
        expect(dependencyKeys.has("openai") || dependencyKeys.has("@ai-sdk/openai"), "README references OpenAI without matching dependencies.");
    }
    if (/stripe/.test(readme)) {
        expect(dependencyKeys.has("stripe") || dependencyKeys.has("@stripe/stripe-js"), "README references Stripe without matching dependencies.");
    }
    if (/react router/.test(readme)) {
        expect(dependencyKeys.has("react-router-dom"), "README references React Router without matching dependencies.");
    }
    if (/tailwind/.test(readme)) {
        expect(dependencyKeys.has("tailwindcss"), "README references Tailwind without matching dependencies.");
        expect(hasTailwindConfig && hasPostcssConfig, "README references Tailwind but tailwind/postcss config files are missing.");
    }
    if (/vercel ai sdk|\bopenai\b|responses api/.test(readme)) {
        expect(/OPENAI_API_KEY=/.test(envExample), "README references OpenAI/Vercel AI SDK without `OPENAI_API_KEY` in `.env.example`.");
    }
    if (stackIssues.length > 0) {
        issues.push({
            code: "README_STACK_MISMATCH",
            message: "README tech-stack descriptions drift from generated dependencies/profile.",
            details: stackIssues.slice(0, 20).join(" | ")
        });
    }

    if (outputMode === "virtual_spec") {
        const specDocRuntimeDrift = [];
        const runtimeChecks = [
            {
                path: "README.md",
                content: files.find((entry) => normalizePath(entry.path) === "README.md")?.content || "",
                patterns: [/npm install/i, /npm run dev/i, /npm run build/i, /npm run start/i, /项目可安装并成功启动/, /可执行的脚手架规范/, /运行方式/],
                reason: "README still describes the ZIP as a runnable app."
            },
            {
                path: "IMPLEMENTATION_PLAN.md",
                content: files.find((entry) => normalizePath(entry.path) === "IMPLEMENTATION_PLAN.md")?.content || "",
                patterns: [/建立可运行基线/, /依赖安装通过/, /开发环境可启动/, /Establish runnable baseline/i, /Dependencies install/i, /app starts/i],
                reason: "Implementation plan still frames Phase 0 as runnable-app bootstrap."
            },
            {
                path: "ONE_CLICK_PROMPT.md",
                content: files.find((entry) => normalizePath(entry.path) === "ONE_CLICK_PROMPT.md")?.content || "",
                patterns: [/npm install/i, /npm run build/i],
                reason: "One-click prompt still uses runnable-app final gate commands."
            }
        ];

        for (const item of runtimeChecks) {
            if (item.patterns.some((pattern) => pattern.test(item.content || ""))) {
                specDocRuntimeDrift.push(`${item.path}: ${item.reason}`);
            }
        }

        if (specDocRuntimeDrift.length > 0) {
            issues.push({
                code: "SPEC_DOC_RUNTIME_DRIFT",
                message: "Spec-pack docs drift back toward runnable-app wording.",
                details: specDocRuntimeDrift.slice(0, 20).join(" | ")
            });
        }
    }

    return issues;
}

async function readPackageJsonManifest(rootDir) {
    const packageJsonPath = path.join(rootDir, "package.json");
    const raw = await fsp.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
}

function collectDependencyNames(manifest) {
    return new Set([
        ...Object.keys(manifest.dependencies || {}),
        ...Object.keys(manifest.devDependencies || {}),
        ...Object.keys(manifest.peerDependencies || {})
    ]);
}

function buildValidationCommands(manifest, rootDir) {
    const scripts = manifest && typeof manifest === "object" && manifest.scripts && typeof manifest.scripts === "object"
        ? manifest.scripts
        : {};
    const dependencies = collectDependencyNames(manifest);
    const hasScript = (...names) => names.some((name) => typeof scripts[name] === "string" && scripts[name].trim().length > 0);
    const commands = [];

    commands.push({ name: "install", command: "npm", args: ["install"] });

    if (hasScript("type-check")) {
        commands.push({ name: "typecheck", command: "npm", args: ["run", "type-check"] });
    } else if (hasScript("typecheck")) {
        commands.push({ name: "typecheck", command: "npm", args: ["run", "typecheck"] });
    } else if (dependencies.has("typescript") || fs.existsSync(path.join(rootDir, "tsconfig.json"))) {
        commands.push({ name: "typecheck", command: "npx", args: ["tsc", "--noEmit"] });
    } else {
        commands.push({ name: "typecheck", skipped: true, reason: "TypeScript type-check is not configured." });
    }

    if (hasScript("lint")) {
        commands.push({ name: "lint", command: "npm", args: ["run", "lint"] });
    } else if (dependencies.has("eslint") || dependencies.has("@eslint/js")) {
        commands.push({ name: "lint", command: "npx", args: ["eslint", "."] });
    } else {
        commands.push({ name: "lint", skipped: true, reason: "Lint is not configured." });
    }

    if (hasScript("build")) {
        commands.push({ name: "build", command: "npm", args: ["run", "build"] });
    } else if (dependencies.has("next")) {
        commands.push({ name: "build", command: "npx", args: ["next", "build"] });
    } else if (dependencies.has("vite")) {
        commands.push({ name: "build", command: "npx", args: ["vite", "build"] });
    } else {
        commands.push({ name: "build", skipped: true, reason: "Build command is not configured." });
    }

    return commands;
}

function runCommandCapture(command, args, cwd, timeoutMs) {
    return new Promise((resolve) => {
        const child = spawnPortable(command, args, { cwd });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            clearTimeout(timeout);
            resolve({
                ok: false,
                exitCode: 1,
                stdout,
                stderr: `${stderr}\n${error.message}`.trim(),
                timedOut
            });
        });
        child.on("close", (code) => {
            clearTimeout(timeout);
            resolve({
                ok: code === 0 && !timedOut,
                exitCode: typeof code === "number" ? code : 1,
                stdout,
                stderr,
                timedOut
            });
        });
    });
}

async function maybeWriteReport(reportPath, payload) {
    if (!reportPath) return;
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${HELP_TEXT}\n`);
        return;
    }
    if (!args.input) {
        throw new Error("Missing required --input path.");
    }

    const rawInput = await fsp.readFile(args.input, "utf8");
    const payload = normalizeInputPayload(JSON.parse(rawInput));
    const placeholderFiles = collectPlaceholderFiles(payload.projectTree, payload.generationManifest);
    const report = {
        version: "generated_scaffold_validation_v1",
        outputMode: payload.outputMode,
        pass: false,
        materializedDir: "",
        keptDirectory: false,
        placeholderCount: placeholderFiles.length,
        installable: false,
        typecheckable: false,
        lintable: false,
        buildable: false,
        commands: [],
        issues: []
    };

    report.issues.push(...collectStructuralIssues(payload.projectTree, payload.generationManifest, payload.outputMode));

    if (payload.outputMode !== "virtual_spec" && placeholderFiles.length > 0) {
        report.issues.push({
            code: "PLACEHOLDERS_REMAINING",
            message: "Generated scaffold still contains placeholder/spec source files.",
            details: placeholderFiles.slice(0, 20).join(", ")
        });
        if (!args.allowPlaceholders) {
            await maybeWriteReport(args.report, report);
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
            process.exitCode = 1;
            return;
        }
    }

    const materializedDir = args.workdir
        ? path.resolve(args.workdir)
        : await fsp.mkdtemp(path.join(os.tmpdir(), "forecoding-generated-"));
    report.materializedDir = materializedDir;
    report.keptDirectory = Boolean(args.keepDir || args.workdir);

    await fsp.mkdir(materializedDir, { recursive: true });
    await materializeTree(payload.projectTree, materializedDir);

    if (payload.outputMode === "virtual_spec") {
        report.pass = report.issues.length === 0;
        await maybeWriteReport(args.report, report);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (!report.pass) {
            process.exitCode = 1;
        }
        if (!report.keptDirectory) {
            await fsp.rm(materializedDir, { recursive: true, force: true });
        }
        return;
    }

    const packageJsonPath = path.join(materializedDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        report.issues.push({
            code: "MISSING_PACKAGE_JSON",
            message: "Materialized scaffold is missing package.json."
        });
        await maybeWriteReport(args.report, report);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        process.exitCode = 1;
        return;
    }

    const manifest = await readPackageJsonManifest(materializedDir);
    const commands = buildValidationCommands(manifest, materializedDir).filter((item) => {
        if (item.name === "install" && args.skipInstall) return false;
        if (item.name === "typecheck" && args.skipTypecheck) return false;
        if (item.name === "lint" && args.skipLint) return false;
        if (item.name === "build" && args.skipBuild) return false;
        return true;
    });

    let installSucceeded = args.skipInstall;
    report.installable = args.skipInstall;
    for (const item of commands) {
        if (item.skipped) {
            report.commands.push({
                name: item.name,
                command: "",
                ok: true,
                exitCode: 0,
                skipped: true,
                stdout: "",
                stderr: item.reason
            });
            if (item.name === "typecheck") report.typecheckable = true;
            if (item.name === "lint") report.lintable = true;
            if (item.name === "build") report.buildable = true;
            continue;
        }

        if (item.name !== "install" && !installSucceeded) {
            report.commands.push({
                name: item.name,
                command: `${item.command} ${item.args.join(" ")}`,
                ok: false,
                exitCode: 1,
                skipped: true,
                stdout: "",
                stderr: "Skipped because install failed."
            });
            continue;
        }

        const result = await runCommandCapture(item.command, item.args, materializedDir, args.timeoutMs);
        report.commands.push({
            name: item.name,
            command: `${item.command} ${item.args.join(" ")}`,
            ok: result.ok,
            exitCode: result.exitCode,
            skipped: false,
            timedOut: result.timedOut,
            stdout: truncate(result.stdout),
            stderr: truncate(result.stderr)
        });

        if (!result.ok) {
            report.issues.push({
                code: `${item.name.toUpperCase()}_FAILED`,
                message: `${item.name} command failed.`,
                details: truncate(result.stderr || result.stdout)
            });
        }

        if (item.name === "install") installSucceeded = result.ok;
        if (item.name === "install") report.installable = result.ok;
        if (item.name === "typecheck") report.typecheckable = result.ok;
        if (item.name === "lint") report.lintable = result.ok;
        if (item.name === "build") report.buildable = result.ok;
    }

    report.pass = report.issues.length === 0;

    await maybeWriteReport(args.report, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    if (!report.pass) {
        process.exitCode = 1;
    }

    if (!report.keptDirectory) {
        await fsp.rm(materializedDir, { recursive: true, force: true });
    }
}

main().catch(async (error) => {
    const report = {
        version: "generated_scaffold_validation_v1",
        pass: false,
        issues: [
            {
                code: "VALIDATOR_ERROR",
                message: error instanceof Error ? error.message : String(error)
            }
        ]
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
});
