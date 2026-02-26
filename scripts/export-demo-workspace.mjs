#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

for (const envName of [".env.local", ".env"]) {
    const envPath = path.join(projectRoot, envName);
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
    }
}

function parseArgs(argv) {
    const args = {
        email: "",
        projectId: "",
        output: path.join(projectRoot, "public", "demo", "workspace.json"),
        redact: true,
        list: false
    };

    for (let i = 2; i < argv.length; i += 1) {
        const current = argv[i];
        const next = argv[i + 1];

        if (current === "--email" && next) {
            args.email = next.trim();
            i += 1;
            continue;
        }
        if (current === "--project-id" && next) {
            args.projectId = next.trim();
            i += 1;
            continue;
        }
        if (current === "--output" && next) {
            args.output = path.resolve(projectRoot, next.trim());
            i += 1;
            continue;
        }
        if (current === "--no-redact") {
            args.redact = false;
            continue;
        }
        if (current === "--list") {
            args.list = true;
            continue;
        }
    }

    return args;
}

function printHelp() {
    console.log("Export a public demo workspace from your account data.");
    console.log("");
    console.log("Usage:");
    console.log("  npm run demo:export -- --email you@example.com --project-id <PROJECT_ID>");
    console.log("");
    console.log("Options:");
    console.log("  --email <email>         Required. User email in Forecoding.");
    console.log("  --project-id <id>       Optional. If omitted, latest project is selected.");
    console.log("  --list                  List project IDs for the user and exit.");
    console.log("  --output <path>         Output JSON path. Default: public/demo/workspace.json");
    console.log("  --no-redact             Disable masking for sensitive strings.");
}

function parseProjects(raw) {
    if (!Array.isArray(raw)) return [];

    return raw.filter((item) => {
        if (!item || typeof item !== "object") return false;
        if (typeof item.id !== "string" || item.id.trim() === "") return false;
        if (!Array.isArray(item.versions)) return false;
        return true;
    });
}

const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[_-]?key|webhook|database[_-]?url|smtp|authorization|cookie)/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_CREDENTIAL_PATTERN = /(postgres(?:ql)?|mysql|mongodb):\/\/[^\s"']+/gi;
const STRIPE_SECRET_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+)\b/g;
const STRIPE_WEBHOOK_PATTERN = /\b(whsec_[A-Za-z0-9]+)\b/g;
const GEMINI_PATTERN = /\b(AIza[0-9A-Za-z_-]{20,})\b/g;

function redactString(value) {
    return value
        .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
        .replace(URL_CREDENTIAL_PATTERN, "[REDACTED_DB_URL]")
        .replace(STRIPE_SECRET_PATTERN, "[REDACTED_STRIPE_KEY]")
        .replace(STRIPE_WEBHOOK_PATTERN, "[REDACTED_STRIPE_WEBHOOK]")
        .replace(GEMINI_PATTERN, "[REDACTED_API_KEY]");
}

function redactValue(value, keyHint = "") {
    if (typeof value === "string") {
        if (SENSITIVE_KEY_PATTERN.test(keyHint)) {
            return "[REDACTED]";
        }
        return redactString(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, keyHint));
    }

    if (!value || typeof value !== "object") {
        return value;
    }

    const next = {};
    for (const [key, child] of Object.entries(value)) {
        next[key] = redactValue(child, key);
    }
    return next;
}

function chooseProject(projects, projectId) {
    if (projectId) {
        return projects.find((project) => project.id === projectId) || null;
    }

    const sorted = [...projects].sort((a, b) => {
        const aUpdated = Number(a.updatedAt || 0);
        const bUpdated = Number(b.updatedAt || 0);
        return bUpdated - aUpdated;
    });
    return sorted[0] || null;
}

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

async function main() {
    const args = parseArgs(process.argv);

    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        printHelp();
        return;
    }

    if (!args.email) {
        console.error("Missing --email");
        printHelp();
        process.exitCode = 1;
        return;
    }

    const prisma = new PrismaClient({ log: ["warn", "error"] });

    try {
        const user = await prisma.user.findUnique({
            where: { email: args.email },
            select: { id: true, email: true }
        });

        if (!user?.id) {
            throw new Error(`User not found by email: ${args.email}`);
        }

        const workspace = await prisma.workspaceState.findUnique({
            where: { userId: user.id },
            select: { data: true, updatedAt: true }
        });

        const projects = parseProjects(workspace?.data);
        if (!projects.length) {
            throw new Error("No projects found in workspace.");
        }

        if (args.list) {
            console.log(`Projects for ${user.email}:`);
            for (const project of projects) {
                const updated = Number(project.updatedAt || 0);
                const updatedText = updated > 0 ? new Date(updated).toLocaleString() : "unknown";
                console.log(`- ${project.id} | ${project.name || "(untitled)"} | updated: ${updatedText}`);
            }
            return;
        }

        const selectedProject = chooseProject(projects, args.projectId);
        if (!selectedProject) {
            throw new Error(
                args.projectId
                    ? `Project not found: ${args.projectId}`
                    : "Unable to select project from workspace."
            );
        }

        const publicProject = args.redact
            ? redactValue(selectedProject)
            : selectedProject;

        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            project: publicProject
        };

        ensureParentDir(args.output);
        fs.writeFileSync(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

        console.log("Demo workspace exported successfully.");
        console.log(`Email: ${args.email}`);
        console.log(`Project: ${selectedProject.name || "(untitled)"} (${selectedProject.id})`);
        console.log(`Output: ${args.output}`);
        console.log("Public URL after deploy: /demo");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
