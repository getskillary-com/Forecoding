#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
    const args = {
        failOnWarning: false,
        json: false
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === "--fail-on-warning") {
            args.failOnWarning = true;
        } else if (value === "--json") {
            args.json = true;
        }
    }

    return args;
}

function loadDefaultEnvFiles() {
    const envFiles = [".env.local", ".env"];
    for (const relativePath of envFiles) {
        const absolutePath = path.join(projectRoot, relativePath);
        if (!fs.existsSync(absolutePath)) continue;
        loadDotEnv({
            path: absolutePath,
            override: false
        });
    }
}

function hasEnvValue(key) {
    return Boolean((process.env[key] || "").trim());
}

function normalizeAiProvider(value) {
    const normalized = (value || "").trim().toLowerCase();
    if (normalized === "openai" || normalized === "gemini" || normalized === "claude") {
        return normalized;
    }
    return "";
}

function issueSeverityRank(severity) {
    return severity === "error" ? 0 : 1;
}

function runRuntimePreflightGate() {
    const issues = [];

    const requiredEnv = [
        { key: "APP_BASE_URL", message: "APP_BASE_URL must be configured for canonical links and callback URLs." },
        { key: "AUTH_SESSION_COOKIE_NAME", message: "AUTH_SESSION_COOKIE_NAME must be configured for session consistency." },
        { key: "AUTH_CODE_SECRET", message: "AUTH_CODE_SECRET must be configured to sign login/reset codes." },
        { key: "EMAIL_SERVER", message: "EMAIL_SERVER must be configured to send auth and recovery emails." },
        { key: "EMAIL_FROM", message: "EMAIL_FROM must be configured for outbound auth emails." },
        { key: "FIREBASE_PROJECT_ID", message: "FIREBASE_PROJECT_ID must be configured for server-side Firebase access." },
        { key: "FIREBASE_CLIENT_EMAIL", message: "FIREBASE_CLIENT_EMAIL must be configured for server-side Firebase access." },
        { key: "FIREBASE_PRIVATE_KEY", message: "FIREBASE_PRIVATE_KEY must be configured for server-side Firebase access." },
        { key: "NEXT_PUBLIC_FIREBASE_API_KEY", message: "NEXT_PUBLIC_FIREBASE_API_KEY must be configured for browser Firebase authentication." },
        { key: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", message: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN must be configured for browser Firebase authentication." },
        { key: "NEXT_PUBLIC_FIREBASE_PROJECT_ID", message: "NEXT_PUBLIC_FIREBASE_PROJECT_ID must be configured for browser Firebase authentication." },
        { key: "NEXT_PUBLIC_FIREBASE_APP_ID", message: "NEXT_PUBLIC_FIREBASE_APP_ID must be configured for browser Firebase authentication." },
        { key: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", message: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID must be configured for browser Firebase authentication." },
        { key: "STRIPE_SECRET_KEY", message: "STRIPE_SECRET_KEY must be configured for checkout, refund, and reconciliation flows." },
        { key: "STRIPE_WEBHOOK_SECRET", message: "STRIPE_WEBHOOK_SECRET must be configured for webhook signature verification." }
    ];

    for (const requirement of requiredEnv) {
        if (hasEnvValue(requirement.key)) continue;
        issues.push({
            code: "ENV_MISSING",
            severity: "error",
            envKey: requirement.key,
            message: requirement.message
        });
    }

    const hasAdminEmails = hasEnvValue("FORECODING_ADMIN_EMAILS") || hasEnvValue("ADMIN_EMAILS");
    if (!hasAdminEmails) {
        issues.push({
            code: "ADMIN_CONFIG_MISSING",
            severity: "error",
            envKey: "FORECODING_ADMIN_EMAILS",
            message: "At least one admin email must be configured in FORECODING_ADMIN_EMAILS (or ADMIN_EMAILS)."
        });
    }

    const appBaseUrl = (process.env.APP_BASE_URL || "").trim();
    if (appBaseUrl) {
        try {
            const parsed = new URL(appBaseUrl);
            if (!parsed.protocol || (parsed.protocol !== "https:" && process.env.NODE_ENV === "production")) {
                issues.push({
                    code: "APP_BASE_URL_INSECURE",
                    severity: "warning",
                    envKey: "APP_BASE_URL",
                    message: "APP_BASE_URL should use HTTPS in production."
                });
            }
        } catch {
            issues.push({
                code: "APP_BASE_URL_INVALID",
                severity: "error",
                envKey: "APP_BASE_URL",
                message: "APP_BASE_URL is not a valid URL."
            });
        }
    }

    const aiProvider = normalizeAiProvider(process.env.AI_PROVIDER);
    if (!aiProvider) {
        issues.push({
            code: "AI_PROVIDER_INVALID",
            severity: "error",
            envKey: "AI_PROVIDER",
            message: "AI_PROVIDER must be one of: openai, gemini, claude."
        });
    } else if (aiProvider === "openai" && !hasEnvValue("OPENAI_API_KEY")) {
        issues.push({
            code: "AI_PROVIDER_KEY_MISSING",
            severity: "error",
            envKey: "OPENAI_API_KEY",
            message: "OPENAI_API_KEY is required when AI_PROVIDER=openai."
        });
    } else if (aiProvider === "gemini" && !hasEnvValue("GEMINI_API_KEY")) {
        issues.push({
            code: "AI_PROVIDER_KEY_MISSING",
            severity: "error",
            envKey: "GEMINI_API_KEY",
            message: "GEMINI_API_KEY is required when AI_PROVIDER=gemini."
        });
    } else if (aiProvider === "claude" && !hasEnvValue("CLAUDE_API_KEY") && !hasEnvValue("ANTHROPIC_API_KEY")) {
        issues.push({
            code: "AI_PROVIDER_KEY_MISSING",
            severity: "error",
            envKey: "CLAUDE_API_KEY",
            message: "CLAUDE_API_KEY (or ANTHROPIC_API_KEY) is required when AI_PROVIDER=claude."
        });
    }

    if (process.env.NODE_ENV === "production" && (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS || "").trim() === "1") {
        issues.push({
            code: "DEV_AUTH_BYPASS_ENABLED",
            severity: "warning",
            envKey: "NEXT_PUBLIC_DEV_AUTH_BYPASS",
            message: "NEXT_PUBLIC_DEV_AUTH_BYPASS=1 should not be enabled in production."
        });
    }

    issues.sort((left, right) => {
        const severityOrder = issueSeverityRank(left.severity) - issueSeverityRank(right.severity);
        if (severityOrder !== 0) return severityOrder;
        const keyOrder = (left.envKey || "").localeCompare(right.envKey || "");
        if (keyOrder !== 0) return keyOrder;
        return left.code.localeCompare(right.code);
    });

    return {
        checkedAt: Date.now(),
        pass: issues.every((issue) => issue.severity !== "error"),
        issues
    };
}

function renderIssue(issue) {
    const keySuffix = issue.envKey ? ` (${issue.envKey})` : "";
    return `[${issue.severity.toUpperCase()}] ${issue.code}${keySuffix}: ${issue.message}`;
}

function main() {
    const args = parseArgs(process.argv);
    loadDefaultEnvFiles();

    const result = runRuntimePreflightGate();
    const errorCount = result.issues.filter((issue) => issue.severity === "error").length;
    const warningCount = result.issues.filter((issue) => issue.severity === "warning").length;
    const shouldFail = errorCount > 0 || (args.failOnWarning && warningCount > 0);

    if (args.json) {
        process.stdout.write(`${JSON.stringify({
            checkedAt: result.checkedAt,
            pass: result.pass,
            failOnWarning: args.failOnWarning,
            errorCount,
            warningCount,
            issues: result.issues
        }, null, 2)}\n`);
    } else if (result.issues.length === 0) {
        process.stdout.write("Runtime preflight gate passed (0 issues).\n");
    } else {
        const lines = [
            `Runtime preflight gate ${shouldFail ? "failed" : "passed with warnings"} (errors=${errorCount}, warnings=${warningCount}).`,
            ...result.issues.map((issue) => renderIssue(issue))
        ];
        process.stdout.write(`${lines.join("\n")}\n`);
    }

    if (shouldFail) {
        process.exitCode = 1;
    }
}

main();
